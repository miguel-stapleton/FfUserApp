import { prisma } from '../prisma'
import { ServiceType, ProposalResponse } from '@prisma/client'
import { logAudit } from '../audit'
import { BackofficeClientInfo, UpsertClientServiceRequest } from '@/lib/types'
import { ffadmin } from '../ffadmin'
import { formatInTimeZone } from 'date-fns-tz'

/**
 * Upsert client service with data from FFadmin Supabase
 */
export async function upsertClientServiceFromFFadmin(
  clientItemId: string,
  serviceType: ServiceType,
  actorUserId?: string
): Promise<string> {
  const itemIdNum = Number(clientItemId)
  const { data: client } = await ffadmin
    .from('clients')
    .select('bride_name, wedding_date, beauty_venue, notes')
    .eq('item_id', itemIdNum)
    .maybeSingle()

  if (!client) {
    throw new Error(`Client not found in FFadmin with item_id: ${clientItemId}`)
  }

  let clientService = await prisma.clientService.findFirst({
    where: { clientItemId, service: serviceType },
  })

  const data = {
    bridesName: client.bride_name || '',
    weddingDate: client.wedding_date ? new Date(client.wedding_date) : new Date(),
    beautyVenue: client.beauty_venue || '',
    description: client.notes || '',
  }

  if (clientService) {
    clientService = await prisma.clientService.update({
      where: { id: clientService.id },
      data,
    })
  } else {
    clientService = await prisma.clientService.create({
      data: { clientItemId, service: serviceType, ...data },
    })
  }

  await logAudit({
    action: 'UPSERT',
    entityType: 'CLIENT_SERVICE',
    entityId: clientService.id,
    details: { clientItemId, service: serviceType, bridesName: client.bride_name },
    userId: actorUserId,
  })

  return clientService.id
}

/**
 * Upsert client service with manual data
 */
export async function upsertClientService(
  data: UpsertClientServiceRequest,
  actorUserId?: string
): Promise<string> {
  let clientService = await prisma.clientService.findFirst({
    where: { clientItemId: data.clientItemId, service: data.serviceType as any },
  })

  if (clientService) {
    clientService = await prisma.clientService.update({
      where: { id: clientService.id },
      data: {
        bridesName: data.clientName,
        weddingDate: data.eventDate,
        beautyVenue: data.eventLocation || '',
        description: data.notes,
      },
    })
  } else {
    clientService = await prisma.clientService.create({
      data: {
        clientItemId: data.clientItemId,
        service: data.serviceType as any,
        bridesName: data.clientName,
        weddingDate: data.eventDate,
        beautyVenue: data.eventLocation || '',
        description: data.notes,
      },
    })
  }

  await logAudit({
    action: 'UPSERT',
    entityType: 'CLIENT_SERVICE',
    entityId: clientService.id,
    details: {
      clientItemId: data.clientItemId,
      service: data.serviceType,
      bridesName: data.clientName,
      weddingDate: data.eventDate.toISOString(),
    },
    userId: actorUserId,
  })

  return clientService.id
}

export async function getClientServiceByItemId(clientItemId: string) {
  return await prisma.clientService.findFirst({
    where: { clientItemId },
    include: {
      batches: {
        include: {
          proposals: {
            include: {
              artist: { select: { id: true, email: true, type: true, tier: true } },
            },
          },
        },
      },
    },
  })
}

export async function getClientServices(options?: {
  service?: ServiceType
  limit?: number
  offset?: number
}) {
  const where: any = {}
  if (options?.service) where.service = options.service

  return await prisma.clientService.findMany({
    where,
    include: {
      batches: { select: { id: true, state: true, mode: true, createdAt: true } },
    },
    orderBy: { weddingDate: 'asc' },
    take: options?.limit,
    skip: options?.offset,
  })
}

export async function deleteClientService(
  clientServiceId: string,
  actorUserId?: string
): Promise<void> {
  const clientService = await prisma.clientService.findUnique({
    where: { id: clientServiceId },
  })
  if (!clientService) throw new Error('Client service not found')

  const activeBatches = await prisma.proposalBatch.findMany({
    where: { clientServiceId, state: 'OPEN' },
  })
  if (activeBatches.length > 0) {
    throw new Error('Cannot delete client service with active proposal batches')
  }

  await prisma.clientService.delete({ where: { id: clientServiceId } })

  await logAudit({
    action: 'DELETE',
    entityType: 'CLIENT_SERVICE',
    entityId: clientServiceId,
    details: { bridesName: clientService.bridesName, clientItemId: clientService.clientItemId },
    userId: actorUserId,
  })
}

/**
 * Get detailed client information for backoffice modal (reads from FFadmin Supabase)
 */
export async function getBackofficeClientInfo(clientItemId: string): Promise<BackofficeClientInfo | null> {
  try {
    const itemIdNum = Number(clientItemId)

    const { data: client } = await ffadmin
      .from('clients')
      .select('*')
      .eq('item_id', itemIdNum)
      .maybeSingle()

    if (!client) return null

    const clientServices = await prisma.clientService.findMany({
      where: { clientItemId },
      include: {
        batches: {
          include: {
            proposals: { include: { artist: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        auditLogs: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (clientServices.length === 0) return null

    const muaService = clientServices.find(cs => cs.service === ServiceType.MUA)
    const hsService = clientServices.find(cs => cs.service === ServiceType.HS)

    const getLatestBatch = (service: any) => {
      if (!service?.batches?.length) return null
      return service.batches.find((b: any) => b.state === 'OPEN') || service.batches[0]
    }

    const muaBatch = getLatestBatch(muaService)
    const hsBatch = getLatestBatch(hsService)

    const allProposals = [
      ...(muaBatch?.proposals || []),
      ...(hsBatch?.proposals || []),
    ]

    type ArtistInfo = { email: string; tier: string }
    const availableArtists: { mua: ArtistInfo[]; hs: ArtistInfo[] } = { mua: [], hs: [] }
    const unavailableArtists: { mua: ArtistInfo[]; hs: ArtistInfo[] } = { mua: [], hs: [] }

    allProposals.forEach(proposal => {
      const artist: ArtistInfo = { email: proposal.artist.email, tier: proposal.artist.tier }
      const type = proposal.artist.type === 'MUA' ? 'mua' : 'hs'
      if (proposal.response === ProposalResponse.YES) {
        availableArtists[type].push(artist)
      } else if (proposal.response === ProposalResponse.NO) {
        unavailableArtists[type].push(artist)
      }
    })

    const timeline: Array<{ timestamp: string; event: string; icon: string }> = []

    clientServices.forEach(service => {
      service.auditLogs.forEach((log: any) => {
        const timestamp = formatInTimeZone(log.createdAt, 'Europe/Lisbon', 'MMM dd, yyyy HH:mm')
        let event = ''
        let icon = '📝'

        switch (log.action) {
          case 'BATCH_CREATED':
            event = `${service.service} batch created`
            icon = '🚀'
            break
          case 'BATCH_COMPLETED':
            event = `${service.service} batch completed`
            icon = '✅'
            break
          case 'PROPOSAL_RESPONSE': {
            const payload = log.payload as any
            event = `${payload.artistEmail} responded ${payload.response} to ${service.service} proposal`
            icon = payload.response === 'YES' ? '✅' : '❌'
            break
          }
          default:
            event = `${log.action} - ${service.service}`
        }

        timeline.push({ timestamp, event, icon })
      })
    })

    allProposals.forEach(proposal => {
      if (proposal.respondedAt && proposal.response) {
        const timestamp = formatInTimeZone(proposal.respondedAt, 'Europe/Lisbon', 'MMM dd, yyyy HH:mm')
        const event = `${proposal.artist.email} responded ${proposal.response}`
        const icon = proposal.response === ProposalResponse.YES ? '✅' : '❌'
        const exists = timeline.some(
          t => t.timestamp === timestamp && t.event.includes(proposal.artist.email) && t.event.includes(proposal.response)
        )
        if (!exists) timeline.push({ timestamp, event, icon })
      }
    })

    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return {
      clientItemId,
      clientName: client.bride_name || '',
      eventDate: client.wedding_date ? new Date(client.wedding_date).toISOString() : '',
      beautyVenue: client.beauty_venue || '',
      observations: client.notes || '',
      mStatus: client.m_status || '',
      hStatus: client.h_status || '',
      availableArtists,
      unavailableArtists,
      timeline,
    }
  } catch (error) {
    console.error('Error fetching backoffice client info:', error)
    throw new Error('Failed to fetch client info')
  }
}
