import { NextRequest, NextResponse } from 'next/server'
import { requireArtist } from '@/lib/auth'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Ensure uploads dir exists
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await fs.mkdir(uploadsDir, { recursive: true })

    // Save file
    const ext = file.type.split('/')[1] || 'png'
    const filename = `${randomUUID()}.${ext}`
    const filePath = path.join(uploadsDir, filename)
    await fs.writeFile(filePath, buffer)

    // Build public URL path
    const publicPath = `/uploads/${filename}`

    // Update artist profile picture
    const artist = await prisma.artist.update({
      where: { userId: user.id },
      data: { profilePicture: publicPath },
    })

    await logAudit({
      userId: user.id,
      action: 'ARTIST_UPLOAD_PROFILE_PICTURE',
      entityType: 'ARTIST',
      entityId: artist.id,
      details: { path: publicPath, mime: file.type, size: buffer.length },
    })

    return NextResponse.json({ success: true, path: publicPath })
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message.startsWith('Forbidden'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 403 })
    }

    console.error('Upload profile picture error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
