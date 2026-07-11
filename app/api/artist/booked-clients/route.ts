import { NextRequest, NextResponse } from 'next/server'
import { requireArtist, handleAuthError } from '@/lib/auth'
import { ffadmin } from '@/lib/ffadmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const user = await requireArtist(request)
    const { prisma } = await import('@/lib/prisma')

    const artist = await prisma.artist.findUnique({ where: { userId: user.id } })
    if (!artist) return NextResponse.json({ error: 'Artist not found' }, { status: 404 })

    // Look up this artist's full display name in FFadmin
    const artistTable = artist.type === 'MUA' ? 'makeup_artists' : 'hairstylists'
    const nameCol = artist.type === 'MUA' ? 'mua_full_name' : 'hs_full_name'
    const emailCol = artist.type === 'MUA' ? 'mua_email' : 'hs_email'

    const { data: artistRow } = await ffadmin
      .from(artistTable)
      .select(nameCol)
      .eq(emailCol, artist.email)
      .maybeSingle()

    const fullName: string | null = (artistRow as any)?.[nameCol] ?? null
    if (!fullName) {
      return NextResponse.json({ clients: [] })
    }

    const bookedStatus = artist.type === 'MUA' ? 'MUA booked!' : 'HS booked!'
    const statusField = artist.type === 'MUA' ? 'm_status' : 'h_status'
    const chosenCol = artist.type === 'MUA' ? 'chosen_mua' : 'chosen_hs'
    const trialDateCol = artist.type === 'MUA' ? 'm_trial_date' : 'h_trial_date'
    const today = new Date().toISOString().split('T')[0]

    const { data: clients, error } = await ffadmin
      .from('clients')
      .select('item_id, bride_name, wedding_date, m_trial_date, h_trial_date')
      .eq(statusField, bookedStatus)
      .eq(chosenCol, fullName)
      .gte('wedding_date', today)

    if (error) {
      console.error('[booked-clients] FFadmin query error:', error)
      return NextResponse.json({ error: 'FFadmin query failed' }, { status: 502 })
    }

    const results = (clients || []).map((c: any) => ({
      clientItemId: String(c.item_id),
      brideName: c.bride_name || '',
      trialDate: c[trialDateCol] || undefined,
    }))

    results.sort((a: any, b: any) => a.brideName.localeCompare(b.brideName, 'pt'))

    return NextResponse.json({ clients: results })
  } catch (error) {
    console.error('[booked-clients] error:', error)
    return handleAuthError(error)
  }
}
