import { NextRequest, NextResponse } from 'next/server'
import { requireArtist } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { upsertClientServiceFromMonday } from '@/lib/services/clients'
import { logAudit } from '@/lib/audit'
import { ServiceType as PrismaServiceType } from '@prisma/client'
import axios from 'axios'

const MONDAY_API_URL = 'https://api.monday.com/v2'
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN || ''
const CLIENTS_BOARD_ID = 1260828829

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

    // Update Monday status on Clients board
    const columnId = artist.type === 'MUA' ? 'project_status' : 'dup__of_mstatus'
    const label = artist.type === 'MUA' ? 'MUA booked!' : 'H booked!'
    try {
      const mutation = `
        mutation UpdateStatus($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
          change_multiple_column_values(
            item_id: $itemId,
            board_id: $boardId,
            column_values: $columnValues
          ) {
            id
          }
        }
      `
      await axios.post(
        MONDAY_API_URL,
        {
          query: mutation,
          variables: {
            itemId: String(itemId),
            boardId: CLIENTS_BOARD_ID,
            columnValues: JSON.stringify({ [columnId]: { label } }),
          },
        },
        {
          headers: {
            Authorization: MONDAY_API_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      )
    } catch (err) {
      console.error('[confirm-booking:confirm] Failed to update Monday status', {
        itemId,
        columnId,
        label,
        err,
      })
      // Do not fail the whole flow if Monday update fails
    }

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
        monday: { columnId, label },
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
