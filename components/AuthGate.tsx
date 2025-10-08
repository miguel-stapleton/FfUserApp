'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { User, Artist } from '@/lib/types'

interface AuthGateProps {
  children: React.ReactNode
  requiredRole?: 'ARTIST' | 'BACKOFFICE'
  redirectTo?: string
}

interface AuthState {
  user: User | null
  artist: Artist | null
  loading: boolean
  error: string | null
}

export function AuthGate({ 
  children, 
  requiredRole, 
  redirectTo = '/login' 
}: AuthGateProps) {
  const router = useRouter()
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    artist: null,
    loading: true,
    error: null
  })

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        })

        if (!response.ok) {
          if (response.status === 401) {
            // Not authenticated, redirect to login
            router.push(redirectTo)
            return
          }
          throw new Error('Failed to check authentication')
        }

        const data = await response.json()
        
        // Check role requirement
        if (requiredRole && data.user.role !== requiredRole) {
          // Wrong role, redirect to appropriate page
          const redirectPath = data.user.role === 'ARTIST' 
            ? '/(artist)/get-clients' 
            : '/(backoffice)/proposals'
          router.push(redirectPath)
          return
        }

        setAuthState({
          user: data.user,
          artist: data.artist,
          loading: false,
          error: null
        })

      } catch (error) {
        console.error('Auth check failed:', error)
        setAuthState({
          user: null,
          artist: null,
          loading: false,
          error: 'Authentication failed'
        })
        router.push(redirectTo)
      }
    }

    checkAuth()
  }, [router, requiredRole, redirectTo])

  if (authState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (authState.error || !authState.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">Authentication required</p>
          <p className="text-gray-600">Redirecting to login...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
