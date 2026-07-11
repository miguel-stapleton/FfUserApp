import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireArtist, handleAuthError } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { ffadmin, EMAIL_TO_DISPLAY_NAME, addFFadminActivityLog } from '@/lib/ffadmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  clientId: z.string().min(1), // FFadmin clients.item_id (as string)
  trialDate: z.string().min(1), // YYYY-MM-DD
})

export async function POST(request: NextRequest) {
  try {
    const user = await requireArtist(request)
    const { clientId, trialDate } = bodySchema.parse(await request.json())
    const itemIdNum = Number(clientId)

    // Determine which trial date field to update based on artist type
    const { prisma } = await import('@/lib/prisma')
    const artist = await prisma.artist.findUnique({ where: { userId: user.id } })
    if (!artist) return NextResponse.json({ error: 'Artist not found' }, { status: 404 })

    const trialDateField = artist.type === 'MUA' ? 'm_trial_date' : 'h_trial_date'

    // PATCH trial date on FFadmin clients table
    const { error } = await ffadmin
      .from('clients')
      .update({ [trialDateField]: trialDate })
      .eq('item_id', itemIdNum)

    if (error) {
      console.error('[log-trial] FFadmin patch failed:', error)
      return NextResponse.json({ error: 'Failed to update trial date' }, { status: 500 })
    }

    // Add activity log entry
    const shortName = EMAIL_TO_DISPLAY_NAME[user.email] || 'Artista'
    const message = `${shortName} inseriu ${trialDate} para prova desta cliente.`
    await addFFadminActivityLog(itemIdNum, message)

    // Local audit
    await logAudit({
      userId: user.id,
      action: 'ARTIST_LOG_TRIAL',
      entityType: 'CLIENT_ITEM',
      entityId: clientId,
      details: { trialDate, artistType: artist.type },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[log-trial] error:', error)
    return handleAuthError(error)
  }
}
