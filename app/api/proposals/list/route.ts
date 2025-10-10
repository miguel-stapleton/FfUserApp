import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, getAuthCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Get token from cookie
    const token = getAuthCookie(request)
    if (!token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Verify token
    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      )
    }

    // Check if user is an artist
    if (payload.role !== 'ARTIST') {
      return NextResponse.json(
        { error: 'Access denied. Artist role required.' },
        { status: 403 }
      )
    }

    // Get artist proposals
    const { getOpenProposalsForArtist } = await import('@/lib/services/proposals')
    const proposals = await getOpenProposalsForArtist(payload.userId)

    return NextResponse.json({ proposals })

  } catch (error) {
    console.error('Failed to fetch proposals:', error)
    console.error('Error details:', error instanceof Error ? error.message : 'Unknown error')
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
