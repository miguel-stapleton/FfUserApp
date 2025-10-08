import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_MUA_BOARD_ID = process.env.MONDAY_MUA_BOARD_ID
const MONDAY_HS_BOARD_ID = process.env.MONDAY_HS_BOARD_ID

const DEFAULT_PASSWORD = 'freshfaced2022'

// Username to email mapping
const USERNAME_EMAIL_MAP: Record<string, string> = {
  // MUA
  'anaroma': 'anaroma.makeup@gmail.com',
  'sofia': 'anaferreira.geral@hotmail.com',
  'ananeves': 'anacatarinanev@gmail.com',
  'sara': 'sara.jogo@hotmail.com',
  'filipa': 'filipawahnon.mua@gmail.com',
  // HS
  'agne': 'hi@letshair.com',
  'lilia': 'liliapcosta@gmail.com',
  'andreia': 'andreiadematoshair@gmail.com',
  'eric': 'riberic@gmail.com',
  'oksana': 'kseniya.hairstylist@gmail.com',
  'joana': 'joanacarvalho_@hotmail.com',
  'olgah': 'olga.amaral.hilario@gmail.com',
}

// Reverse map for lookup
const EMAIL_USERNAME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(USERNAME_EMAIL_MAP).map(([k, v]) => [v, k])
)

async function fetchArtistsFromMonday(boardId: string, type: 'MUA' | 'HS') {
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

  const response = await axios.post(
    MONDAY_API_URL,
    {
      query,
      variables: { boardId },
    },
    {
      headers: {
        'Authorization': MONDAY_API_TOKEN,
        'Content-Type': 'application/json',
      },
    }
  )

  const board = response.data.data.boards[0]
  const artists: Array<{ email: string; name: string; mondayItemId: string; type: 'MUA' | 'HS' }> = []

  for (const item of board.items_page.items) {
    const emailColumn = item.column_values.find((col: any) => col.id === 'email')
    const email = emailColumn?.text

    if (email) {
      artists.push({
        email,
        name: item.name,
        mondayItemId: item.id,
        type,
      })
    }
  }

  return artists
}

async function main() {
  try {
    console.log('Fetching artists from Monday.com boards...\n')

    // Fetch MUA artists
    const muaArtists = await fetchArtistsFromMonday(MONDAY_MUA_BOARD_ID!, 'MUA')
    console.log(`Found ${muaArtists.length} MUA artists`)

    // Fetch HS artists
    const hsArtists = await fetchArtistsFromMonday(MONDAY_HS_BOARD_ID!, 'HS')
    console.log(`Found ${hsArtists.length} HS artists\n`)

    const allArtists = [...muaArtists, ...hsArtists]

    // Hash the default password once
    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10)

    let createdCount = 0
    let skippedCount = 0

    for (const artist of allArtists) {
      console.log(`Processing ${artist.name} (${artist.email})...`)

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: artist.email },
      })

      if (existingUser) {
        console.log(`  ✓ User already exists\n`)
        skippedCount++
        continue
      }

      // Get username from mapping
      const username = EMAIL_USERNAME_MAP[artist.email]
      if (!username) {
        console.log(`  ⚠️  No username mapping found, skipping\n`)
        skippedCount++
        continue
      }

      // Create user and artist in a transaction
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: artist.email,
            username: username,
            passwordHash: hashedPassword,
            role: 'ARTIST',
          },
        })

        await tx.artist.create({
          data: {
            userId: user.id,
            email: artist.email,
            type: artist.type,
            tier: 'FRESH', // Default tier
            mondayItemId: artist.mondayItemId,
            active: true,
          },
        })
      })

      console.log(`  ✅ Created user and artist record`)
      console.log(`     Username: ${username}`)
      console.log(`     Type: ${artist.type}`)
      console.log(`     Monday ID: ${artist.mondayItemId}\n`)
      createdCount++
    }

    console.log('\n=== SUMMARY ===')
    console.log(`Total artists in Monday: ${allArtists.length}`)
    console.log(`Accounts created: ${createdCount}`)
    console.log(`Already existed: ${skippedCount}`)
    console.log(`\nDefault password for all accounts: ${DEFAULT_PASSWORD}`)

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
