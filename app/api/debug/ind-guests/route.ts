import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { ffadmin } from '@/lib/ffadmin'

const ALLOWED_EMAILS = new Set(['info@miguelstapleton.art'])

export async function GET(request: NextRequest) {
  const me = await getUserFromRequest(request)
  if (!me || !ALLOWED_EMAILS.has(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Raw fetch of ALL independent guests from FFadmin Supabase
  const { data: allGuests, error: fetchError } = await ffadmin
    .from('independent_guests')
    .select('id, item_id_ind, client_name, event_date, mu, h, archived')
    .order('id', { ascending: false })
    .limit(20)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message, fetchError }, { status: 500 })
  }

  const now = new Date()

  // Annotate each guest with why it would pass/fail the proposal filters
  const annotated = (allGuests ?? []).map((g: any) => {
    const reasons: string[] = []

    if (!g.item_id_ind) reasons.push('SKIP: item_id_ind is null/0')

    const eventDate = g.event_date ? new Date(g.event_date + 'T00:00:00') : null
    if (!eventDate) reasons.push('SKIP: event_date is null')
    else if (eventDate.getTime() <= now.getTime()) reasons.push(`SKIP: event_date ${g.event_date} is in the past`)

    if (reasons.length === 0) reasons.push('PASS: would appear in proposals (if artist type matches and not already responded)')

    return {
      id: g.id,
      item_id_ind: g.item_id_ind,
      client_name: g.client_name,
      event_date: g.event_date,
      mu: g.mu,
      h: g.h,
      archived: g.archived,
      filter_result: reasons,
    }
  })

  // Check FFuser Prisma for any ClientService with clientItemId = 'null'
  const nullClientService = await prisma.clientService.findMany({
    where: { clientItemId: 'null' },
    include: {
      proposals: { select: { response: true, respondedAt: true } },
    },
  })

  return NextResponse.json({
    now: now.toISOString(),
    ffadmin_fetch_error: fetchError ?? null,
    guests: annotated,
    null_client_services_in_ffuser_db: nullClientService.map(cs => ({
      id: cs.id,
      bridesName: cs.bridesName,
      service: cs.service,
      responses: cs.proposals.map(p => ({ response: p.response, respondedAt: p.respondedAt })),
    })),
  })
}
