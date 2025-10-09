import { NextRequest, NextResponse } from 'next/server'
import { requireArtist, handleAuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const user = await requireArtist(request)

    // Get the form data
    const formData = await request.formData()
    const file = formData.get('profilePicture') as File

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      )
    }

    // TODO: Implement cloud storage (Vercel Blob, AWS S3, or Cloudflare R2)
    // For now, just store a placeholder path
    const fileExtension = file.name.split('.').pop()
    const filename = `${user.id}-${Date.now()}.${fileExtension}`
    const profilePicturePath = `/uploads/profile-pictures/${filename}`
    
    await prisma.artist.update({
      where: { userId: user.id },
      data: {
        profilePicture: profilePicturePath,
      },
    })

    return NextResponse.json({
      message: 'Profile picture path saved (file upload pending cloud storage implementation)',
      path: profilePicturePath,
    })
  } catch (error) {
    console.error('Failed to upload profile picture:', error)
    return handleAuthError(error)
  }
}
