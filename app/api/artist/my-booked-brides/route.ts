import { NextRequest, NextResponse } from 'next/server'
import { requireArtist, handleAuthError } from '@/lib/auth'
import axios from 'axios'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_CLIENTS_BOARD_ID =
  process.env.MONDAY_CLIENTS_BOARD_ID || process.env.MONDAY_BOARD_ID || '1260828829'
const MONDAY_MSTATUS_COLUMN_ID = process.env.MONDAY_MSTATUS_COLUMN_ID || 'project_status'
const MONDAY_HSTATUS_COLUMN_ID = process.env.MONDAY_HSTATUS_COLUMN_ID || 'dup__of_mstatus'

// Resolve env var, falling back if placeholder strings slipped through
const MONDAY_CHOSEN_MUA_COLUMN_ID =
  !process.env.MONDAY_CHOSEN_MUA_COLUMN_ID ||
  process.env.MONDAY_CHOSEN_MUA_COLUMN_ID === 'chosen_mua_column_id'
    ? 'connect_boards'
    : process.env.MONDAY_CHOSEN_MUA_COLUMN_ID

const MONDAY_CHOSEN_HS_COLUMN_ID =
  !process.env.MONDAY_CHOSEN_HS_COLUMN_ID ||
  process.env.MONDAY_CHOSEN_HS_COLUMN_ID === 'chosen_hs_column_id'
    ? 'connect_boards0'
    : process.env.MONDAY_CHOSEN_HS_COLUMN_ID

/**
 * Parse the linkedPulseIds array out of a connect_boards column JSON value.
 * Monday returns something like: {"linkedPulseIds":[{"linkedPulseId":1234567890}]}
 */
function parseLinkedPulseIds(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    const ids: any[] = parsed?.linkedPulseIds || []
    return ids.map((lp: any) => String(lp.linkedPulseId)).filter(Boolean)
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireArtist(request)
    const { prisma } = await import('@/lib/prisma')

    const artist = await prisma.artist.findUnique({
      where: { userId: user.id },
      include: { user: true },
    })
    if (!artist) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 })
    }

    // Which status column and booked label apply to this artist type
    const statusColumnId =
      artist.type === 'MUA' ? MONDAY_MSTATUS_COLUMN_ID : MONDAY_HSTATUS_COLUMN_ID
    const bookedStatus = artist.type === 'MUA' ? 'MUA booked!' : 'H booked!'

    // The connect_boards column that points TO this artist's type
    const myColumnId =
      artist.type === 'MUA' ? MONDAY_CHOSEN_MUA_COLUMN_ID : MONDAY_CHOSEN_HS_COLUMN_ID

    // The connect_boards column for the OTHER service type (companion artist)
    const companionColumnId =
      artist.type === 'MUA' ? MONDAY_CHOSEN_HS_COLUMN_ID : MONDAY_CHOSEN_MUA_COLUMN_ID

    // Use items_by_column_values to pre-filter by booked status — much faster than a full
    // board scan because Monday does the filtering server-side.
    const mondayQuery = `
      query GetBookedItems($boardId: ID!, $colId: String!, $val: String!) {
        items_by_column_values(
          board_id: $boardId
          column_id: $colId
          column_value: $val
          limit: 500
        ) {
          id
          name
          column_values { id text value }
        }
      }
    `

    const resp = await axios.post(
      MONDAY_API_URL,
      {
        query: mondayQuery,
        variables: {
          boardId: MONDAY_CLIENTS_BOARD_ID,
          colId: statusColumnId,
          val: bookedStatus,
        },
      },
      {
        headers: {
          Authorization: MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    if (resp.data?.errors) {
      console.error('[my-booked-brides] Monday API errors:', resp.data.errors)
      return NextResponse.json({ error: 'Monday API error' }, { status: 502 })
    }

    const allBooked: any[] = resp.data?.data?.items_by_column_values || []
    console.log(
      `[my-booked-brides] ${artist.email} (${artist.type}): ${allBooked.length} booked items from Monday`
    )

    // Filter to items where this artist is the linked artist in their column
    const myItems = allBooked.filter((item) => {
      const col = item.column_values.find((c: any) => c.id === myColumnId)
      const linkedIds = parseLinkedPulseIds(col?.value)
      return linkedIds.includes(String(artist.mondayItemId))
    })

    console.log(`[my-booked-brides] ${myItems.length} items linked to this artist`)

    // Collect all companion artist Monday item IDs so we can batch-fetch from DB
    const companionMondayIds = myItems
      .flatMap((item) => {
        const col = item.column_values.find((c: any) => c.id === companionColumnId)
        return parseLinkedPulseIds(col?.value)
      })
      .filter(Boolean)

    // Look up companion artists in the DB (for name + profile picture)
    const companionArtists =
      companionMondayIds.length > 0
        ? await prisma.artist.findMany({
            where: { mondayItemId: { in: companionMondayIds } },
            include: { user: true },
          })
        : []

    const companionByMondayId = new Map(companionArtists.map((a) => [a.mondayItemId, a]))

    // Build the response payload
    const brides = myItems.map((item) => {
      const cols: any[] = item.column_values
      const getCol = (id: string) => cols.find((c: any) => c.id === id)

      const brideName = getCol('short_text8')?.text || item.name

      // Wedding date
      const dateCol = getCol('date6')
      let weddingDate: string | null = null
      if (dateCol?.text) {
        weddingDate = dateCol.text
      } else if (dateCol?.value) {
        try {
          weddingDate = JSON.parse(dateCol.value)?.date ?? null
        } catch {}
      }

      const beautyVenue = getCol('short_text1')?.text || ''

      // Companion artist (first linked ID wins)
      const companionCol = getCol(companionColumnId)
      const companionIds = parseLinkedPulseIds(companionCol?.value)
      const companion = companionIds.length > 0 ? companionByMondayId.get(companionIds[0]) : null

      return {
        mondayItemId: String(item.id),
        brideName,
        weddingDate,
        beautyVenue,
        companion: companion
          ? {
              name: companion.user?.username || companion.email,
              type: companion.type,
              profilePicture: companion.profilePicture ?? null,
            }
          : null,
      }
    })

    // Sort by wedding date ascending (soonest first), nulls last
    brides.sort((a, b) => {
      if (!a.weddingDate) return 1
      if (!b.weddingDate) return -1
      return new Date(a.weddingDate).getTime() - new Date(b.weddingDate).getTime()
    })

    return NextResponse.json({ brides })
  } catch (error) {
    console.error('[my-booked-brides] error:', error)
    return handleAuthError(error)
  }
}
