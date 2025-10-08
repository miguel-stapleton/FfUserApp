import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { createToken, setAuthCookie } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { emailOrUsername, password } = loginSchema.parse(body)

    // Find user by email or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: emailOrUsername },
          { username: emailOrUsername },
        ],
      },
      include: {
        artist: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash)
    if (!isValidPassword) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Log audit event
    await logAudit({
      userId: user.id,
      action: 'USER_LOGIN',
      details: {
        loginMethod: emailOrUsername.includes('@') ? 'email' : 'username',
        userAgent: request.headers.get('user-agent') || 'unknown',
      },
    })

    // Create JWT token
    const token = createToken({
      userId: user.id,
      role: user.role,
    })

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
      }
    }

    // Create response with cookie
    const response = NextResponse.json(responseData)
    setAuthCookie(response, token)
    return response

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
