import { prisma } from '../prisma'
import { ArtistType, ProposalResponse, ServiceType } from '@prisma/client'
import { logAudit } from '../audit'
import { BackofficeClientInfo, UpsertClientServiceRequest } from '@/lib/types'
import { getClientFromMonday } from '../monday'
import { formatInTimeZone } from 'date-fns-tz'

/**
 * Upsert a client service from Monday.com data
 */
export async function upsertClientServiceFromMonday(
  mondayClientItemId: string,
  serviceType: ServiceType,
  actorUserId?: string
): Promise<string> {
  // Get client data from Monday.com
  const mondayClient = await getClientFromMonday(mondayClientItemId)
  
  if (!mondayClient) {
    throw new Error(`Client not found in Monday.com with ID: ${mondayClientItemId}`)
  }

  // Find existing client service or create new one
  let clientService = await prisma.clientService.findFirst({
    where: {
      mondayClientItemId,
      service: serviceType,
    },
  })

  if (clientService) {
    // Update existing
    clientService = await prisma.clientService.update({
      where: { id: clientService.id },
      data: {
        bridesName: mondayClient.name,
        weddingDate: mondayClient.eventDate,
        beautyVenue: mondayClient.beautyVenue || '',
        description: mondayClient.notes,
      },
    })
  } else {
    // Create new
    clientService = await prisma.clientService.create({
      data: {
        mondayClientItemId,
        service: serviceType,
        bridesName: mondayClient.name,
        weddingDate: mondayClient.eventDate,
        beautyVenue: mondayClient.beautyVenue || '',
        description: mondayClient.notes,
      },
    })
  }

  // Log the upsert action
  await logAudit({
    action: 'UPSERT',
    entityType: 'CLIENT_SERVICE',
    entityId: clientService.id,
    details: {
      mondayClientItemId,
      service: serviceType,
      bridesName: mondayClient.name,
      weddingDate: mondayClient.eventDate.toISOString(),
    },
    userId: actorUserId,
  })

  return clientService.id
}

/**
 * Upsert client service with manual data (not from Monday.com)
 */
export async function upsertClientService(
  data: UpsertClientServiceRequest,
  actorUserId?: string
): Promise<string> {
  // Find existing client service or create new one
  let clientService = await prisma.clientService.findFirst({
    where: {
      mondayClientItemId: data.mondayClientItemId,
      service: data.serviceType as any,
    },
  })

  if (clientService) {
    // Update existing
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
    // Create new
    clientService = await prisma.clientService.create({
      data: {
        mondayClientItemId: data.mondayClientItemId,
        service: data.serviceType as any,
        bridesName: data.clientName,
        weddingDate: data.eventDate,
        beautyVenue: data.eventLocation || '',
        description: data.notes,
      },
    })
  }

  // Log the upsert action
  await logAudit({
    action: 'UPSERT',
    entityType: 'CLIENT_SERVICE',
    entityId: clientService.id,
    details: {
      mondayClientItemId: data.mondayClientItemId,
      service: data.serviceType,
      bridesName: data.clientName,
      weddingDate: data.eventDate.toISOString(),
    },
    userId: actorUserId,
  })

  return clientService.id
}

/**
 * Get client service by Monday.com item ID
 */
export async function getClientServiceByMondayId(mondayClientItemId: string) {
  return await prisma.clientService.findFirst({
    where: {
      mondayClientItemId,
    },
    include: {
      batches: {
        include: {
          proposals: {
            include: {
              artist: {
                select: {
                  id: true,
                  email: true,
                  type: true,
                  tier: true,
                },
              },
            },
          },
        },
      },
    },
  })
}

/**
 * Get all client services with optional filtering
 */
export async function getClientServices(options?: {
  service?: ServiceType
  limit?: number
  offset?: number
}) {
  const where: any = {}
  
  if (options?.service) {
    where.service = options.service
  }

  return await prisma.clientService.findMany({
    where,
    include: {
      batches: {
        select: {
          id: true,
          state: true,
          mode: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      weddingDate: 'asc',
    },
    take: options?.limit,
    skip: options?.offset,
  })
}

/**
 * Sync client data from Monday.com (update existing records)
 */
export async function syncClientFromMonday(
  mondayClientItemId: string,
  actorUserId?: string
): Promise<void> {
  const existingClient = await prisma.clientService.findFirst({
    where: { mondayClientItemId },
  })

  if (!existingClient) {
    throw new Error(`Client service not found with Monday ID: ${mondayClientItemId}`)
  }

  // Get updated data from Monday.com
  const mondayClient = await getClientFromMonday(mondayClientItemId)
  
  if (!mondayClient) {
    throw new Error(`Client not found in Monday.com with ID: ${mondayClientItemId}`)
  }

  // Update the client service
  await prisma.clientService.update({
    where: { id: existingClient.id },
    data: {
      bridesName: mondayClient.name,
      weddingDate: mondayClient.eventDate,
      beautyVenue: mondayClient.beautyVenue || '',
      description: mondayClient.notes,
    },
  })

  // Log the sync action
  await logAudit({
    action: 'SYNC',
    entityType: 'CLIENT_SERVICE',
    entityId: existingClient.id,
    details: {
      mondayClientItemId,
      bridesName: mondayClient.name,
      weddingDate: mondayClient.eventDate.toISOString(),
    },
    userId: actorUserId,
  })
}

/**
 * Delete a client service
 */
export async function deleteClientService(
  clientServiceId: string,
  actorUserId?: string
): Promise<void> {
  const clientService = await prisma.clientService.findUnique({
    where: { id: clientServiceId },
  })

  if (!clientService) {
    throw new Error('Client service not found')
  }

  // Check if there are any active proposal batches
  const activeBatches = await prisma.proposalBatch.findMany({
    where: {
      clientServiceId,
      state: 'OPEN',
    },
  })

  if (activeBatches.length > 0) {
    throw new Error('Cannot delete client service with active proposal batches')
  }

  await prisma.clientService.delete({
    where: { id: clientServiceId },
  })

  // Log the deletion
  await logAudit({
    action: 'DELETE',
    entityType: 'CLIENT_SERVICE',
    entityId: clientServiceId,
    details: {
      bridesName: clientService.bridesName,
      mondayClientItemId: clientService.mondayClientItemId,
    },
    userId: actorUserId,
  })
}

/**
 * Get detailed client information for backoffice modal
 */
export async function getBackofficeClientInfo(mondayClientItemId: string): Promise<BackofficeClientInfo | null> {
  try {
    // Fetch live client data from Monday.com
    const mondayClient = await getClientFromMonday(mondayClientItemId)
    if (!mondayClient) {
      return null
    }

    // Find ClientService records for this Monday client
    const clientServices = await prisma.clientService.findMany({
      where: {
        mondayClientItemId: mondayClientItemId
      },
      include: {
        batches: {
          include: {
            proposals: {
              include: {
                artist: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        auditLogs: {
          orderBy: {
            createdAt: 'asc'
          }
        }
      }
    })

    if (clientServices.length === 0) {
      return null
    }

    // Get the latest OPEN batch or most recent batch for each service type
    const muaService = clientServices.find(cs => cs.service === ServiceType.MUA)
    const hsService = clientServices.find(cs => cs.service === ServiceType.HS)

    const getLatestBatch = (service: any) => {
      if (!service?.batches?.length) return null
      const openBatch = service.batches.find((batch: any) => batch.state === 'OPEN')
      return openBatch || service.batches[0]
    }

    const muaBatch = getLatestBatch(muaService)
    const hsBatch = getLatestBatch(hsService)

    // Get all artists from the latest batches
    const allProposals = [
      ...(muaBatch?.proposals || []),
      ...(hsBatch?.proposals || [])
    ]

    // Group artists by availability and type/tier
    type ArtistInfo = {
      email: string
      tier: string
    }
    
    const availableArtists: {
      mua: ArtistInfo[]
      hs: ArtistInfo[]
    } = {
      mua: [],
      hs: []
    }

    const unavailableArtists: {
      mua: ArtistInfo[]
      hs: ArtistInfo[]
    } = {
      mua: [],
      hs: []
    }

    allProposals.forEach(proposal => {
      const artist: ArtistInfo = {
        email: proposal.artist.email,
        tier: proposal.artist.tier,
      }

      const type = proposal.artist.type === 'MUA' ? 'mua' : 'hs'

      if (proposal.response === ProposalResponse.YES) {
        availableArtists[type].push(artist)
      } else if (proposal.response === ProposalResponse.NO) {
        unavailableArtists[type].push(artist)
      }
    })

    // Build timeline from audit logs and proposal responses
    const timeline: Array<{
      timestamp: string
      event: string
      icon: string
    }> = []

    // Add audit log events
    clientServices.forEach(service => {
      service.auditLogs.forEach(log => {
        const timestamp = formatInTimeZone(
          log.createdAt,
          'Europe/Lisbon',
          'MMM dd, yyyy HH:mm'
        )

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
          case 'PROPOSAL_RESPONSE':
            const payload = log.payload as any
            event = `${payload.artistEmail} responded ${payload.response} to ${service.service} proposal`
            icon = payload.response === 'YES' ? '✅' : '❌'
            break
          default:
            event = `${log.action} - ${service.service}`
        }

        timeline.push({ timestamp, event, icon })
      })
    })

    // Add proposal responses that might not be in audit logs
    allProposals.forEach(proposal => {
      if (proposal.respondedAt && proposal.response) {
        const timestamp = formatInTimeZone(
          proposal.respondedAt,
          'Europe/Lisbon',
          'MMM dd, yyyy HH:mm'
        )

        const event = `${proposal.artist.email} responded ${proposal.response}`
        const icon = proposal.response === ProposalResponse.YES ? '✅' : '❌'

        // Check if this event is already in timeline
        const exists = timeline.some(t => 
          t.timestamp === timestamp && 
          t.event.includes(proposal.artist.email) &&
          t.event.includes(proposal.response)
        )

        if (!exists) {
          timeline.push({ timestamp, event, icon })
        }
      }
    })

    // Sort timeline by timestamp (most recent first)
    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return {
      mondayClientItemId,
      clientName: mondayClient.name,
      eventDate: mondayClient.eventDate.toISOString(),
      beautyVenue: mondayClient.beautyVenue,
      observations: mondayClient.observations,
      mStatus: mondayClient.mStatus,
      hStatus: mondayClient.hStatus,
      availableArtists,
      unavailableArtists,
      timeline
    }

  } catch (error) {
    console.error('Error fetching backoffice client info:', error)
    throw new Error('Failed to fetch client info')
  }
}
