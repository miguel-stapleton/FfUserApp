import { prisma } from '../prisma'
import { ArtistType, ProposalResponse, ServiceType } from '@prisma/client'
import { logAudit } from '../audit'
import { BackofficeClientInfo } from '@/lib/types'
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
      serviceType,
    },
  })

  if (clientService) {
    // Update existing
    clientService = await prisma.clientService.update({
      where: { id: clientService.id },
      data: {
        clientName: mondayClient.name,
        clientEmail: mondayClient.email,
        clientPhone: mondayClient.phone,
        eventDate: mondayClient.eventDate,
        eventLocation: mondayClient.location,
        budget: mondayClient.budget,
        notes: mondayClient.notes,
      },
    })
  } else {
    // Create new
    clientService = await prisma.clientService.create({
      data: {
        mondayClientItemId,
        serviceType,
        clientName: mondayClient.name,
        clientEmail: mondayClient.email,
        clientPhone: mondayClient.phone,
        eventDate: mondayClient.eventDate,
        eventLocation: mondayClient.location,
        budget: mondayClient.budget,
        notes: mondayClient.notes,
      },
    })
  }

  // Log the upsert action
  await logAudit({
    action: 'UPSERT',
    entityType: 'CLIENT_SERVICE',
    entityId: clientService.id,
    payload: {
      mondayClientItemId,
      serviceType,
      clientName: mondayClient.name,
      clientEmail: mondayClient.email,
      eventDate: mondayClient.eventDate.toISOString(),
      isNew: !clientService.updatedAt || clientService.createdAt === clientService.updatedAt,
    },
    actorUserId,
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
  const clientService = await prisma.clientService.findFirst({
    where: {
      mondayClientItemId: data.mondayClientItemId,
      serviceType: data.serviceType,
    },
  })

  if (clientService) {
    // Update existing
    clientService = await prisma.clientService.update({
      where: { id: clientService.id },
      data: {
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        eventDate: data.eventDate,
        eventLocation: data.eventLocation,
        budget: data.budget,
        notes: data.notes,
      },
    })
  } else {
    // Create new
    clientService = await prisma.clientService.create({
      data: {
        mondayClientItemId: data.mondayClientItemId,
        serviceType: data.serviceType,
        clientName: data.clientName,
        clientEmail: data.clientEmail,
        clientPhone: data.clientPhone,
        eventDate: data.eventDate,
        eventLocation: data.eventLocation,
        budget: data.budget,
        notes: data.notes,
      },
    })
  }

  // Log the upsert action
  await logAudit({
    action: 'UPSERT',
    entityType: 'CLIENT_SERVICE',
    entityId: clientService.id,
    payload: {
      mondayClientItemId: data.mondayClientItemId,
      serviceType: data.serviceType,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      eventDate: data.eventDate.toISOString(),
      isNew: !clientService.updatedAt || clientService.createdAt === clientService.updatedAt,
    },
    actorUserId,
  })

  return clientService.id
}

/**
 * Get client service by Monday.com item ID
 */
export async function getClientServiceByMondayId(mondayClientItemId: string) {
  return await prisma.clientService.findUnique({
    where: {
      mondayClientItemId,
    },
    include: {
      proposalBatches: {
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
  serviceType?: ServiceType
  limit?: number
  offset?: number
}) {
  const where: any = {}
  
  if (options?.serviceType) {
    where.serviceType = options.serviceType
  }

  return await prisma.clientService.findMany({
    where,
    include: {
      proposalBatches: {
        select: {
          id: true,
          state: true,
          mode: true,
          actualCount: true,
          createdAt: true,
        },
      },
    },
    orderBy: {
      eventDate: 'asc',
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
  const existingClient = await prisma.clientService.findUnique({
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
    where: { mondayClientItemId },
    data: {
      clientName: mondayClient.name,
      clientEmail: mondayClient.email,
      clientPhone: mondayClient.phone,
      eventDate: mondayClient.eventDate,
      eventLocation: mondayClient.location,
      budget: mondayClient.budget,
      notes: mondayClient.notes,
    },
  })

  // Log the sync action
  await logAudit({
    action: 'SYNC',
    entityType: 'CLIENT_SERVICE',
    entityId: existingClient.id,
    payload: {
      mondayClientItemId,
      clientName: mondayClient.name,
      clientEmail: mondayClient.email,
      eventDate: mondayClient.eventDate.toISOString(),
    },
    actorUserId,
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
  const activeBatches = await prisma.proposalBatch.count({
    where: {
      clientServiceId,
      state: { in: ['PENDING', 'ACTIVE'] },
    },
  })

  if (activeBatches > 0) {
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
    payload: {
      clientName: clientService.clientName,
      mondayClientItemId: clientService.mondayClientItemId,
    },
    actorUserId,
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
    const muaService = clientServices.find(cs => cs.serviceType === ServiceType.MUA)
    const hsService = clientServices.find(cs => cs.serviceType === ServiceType.HS)

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
    const availableArtists = {
      MUA: { FOUNDER: [], RESIDENT: [], FRESH: [] },
      HS: { FOUNDER: [], RESIDENT: [], FRESH: [] }
    }

    const unavailableArtists = {
      MUA: { FOUNDER: [], RESIDENT: [], FRESH: [] },
      HS: { FOUNDER: [], RESIDENT: [], FRESH: [] }
    }

    allProposals.forEach(proposal => {
      const artist = {
        email: proposal.artist.email,
        tier: proposal.artist.tier,
        response: proposal.response,
        respondedAt: proposal.respondedAt
      }

      const type = proposal.artist.type as keyof typeof availableArtists
      const tier = proposal.artist.tier as keyof typeof availableArtists.MUA

      if (proposal.response === ProposalResponse.YES) {
        availableArtists[type][tier].push(artist)
      } else if (proposal.response === ProposalResponse.NO) {
        unavailableArtists[type][tier].push(artist)
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
            event = `${service.serviceType} batch created`
            icon = '🚀'
            break
          case 'BATCH_COMPLETED':
            event = `${service.serviceType} batch completed`
            icon = '✅'
            break
          case 'PROPOSAL_RESPONSE':
            const payload = log.payload as any
            event = `${payload.artistEmail} responded ${payload.response} to ${service.serviceType} proposal`
            icon = payload.response === 'YES' ? '✅' : '❌'
            break
          default:
            event = `${log.action} - ${service.serviceType}`
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
      eventDate: mondayClient.eventDate,
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
