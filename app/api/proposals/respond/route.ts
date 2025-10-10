import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireArtist, handleAuthError } from '@/lib/auth'
import axios from 'axios'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
const MONDAY_CLIENTS_BOARD_ID = process.env.MONDAY_CLIENTS_BOARD_ID || process.env.MONDAY_BOARD_ID // Clients board
const MONDAY_POLLS_BOARD_ID = '1952175468'

// Map artist emails to their Polls board column IDs
const MUA_POLL_COLUMNS: Record<string, string> = {
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

const HS_POLL_COLUMNS: Record<string, string> = {
  'hi@letshair.com': 'boolean_mkqwrtzh',
  'liliapcosta@gmail.com': 'boolean_mkqwm8w8',
  'andreiadematoshair@gmail.com': 'boolean_mkqw9etg',
  'riberic@gmail.com': 'boolean_mkqwt8cv',
  'kseniya.hairstylist@gmail.com': 'boolean_mkqwbra6',
  'joanacarvalho_@hotmail.com': 'boolean_mkqwx8ve',
  'olga.amaral.hilario@gmail.com': 'boolean_mkqwnszp',
}

// Artist email to shortened name mapping
const ARTIST_SHORT_NAMES: Record<string, string> = {
  'gi.lola@gmail.com': 'Lola',
  'tecadete@gmail.com': 'Teresa',
  'info@miguelstapleton.art': 'Miguel',
  'iaguiarmakeup@gmail.com': 'Inês',
  'anaroma.makeup@gmail.com': 'Roma',
  'anaferreira.geral@hotmail.com': 'Sofia',
  'anacatarinanev@gmail.com': 'Neves',
  'ritarnunes.mua@gmail.com': 'Rita',
  'sara.jogo@hotmail.com': 'Sara',
  'filipawahnon.mua@gmail.com': 'Filipa',
  'hi@letshair.com': 'Agne', // HS
  'liliapcosta@gmail.com': 'Lília',
  'andreiadematoshair@gmail.com': 'Andreia',
  'riberic@gmail.com': 'Eric',
  'kseniya.hairstylist@gmail.com': 'Oksana',
  'joanacarvalho_@hotmail.com': 'Joana',
  'olga.amaral.hilario@gmail.com': 'Olga Hilário',
}

// Column IDs for Clients board
const MSTATUS_COLUMN_ID = 'project_status'
const MUA_PODE_COLUMN_ID = 'color_mkwhcpdm'
const HSTATUS_COLUMN_ID = 'dup__of_mstatus'
const HS_PODE_COLUMN_ID = 'color_mkwh47yj'

const responseSchema = z.object({
  proposalId: z.string(), // This is the Monday item ID from Clients board
  response: z.enum(['YES', 'NO']),
})

export async function POST(request: NextRequest) {
  try {
    const user = await requireArtist(request)

    const { prisma } = await import('@/lib/prisma')
    // Get artist record
    const artist = await prisma.artist.findUnique({
      where: { userId: user.id },
      select: { email: true, type: true },
    })

    if (!artist) {
      return NextResponse.json(
        { error: 'Artist not found' },
        { status: 404 }
      )
    }

    const body = await request.json()
    const { proposalId, response } = responseSchema.parse(body)

    console.log('=== PROPOSAL RESPONSE DEBUG ===')
    console.log('Artist email:', artist.email)
    console.log('Artist type:', artist.type)
    console.log('Client item ID:', proposalId)
    console.log('Response:', response)

    // Get the client item from Clients board to check status
    const clientQuery = `
      query GetClientItem($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          column_values {
            id
            text
          }
        }
      }
    `

    const clientResponse = await axios.post(
      MONDAY_API_URL,
      {
        query: clientQuery,
        variables: { itemId: proposalId },
      },
      {
        headers: {
          'Authorization': MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    const clientItem = clientResponse.data.data.items[0]
    if (!clientItem) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    // Check status based on artist type
    let status: string | undefined
    let shouldUpdatePolls = false
    let shouldUpdateClientBoard = false

    if (artist.type === 'MUA') {
      const mStatusCol = clientItem.column_values.find((col: any) => col.id === MSTATUS_COLUMN_ID)
      status = mStatusCol?.text
      console.log('Mstatus:', status)
      
      // Check if status is "Travelling fee + inquire the artist" for Client board updates
      if (status === 'Travelling fee + inquire the artist') {
        shouldUpdateClientBoard = true
        console.log('Status is "Travelling fee + inquire the artist" - will update Client board columns')
      }
      
      // Check if status matches for Polls board updates
      shouldUpdatePolls = status === 'inquire second option' || status === 'undecided- inquire availabilities'
    } else if (artist.type === 'HS') {
      const hStatusCol = clientItem.column_values.find((col: any) => col.id === HSTATUS_COLUMN_ID)
      status = hStatusCol?.text
      console.log('Hstatus:', status)
      
      // Check if status is "Travelling fee + inquire the artist" for Client board updates
      if (status === 'Travelling fee + inquire the artist') {
        shouldUpdateClientBoard = true
        console.log('Status is "Travelling fee + inquire the artist" - will update Client board columns')
      }
      
      // Check if status matches for HS Polls board updates
      shouldUpdatePolls = status === 'Travelling fee + inquire second option' || status === 'undecided- inquire availabilities'
    }

    // Handle Client board updates for MUA with "Travelling fee + inquire the artist" status
    if (shouldUpdateClientBoard && artist.type === 'MUA') {
      if (response === 'YES') {
        console.log('MUA responded YES - updating MUApode to "Pode!"')
        
        // Update MUApode column to "Pode!"
        const updateMutation = `
          mutation UpdateClientColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
            change_column_value(
              board_id: $boardId,
              item_id: $itemId,
              column_id: $columnId,
              value: $value
            ) {
              id
            }
          }
        `

        await axios.post(
          MONDAY_API_URL,
          {
            query: updateMutation,
            variables: {
              boardId: MONDAY_CLIENTS_BOARD_ID,
              itemId: proposalId,
              columnId: MUA_PODE_COLUMN_ID,
              value: JSON.stringify({ label: "Pode!" }),
            },
          },
          {
            headers: {
              'Authorization': MONDAY_API_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        )

        console.log(' MUApode updated to "Pode!"')
      } else if (response === 'NO') {
        console.log('MUA responded NO - updating MStatus and MUApode')
        
        // Update both MStatus and MUApode columns
        const updateMutation = `
          mutation UpdateClientColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
            change_multiple_column_values(
              board_id: $boardId,
              item_id: $itemId,
              column_values: $columnValues
            ) {
              id
            }
          }
        `

        await axios.post(
          MONDAY_API_URL,
          {
            query: updateMutation,
            variables: {
              boardId: MONDAY_CLIENTS_BOARD_ID,
              itemId: proposalId,
              columnValues: JSON.stringify({
                [MSTATUS_COLUMN_ID]: { label: "inquire second option" },
                [MUA_PODE_COLUMN_ID]: { label: "Não pode" },
              }),
            },
          },
          {
            headers: {
              'Authorization': MONDAY_API_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        )

        console.log(' MStatus updated to "inquire second option" and MUApode updated to "Não pode"')
      }
    }

    // Handle Client board updates for HS with "Travelling fee + inquire the artist" status
    if (shouldUpdateClientBoard && artist.type === 'HS') {
      if (response === 'YES') {
        console.log('HS responded YES - updating HSpode to "Pode!"')
        
        // Update HSpode column to "Pode!"
        const updateMutation = `
          mutation UpdateClientColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
            change_column_value(
              board_id: $boardId,
              item_id: $itemId,
              column_id: $columnId,
              value: $value
            ) {
              id
            }
          }
        `

        await axios.post(
          MONDAY_API_URL,
          {
            query: updateMutation,
            variables: {
              boardId: MONDAY_CLIENTS_BOARD_ID,
              itemId: proposalId,
              columnId: HS_PODE_COLUMN_ID,
              value: JSON.stringify({ label: "Pode!" }),
            },
          },
          {
            headers: {
              'Authorization': MONDAY_API_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        )

        console.log(' HSpode updated to "Pode!"')
      } else if (response === 'NO') {
        console.log('HS responded NO - updating Hstatus and HSpode')
        
        // Update both Hstatus and HSpode columns
        const updateMutation = `
          mutation UpdateClientColumns($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
            change_multiple_column_values(
              board_id: $boardId,
              item_id: $itemId,
              column_values: $columnValues
            ) {
              id
            }
          }
        `

        await axios.post(
          MONDAY_API_URL,
          {
            query: updateMutation,
            variables: {
              boardId: MONDAY_CLIENTS_BOARD_ID,
              itemId: proposalId,
              columnValues: JSON.stringify({
                [HSTATUS_COLUMN_ID]: { label: "Travelling fee + inquire second option" },
                [HS_PODE_COLUMN_ID]: { label: "Não pode" },
              }),
            },
          },
          {
            headers: {
              'Authorization': MONDAY_API_TOKEN,
              'Content-Type': 'application/json',
            },
          }
        )

        console.log(' Hstatus updated to "Travelling fee + inquire second option" and HSpode updated to "Não pode"')
      }
    }

    // Only process YES responses for Polls board updates
    if (response === 'YES' && shouldUpdatePolls) {
      console.log('Status matches - updating Polls board...')

      // Find the corresponding item in Polls board
      const pollsQuery = `
        query GetPollsBoard($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 500) {
              items {
                id
                column_values {
                  id
                  text
                }
              }
            }
          }
        }
      `

      const pollsResponse = await axios.post(
        MONDAY_API_URL,
        {
          query: pollsQuery,
          variables: { boardId: MONDAY_POLLS_BOARD_ID },
        },
        {
          headers: {
            'Authorization': MONDAY_API_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      )

      const pollsBoard = pollsResponse.data.data.boards[0]
      if (!pollsBoard) {
        return NextResponse.json(
          { error: 'Polls board not found' },
          { status: 404 }
        )
      }

      // Find item where Item IDD column matches the client item ID
      const pollItem = pollsBoard.items_page.items.find((item: any) => {
        const itemIDDCol = item.column_values.find((col: any) => col.id === 'text_mkr0k74g')
        return itemIDDCol?.text === proposalId
      })

      if (!pollItem) {
        console.log('No matching poll item found for client ID:', proposalId)
      } else {
        console.log('Found poll item:', pollItem.id)

        // Get the artist's column ID based on type
        const pollColumns = artist.type === 'MUA' ? MUA_POLL_COLUMNS : HS_POLL_COLUMNS
        const artistColumnId = pollColumns[artist.email]
        
        if (!artistColumnId) {
          console.log('No poll column mapping for artist:', artist.email)
        } else {
          console.log('Artist poll column:', artistColumnId)

          // Update the column to TRUE
          const updateMutation = `
            mutation UpdatePollColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
              change_column_value(
                board_id: $boardId,
                item_id: $itemId,
                column_id: $columnId,
                value: $value
              ) {
                id
              }
            }
          `

          await axios.post(
            MONDAY_API_URL,
            {
              query: updateMutation,
              variables: {
                boardId: MONDAY_POLLS_BOARD_ID,
                itemId: pollItem.id,
                columnId: artistColumnId,
                value: JSON.stringify({ checked: "true" }),
              },
            },
            {
              headers: {
                'Authorization': MONDAY_API_TOKEN,
                'Content-Type': 'application/json',
              },
            }
          )

          console.log(' Poll column updated to TRUE')
        }
      }
    } else if (response === 'NO' && (shouldUpdatePolls || (artist.type === 'MUA' && (status === 'inquire second option' || status === 'undecided- inquire availabilities')) || (artist.type === 'HS' && (status === 'Travelling fee + inquire second option' || status === 'undecided- inquire availabilities')))) {
      console.log('NO response for status that requires Polls board update')

      // Find the corresponding item in Polls board
      const pollsQuery = `
        query GetPollsBoard($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 500) {
              items {
                id
                column_values {
                  id
                  text
                }
              }
            }
          }
        }
      `

      const pollsResponse = await axios.post(
        MONDAY_API_URL,
        {
          query: pollsQuery,
          variables: { boardId: MONDAY_POLLS_BOARD_ID },
        },
        {
          headers: {
            'Authorization': MONDAY_API_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      )

      const pollsBoard = pollsResponse.data.data.boards[0]
      if (pollsBoard) {
        // Find item where Item IDD column matches the client item ID
        const pollItem = pollsBoard.items_page.items.find((item: any) => {
          const itemIDDCol = item.column_values.find((col: any) => col.id === 'text_mkr0k74g')
          return itemIDDCol?.text === proposalId
        })

        if (pollItem) {
          console.log('Found poll item for NO response:', pollItem.id)

          // Get the artist's column ID and short name
          const pollColumns = artist.type === 'MUA' ? MUA_POLL_COLUMNS : HS_POLL_COLUMNS
          const artistColumnId = pollColumns[artist.email]
          const artistShortName = ARTIST_SHORT_NAMES[artist.email]
          
          if (artistColumnId && artistShortName) {
            console.log('Artist poll column:', artistColumnId)
            console.log('Artist short name:', artistShortName)

            // Mark the column as FALSE
            const updateColumnMutation = `
              mutation UpdatePollColumn($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
                change_column_value(
                  board_id: $boardId,
                  item_id: $itemId,
                  column_id: $columnId,
                  value: $value
                ) {
                  id
                }
              }
            `

            await axios.post(
              MONDAY_API_URL,
              {
                query: updateColumnMutation,
                variables: {
                  boardId: MONDAY_POLLS_BOARD_ID,
                  itemId: pollItem.id,
                  columnId: artistColumnId,
                  value: JSON.stringify({ checked: "false" }),
                },
              },
              {
                headers: {
                  'Authorization': MONDAY_API_TOKEN,
                  'Content-Type': 'application/json',
                },
              }
            )

            console.log(' Poll column marked as FALSE')

            // Create update on Polls board item
            const createUpdateMutation = `
              mutation CreateUpdate($itemId: ID!, $body: String!) {
                create_update(
                  item_id: $itemId,
                  body: $body
                ) {
                  id
                }
              }
            `

            await axios.post(
              MONDAY_API_URL,
              {
                query: createUpdateMutation,
                variables: {
                  itemId: pollItem.id,
                  body: `${artistShortName} não pode`,
                },
              },
              {
                headers: {
                  'Authorization': MONDAY_API_TOKEN,
                  'Content-Type': 'application/json',
                },
              }
            )

            console.log(` Update created on Polls board: "${artistShortName} não pode"`)
          } else {
            console.log('No poll column mapping or short name for artist:', artist.email)
          }
        } else {
          console.log('No matching poll item found for client ID:', proposalId)
        }
      }
    } else {
      console.log('Status does not match - skipping Polls board update')
    }

    // ===============================
    // Persist response locally so it won't reappear on refresh
    // ===============================
    const { prisma } = await import('@/lib/prisma')

    // 1) Upsert a ClientService for this Monday client item
    //    Extract a few fields from the already-fetched clientItem
    const getCol = (id: string) => clientItem.column_values.find((c: any) => c.id === id)?.text || null
    const bridesName = getCol('short_text8') || 'Client'
    const weddingDateText = getCol('date6')
    const beautyVenue = getCol('short_text1') || ''
    const description = getCol('long_text4') || ''

    let clientService = await prisma.clientService.findFirst({
      where: {
        mondayClientItemId: proposalId,
        service: artist.type as any,
      },
    })

    if (!clientService) {
      clientService = await prisma.clientService.create({
        data: {
          mondayClientItemId: proposalId,
          service: artist.type as any, // 'MUA' | 'HS'
          bridesName: bridesName,
          weddingDate: weddingDateText ? new Date(weddingDateText) : new Date(),
          beautyVenue,
          description,
          currentStatus: status || null,
        },
      })
    }

    // 2) Ensure there is an open ProposalBatch for this ClientService
    let batch = await prisma.proposalBatch.findFirst({
      where: { clientServiceId: clientService.id, state: 'OPEN' as any },
    })

    if (!batch) {
      batch = await prisma.proposalBatch.create({
        data: {
          clientServiceId: clientService.id,
          mode: 'BROADCAST' as any,
          startReason: 'UNDECIDED' as any,
          deadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          state: 'OPEN' as any,
        },
      })
    }

    // 3) Upsert a Proposal for this artist and set the response
    //    Unique constraint is on [proposalBatchId, artistId]
    const artistRecord = await prisma.artist.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })

    if (artistRecord) {
      const existing = await prisma.proposal.findFirst({
        where: { proposalBatchId: batch.id, artistId: artistRecord.id },
      })

      if (!existing) {
        await prisma.proposal.create({
          data: {
            proposalBatchId: batch.id,
            clientServiceId: clientService.id,
            artistId: artistRecord.id,
            response: response as any,
            respondedAt: new Date(),
          },
        })
      } else if (!existing.response) {
        await prisma.proposal.update({
          where: { id: existing.id },
          data: { response: response as any, respondedAt: new Date() },
        })
      }
    }

    console.log('=== END PROPOSAL RESPONSE DEBUG ===\n')

    return NextResponse.json({
      success: true,
      message: `Response "${response}" recorded successfully`,
    })

  } catch (error) {
    console.error('Proposal response error:', error)
    return handleAuthError(error)
  }
}
