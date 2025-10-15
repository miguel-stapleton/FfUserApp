import { NextRequest, NextResponse } from 'next/server'
import { requireArtist } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { upsertClientServiceFromMonday } from '@/lib/services/clients'
import { logAudit } from '@/lib/audit'
import { ServiceType as PrismaServiceType } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const user = await requireArtist(request)
    const body = await request.json()
    const itemId: string | undefined = body?.itemId

    if (!itemId) {
      return NextResponse.json({ success: false, error: 'Missing itemId' }, { status: 400 })
    }

    // Fetch artist record to get type and email
    const artist = await prisma.artist.findFirst({
      where: { userId: user.id, active: true },
      select: { id: true, email: true, type: true },
    })

    if (!artist) {
      return NextResponse.json({ success: false, error: 'Artist not found' }, { status: 404 })
    }

    const serviceTypeEnum: PrismaServiceType = artist.type as PrismaServiceType

    // Ensure ClientService exists for this Monday item
    const clientServiceId = await upsertClientServiceFromMonday(String(itemId), serviceTypeEnum)

    // Log audit event
    await logAudit({
      userId: user.id,
      action: 'CONFIRM_BOOKING',
      entityType: 'CLIENT_SERVICE',
      entityId: clientServiceId,
      details: {
        mondayItemId: String(itemId),
        artistId: artist.id,
        artistEmail: artist.email,
        artistType: artist.type,
        confirmedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[confirm-booking:confirm] error', error)
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
