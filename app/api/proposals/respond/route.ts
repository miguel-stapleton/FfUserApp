import { NextRequest, NextResponse } from 'next/server'
import { getAuthCookie, verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const token = getAuthCookie(request)
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'ARTIST') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { proposalId, response } = body || {}
    if (!proposalId || (response !== 'YES' && response !== 'NO')) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { respondToProposal } = await import('@/lib/services/proposals')
    await respondToProposal({ proposalId, response, actorUserId: payload.userId })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to respond to proposal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
