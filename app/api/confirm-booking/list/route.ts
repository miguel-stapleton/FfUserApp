import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireArtist } from '@/lib/auth'
import { ffadmin } from '@/lib/ffadmin'

export async function GET(request: NextRequest) {
  try {
    const user = await requireArtist(request)

    const artist = await prisma.artist.findFirst({
      where: { userId: user.id, active: true },
      select: { email: true, type: true },
    })
    if (!artist) return NextResponse.json({ items: [] })

    const artistTable = artist.type === 'MUA' ? 'makeup_artists' : 'hairstylists'
    const nameCol = artist.type === 'MUA' ? 'mua_full_name' : 'hs_full_name'
    const emailCol = artist.type === 'MUA' ? 'mua_email' : 'hs_email'

    const { data: artistRow } = await ffadmin
      .from(artistTable)
      .select(nameCol)
      .eq(emailCol, artist.email)
      .maybeSingle()

    const fullName: string | null = (artistRow as any)?.[nameCol] ?? null
    if (!fullName) return NextResponse.json({ items: [] })

    const statusField = artist.type === 'MUA' ? 'm_status' : 'h_status'
    const chosenCol = artist.type === 'MUA' ? 'chosen_mua' : 'chosen_hs'
    const today = new Date().toISOString().split('T')[0]

    // MUA: "waiting for payment" or "meeting check"; HS: "waiting for payment" only
    const targetStatuses = artist.type === 'MUA'
      ? ['waiting for payment', 'meeting check']
      : ['waiting for payment']

    const { data: clients, error } = await ffadmin
      .from('clients')
      .select('item_id, bride_name, wedding_date')
      .in(statusField, targetStatuses)
      .eq(chosenCol, fullName)
      .gte('wedding_date', today)

    if (error) {
      console.error('[confirm-booking:list] FFadmin query error:', error)
      return NextResponse.json({ items: [] })
    }

    const results = (clients || []).map((c: any) => ({
      id: String(c.item_id),
      name: c.bride_name || '',
      eventDate: c.wedding_date
        ? new Date(c.wedding_date).toLocaleDateString('en-GB')
        : '',
    }))

    results.sort((a: any, b: any) => {
      const da = new Date(a.eventDate).getTime() || 0
      const db = new Date(b.eventDate).getTime() || 0
      return da - db
    })

    return NextResponse.json({ items: results })
  } catch (error) {
    console.error('[confirm-booking:list] error:', error)
    return NextResponse.json({ items: [] })
  }
}
