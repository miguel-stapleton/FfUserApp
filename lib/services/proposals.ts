import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import axios from 'axios'
import { 
  ProposalBatchMode, 
  BatchStartReason, 
  ProposalResponse, 
  ArtistProposalCard,
  CreateBatchRequest,
  RespondToProposalRequest
} from '@/lib/types'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
// Always fetch from the Clients board
const MONDAY_BOARD_ID = process.env.MONDAY_CLIENTS_BOARD_ID || process.env.MONDAY_BOARD_ID
// Kept for backward compatibility but no longer used for selection
const MONDAY_MUA_BOARD_ID = process.env.MONDAY_MUA_BOARD_ID
const MONDAY_HS_BOARD_ID = process.env.MONDAY_HS_BOARD_ID
const MONDAY_MSTATUS_COLUMN_ID = process.env.MONDAY_MSTATUS_COLUMN_ID || 'project_status'
const MONDAY_HSTATUS_COLUMN_ID = process.env.MONDAY_HSTATUS_COLUMN_ID || 'dup__of_mstatus'

// Independent Guests board + columns
const MONDAY_INDEPENDENT_GUESTS_BOARD_ID = '1913629164'
const MONDAY_INDEP_GUESTS_EVENT_DATE_COL = 'date6'
const MONDAY_INDEP_GUESTS_LOCATION_COL = 'short_text1'
const MONDAY_INDEP_GUESTS_MUA_BOOL_COL = 'booleancr88sq6z' // MU?
const MONDAY_INDEP_GUESTS_HS_BOOL_COL = 'booleany6w6zo7p'  // H? / False

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
 * Create a proposal batch and proposals for a specific list of artist IDs.
 * Does NOT change existing behavior elsewhere; use this only when you must target known artists.
 */
export async function createBatchForSpecificArtists(
  clientServiceId: string,
  mode: ProposalBatchMode,
  reason: BatchStartReason,
  artistIds: string[],
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

    // Create proposals exactly for the provided artist IDs
    const proposals = await Promise.all(
      artistIds.map(artistId =>
        tx.proposal.create({
          data: {
            proposalBatchId: batch.id,
            clientServiceId: clientService.id,
            artistId,
          },
        })
      )
    )

    return { batchId: batch.id, proposalCount: proposals.length }
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

    // Use the Clients board for all artists
    const boardIdToUse = MONDAY_BOARD_ID

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
                  value
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
          variables: { boardId: boardIdToUse, cursor },
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
        // Prefer env-provided MUA status column id, fallback to common titles
        let mStatusCol = columnValues.find((col: any) => col.id === MONDAY_MSTATUS_COLUMN_ID)
        if (!mStatusCol) {
          mStatusCol = columnValues.find((col: any) =>
            col.id === 'project_status' ||
            col.title?.toLowerCase().includes('mstatus') ||
            col.title?.toLowerCase().includes('status')
          )
        }
        if (mStatusCol) {
          status = mStatusCol.text
          if ((!status || status.length === 0) && mStatusCol.value) {
            try {
              const parsed = JSON.parse(mStatusCol.value)
              status = parsed?.label || status
            } catch {}
          }
        }
      } else {
        // Prefer env-provided HS status column id, fallback to common titles
        let hStatusCol = columnValues.find((col: any) => col.id === MONDAY_HSTATUS_COLUMN_ID)
        if (!hStatusCol) {
          hStatusCol = columnValues.find((col: any) =>
            col.id === 'dup__of_mstatus' ||
            col.title?.toLowerCase().includes('hstatus') ||
            col.title?.toLowerCase().includes('status')
          )
        }
        if (hStatusCol) {
          status = hStatusCol.text
          if ((!status || status.length === 0) && hStatusCol.value) {
            try {
              const parsed = JSON.parse(hStatusCol.value)
              status = parsed?.label || status
            } catch {}
          }
        }
      }

      if (!status) {
        console.log('No status found for item:', item.id, 'Available columns:', columnValues.map((c:any)=>`${c.id}:${c.text}`).slice(0,10))
      }

      // Exact matching for status values per requirements
      const targetsExact = [
        'Travelling fee + inquire the artist',
        'undecided- inquire availabilities',
        'inquire second option',
      ]

      if (!status || !targetsExact.includes(status)) {
        continue
      }

      // Skip if artist has already responded to this client (persisted in DB)
      if (respondedClientIds.has(item.id)) {
        console.log('Skipping client (already responded):', brideName, 'Item ID:', item.id)
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

    // Also fetch Independent Guests board per requirements
    try {
      let guestItems: any[] = []
      let gCursor: string | null = null
      let gHasMore = true
      while (gHasMore) {
        const guestsQuery = `
          query GetGuests($boardId: ID!, $cursor: String) {
            boards(ids: [$boardId]) {
              items_page(limit: 100, cursor: $cursor) {
                cursor
                items {
                  id
                  name
                  column_values { id text value }
                }
              }
            }
          }
        `
        const guestsResp: any = await axios.post(
          MONDAY_API_URL,
          { query: guestsQuery, variables: { boardId: MONDAY_INDEPENDENT_GUESTS_BOARD_ID, cursor: gCursor } },
          { headers: { 'Authorization': MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
        )
        if (guestsResp.data.errors) {
          console.error('Monday API errors (guests):', guestsResp.data.errors)
          break
        }
        const gBoard = guestsResp.data?.data?.boards?.[0]
        if (!gBoard?.items_page) break
        guestItems = guestItems.concat(gBoard.items_page.items || [])
        gCursor = gBoard.items_page.cursor
        gHasMore = !!gCursor
      }

      for (const gItem of guestItems) {
        // If artist already responded to this guest item, skip it
        if (respondedClientIds.has(String(gItem.id))) continue

        const colValues = gItem.column_values || []
        const muaBool = colValues.find((c: any) => c.id === MONDAY_INDEP_GUESTS_MUA_BOOL_COL)
        const hsBool = colValues.find((c: any) => c.id === MONDAY_INDEP_GUESTS_HS_BOOL_COL)

        // Parse boolean from JSON value or text
        const parseBool = (col: any): boolean => {
          if (!col) return false
          if (typeof col.text === 'string') {
            const t = col.text.toLowerCase().trim()
            if (t === 'true' || t === 'checked') return true
          }
          if (col.value) {
            try {
              const v = JSON.parse(col.value)
              if (v && (v.checked === 'true' || v.checked === true)) return true
            } catch {}
          }
          return false
        }

        const eligible = (artist.type === 'MUA' && parseBool(muaBool)) || (artist.type === 'HS' && parseBool(hsBool))
        if (!eligible) continue

        // Extract event date and location
        let eventDate: Date | null = null
        const dateCol = colValues.find((c: any) => c.id === MONDAY_INDEP_GUESTS_EVENT_DATE_COL)
        if (dateCol?.value) {
          try {
            const dv = JSON.parse(dateCol.value)
            if (dv?.date && typeof dv.date === 'string') {
              const d = new Date(dv.date + 'T00:00:00')
              if (!isNaN(d.getTime())) eventDate = d
            }
          } catch {}
        }
        if (!eventDate && dateCol?.text) {
          const d = new Date(dateCol.text)
          if (!isNaN(d.getTime())) eventDate = d
        }

        // Only include future dates; if no valid date, skip
        if (!eventDate || eventDate.getTime() <= Date.now()) {
          continue
        }

        const venueCol = colValues.find((c: any) => c.id === MONDAY_INDEP_GUESTS_LOCATION_COL)
        const beautyVenue = venueCol?.text || ''

        // Client's Name from short_text8 (fallback to item.name)
        const nameCol = colValues.find((c: any) => c.id === 'short_text8')
        const clientName = (nameCol?.text || '').trim() || gItem.name

        proposals.push({
          id: `guest-${gItem.id}`,
          batchId: 'guest-' + gItem.id,
          clientName,
          serviceType: artist.type as any,
          eventDate,
          beautyVenue,
          observations: '',
          createdAt: new Date(),
          isExpired: false,
        })
      }
    } catch (guestErr) {
      console.error('Failed to fetch Independent Guests board:', guestErr)
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
  // Try DB proposal path first (existing flow)
  const dbProposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      proposalBatch: { include: { clientService: true } },
      artist: { include: { user: true } },
    },
  })

  if (dbProposal) {
    await prisma.$transaction(async (tx) => {
      if (dbProposal.response) {
        throw new Error('Proposal has already been responded to')
      }
      if (dbProposal.proposalBatch?.state !== 'OPEN') {
        throw new Error('Proposal batch is not active')
      }
      await tx.proposal.update({
        where: { id: proposalId },
        data: { response, respondedAt: new Date() },
      })
      await logAudit({
        userId: actorUserId,
        action: 'PROPOSAL_RESPONSE',
        entityType: 'PROPOSAL',
        entityId: proposalId,
        details: {
          proposalId,
          response,
          bridesName: dbProposal.proposalBatch?.clientService?.bridesName,
          artistEmail: dbProposal.artist?.email,
        },
      })
      if (dbProposal.proposalBatch?.mode === 'SINGLE' && response === 'YES') {
        await tx.proposalBatch.update({ where: { id: dbProposal.proposalBatchId }, data: { state: 'COMPLETED' as any } })
        await tx.proposal.updateMany({
          where: { proposalBatchId: dbProposal.proposalBatchId, response: null, id: { not: proposalId } },
          data: { response: 'NO', respondedAt: new Date() },
        })
      }
      const remaining = await tx.proposal.count({ where: { proposalBatchId: dbProposal.proposalBatchId, response: null } })
      if (remaining === 0 && dbProposal.proposalBatch?.state === 'OPEN') {
        await tx.proposalBatch.update({ where: { id: dbProposal.proposalBatchId }, data: { state: 'COMPLETED' as any } })
      }
    })
    return
  }

  // Not a DB proposal ID. Handle Monday-based IDs.
  // Resolve acting artist
  const actor = await prisma.artist.findUnique({ where: { userId: actorUserId }, include: { user: true } })
  if (!actor) throw new Error('Artist not found')

  // Helper to ensure OPEN batch exists
  const ensureOpenBatchId = async (clientServiceId: string): Promise<string> => {
    let batch = await prisma.proposalBatch.findFirst({ where: { clientServiceId, state: 'OPEN' as any } })
    if (!batch) {
      batch = await prisma.proposalBatch.create({
        data: {
          clientServiceId,
          mode: 'BROADCAST' as any,
          startReason: 'UNDECIDED' as any,
          deadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          state: 'OPEN' as any,
        },
      })
    }
    return batch.id
  }

  // Independent Guests ID: 'guest-<id>'
  if (proposalId.startsWith('guest-')) {
    const guestItemId = proposalId.replace('guest-', '')

    // Ensure ClientService for Independent Guests exists (build minimal data from Guests board)
    let clientService = await prisma.clientService.findFirst({
      where: { mondayClientItemId: guestItemId, service: actor.type as any },
    })
    if (!clientService) {
      const query = `
        query GetGuestItem($itemId: ID!) {
          items(ids: [$itemId]) { id name column_values { id text value } }
        }
      `
      const resp: any = await axios.post(
        MONDAY_API_URL,
        { query, variables: { itemId: guestItemId } },
        { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
      )
      const item = resp.data?.data?.items?.[0]
      const cols: any[] = item?.column_values || []
      const getCol = (id: string) => cols.find(c => c.id === id)
      // Parse date6
      let weddingDate = new Date()
      const dCol = getCol(MONDAY_INDEP_GUESTS_EVENT_DATE_COL)
      if (dCol?.value) {
        try { const dv = JSON.parse(dCol.value); if (dv?.date) { const d = new Date(dv.date); if (!isNaN(d.getTime())) weddingDate = d } } catch {}
      } else if (dCol?.text) { const d = new Date(dCol.text); if (!isNaN(d.getTime())) weddingDate = d }
      const venueCol = getCol(MONDAY_INDEP_GUESTS_LOCATION_COL)
      const beautyVenue = venueCol?.text || ''
      const nameCol = getCol('short_text8')
      const clientName = (nameCol?.text || '').trim() || item?.name || 'Client'
      clientService = await prisma.clientService.create({
        data: {
          mondayClientItemId: guestItemId,
          service: actor.type as any,
          bridesName: clientName,
          weddingDate,
          beautyVenue,
          description: null,
          currentStatus: null,
        },
      })
    }
    const batchId = await ensureOpenBatchId(clientService.id)
    // Upsert Proposal for this artist then set response
    const existing = await prisma.proposal.findFirst({ where: { proposalBatchId: batchId, artistId: actor.id } })
    let targetProposalId = existing?.id
    if (!existing) {
      const created = await prisma.proposal.create({
        data: { proposalBatchId: batchId, clientServiceId: clientService.id, artistId: actor.id }
      })
      targetProposalId = created.id
    }
    await prisma.proposal.update({ where: { id: targetProposalId! }, data: { response, respondedAt: new Date() } })
    await logAudit({
      userId: actorUserId,
      action: 'PROPOSAL_RESPONSE',
      entityType: 'CLIENT_SERVICE',
      entityId: clientService.id,
      details: { mondayClientItemId: guestItemId, response, artistEmail: actor.email },
    })
    return
  }

  // Monday Clients board item ID: numeric or 'monday-<id>'
  const mondayId = proposalId.startsWith('monday-') ? proposalId.replace('monday-', '') : proposalId
  if (/^\d+$/.test(mondayId)) {
    // Ensure ClientService exists (from Clients board)
    const clientServiceId = await (async () => {
      try {
        // Uses Clients board data
        const id = await (await import('./clients')).upsertClientServiceFromMonday(mondayId, actor.type as any, actorUserId)
        return id
      } catch (e) {
        // As a fallback, create minimal client service if Monday lookup fails
        let cs = await prisma.clientService.findFirst({ where: { mondayClientItemId: mondayId, service: actor.type as any } })
        if (!cs) {
          cs = await prisma.clientService.create({
            data: {
              mondayClientItemId: mondayId,
              service: actor.type as any,
              bridesName: 'Client',
              weddingDate: new Date(),
              beautyVenue: '',
            },
          })
        }
        return cs.id
      }
    })()
    const batchId = await ensureOpenBatchId(clientServiceId)
    const existing = await prisma.proposal.findFirst({ where: { proposalBatchId: batchId, artistId: actor.id } })
    let targetProposalId = existing?.id
    if (!existing) {
      const created = await prisma.proposal.create({ data: { proposalBatchId: batchId, clientServiceId, artistId: actor.id } })
      targetProposalId = created.id
    }
    await prisma.proposal.update({ where: { id: targetProposalId! }, data: { response, respondedAt: new Date() } })
    await logAudit({
      userId: actorUserId,
      action: 'PROPOSAL_RESPONSE',
      entityType: 'CLIENT_SERVICE',
      entityId: clientServiceId,
      details: { mondayClientItemId: mondayId, response, artistEmail: actor.email },
    })
    return
  }

  // If we get here, the ID didn't match any supported format
  throw new Error('Proposal not found')
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
