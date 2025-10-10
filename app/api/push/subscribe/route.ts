import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyToken, getAuthCookie } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { endpoint, p256dh, auth } = subscriptionSchema.parse(body)

    // Upsert the push subscription
    await prisma.pushSubscription.upsert({
      where: {
        endpoint,
      },
      update: {
        userId: payload.userId,
        p256dh,
        auth,
      },
      create: {
        userId: payload.userId,
        endpoint,
        p256dh,
        auth,
      },
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid subscription data', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Push subscription error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get('endpoint')

    if (!endpoint) {
      return NextResponse.json(
        { error: 'Endpoint parameter required' },
        { status: 400 }
      )
    }

    // Delete the push subscription
    await prisma.pushSubscription.delete({
      where: {
        endpoint,
      },
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Push unsubscription error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
