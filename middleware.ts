import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, getAuthCookie } from '@/lib/auth'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if route requires authentication
  const isArtistRoute = pathname.startsWith('/(artist)')
  const isBackofficeRoute = pathname.startsWith('/(backoffice)')
  
  if (!isArtistRoute && !isBackofficeRoute) {
    return NextResponse.next()
  }

  // Get token from cookie
  const token = getAuthCookie(request)
  if (!token) {
    return redirectToLogin(request)
  }

  // Verify token
  const payload = verifyToken(token)
  if (!payload) {
    return redirectToLogin(request)
  }

  // Check role permissions
  if (isArtistRoute && payload.role !== 'ARTIST') {
    return NextResponse.json(
      { error: 'Access denied - Artist role required' },
      { status: 403 }
    )
  }

  if (isBackofficeRoute && payload.role !== 'BACKOFFICE') {
    return NextResponse.json(
      { error: 'Access denied - Backoffice role required' },
      { status: 403 }
    )
  }

  return NextResponse.next()
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/(artist)/:path*',
    '/(backoffice)/:path*',
  ],
}
