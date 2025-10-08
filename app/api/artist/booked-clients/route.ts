import { NextRequest, NextResponse } from 'next/server'
import { requireArtist, handleAuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import axios from 'axios'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID
const MONDAY_MUA_BOARD_ID = process.env.MONDAY_MUA_BOARD_ID
const MONDAY_HS_BOARD_ID = process.env.MONDAY_HS_BOARD_ID

interface BookedClient {
  mondayItemId: string
  brideName: string
}

interface ArtistInfo {
  type: 'MUA' | 'HS'
  mondayItemId: string
  name: string
}

// Map artist names to their reservation text patterns
const MUA_RESERVATION_PATTERNS: Record<string, string> = {
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
}

async function findArtistInMonday(email: string): Promise<ArtistInfo | null> {
  const query = `
    query GetBoardItems($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 100) {
          items {
            id
            name
            column_values {
              id
              text
            }
          }
        }
      }
    }
  `

  // Check MUA board
  try {
    const muaResponse = await axios.post(
      MONDAY_API_URL,
      {
        query,
        variables: { boardId: MONDAY_MUA_BOARD_ID },
      },
      {
        headers: {
          'Authorization': MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    const muaBoard = muaResponse.data.data.boards[0]
    if (muaBoard?.items_page) {
      for (const item of muaBoard.items_page.items) {
        const emailColumn = item.column_values.find((col: any) => col.id === 'email')
        if (emailColumn?.text === email) {
          return { type: 'MUA', mondayItemId: item.id, name: item.name }
        }
      }
    }
  } catch (error) {
    console.error('Error checking MUA board:', error)
  }

  // Check HS board
  try {
    const hsResponse = await axios.post(
      MONDAY_API_URL,
      {
        query,
        variables: { boardId: MONDAY_HS_BOARD_ID },
      },
      {
        headers: {
          'Authorization': MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    const hsBoard = hsResponse.data.data.boards[0]
    if (hsBoard?.items_page) {
      for (const item of hsBoard.items_page.items) {
        const emailColumn = item.column_values.find((col: any) => col.id === 'email')
        if (emailColumn?.text === email) {
          return { type: 'HS', mondayItemId: item.id, name: item.name }
        }
      }
    }
  } catch (error) {
    console.error('Error checking HS board:', error)
  }

  return null
}

export async function GET(request: NextRequest) {
  try {
    // Authenticate and get user
    const user = await requireArtist(request)

    // Get artist record
    const artist = await prisma.artist.findUnique({
      where: { userId: user.id },
      select: {
        email: true,
      },
    })

    if (!artist) {
      return NextResponse.json(
        { error: 'Artist profile not found' },
        { status: 404 }
      )
    }

    console.log('=== BOOKED CLIENTS DEBUG ===')
    console.log('Artist email:', artist.email)

    // Dynamically find artist in Monday.com boards
    const artistInfo = await findArtistInMonday(artist.email)
    
    if (!artistInfo) {
      console.log('Artist not found in any Monday.com board')
      return NextResponse.json({ clients: [] })
    }

    console.log('Artist type (from Monday):', artistInfo.type)
    console.log('Artist name:', artistInfo.name)
    console.log('Artist Monday Item ID:', artistInfo.mondayItemId)

    // Get the reservation pattern for this artist
    // Match by checking if any pattern key is contained in the artist name
    let reservationPattern: string | undefined
    for (const [key, pattern] of Object.entries(MUA_RESERVATION_PATTERNS)) {
      if (artistInfo.name.includes(key)) {
        reservationPattern = pattern
        break
      }
    }
    
    if (!reservationPattern && artistInfo.type === 'MUA') {
      console.log('No reservation pattern found for artist:', artistInfo.name)
      return NextResponse.json({ clients: [] })
    }
    console.log('Searching for pattern:', reservationPattern)

    // Fetch ALL clients from Monday.com Clients board using pagination
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

      const clientsResponse = await axios.post(
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

    console.log('Total clients fetched from Monday:', allItems.length)

    const bookedClients: BookedClient[] = []

    // Filter clients based on artist type
    for (const item of allItems) {
      const columnValues = item.column_values || []

      // Get bride's name from short_text8 column
      const brideNameColumn = columnValues.find((col: any) => col.id === 'short_text8')
      const brideName = brideNameColumn?.text

      if (!brideName) continue

      console.log(`Processing bride: ${brideName}`)

      if (artistInfo.type === 'MUA') {
        // Check if Mstatus (project_status) is "MUA booked!"
        const mStatusColumn = columnValues.find((col: any) => col.id === 'project_status')
        const mStatus = mStatusColumn?.text

        console.log(`Mstatus: ${mStatus}`)

        if (mStatus === 'MUA booked!') {
          // Search updates for the artist's reservation pattern
          const updates = item.updates || []
          const hasReservation = updates.some((update: any) => 
            update.text_body?.includes(reservationPattern)
          )

          console.log(`Bride: ${brideName} | MUA booked! | Has "${reservationPattern}": ${hasReservation}`)

          if (hasReservation) {
            bookedClients.push({
              mondayItemId: item.id,
              brideName,
            })
          }
        }
      } else if (artistInfo.type === 'HS') {
        // Check if Hstatus (project_status) is "HS booked!"
        const hStatusColumn = columnValues.find((col: any) => col.id === 'project_status')
        const hStatus = hStatusColumn?.text

        console.log(`Hstatus: ${hStatus}`)

        if (hStatus === 'HS booked!') {
          // Search updates for the artist's reservation pattern
          const updates = item.updates || []
          const hasReservation = updates.some((update: any) => 
            update.text_body?.includes(reservationPattern)
          )

          console.log(`Bride: ${brideName} | HS booked! | Has "${reservationPattern}": ${hasReservation}`)

          if (hasReservation) {
            bookedClients.push({
              mondayItemId: item.id,
              brideName,
            })
          }
        }
      }
    }

    console.log('Total booked clients found:', bookedClients.length)
    console.log('=== END DEBUG ===\n')

    return NextResponse.json({ clients: bookedClients })
  } catch (error) {
    console.error('Failed to fetch booked clients:', error)
    return handleAuthError(error)
  }
}