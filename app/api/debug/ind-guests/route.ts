import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { ffadmin } from '@/lib/ffadmin'
import { getOpenProposalsForArtist } from '@/lib/services/proposals'

const ALLOWED_EMAILS = new Set(['info@miguelstapleton.art'])

export async function GET(request: NextRequest) {
  const me = await getUserFromRequest(request)
  if (!me || !ALLOWED_EMAILS.has(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Who is logged in?
  const artist = await prisma.artist.findUnique({
    where: { userId: me.id },
    include: { user: true },
  })

  // respondedClientIds for this artist (same logic as proposals.ts)
  const respondedProposals = artist
    ? await prisma.proposal.findMany({
        where: { artistId: artist.id, response: { not: null } },
        include: { clientService: true },
      })
    : []
  const respondedClientIds = new Set(respondedProposals.map((p: any) => p.clientService.clientItemId))

  // Raw fetch from FFadmin Supabase — same query as proposals.ts
  const boolCol = artist?.type === 'MUA' ? 'mu' : 'h'
  const { data: allGuests, error: fetchError } = await ffadmin
    .from('independent_guests')
    .select('id, item_id_ind, client_name, event_date, mu, h, archived')
    .eq(boolCol, true)
    .order('id', { ascending: false })
    .limit(20)

  const now = new Date()

  const annotated = (allGuests ?? []).map((g: any) => {
    const reasons: string[] = []
    if (!g.item_id_ind) reasons.push('SKIP: item_id_ind is null/0')
    const eventDate = g.event_date ? new Date(g.event_date + 'T00:00:00') : null
    if (!eventDate) reasons.push('SKIP: event_date is null')
    else if (eventDate.getTime() <= now.getTime()) reasons.push(`SKIP: event_date ${g.event_date} is past/today`)
    const itemId = String(g.item_id_ind)
    if (g.item_id_ind && respondedClientIds.has(itemId)) reasons.push(`SKIP: ${itemId} is in respondedClientIds`)
    if (reasons.length === 0) reasons.push('PASS: should appear in proposals')
    return { id: g.id, item_id_ind: g.item_id_ind, client_name: g.client_name, event_date: g.event_date, mu: g.mu, h: g.h, filter_result: reasons }
  })

  // Also check for any ClientService with clientItemId = 'null'
  const nullClientServices = await prisma.clientService.findMany({
    where: { clientItemId: 'null' },
    include: { proposals: { select: { response: true } } },
  })

  // Call the actual proposals function and see what it returns
  let actualProposals: any[] = []
  let actualProposalsError: string | null = null
  try {
    actualProposals = await getOpenProposalsForArtist(me.id)
  } catch (e: any) {
    actualProposalsError = e?.message ?? String(e)
  }

  return NextResponse.json({
    now: now.toISOString(),
    logged_in_as: { email: me.email, role: me.role, userId: me.id },
    artist: artist ? { id: artist.id, type: artist.type, email: artist.email } : null,
    boolCol_used: boolCol,
    ffadmin_fetch_error: fetchError ?? null,
    respondedClientIds: Array.from(respondedClientIds),
    guests: annotated,
    null_client_services: nullClientServices.map((cs: any) => ({
      id: cs.id, service: cs.service,
      responses: cs.proposals.map((p: any) => p.response),
    })),
    actual_proposals_count: actualProposals.length,
    actual_proposals_error: actualProposalsError,
    actual_proposals: actualProposals.map(p => ({
      id: p.id,
      clientName: p.clientName,
      eventDate: p.eventDate,
      isIndependentGuest: p.isIndependentGuest ?? false,
    })),
  })
}
