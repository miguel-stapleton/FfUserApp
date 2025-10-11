import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, handleAuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request)

    // Check if user has any subscriptions first to provide a better message
    const subs = await prisma.pushSubscription.findMany({ where: { userId: user.id } })
    if (subs.length === 0) {
      return NextResponse.json({ success: false, error: 'No push subscription found for your user on this domain.' }, { status: 400 })
    }

    await sendPushToUser(user.id, {
      title: 'Test notification',
      body: 'Push is working on this domain.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url: '/get-clients',
      data: { type: 'test_push' },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    // Propagate proper auth error codes
    return handleAuthError(error)
  }
}
