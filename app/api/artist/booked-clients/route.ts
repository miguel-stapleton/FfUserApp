import { NextRequest, NextResponse } from 'next/server'
import { requireArtist, handleAuthError } from '@/lib/auth'
import axios from 'axios'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_CLIENTS_BOARD_ID = process.env.MONDAY_CLIENTS_BOARD_ID || process.env.MONDAY_BOARD_ID
const MONDAY_MSTATUS_COLUMN_ID = process.env.MONDAY_MSTATUS_COLUMN_ID || 'project_status'
const MONDAY_HSTATUS_COLUMN_ID = process.env.MONDAY_HSTATUS_COLUMN_ID || 'dup__of_mstatus'

// Map explicit "<Name> reservada" patterns for MUAs and HS
const RESERVED_PATTERNS: Record<string, string> = {
  // MUA
  'Lola': 'Lola reservada',
  'Miguel': 'Miguel reservada',
  'Teresa': 'Teresa reservada',
  'Inês': 'Inês reservada',
  'Rita': 'Rita reservada',
  'Sofia': 'Sofia reservada',
  'Filipa': 'Filipa reservada',
  'Ana Neves': 'Ana Neves reservada',
  'Ana Roma': 'Ana Roma reservada',
  'Sara': 'Sara reservada',
  // HS
  'Olga H': 'Olga H reservada',
  'Lília': 'Lília reservada',
  'Oksana': 'Oksana reservada',
  'Eric': 'Eric reservada',
  'Andreia': 'Andreia reservada',
  'Agne': 'Agne reservada',
  'Joana': 'Joana reservada',
  'Olga': 'Olga reservada',
}

// Map artist email to their canonical short name
const EMAIL_TO_SHORT_NAME: Record<string, string> = {
  // MUA
  'gi.lola@gmail.com': 'Lola',
  'info@miguelstapleton.art': 'Miguel',
  'tecadete@gmail.com': 'Teresa',
  'iaguiarmakeup@gmail.com': 'Inês',
  'ritarnunes.mua@gmail.com': 'Rita',
  'anaferreira.geral@hotmail.com': 'Sofia',
  'filipawahnon.mua@gmail.com': 'Filipa',
  'anacatarinanev@gmail.com': 'Ana Neves',
  'sara.jogo@hotmail.com': 'Sara',
  'anaroma.makeup@gmail.com': 'Ana Roma',
  // HS
  'olga.amaral.hilario@gmail.com': 'Olga H',
  'liliapcosta@gmail.com': 'Lília',
  'kseniya.hairstylist@gmail.com': 'Oksana',
  'riberic@gmail.com': 'Eric',
  'andreiadematoshair@gmail.com': 'Andreia',
  'hi@letshair.com': 'Agne',
  'joanacarvalho_@hotmail.com': 'Joana',
}

function extractArtistKey(fullName: string): string {
  // Special multi-word names first
  if (fullName.includes('Ana Neves')) return 'Ana Neves'
  if (fullName.includes('Ana Roma')) return 'Ana Roma'
  if (fullName.includes('Olga H')) return 'Olga H'
  // Try to find any known key inside the name
  for (const key of Object.keys(RESERVED_PATTERNS)) {
    if (fullName.includes(key)) return key
  }
  // Fallback to first token
  return fullName.split(' ')[0]
}

function normalizeDiacritics(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function normalizeSpaces(s: string) {
  return s
    .replace(/\u00A0/g, ' ') // non-breaking space -> normal space
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim()
}

export async function GET(request: NextRequest) {
  try {
    if (!MONDAY_API_TOKEN || !MONDAY_CLIENTS_BOARD_ID) {
      return NextResponse.json({ error: 'Monday configuration missing' }, { status: 500 })
    }

    const user = await requireArtist(request)

    // Load artist from DB to know type and Monday item id + name from Monday
    const { prisma } = await import('@/lib/prisma')
    const artist = await prisma.artist.findUnique({ where: { userId: user.id } })
    if (!artist) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 })
    }

    // Get artist short name from email first, then fallback to Monday item name
    const artistQuery = `
      query GetArtistItem($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          name
        }
      }
    `
    const artistRes = await axios.post(
      MONDAY_API_URL,
      { query: artistQuery, variables: { itemId: artist.mondayItemId } },
      { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
    )
    const artistItem = artistRes.data?.data?.items?.[0]
    const artistName = artistItem?.name || ''

    const emailShort = EMAIL_TO_SHORT_NAME[artist.email]
    const artistKey = emailShort || extractArtistKey(artistName)
    const reservedPatternRaw = RESERVED_PATTERNS[artistKey] || `${artistKey} reservada`
    const reservedPattern = normalizeDiacritics(reservedPatternRaw)

    // Fetch all Clients board items via pagination
    let allItems: any[] = []
    let cursor: string | null = null
    let hasMore = true

    // Force Monday to include specific columns even when empty by requesting by IDs
    const clientsQuery = `
      query GetBoardItems($boardId: ID!, $cursor: String, $columnIds: [String!]) {
        boards(ids: [$boardId]) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values(ids: $columnIds) { id text value }
              updates { id text_body }
            }
          }
        }
      }
    `

    // Fallback query without filtering columns by ID
    const clientsQueryNoFilter = `
      query GetBoardItems($boardId: ID!, $cursor: String) {
        boards(ids: [$boardId]) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values { id text value }
              updates { id text_body }
            }
          }
        }
      }
    `

    while (hasMore) {
      // Build the column IDs list for this artist type
      const statusId = (artist.type === 'MUA' ? MONDAY_MSTATUS_COLUMN_ID : MONDAY_HSTATUS_COLUMN_ID)
      const defaultStatusId = (artist.type === 'MUA' ? 'project_status' : 'dup__of_mstatus')
      const colIds = Array.from(new Set([
        statusId,
        defaultStatusId,
        'short_text8', // bride name
        'date6',       // event date
        'short_text1', // beauty venue
        'long_text4',  // observations/notes
        'date_mkpj7c7s', // Trial date column
      ]))

      let resp: any
      try {
        resp = await axios.post(
          MONDAY_API_URL,
          { query: clientsQuery, variables: { boardId: MONDAY_CLIENTS_BOARD_ID, cursor, columnIds: colIds } },
          { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
        )
      } catch (e) {
        console.error('[booked-clients] Monday request failed (with columnIds):', e)
        resp = { data: { errors: [{ message: 'network-or-axios-failure' }] } }
      }

      // If Monday reports errors, retry without filtering column ids
      if (resp?.data?.errors) {
        console.warn('[booked-clients] Monday errors with columnIds, retrying without filter:', resp.data.errors)
        const retry: any = await axios.post(
          MONDAY_API_URL,
          { query: clientsQueryNoFilter, variables: { boardId: MONDAY_CLIENTS_BOARD_ID, cursor } },
          { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
        )
        if (retry?.data?.errors) {
          console.error('[booked-clients] Monday errors on fallback as well:', retry.data.errors)
          return NextResponse.json({ error: 'Monday API error', details: retry.data.errors }, { status: 502 })
        }
        const board = retry.data.data.boards?.[0]
        if (!board) break
        allItems = [...allItems, ...(board.items_page?.items || [])]
        cursor = board.items_page?.cursor
        hasMore = !!cursor
        continue
      }

      const board = resp.data?.data?.boards?.[0]
      if (!board) break
      allItems = [...allItems, ...board.items_page.items]
      cursor = board.items_page.cursor
      hasMore = !!cursor
    }

    // Determine which status column and target status to use
    const statusColumnId = artist.type === 'MUA' ? MONDAY_MSTATUS_COLUMN_ID : MONDAY_HSTATUS_COLUMN_ID
    const targetsRaw = artist.type === 'MUA' ? ['MUA booked!', 'MUA booked !'] : ['H booked!', 'H booked !']
    const targets = targetsRaw.map(normalizeSpaces)

    let statusMatched = 0
    let patternMatched = 0
    let futureDateMatched = 0
    const observedStatuses = new Set<string>()

    const results: Array<{ mondayItemId: string; brideName: string; trialDate?: string }> = []

    for (const item of allItems) {
      const cols = item.column_values || []
      const updates = item.updates || []

      // Find status column strictly by the resolved ID (it was explicitly requested in the query)
      const statusCol = cols.find((c: any) => c.id === statusColumnId) || cols.find((c: any) => c.id === (artist.type === 'MUA' ? 'project_status' : 'dup__of_mstatus'))
      if (!statusCol) {
        console.log('[booked-clients] status column not returned by Monday. tried ids:', { envId: statusColumnId, defaultId: (artist.type === 'MUA' ? 'project_status' : 'dup__of_mstatus') }, 'cols sample:', cols.slice(0,6))
        continue
      }

      let status = statusCol?.text || ''
      if (!status && statusCol?.value) {
        try {
          const parsed = JSON.parse(statusCol.value)
          status = parsed?.label || ''
        } catch {}
      }
      if (status) observedStatuses.add(status)

      const statusNorm = normalizeSpaces(status)
      if (!targets.includes(statusNorm)) continue
      statusMatched++

      // Only future wedding dates
      const dateCol = cols.find((c: any) => c.id === 'date6')
      const dateText = dateCol?.text || ''
      let isFuture = false
      if (dateText) {
        const eventDate = new Date(dateText)
        const today = new Date()
        // Compare by date (ignore time); include today and future
        const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        const d1 = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
        isFuture = d1 >= d0
      }
      if (!isFuture) continue
      futureDateMatched++

      // Case/diacritic-insensitive reserved pattern check in updates for this artist
      const matches = updates.some((u: any) => normalizeDiacritics(u.text_body || '').includes(reservedPattern))
      if (!matches) continue
      patternMatched++

      const brideCol = cols.find((c: any) => c.id === 'short_text8')
      const brideName = brideCol?.text || item.name
      if (!brideName) continue

      // Current Trial date from Trial date column (date_mkpj7c7s)
      const trialCol = cols.find((c: any) => c.id === 'date_mkpj7c7s')
      let trialDate: string | undefined
      if (trialCol?.text) {
        trialDate = trialCol.text
      } else if (trialCol?.value) {
        try {
          const parsed = JSON.parse(trialCol.value)
          trialDate = parsed?.date || undefined
        } catch {}
      }

      results.push({ mondayItemId: item.id, brideName, trialDate })
    }

    console.log('[booked-clients] artist:', artist.email, 'type:', artist.type, 'statusMatched:', statusMatched, 'futureDateMatched:', futureDateMatched, 'patternMatched:', patternMatched, 'returned:', results.length, 'observedStatuses:', Array.from(observedStatuses).slice(0, 10))

    // Sort alphabetically for nicer UX
    results.sort((a, b) => a.brideName.localeCompare(b.brideName, 'pt'))

    return NextResponse.json({ clients: results })
  } catch (error) {
    console.error('Booked clients error:', error)
    return handleAuthError(error)
  }
}
