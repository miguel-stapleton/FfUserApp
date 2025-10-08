import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { findArtistByEmail } from '@/lib/monday'
import { createToken, setAuthCookie } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

const signupSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2),
  password: z.string().min(6),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, username, password } = signupSchema.parse(body)

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User already exists with this email' },
        { status: 409 }
      )
    }

    // Check if artist exists in Monday.com
    const mondayArtist = await findArtistByEmail(email)
    if (!mondayArtist) {
      return NextResponse.json(
        { error: 'Access Denied - Artist not found in system' },
        { status: 403 }
      )
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Create user and artist in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          username,
          passwordHash,
          role: 'ARTIST',
        },
      })

      // Determine artist type from Monday board
      const artistType = mondayArtist.board === 'MUA' ? 'MUA' : 'HS'

      // Create artist profile
      const artist = await tx.artist.create({
        data: {
          userId: user.id,
          email,
          type: artistType,
          tier: mondayArtist.tier,
          mondayItemId: mondayArtist.itemId,
          active: true,
        },
      })

      return { user, artist }
    })

    // Log audit event
    await logAudit({
      userId: result.user.id,
      action: 'USER_SIGNUP',
      details: {
        email,
        username,
        artistType: result.artist.type,
        tier: result.artist.tier,
      },
    })

    // Create JWT token
    const token = createToken({
      userId: result.user.id,
      role: result.user.role,
    })

    // Create response with cookie
    const response = NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        role: result.user.role,
      },
      artist: {
        id: result.artist.id,
        type: result.artist.type,
        tier: result.artist.tier,
        active: result.artist.active,
      },
    })

    setAuthCookie(response, token)
    return response

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
