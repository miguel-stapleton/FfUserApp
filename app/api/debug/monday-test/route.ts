import { NextRequest, NextResponse } from 'next/server'
import { getAllClientsFromMonday } from '@/lib/monday'

export async function GET(request: NextRequest) {
  try {
    console.log('Testing Monday.com API connection...')
    console.log('MONDAY_API_TOKEN:', process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set')
    console.log('MONDAY_BOARD_ID:', process.env.MONDAY_BOARD_ID)
    console.log('MONDAY_MUA_BOARD_ID:', process.env.MONDAY_MUA_BOARD_ID)
    console.log('MONDAY_HS_BOARD_ID:', process.env.MONDAY_HS_BOARD_ID)

    const clients = await getAllClientsFromMonday()
    
    return NextResponse.json({
      success: true,
      clientCount: clients.length,
      clients: clients.slice(0, 3), // Show first 3 for debugging
      environment: {
        MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set',
        MONDAY_BOARD_ID: process.env.MONDAY_BOARD_ID,
        MONDAY_MUA_BOARD_ID: process.env.MONDAY_MUA_BOARD_ID,
        MONDAY_HS_BOARD_ID: process.env.MONDAY_HS_BOARD_ID,
      }
    })
  } catch (error) {
    console.error('Monday.com API test failed:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      environment: {
        MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set',
        MONDAY_BOARD_ID: process.env.MONDAY_BOARD_ID,
        MONDAY_MUA_BOARD_ID: process.env.MONDAY_MUA_BOARD_ID,
        MONDAY_HS_BOARD_ID: process.env.MONDAY_HS_BOARD_ID,
      }
    }, { status: 500 })
  }
}
