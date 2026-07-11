import { NextRequest, NextResponse } from 'next/server'
import { requireArtist, handleAuthError } from '@/lib/auth'
import { ffadmin } from '@/lib/ffadmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const user = await requireArtist(request)
    const { prisma } = await import('@/lib/prisma')

    const artist = await prisma.artist.findUnique({
      where: { userId: user.id },
      include: { user: true },
    })
    if (!artist) {
      return NextResponse.json({ error: 'Artist not found' }, { status: 404 })
    }

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
      console.warn('[my-booked-brides] Artist full name not found in FFadmin for', artist.email)
      return NextResponse.json({ brides: [] })
    }

    // Query clients booked with this artist
    const bookedStatus = artist.type === 'MUA' ? 'MUA booked!' : 'HS booked!'
    const chosenCol = artist.type === 'MUA' ? 'chosen_mua' : 'chosen_hs'
    const companionChosenCol = artist.type === 'MUA' ? 'chosen_hs' : 'chosen_mua'
    const companionTable = artist.type === 'MUA' ? 'hairstylists' : 'makeup_artists'
    const companionNameCol = artist.type === 'MUA' ? 'hs_full_name' : 'mua_full_name'
    const companionEmailCol = artist.type === 'MUA' ? 'hs_email' : 'mua_email'
    const statusField = artist.type === 'MUA' ? 'm_status' : 'h_status'

    const { data: clients, error } = await ffadmin
      .from('clients')
      .select('*')
      .eq(statusField, bookedStatus)
      .eq(chosenCol, fullName)

    if (error) {
      console.error('[my-booked-brides] FFadmin query error:', error)
      return NextResponse.json({ error: 'FFadmin query failed' }, { status: 502 })
    }

    // For each client, look up the companion artist info
    const brides = await Promise.all(
      (clients || []).map(async (client: any) => {
        const companionFullName: string | null = client[companionChosenCol] ?? null
        let companion: { name: string; type: string; profilePicture: null } | null = null

        if (companionFullName) {
          const { data: companionRow } = await ffadmin
            .from(companionTable)
            .select(companionEmailCol)
            .eq(companionNameCol, companionFullName)
            .maybeSingle()

          if (companionRow) {
            const companionArtist = await prisma.artist.findFirst({
              where: { email: (companionRow as any)[companionEmailCol] },
              include: { user: true },
            })
            if (companionArtist) {
              companion = {
                name: companionArtist.user?.username || companionArtist.email,
                type: companionArtist.type,
                profilePicture: null,
              }
            }
          }
        }

        return {
          clientItemId: String(client.item_id),
          brideName: client.bride_name || '',
          weddingDate: client.wedding_date || null,
          beautyVenue: client.beauty_venue || '',
          companion,
        }
      })
    )

    // Sort by wedding date ascending
    brides.sort((a, b) => {
      if (!a.weddingDate) return 1
      if (!b.weddingDate) return -1
      return new Date(a.weddingDate).getTime() - new Date(b.weddingDate).getTime()
    })

    return NextResponse.json({ brides })
  } catch (error) {
    console.error('[my-booked-brides] error:', error)
    return handleAuthError(error)
  }
}
