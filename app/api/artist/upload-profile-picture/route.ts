import { NextRequest, NextResponse } from 'next/server'
import { requireArtist } from '@/lib/auth'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'profiles'

export async function POST(request: NextRequest) {
  try {
    const { prisma } = await import('@/lib/prisma')
    const { logAudit } = await import('@/lib/audit')

    const user = await requireArtist(request)

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('profilePicture') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    const SUPABASE_URL = process.env.SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Ensure bucket exists (idempotent)
    // If bucket already exists, Supabase will return 409; we ignore that.
    await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {})

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const ext = file.type.split('/')[1] || 'png'
    const path = `${user.id}/${randomUUID()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Supabase upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 })
    }

    // Get public URL (bucket marked public above). If private, we could generate a signed URL instead.
    const { data: publicData } = await supabase.storage.from(BUCKET).getPublicUrl(path)
    const publicUrl = publicData.publicUrl

    // Update artist profile picture URL in DB
    const artist = await prisma.artist.update({
      where: { userId: user.id },
      data: { profilePicture: publicUrl },
    })

    await logAudit({
      userId: user.id,
      action: 'ARTIST_UPLOAD_PROFILE_PICTURE',
      entityType: 'ARTIST',
      entityId: artist.id,
      details: { url: publicUrl, mime: file.type, size: buffer.length },
    })

    return NextResponse.json({ success: true, url: publicUrl })
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message.startsWith('Forbidden'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 403 })
    }

    console.error('Upload profile picture error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
