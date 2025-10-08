import { NextRequest, NextResponse } from 'next/server'
import { findArtistByEmail } from '@/lib/monday'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')

  if (!email) {
    return NextResponse.json({
      error: 'Please provide email parameter: ?email=your@email.com'
    }, { status: 400 })
  }

  try {
    console.log(`Testing artist lookup for email: ${email}`)
    console.log('Environment variables:')
    console.log('MONDAY_MUA_BOARD_ID:', process.env.MONDAY_MUA_BOARD_ID)
    console.log('MONDAY_HS_BOARD_ID:', process.env.MONDAY_HS_BOARD_ID)
    console.log('MONDAY_API_TOKEN:', process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set')

    const artist = await findArtistByEmail(email)
    
    return NextResponse.json({
      success: true,
      email,
      artistFound: !!artist,
      artist,
      environment: {
        MONDAY_MUA_BOARD_ID: process.env.MONDAY_MUA_BOARD_ID,
        MONDAY_HS_BOARD_ID: process.env.MONDAY_HS_BOARD_ID,
        MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set'
      }
    })
  } catch (error) {
    console.error('Artist lookup failed:', error)
    return NextResponse.json({
      success: false,
      email,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      environment: {
        MONDAY_MUA_BOARD_ID: process.env.MONDAY_MUA_BOARD_ID,
        MONDAY_HS_BOARD_ID: process.env.MONDAY_HS_BOARD_ID,
        MONDAY_API_TOKEN: process.env.MONDAY_API_TOKEN ? 'Set' : 'Not set'
      }
    }, { status: 500 })
  }
}
