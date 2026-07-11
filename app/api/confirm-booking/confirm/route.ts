import { NextRequest, NextResponse } from 'next/server'
import { requireArtist } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { ffadmin, addFFadminActivityLog, EMAIL_TO_DISPLAY_NAME } from '@/lib/ffadmin'

export async function POST(request: NextRequest) {
  try {
    const user = await requireArtist(request)
    const body = await request.json()
    const itemId: string | undefined = body?.itemId
    if (!itemId) return NextResponse.json({ success: false, error: 'Missing itemId' }, { status: 400 })

    const artist = await prisma.artist.findFirst({
      where: { userId: user.id, active: true },
      select: { id: true, email: true, type: true },
    })
    if (!artist) return NextResponse.json({ success: false, error: 'Artist not found' }, { status: 404 })

    const statusField = artist.type === 'MUA' ? 'm_status' : 'h_status'
    const bookedStatus = artist.type === 'MUA' ? 'MUA booked!' : 'HS booked!'
    const itemIdNum = Number(itemId)

    // PATCH FFadmin clients status to booked
    const { error } = await ffadmin
      .from('clients')
      .update({ [statusField]: bookedStatus })
      .eq('item_id', itemIdNum)

    if (error) {
      console.error('[confirm-booking:confirm] FFadmin patch failed:', error)
      return NextResponse.json({ success: false, error: 'Failed to update status' }, { status: 500 })
    }

    // Activity log
    const displayName = EMAIL_TO_DISPLAY_NAME[artist.email] || 'Artista'
    await addFFadminActivityLog(
      itemIdNum,
      `${displayName} confirmou reserva. Status atualizado para "${bookedStatus}".`
    )

    // Ensure local ClientService exists for audit FK
    let clientService = await prisma.clientService.findFirst({
      where: { clientItemId: itemId, service: artist.type as any },
    })
    if (!clientService) {
      clientService = await prisma.clientService.create({
        data: {
          clientItemId: itemId,
          service: artist.type as any,
          bridesName: 'Client',
          weddingDate: new Date(),
          beautyVenue: '',
        },
      })
    }

    await logAudit({
      userId: user.id,
      action: 'CONFIRM_BOOKING',
      entityType: 'CLIENT_SERVICE',
      entityId: clientService.id,
      details: {
        clientItemId: itemId,
        artistId: artist.id,
        artistEmail: artist.email,
        artistType: artist.type,
        bookedStatus,
        confirmedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[confirm-booking:confirm] error:', error)
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 })
  }
}
