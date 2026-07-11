import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createBatchAndProposals, createBatchForSpecificArtists } from '@/lib/services/proposals'
import { logAudit } from '@/lib/audit'
import { sendNewProposalNotification, sendPushToArtistsByType } from '@/lib/push'
import { ServiceType as PrismaServiceType } from '@prisma/client'
import { resolveArtistEmailFromDisplayName } from '@/lib/ffadmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-ffadmin-secret')
    if (process.env.FFADMIN_WEBHOOK_SECRET && secret !== process.env.FFADMIN_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { type } = body

    if (type === 'new_independent_guest' || type === 'guest_boolean_flip') {
      await handleIndependentGuest(body)
    } else if (type === 'client_status_change') {
      await handleClientStatusChange(body)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[ffadmin:webhook] error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}

// ── Independent Guests ───────────────────────────────────────────────────────

async function handleIndependentGuest(body: any) {
  const { serviceType, item_id_ind, client_name, event_date } = body
  if (!serviceType || !item_id_ind) return
  const eventDate = event_date ? new Date(event_date + 'T00:00:00') : null
  if (!eventDate || eventDate.getTime() <= Date.now()) return

  await sendPushToArtistsByType(serviceType, {
    title: 'New Independent Guest',
    body: `${client_name || 'Guest'} on ${eventDate.toLocaleDateString('en-GB')}`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/get-clients',
    data: { type: 'new_proposal', board: 'Independent Guests', itemId: String(item_id_ind) },
  })
}

// ── Client status changes ────────────────────────────────────────────────────

async function handleClientStatusChange(body: any) {
  const {
    serviceType, clientItemId,
    m_status, h_status,
    chosen_mua, chosen_hs,
    bride_name, wedding_date, beauty_venue, observations,
  } = body

  if (!serviceType || !clientItemId) return

  const status: string = (serviceType === 'MUA' ? m_status : h_status) || ''
  const chosenName: string | null = serviceType === 'MUA' ? chosen_mua : chosen_hs
  const serviceTypeEnum: PrismaServiceType = serviceType === 'MUA' ? 'MUA' : 'HS'
  const itemIdStr = String(clientItemId)
  const eventDate = wedding_date ? new Date(wedding_date + 'T00:00:00') : new Date()
  const brideName: string = bride_name || 'Client'

  const clientServiceId = await upsertClientServiceDirect({
    clientItemId: itemIdStr,
    serviceType: serviceTypeEnum,
    bridesName: brideName,
    weddingDate: eventDate,
    beautyVenue: beauty_venue || '',
    description: observations || null,
    currentStatus: status || null,
  })

  const norm = (s: string) => s.toLowerCase().trim()

  if (norm(status) === 'undecided') {
    await handleUndecided(clientServiceId, serviceType, serviceTypeEnum, brideName, eventDate)
  } else if (norm(status) === 'inquire artist') {
    await handleInquireArtist(clientServiceId, serviceType, serviceTypeEnum, chosenName, brideName, eventDate)
  } else if (norm(status) === 'inquire second option') {
    await handleSecondOption(clientServiceId, serviceType, serviceTypeEnum, chosenName, brideName, eventDate)
  }
}

async function upsertClientServiceDirect(data: {
  clientItemId: string
  serviceType: PrismaServiceType
  bridesName: string
  weddingDate: Date
  beautyVenue: string
  description: string | null
  currentStatus: string | null
}): Promise<string> {
  let cs = await prisma.clientService.findFirst({
    where: { clientItemId: data.clientItemId, service: data.serviceType },
  })
  if (cs) {
    cs = await prisma.clientService.update({
      where: { id: cs.id },
      data: {
        bridesName: data.bridesName,
        weddingDate: data.weddingDate,
        beautyVenue: data.beautyVenue,
        description: data.description,
        currentStatus: data.currentStatus,
      },
    })
  } else {
    cs = await prisma.clientService.create({
      data: {
        clientItemId: data.clientItemId,
        service: data.serviceType,
        bridesName: data.bridesName,
        weddingDate: data.weddingDate,
        beautyVenue: data.beautyVenue,
        description: data.description,
        currentStatus: data.currentStatus,
      },
    })
  }
  return cs.id
}

async function handleUndecided(
  clientServiceId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: PrismaServiceType,
  brideName: string,
  eventDate: Date
) {
  const artists = await prisma.artist.findMany({
    where: { type: serviceType, active: true },
    select: { id: true },
  })
  if (artists.length === 0) return
  const { batchId, proposalCount } = await createBatchAndProposals(clientServiceId, 'BROADCAST', 'UNDECIDED')
  await logAudit({
    action: 'STARTED', entityType: 'BATCH', entityId: clientServiceId,
    details: { batchId, mode: 'BROADCAST', serviceType, proposalCount, note: 'undecided from FFadmin' },
  })
  await sendNewProposalNotification(artists.map(a => a.id), brideName, serviceTypeEnum, eventDate)
}

async function handleInquireArtist(
  clientServiceId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: PrismaServiceType,
  chosenName: string | null,
  brideName: string,
  eventDate: Date
) {
  const email = resolveArtistEmailFromDisplayName(chosenName, serviceType)
  if (!email) {
    console.warn('[ffadmin:webhook] Cannot resolve artist email from name', chosenName)
    return
  }
  const artist = await prisma.artist.findFirst({ where: { email, type: serviceType, active: true } })
  if (!artist) {
    console.warn('[ffadmin:webhook] Artist not found in DB', { email, serviceType })
    return
  }
  const { batchId, proposalCount } = await createBatchForSpecificArtists(
    clientServiceId, 'SINGLE', 'CHOSEN_NO', [artist.id]
  )
  await logAudit({
    action: 'STARTED', entityType: 'BATCH', entityId: clientServiceId,
    details: { batchId, mode: 'SINGLE', serviceType, chosenArtistEmail: email, proposalCount, note: 'Inquire artist from FFadmin' },
  })
  await sendNewProposalNotification([artist.id], brideName, serviceTypeEnum, eventDate)
}

async function handleSecondOption(
  clientServiceId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: PrismaServiceType,
  chosenName: string | null,
  brideName: string,
  eventDate: Date
) {
  const exceptionEmail = resolveArtistEmailFromDisplayName(chosenName, serviceType)
  const allArtists = await prisma.artist.findMany({ where: { type: serviceType, active: true } })
  const filtered = exceptionEmail ? allArtists.filter(a => a.email !== exceptionEmail) : allArtists
  if (filtered.length === 0) return
  const { batchId, proposalCount } = await createBatchForSpecificArtists(
    clientServiceId, 'BROADCAST', 'UNDECIDED', filtered.map(a => a.id)
  )
  await logAudit({
    action: 'STARTED', entityType: 'BATCH', entityId: clientServiceId,
    details: { batchId, mode: 'BROADCAST', serviceType, exceptionEmail, proposalCount, note: 'second option from FFadmin' },
  })
  await sendNewProposalNotification(filtered.map(a => a.id), brideName, serviceTypeEnum, eventDate)
}
