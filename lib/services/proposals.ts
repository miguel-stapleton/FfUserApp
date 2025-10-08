import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import axios from 'axios'
import { 
  ProposalBatchMode, 
  BatchStartReason, 
  ProposalResponse, 
  ArtistProposalCard,
  CreateBatchRequest,
  RespondToProposalRequest,
  BackofficeRow
} from '@/lib/types'
import { mondayService } from '../monday'
import { getAllClientsFromMonday } from '../monday'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID
const MONDAY_MUA_BOARD_ID = process.env.MONDAY_MUA_BOARD_ID
const MONDAY_HS_BOARD_ID = process.env.MONDAY_HS_BOARD_ID

// Artist name mappings for "copy paste para whatsapp" patterns
const WHATSAPP_PATTERNS: Record<string, string> = {
  'Lola': 'copy paste para whatsapp de Lola',
  'Miguel': 'copy paste para whatsapp de Miguel',
  'Teresa': 'copy paste para whatsapp de Teresa',
  'Inês': 'copy paste para whatsapp de Inês',
  'Rita': 'copy paste para whatsapp de Rita',
  'Sofia': 'copy paste para whatsapp de Sofia',
  'Filipa': 'copy paste para whatsapp de Filipa',
  'Ana Neves': 'copy paste para whatsapp de Ana Neves',
  'Ana Roma': 'copy paste para whatsapp de Ana Roma',
  'Sara': 'copy paste para whatsapp de Sara',
  'Olga H': 'copy paste para whatsapp de Olga H',
}

// Get artist first name for matching
function getArtistFirstName(fullName: string): string {
  // Handle special cases
  if (fullName.includes('Ana Neves')) return 'Ana Neves'
  if (fullName.includes('Ana Roma')) return 'Ana Roma'
  if (fullName.includes('Olga H')) return 'Olga H'
  
  // For others, find the matching key
  for (const key of Object.keys(WHATSAPP_PATTERNS)) {
    if (fullName.includes(key)) {
      return key
    }
  }
  
  return fullName.split(' ')[0]
}

/**
 * Create a proposal batch and associated proposals for artists
 */
export async function createBatchAndProposals(
  clientServiceId: string,
  mode: ProposalBatchMode,
  reason: BatchStartReason,
  targetCount?: number
): Promise<{ batchId: string; proposalCount: number }> {
  return await prisma.$transaction(async (tx) => {
    // Get client service details
    const clientService = await tx.clientService.findUnique({
      where: { id: clientServiceId },
    })

    if (!clientService) {
      throw new Error('Client service not found')
    }

    // Calculate deadline (24 hours from now)
    const deadlineAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    // Create the proposal batch
    const batch = await tx.proposalBatch.create({
      data: {
        clientServiceId,
        mode,
        state: 'OPEN',
        startReason: reason as any,
        deadlineAt,
      },
    })

    // Get eligible artists based on service type and mode
    let artists
    if (mode === 'SINGLE') {
      // For single mode, get one artist based on tier priority
      artists = await tx.artist.findMany({
        where: {
          active: true,
          type: clientService.service, // Match service type (MUA/HS)
        },
        orderBy: [
          { tier: 'asc' }, // FOUNDER first, then RESIDENT, then FRESH
          { createdAt: 'asc' }, // Oldest first for fairness
        ],
        take: 1,
      })
    } else {
      // For broadcast mode, get ALL active artists of the service type
      // No constraints on distance or caps - all active artists receive proposals
      artists = await tx.artist.findMany({
        where: {
          active: true,
          type: clientService.service, // Match service type (MUA/HS)
        },
        // No limit - all active artists get the proposal
      })
    }

    // Create proposals for selected artists
    const proposals = await Promise.all(
      artists.map(artist =>
        tx.proposal.create({
          data: {
            proposalBatchId: batch.id,
            clientServiceId: clientService.id,
            artistId: artist.id,
          },
        })
      )
    )

    return {
      batchId: batch.id,
      proposalCount: proposals.length,
    }
  })
}

/**
 * Get open proposals for an artist from Monday.com
 */
export async function getOpenProposalsForArtist(userId: string): Promise<ArtistProposalCard[]> {
  try {
    console.log('=== GET OPEN PROPOSALS DEBUG ===')
    console.log('User ID:', userId)

    // Get artist record
    const artist = await prisma.artist.findUnique({
      where: { userId },
      include: { user: true },
    })

    if (!artist) {
      console.log('Artist not found for user ID:', userId)
      throw new Error('Artist not found')
    }

    console.log('Artist email:', artist.email)
    console.log('Artist type:', artist.type)
    console.log('Artist Monday Item ID:', artist.mondayItemId)

    if (!artist.mondayItemId) {
      console.log('Artist has no Monday Item ID')
      return []
    }

    // Get all client IDs where this artist has already responded
    const respondedProposals = await prisma.proposal.findMany({
      where: {
        artistId: artist.id,
        response: { not: null },
      },
      include: {
        clientService: true,
      },
    })

    const respondedClientIds = new Set(
      respondedProposals.map(p => p.clientService.mondayClientItemId)
    )

    console.log('Artist has already responded to', respondedClientIds.size, 'clients')

    // Determine artist type and get their Monday.com name
    const artistQuery = `
      query GetArtistItem($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          name
        }
      }
    `

    console.log('Fetching artist from Monday.com...')
    
    const artistResponse = await axios.post(
      MONDAY_API_URL,
      {
        query: artistQuery,
        variables: { itemId: artist.mondayItemId },
      },
      {
        headers: {
          'Authorization': MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    if (artistResponse.data.errors) {
      console.error('Monday API errors:', artistResponse.data.errors)
      throw new Error(`Monday API Error: ${JSON.stringify(artistResponse.data.errors)}`)
    }

    const artistItem = artistResponse.data.data.items[0]
    if (!artistItem) {
      console.log('Artist not found in Monday.com')
      return []
    }

    console.log('Artist name from Monday:', artistItem.name)

    const artistFirstName = getArtistFirstName(artistItem.name)
    const whatsappPattern = WHATSAPP_PATTERNS[artistFirstName]

    console.log('Artist first name:', artistFirstName)
    console.log('Whatsapp pattern:', whatsappPattern)

    // Fetch ALL clients from Monday.com with pagination
    console.log('Fetching clients from Monday.com...')
    let allItems: any[] = []
    let cursor: string | null = null
    let hasMore = true

    while (hasMore) {
      const clientsQuery = `
        query GetBoardItems($boardId: ID!, $cursor: String) {
          boards(ids: [$boardId]) {
            items_page(limit: 100, cursor: $cursor) {
              cursor
              items {
                id
                name
                column_values {
                  id
                  text
                }
                updates {
                  id
                  text_body
                }
              }
            }
          }
        }
      `

      const clientsResponse: any = await axios.post(
        MONDAY_API_URL,
        {
          query: clientsQuery,
          variables: { boardId: MONDAY_BOARD_ID, cursor },
        },
        {
          headers: {
            'Authorization': MONDAY_API_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      )

      if (clientsResponse.data.errors) {
        console.error('Monday API errors:', clientsResponse.data.errors)
        throw new Error(`Monday API Error: ${JSON.stringify(clientsResponse.data.errors)}`)
      }

      const board = clientsResponse.data.data.boards[0]
      if (!board || !board.items_page) {
        break
      }

      allItems = [...allItems, ...board.items_page.items]
      cursor = board.items_page.cursor
      hasMore = !!cursor
    }

    console.log('Total clients fetched:', allItems.length)

    const proposals: ArtistProposalCard[] = []

    console.log('Artist type:', artist.type)

    for (const item of allItems) {
      const columnValues = item.column_values || []
      const updates = item.updates || []

      // Get bride's name
      const brideNameColumn = columnValues.find((col: any) => col.id === 'short_text8')
      const brideName = brideNameColumn?.text
      if (!brideName) continue

      // ONLY check the status column that matches the artist's service type
      let status: string | undefined
      if (artist.type === 'MUA') {
        // MUA artists ONLY look at Mstatus (project_status)
        const mStatusCol = columnValues.find((col: any) => col.id === 'project_status')
        status = mStatusCol?.text
      } else {
        // HS artists ONLY look at Hstatus (dup__of_mstatus)
        const hStatusCol = columnValues.find((col: any) => col.id === 'dup__of_mstatus')
        status = hStatusCol?.text
      }

      // Skip if status is not one of the three target statuses
      if (!status || ![
        'Travelling fee + inquire the artist',
        'undecided- inquire availabilities',
        'inquire second option'
      ].includes(status)) {
        continue
      }

      // Skip if artist has already responded to this client
      if (respondedClientIds.has(item.id)) {
        console.log('Skipping client (already responded):', brideName)
        continue
      }

      let shouldInclude = false

      // Apply filtering logic based on status
      if (status === 'Travelling fee + inquire the artist') {
        // Check if whatsapp pattern exists in updates
        if (whatsappPattern) {
          shouldInclude = updates.some((update: any) => 
            update.text_body?.includes(whatsappPattern)
          )
        }
      } else if (status === 'undecided- inquire availabilities') {
        // Show all
        shouldInclude = true
      } else if (status === 'inquire second option') {
        // Exclude if artist is marked as unavailable
        const unavailablePattern = `${artistFirstName} is not available....give us a second!`
        const isMarkedUnavailable = updates.some((update: any) =>
          update.text_body?.includes(unavailablePattern)
        )
        shouldInclude = !isMarkedUnavailable
      }

      if (shouldInclude) {
        // Get wedding date
        const dateColumn = columnValues.find((col: any) => col.id === 'date6')
        const eventDate = dateColumn?.text ? new Date(dateColumn.text) : new Date()

        // Get beauty venue
        const venueColumn = columnValues.find((col: any) => col.id === 'short_text1')
        const beautyVenue = venueColumn?.text || ''

        // Get description
        const descColumn = columnValues.find((col: any) => col.id === 'long_text4')
        const observations = descColumn?.text || ''

        proposals.push({
          id: item.id,
          batchId: 'monday-' + item.id, // Virtual batch ID for Monday.com items
          clientName: brideName,
          serviceType: artist.type as any,
          eventDate,
          beautyVenue,
          observations,
          createdAt: new Date(),
          isExpired: false,
        })
      }
    }

    console.log('Total proposals found:', proposals.length)
    console.log('=== END GET OPEN PROPOSALS DEBUG ===\n')

    return proposals
  } catch (error) {
    console.error('Error in getOpenProposalsForArtist:', error)
    throw error
  }
}

/**
 * Respond to a proposal (YES or NO)
 */
export async function respondToProposal({
  proposalId,
  response,
  actorUserId,
}: RespondToProposalRequest): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Get the proposal with related data
    const proposal = await tx.proposal.findUnique({
      where: { id: proposalId },
      include: {
        proposalBatch: {
          include: {
            clientService: true,
          },
        },
        artist: {
          include: {
            user: true,
          },
        },
      },
    })

    if (!proposal) {
      throw new Error('Proposal not found')
    }

    if (proposal.response) {
      throw new Error('Proposal has already been responded to')
    }

    if (proposal.proposalBatch?.state !== 'OPEN') {
      throw new Error('Proposal batch is not active')
    }

    // Update the proposal
    await tx.proposal.update({
      where: { id: proposalId },
      data: {
        response,
        respondedAt: new Date(),
      },
    })

    // Log the response
    await logAudit({
      userId: actorUserId,
      action: 'PROPOSAL_RESPONSE',
      details: {
        proposalId,
        response,
        clientName: proposal.proposalBatch?.clientService?.clientName,
        artistEmail: proposal.artist?.email,
      },
    })

    // If this is a SINGLE mode batch and someone said YES, complete the batch
    if (proposal.proposalBatch?.mode === 'SINGLE' && response === 'YES') {
      await tx.proposalBatch.update({
        where: { id: proposal.proposalBatchId },
        data: {
          state: 'COMPLETED',
          completedAt: new Date(),
        },
      })

      // Cancel other pending proposals in this batch
      await tx.proposal.updateMany({
        where: {
          proposalBatchId: proposal.proposalBatchId,
          response: null,
          id: { not: proposalId },
        },
        data: {
          response: 'NO', // Auto-reject other proposals
          respondedAt: new Date(),
        },
      })
    }

    // Check if all proposals in batch have been responded to
    const remainingProposals = await tx.proposal.count({
      where: {
        proposalBatchId: proposal.proposalBatchId,
        response: null,
      },
    })

    if (remainingProposals === 0 && proposal.proposalBatch?.state === 'OPEN') {
      await tx.proposalBatch.update({
        where: { id: proposal.proposalBatchId },
        data: {
          state: 'COMPLETED',
          completedAt: new Date(),
        },
      })
    }
  })
}

/**
 * Get proposal statistics for an artist
 */
export async function getArtistProposalStats(artistId: string) {
  const [totalProposals, acceptedProposals, rejectedProposals, pendingProposals] = await Promise.all([
    prisma.proposal.count({
      where: { artistId },
    }),
    prisma.proposal.count({
      where: { artistId, response: 'YES' },
    }),
    prisma.proposal.count({
      where: { artistId, response: 'NO' },
    }),
    prisma.proposal.count({
      where: { artistId, response: null },
    }),
  ])

  const responseRate = totalProposals > 0 ? ((acceptedProposals + rejectedProposals) / totalProposals) * 100 : 0
  const acceptanceRate = totalProposals > 0 ? (acceptedProposals / totalProposals) * 100 : 0

  return {
    totalProposals,
    acceptedProposals,
    rejectedProposals,
    pendingProposals,
    responseRate: Math.round(responseRate * 100) / 100,
    acceptanceRate: Math.round(acceptanceRate * 100) / 100,
  }
}

/**
 * Get all proposals for backoffice dashboard
 */
export async function getBackofficeProposals(): Promise<BackofficeRow[]> {
  try {
    // Fetch live client data from Monday.com
    const mondayClients = await getAllClientsFromMonday()
    
    if (mondayClients.length === 0) {
      return []
    }

    // Get all client services that match Monday items
    const clientServices = await prisma.clientService.findMany({
      where: {
        mondayClientItemId: {
          in: mondayClients.map(client => client.mondayItemId)
        }
      },
      include: {
        proposalBatches: {
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
        }
      }
    })

    // Build the response structure
    const backofficeRows = mondayClients.map(mondayClient => {
      const clientService = clientServices.find(cs => cs.mondayClientItemId === mondayClient.mondayItemId)
      
      // Get latest batch proposals
      const latestBatch = clientService?.proposalBatches?.[0]
      const proposals = latestBatch?.proposals || []

      // Group artists by type and tier
      const muaArtists = proposals
        .filter(p => p.artist.type === 'MUA')
        .map(p => ({
          email: p.artist.email,
          tier: p.artist.tier,
          response: p.response,
          respondedAt: p.respondedAt
        }))

      const hsArtists = proposals
        .filter(p => p.artist.type === 'HS')
        .map(p => ({
          email: p.artist.email,
          tier: p.artist.tier,
          response: p.response,
          respondedAt: p.respondedAt
        }))

      // Determine overall status based on batch status
      let status = 'No Batch'
      if (latestBatch) {
        switch (latestBatch.state) {
          case 'OPEN':
            status = 'Open'
            break
          case 'COMPLETED':
            status = 'Completed'
            break
          case 'CANCELLED':
            status = 'Cancelled'
            break
        }
      }

      return {
        mondayClientItemId: mondayClient.mondayItemId,
        clientName: mondayClient.name,
        eventDate: mondayClient.eventDate,
        beautyVenue: mondayClient.beautyVenue,
        mStatus: mondayClient.mStatus,
        status,
        muaArtists,
        hsArtists
      }
    })

    return backofficeRows
  } catch (error) {
    console.error('Error fetching backoffice proposals:', error)
    throw new Error('Failed to fetch backoffice proposals')
  }
}
