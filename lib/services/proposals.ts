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
const MONDAY_BOARD_ID = process.env.MONDAY_CLIENTS_BOARD_ID || process.env.MONDAY_BOARD_ID || '1260828829'
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

// Polls board (for Independent Guests YES/NO follow-up)
const MONDAY_POLLS_BOARD_ID = '1952175468'
const MONDAY_POLLS_ITEM_IDD_COL = 'text_mkr0k74g' // Item IDD column on Polls board

// MUA email -> Polls boolean column id
const MUA_POLL_COLUMN_BY_EMAIL: Record<string, string> = {
  'gi.lola@gmail.com': 'boolean_mkqwkp91',
  'tecadete@gmail.com': 'boolean_mkqwxdsm',
  'info@miguelstapleton.art': 'boolean_mkqwjvzr',
  'iaguiarmakeup@gmail.com': 'boolean_mkqwadn2',
  'anaroma.makeup@gmail.com': 'boolean_mkqw5473',
  'anaferreira.geral@hotmail.com': 'boolean_mkqwpjnx',
  'anacatarinanev@gmail.com': 'boolean_mkqw9z4',
  'ritarnunes.mua@gmail.com': 'boolean_mkqw3err',
  'sara.jogo@hotmail.com': 'boolean_mkqwhc0d',
  'filipawahnon.mua@gmail.com': 'boolean_mkqwwwtg',
}

// HS email -> Polls boolean column id
const HS_POLL_COLUMN_BY_EMAIL: Record<string, string> = {
  'hi@letshair.com': 'boolean_mkqwrtzh',
  'liliapcosta@gmail.com': 'boolean_mkqwm8w8',
  'andreiadematoshair@gmail.com': 'boolean_mkqw9etg',
  'riberic@gmail.com': 'boolean_mkqwt8cv',
  'kseniya.hairstylist@gmail.com': 'boolean_mkqwbra6',
  'joanacarvalho_@hotmail.com': 'boolean_mkqwx8ve',
  'olga.amaral.hilario@gmail.com': 'boolean_mkqwnszp',
}

// Clients board status/color columns for "Pode!/Não pode"
const MONDAY_CLIENTS_MUAPODE_COL = 'color_mkwhcpdm'
const MONDAY_CLIENTS_HSPODE_COL = 'color_mkwh47yj'

// Display names for updates
const MUA_NAME_BY_EMAIL: Record<string, string> = {
  'gi.lola@gmail.com': 'Lola',
  'info@miguelstapleton.art': 'Miguel',
  'tecadete@gmail.com': 'Teresa',
  'iaguiarmakeup@gmail.com': 'Inês',
  'anaroma.makeup@gmail.com': 'Ana Roma',
  'anaferreira.geral@hotmail.com': 'Sofia',
  'anacatarinanev@gmail.com': 'Ana Neves',
  'ritarnunes.mua@gmail.com': 'Rita',
  'sara.jogo@hotmail.com': 'Sara',
  'filipawahnon.mua@gmail.com': 'Filipa',
}

const HS_NAME_BY_EMAIL: Record<string, string> = {
  'hi@letshair.com': 'Agne',
  'liliapcosta@gmail.com': 'Lília',
  'andreiadematoshair@gmail.com': 'Andreia',
  'riberic@gmail.com': 'Eric',
  'kseniya.hairstylist@gmail.com': 'Oksana',
  'joanacarvalho_@hotmail.com': 'Joana',
  'olga.amaral.hilario@gmail.com': 'Olga H',
}

// Normalize emails for mapping lookups
const normEmail = (e?: string | null) => (e || '').trim().toLowerCase()

// Helper: find Polls item by matching Item IDD (guest/bride Monday item id)
async function findPollsItemIdByGuestId(guestItemId: string): Promise<string | null> {
  const base = String(guestItemId).trim()
  const candidates = [base, `monday-${base}`]

  // 1) Try exact matches via items_by_column_values for each candidate
  const exactQuery = `
    query FindPollsItem($boardId: ID!, $colId: String!, $value: String!) {
      items_by_column_values(board_id: $boardId, column_id: $colId, column_value: $value) { id }
    }
  `
  for (const value of candidates) {
    try {
      const resp: any = await axios.post(
        MONDAY_API_URL,
        { query: exactQuery, variables: { boardId: MONDAY_POLLS_BOARD_ID, colId: MONDAY_POLLS_ITEM_IDD_COL, value } },
        { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
      )
      const items = resp.data?.data?.items_by_column_values || []
      if (Array.isArray(items) && items.length > 0 && items[0]?.id) {
        return String(items[0].id)
      }
    } catch (e) {
      console.warn('[polls] items_by_column_values lookup failed for', value, e)
    }
  }

  // 2) Fallback: scan items_page and match the Item IDD column text/value loosely
  try {
    let cursor: string | null = null
    while (true) {
      const scanQuery = `
        query ScanPolls($boardId: ID!, $cursor: String) {
          boards(ids: [$boardId]) {
            items_page(limit: 100, cursor: $cursor) {
              cursor
              items { id column_values { id text value } }
            }
          }
        }
      `
      const scanResp: any = await axios.post(
        MONDAY_API_URL,
        { query: scanQuery, variables: { boardId: MONDAY_POLLS_BOARD_ID, cursor } },
        { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
      )
      const page = scanResp.data?.data?.boards?.[0]?.items_page
      if (!page) break
      const items = page.items || []
      for (const it of items) {
        const cv = (it.column_values || []).find((c: any) => c.id === MONDAY_POLLS_ITEM_IDD_COL)
        // Prefer explicit text, but also parse JSON value if present
        let t = (cv?.text || '').toString().trim()
        if ((!t || t.length === 0) && cv?.value) {
          try {
            const parsed = JSON.parse(cv.value)
            const pv = (parsed?.text || parsed?.value || '').toString().trim()
            if (pv) t = pv
          } catch {}
        }
        if (!t) continue
        const norm = t.trim()
        if (candidates.includes(norm) || norm.includes(base)) {
          return String(it.id)
        }
      }
      cursor = page.cursor
      if (!cursor) break
    }
  } catch (e) {
    console.warn('[polls] items_page scan failed', e)
  }

  return null
}

// Helper: set a boolean column on Polls item
async function setPollsBoolean(itemId: string, columnId: string, checked: boolean): Promise<void> {
  const mutation = `
    mutation SetBool($boardId: ID!, $itemId: ID!, $columnId: String!, $val: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $val) { id }
    }
  `
  const value = JSON.stringify({ checked: checked ? 'true' : 'false' })
  await axios.post(
    MONDAY_API_URL,
    { query: mutation, variables: { boardId: MONDAY_POLLS_BOARD_ID, itemId, columnId, val: value } },
    { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
  )
}

// Helper: add an update (comment) on a Monday item (Guests board)
async function addGuestUpdate(itemId: string, body: string): Promise<void> {
  const mutation = `
    mutation AddUpdate($itemId: ID!, $body: String!) { create_update (item_id: $itemId, body: $body) { id } }
  `
  await axios.post(
    MONDAY_API_URL,
    { query: mutation, variables: { itemId, body } },
    { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
  )
}

// Helper: add an update (comment) on a Monday item (generic)
async function addItemUpdate(itemId: string, body: string): Promise<void> {
  const mutation = `
    mutation AddUpdate($itemId: ID!, $body: String!) { create_update (item_id: $itemId, body: $body) { id } }
  `
  await axios.post(
    MONDAY_API_URL,
    { query: mutation, variables: { itemId, body } },
    { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
  )
}

// Helper: set a Status/Color label on Clients board
async function setClientsStatusLabel(itemId: string, columnId: string, label: string): Promise<void> {
  const mutation = `
    mutation SetStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $val: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $val) { id }
    }
  `
  const value = JSON.stringify({ label })
  await axios.post(
    MONDAY_API_URL,
    { query: mutation, variables: { boardId: MONDAY_BOARD_ID, itemId, columnId, val: value } },
    { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
  )
}

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
  'Agne': 'copy paste para whatsapp de Agne',
  'Lília': 'copy paste para whatsapp de Lília',
  'Andreia': 'copy paste para whatsapp de Andreia',
  'Eric': 'copy paste para whatsapp de Eric',
  'Oksana': 'copy paste para whatsapp de Oksana',
  'Joana': 'copy paste para whatsapp de Joana',
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
        // HS variant label
        'Travelling fee + inquire second option',
      ]

      if (!status || !targetsExact.includes(status)) {
        continue
      }

      // Skip if artist has already responded to this client (persisted in DB)
      if (respondedClientIds.has(String(item.id))) {
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
      } else if (status === 'inquire second option' || status === 'Travelling fee + inquire second option') {
        // New rule: show to all except the "exception account" whose whatsapp phrase appears in updates
        // If the updates contain the logged-in artist's whatsapp phrase, exclude them; otherwise include
        const myWhatsappPattern = whatsappPattern
        if (myWhatsappPattern) {
          const isException = updates.some((update: any) => update.text_body?.includes(myWhatsappPattern))
          shouldInclude = !isException
        } else {
          // If we couldn't build a pattern, default to include
          shouldInclude = true
        }
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
        try {
          const dv = JSON.parse(dCol.value)
          if (dv?.date && typeof dv.date === 'string') {
            const d = new Date(dv.date + 'T00:00:00')
            if (!isNaN(d.getTime())) weddingDate = d
          }
        } catch {}
      } else if (dCol?.text) {
        const d = new Date(dCol.text)
        if (!isNaN(d.getTime())) weddingDate = d
      }

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

    // Apply Monday side-effects for guests: YES -> set Polls TRUE; NO -> set Polls FALSE + updates
    try {
      if (response === 'YES') {
        const pollsItemId = await findPollsItemIdByGuestId(guestItemId)
        if (pollsItemId) {
          const colId = actor.type === 'MUA' ? MUA_POLL_COLUMN_BY_EMAIL[actor.email] : HS_POLL_COLUMN_BY_EMAIL[actor.email]
          if (colId) {
            await setPollsBoolean(pollsItemId, colId, true)
          } else {
            console.warn('[guests] No Polls column mapping for', actor.email)
          }
        } else {
          console.warn('[guests] Polls item not found for guest', guestItemId)
        }
      } else if (response === 'NO') {
        const pollsItemId = await findPollsItemIdByGuestId(guestItemId)
        const colId = actor.type === 'MUA' ? MUA_POLL_COLUMN_BY_EMAIL[actor.email] : HS_POLL_COLUMN_BY_EMAIL[actor.email]
        const displayName = (actor.type === 'MUA' ? MUA_NAME_BY_EMAIL[actor.email] : HS_NAME_BY_EMAIL[actor.email]) || actor.user?.username || actor.email
        const body = `${displayName} não pode`

        if (!pollsItemId) {
          console.warn('[guests:NO] Polls item not found for guest', guestItemId)
          // Still add update to Clients item per spec
          await addItemUpdate(guestItemId, body)
        } else {
          // If mapping exists, set boolean false; either way, add updates
          if (colId) {
            await setPollsBoolean(pollsItemId, colId, false)
          } else {
            console.warn('[guests:NO] No Polls column mapping for', actor.email)
          }
          await addGuestUpdate(guestItemId, body)
        }
      }
    } catch (mErr) {
      console.error('[guests] Failed to apply Polls/Update actions:', mErr)
    }
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

    // Fetch Clients item to evaluate status gating (Mstatus/Hstatus)
    let mStatusLabel = ''
    let hStatusLabel = ''
    try {
      const itemQuery = `
        query GetItem($id: [ID!]) { items(ids: $id) { id column_values { id text value title } } }
      `
      const itemResp: any = await axios.post(
        MONDAY_API_URL,
        { query: itemQuery, variables: { id: [mondayId] } },
        { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
      )
      const cols: any[] = itemResp.data?.data?.items?.[0]?.column_values || []
      const getLabel = (col: any): string => {
        let t = (col?.text || '').toString().trim()
        if ((!t || t.length === 0) && col?.value) {
          try { const v = JSON.parse(col.value); t = v?.label || t } catch {}
        }
        return t
      }
      let mCol = cols.find(c => c.id === MONDAY_MSTATUS_COLUMN_ID) || cols.find((c:any)=> c.id==='project_status' || c.title?.toLowerCase().includes('mstatus'))
      let hCol = cols.find(c => c.id === MONDAY_HSTATUS_COLUMN_ID) || cols.find((c:any)=> c.id==='dup__of_mstatus' || c.title?.toLowerCase().includes('hstatus'))
      mStatusLabel = getLabel(mCol)
      hStatusLabel = getLabel(hCol)
    } catch (e) {
      console.warn('[brides] Failed to fetch Clients item for status gating', e)
    }

    const normalize = (s: string) => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
    const isTravellingInquireArtist_M = normalize(mStatusLabel) === 'travelling fee + inquire the artist'
    const isTravellingInquireArtist_H = normalize(hStatusLabel) === 'travelling fee + inquire the artist'
    const isSecondOption_M = normalize(mStatusLabel) === 'inquire second option'
    const isSecondOption_H = normalize(hStatusLabel) === 'travelling fee + inquire second option'
    const isUndecided_M = normalize(mStatusLabel) === 'undecided- inquire availabilities' || normalize(mStatusLabel) === 'undecided - inquire availabilities'
    const isUndecided_H = normalize(hStatusLabel) === 'undecided- inquire availabilities' || normalize(hStatusLabel) === 'undecided - inquire availabilities'

    // Brides: YES flows
    if (response === 'YES') {
      try {
        if (actor.type === 'MUA' && isTravellingInquireArtist_M) {
          // Set MUApode to "Pode!"
          await setClientsStatusLabel(mondayId, MONDAY_CLIENTS_MUAPODE_COL, 'Pode!')
        }
        if (actor.type === 'HS' && isTravellingInquireArtist_H) {
          // Set HSpode to "Pode!"
          await setClientsStatusLabel(mondayId, MONDAY_CLIENTS_HSPODE_COL, 'Pode!')
        }

        // YES on second-option / undecided -> set Polls TRUE
        const yesNeedsPolls = (actor.type === 'MUA' && (isSecondOption_M || isUndecided_M)) || (actor.type === 'HS' && (isSecondOption_H || isUndecided_H))
        if (yesNeedsPolls) {
          let pollsItemId: string | null = null
          for (let attempt = 1; attempt <= 5; attempt++) {
            pollsItemId = await findPollsItemIdByGuestId(mondayId)
            if (pollsItemId) break
            await new Promise(res => setTimeout(res, 1000))
          }
          if (pollsItemId) {
            const colId = actor.type === 'MUA' ? MUA_POLL_COLUMN_BY_EMAIL[normEmail(actor.email)] : HS_POLL_COLUMN_BY_EMAIL[normEmail(actor.email)]
            if (colId) {
              await setPollsBoolean(pollsItemId, colId, true)
            } else {
              console.warn('[brides] No Polls column mapping for', actor.email)
            }
          } else {
            console.warn('[brides] Polls item not found for client', mondayId)
          }
        }
      } catch (e) {
        console.error('[brides] Failed to update Polls board on YES:', e)
      }
    }

    // Brides: NO flows
    if (response === 'NO') {
      try {
        if (actor.type === 'MUA' && isTravellingInquireArtist_M) {
          // MUA NO on Travelling fee + inquire the artist
          await setClientsStatusLabel(mondayId, MONDAY_MSTATUS_COLUMN_ID, 'inquire second option')
          await setClientsStatusLabel(mondayId, MONDAY_CLIENTS_MUAPODE_COL, 'Não pode')
          const name = MUA_NAME_BY_EMAIL[normEmail(actor.email)] || actor.user?.username || actor.email
          await addItemUpdate(mondayId, `${name} foi escolhido mas não pode`)
        }
        if (actor.type === 'HS' && isTravellingInquireArtist_H) {
          // HS NO on Travelling fee + inquire the artist
          await setClientsStatusLabel(mondayId, MONDAY_HSTATUS_COLUMN_ID, 'Travelling fee + inquire second option')
          await setClientsStatusLabel(mondayId, MONDAY_CLIENTS_HSPODE_COL, 'Não pode')
          const name = HS_NAME_BY_EMAIL[normEmail(actor.email)] || actor.user?.username || actor.email
          await addItemUpdate(mondayId, `${name} foi escolhido mas não pode`)
        }

        // NO on second-option / undecided -> set Polls FALSE + updates (both MUA and HS)
        const noNeedsPolls = (actor.type === 'MUA' && (isSecondOption_M || isUndecided_M)) || (actor.type === 'HS' && (isSecondOption_H || isUndecided_H))
        if (noNeedsPolls) {
          let pollsItemId: string | null = null
          for (let attempt = 1; attempt <= 5; attempt++) {
            pollsItemId = await findPollsItemIdByGuestId(mondayId)
            if (pollsItemId) break
            await new Promise(res => setTimeout(res, 1000))
          }
          const email = normEmail(actor.email)
          const colId = actor.type === 'MUA' ? MUA_POLL_COLUMN_BY_EMAIL[email] : HS_POLL_COLUMN_BY_EMAIL[email]
          const displayName = (actor.type === 'MUA' ? MUA_NAME_BY_EMAIL[email] : HS_NAME_BY_EMAIL[email]) || actor.user?.username || actor.email
          const body = `${displayName} não pode`

          if (!pollsItemId) {
            console.warn('[brides:NO] Polls item not found for client', mondayId)
            // Still add update to Clients item per spec
            await addItemUpdate(mondayId, body)
          } else {
            // If mapping exists, set boolean false; either way, add updates
            if (colId) {
              await setPollsBoolean(pollsItemId, colId, false)
            } else {
              console.warn('[brides:NO] No Polls column mapping for', actor.email)
            }
            await Promise.all([
              addItemUpdate(pollsItemId, body),
              addItemUpdate(mondayId, body),
            ])
          }
        }
      } catch (e) {
        console.error('[brides:NO] Failed to apply Clients/Polls updates:', e)
      }
    }
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
