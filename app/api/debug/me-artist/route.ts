import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, handleAuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    const artist = await prisma.artist.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        userId: true,
        email: true,
        type: true,
        active: true,
        mondayItemId: true,
      },
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      artist,
    })
  } catch (error) {
    return handleAuthError(error)
  }
}
