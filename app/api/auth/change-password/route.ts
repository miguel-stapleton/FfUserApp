import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, verifyPassword, hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
})

export async function POST(request: NextRequest) {
  try {
    const { prisma } = await import('@/lib/prisma')
    const { logAudit } = await import('@/lib/audit')

    const user = await requireAuth(request)
    const payload = await request.json()
    const { currentPassword, newPassword } = bodySchema.parse(payload)

    // Load user from DB
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify existing password
    const ok = await verifyPassword(currentPassword, dbUser.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Update password
    const newHash = await hashPassword(newPassword)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } })

    // Audit log
    await logAudit({
      userId: user.id,
      action: 'USER_CHANGE_PASSWORD',
      entityType: 'USER',
      entityId: user.id,
      details: { method: 'self_service' },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message.startsWith('Forbidden'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 403 })
    }

    console.error('Change password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
