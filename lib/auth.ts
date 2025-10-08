import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key'
const COOKIE_NAME = 'ff_token'

export interface JWTPayload {
  userId: string
  email: string
  role: string
}

export interface AuthUser {
  id: string
  email: string
  username: string | null
  role: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export function createToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

/**
 * Get user from request by reading ff_token cookie
 */
export async function getUserFromRequest(request: NextRequest): Promise<AuthUser | null> {
  try {
    const token = getAuthCookie(request)

    if (!token) {
      return null
    }

    const payload = verifyToken(token)
    if (!payload) {
      return null
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    })

    return user
  } catch {
    return null
  }
}

export function getAuthCookie(request: NextRequest): string | null {
  return request.cookies.get(COOKIE_NAME)?.value || null
}

/**
 * Require authentication and return user
 */
export async function requireAuth(request: NextRequest): Promise<AuthUser> {
  const user = await getUserFromRequest(request)
  
  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

/**
 * Require artist role
 */
export async function requireArtist(request: NextRequest): Promise<AuthUser> {
  const user = await requireAuth(request)
  
  if (user.role !== 'ARTIST') {
    throw new Error('Forbidden: Artist role required')
  }

  return user
}

/**
 * Require backoffice role
 */
export async function requireBackoffice(request: NextRequest): Promise<AuthUser> {
  const user = await requireAuth(request)
  
  if (user.role !== 'BACKOFFICE') {
    throw new Error('Forbidden: Backoffice role required')
  }

  return user
}

/**
 * Require admin role
 */
export async function requireAdmin(request: NextRequest): Promise<AuthUser> {
  const user = await requireAuth(request)
  
  if (user.role !== 'ADMIN') {
    throw new Error('Forbidden: Admin role required')
  }

  return user
}

/**
 * Check if user has any of the specified roles
 */
export async function requireAnyRole(request: NextRequest, roles: string[]): Promise<AuthUser> {
  const user = await requireAuth(request)
  
  if (!roles.includes(user.role)) {
    throw new Error(`Forbidden: One of these roles required: ${roles.join(', ')}`)
  }

  return user
}

/**
 * Set authentication cookie
 */
export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

/**
 * Clear authentication cookie
 */
export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

/**
 * Create authenticated response with user data and token
 */
export function createAuthResponse(user: AuthUser, token: string) {
  const response = NextResponse.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      token,
    },
    message: 'Authentication successful',
  })

  setAuthCookie(response, token)
  return response
}

/**
 * Handle authentication errors consistently
 */
export function handleAuthError(error: unknown): NextResponse {
  if (error instanceof Error) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    if (error.message.startsWith('Forbidden')) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 403 }
      )
    }
  }

  console.error('Auth error:', error)
  return NextResponse.json(
    { success: false, error: 'Internal server error' },
    { status: 500 }
  )
}

// Legacy function for backward compatibility
export async function getAuthUser(request: NextRequest) {
  return getUserFromRequest(request)
}
