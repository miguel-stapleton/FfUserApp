import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken, getAuthCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'

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

    // Get user with artist data
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        artist: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      )
    }

    // Prepare response data
    const responseData: any = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    }

    // Include artist data if user is an artist
    if (user.artist) {
      responseData.artist = {
        id: user.artist.id,
        type: user.artist.type,
        tier: user.artist.tier,
        active: user.artist.active,
        profilePicture: user.artist.profilePicture,
      }
    }

    return NextResponse.json(responseData)

  } catch (error) {
    console.error('Me endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
