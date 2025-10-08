import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'

const MONDAY_API_URL = 'https://api.monday.com/v2'

export async function GET(request: NextRequest) {
  try {
    const query = `
      query GetBoardsRaw($muaBoardId: ID!, $hsBoardId: ID!) {
        boards(ids: [$muaBoardId, $hsBoardId]) {
          id
          name
          items_page(limit: 10) {
            items {
              id
              name
              column_values {
                id
                text
                title
                value
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
        variables: { 
          muaBoardId: process.env.MONDAY_MUA_BOARD_ID,
          hsBoardId: process.env.MONDAY_HS_BOARD_ID
        } 
      },
      {
        headers: {
          'Authorization': process.env.MONDAY_API_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    )

    if (response.data.errors) {
      throw new Error(`Monday API Error: ${JSON.stringify(response.data.errors)}`)
    }

    const boards = response.data.data.boards

    // Find all email-related columns
    const emailColumns = []
    for (const board of boards) {
      for (const item of board.items_page.items) {
        for (const col of item.column_values) {
          if (col.title?.toLowerCase().includes('email') || col.id === 'email' || col.text?.includes('@')) {
            emailColumns.push({
              boardId: board.id,
              boardName: board.name,
              itemId: item.id,
              itemName: item.name,
              columnId: col.id,
              columnTitle: col.title,
              columnText: col.text,
              columnValue: col.value
            })
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      boards: boards.map(board => ({
        id: board.id,
        name: board.name,
        itemCount: board.items_page.items.length,
        firstItem: board.items_page.items[0] || null
      })),
      emailColumns,
      environment: {
        MONDAY_MUA_BOARD_ID: process.env.MONDAY_MUA_BOARD_ID,
        MONDAY_HS_BOARD_ID: process.env.MONDAY_HS_BOARD_ID,
        MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set'
      }
    })
  } catch (error) {
    console.error('Monday raw data fetch failed:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}
