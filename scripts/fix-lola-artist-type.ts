import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const prisma = new PrismaClient()

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_MUA_BOARD_ID = process.env.MONDAY_MUA_BOARD_ID
const MONDAY_HS_BOARD_ID = process.env.MONDAY_HS_BOARD_ID

async function findArtistInMonday(email: string) {
  const query = `
    query GetBoardItems($boardId: ID!) {
      boards(ids: [$boardId]) {
        id
        name
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
  for (const item of muaBoard.items_page.items) {
    const emailColumn = item.column_values.find((col: any) => col.id === 'email')
    if (emailColumn?.text === email) {
      return { type: 'MUA', itemId: item.id, name: item.name }
    }
  }

  // Check HS board
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
  for (const item of hsBoard.items_page.items) {
    const emailColumn = item.column_values.find((col: any) => col.id === 'email')
    if (emailColumn?.text === email) {
      return { type: 'HS', itemId: item.id, name: item.name }
    }
  }

  return null
}

async function main() {
  try {
    console.log('Checking all artists...\n')

    const artists = await prisma.artist.findMany({
      select: {
        id: true,
        email: true,
        type: true,
        mondayItemId: true,
      },
    })

    console.log(`Found ${artists.length} artists in database\n`)

    let updatedCount = 0

    for (const artist of artists) {
      console.log(`Checking ${artist.email}...`)
      console.log(`  Current DB type: ${artist.type}`)
      console.log(`  Current DB Monday ID: ${artist.mondayItemId}`)

      const mondayData = await findArtistInMonday(artist.email)

      if (!mondayData) {
        console.log(`  ❌ Not found in any Monday board\n`)
        continue
      }

      console.log(`  Monday board: ${mondayData.type}`)
      console.log(`  Monday item ID: ${mondayData.itemId}`)
      console.log(`  Monday name: ${mondayData.name}`)

      if (artist.type !== mondayData.type || artist.mondayItemId !== mondayData.itemId) {
        console.log(`  🔄 UPDATING...`)
        await prisma.artist.update({
          where: { id: artist.id },
          data: {
            type: mondayData.type as 'MUA' | 'HS',
            mondayItemId: mondayData.itemId,
          },
        })
        console.log(`  ✅ Updated!\n`)
        updatedCount++
      } else {
        console.log(`  ✓ Already correct\n`)
      }
    }

    console.log(`\n=== SUMMARY ===`)
    console.log(`Total artists checked: ${artists.length}`)
    console.log(`Artists updated: ${updatedCount}`)
    console.log(`Artists already correct: ${artists.length - updatedCount}`)

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
