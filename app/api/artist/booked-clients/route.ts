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

    // Get artist Monday item to determine their display name for pattern
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

    const artistKey = extractArtistKey(artistName)
    const reservedPattern = (RESERVED_PATTERNS[artistKey] || `${artistKey} reservada`).toLowerCase()

    // Fetch all Clients board items via pagination
    let allItems: any[] = []
    let cursor: string | null = null
    let hasMore = true

    const clientsQuery = `
      query GetBoardItems($boardId: ID!, $cursor: String) {
        boards(ids: [$boardId]) {
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values { id text }
              updates { id text_body }
            }
          }
        }
      }
    `

    while (hasMore) {
      const resp = await axios.post(
        MONDAY_API_URL,
        { query: clientsQuery, variables: { boardId: MONDAY_CLIENTS_BOARD_ID, cursor } },
        { headers: { Authorization: MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
      )
      if (resp.data.errors) {
        return NextResponse.json({ error: 'Monday API error', details: resp.data.errors }, { status: 502 })
      }
      const board = resp.data.data.boards?.[0]
      if (!board) break
      allItems.push(...(board.items_page?.items || []))
      cursor = board.items_page?.cursor
      hasMore = !!cursor
    }

    // Determine which status column and target status to use
    const statusColumnId = artist.type === 'MUA' ? MONDAY_MSTATUS_COLUMN_ID : MONDAY_HSTATUS_COLUMN_ID
    const targetStatus = artist.type === 'MUA' ? 'MUA booked!' : 'H booked!'

    const results: Array<{ mondayItemId: string; brideName: string }> = []

    for (const item of allItems) {
      const cols = item.column_values || []
      const updates = item.updates || []
      const statusCol = cols.find((c: any) => c.id === statusColumnId)
      const status = statusCol?.text
      if (status !== targetStatus) continue

      // Case-insensitive reserved pattern check in updates for this artist
      const matches = updates.some((u: any) => (u.text_body || '').toLowerCase().includes(reservedPattern))
      if (!matches) continue

      const brideCol = cols.find((c: any) => c.id === 'short_text8')
      const brideName = brideCol?.text || item.name
      if (!brideName) continue

      results.push({ mondayItemId: item.id, brideName })
    }

    // Sort alphabetically for nicer UX
    results.sort((a, b) => a.brideName.localeCompare(b.brideName, 'pt'))

    return NextResponse.json({ clients: results })
  } catch (error) {
    console.error('Booked clients error:', error)
    return handleAuthError(error)
  }
}
