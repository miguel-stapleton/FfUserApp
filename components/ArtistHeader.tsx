'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, User, Lock, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

interface ArtistHeaderProps {
  artistName?: string
}

export function ArtistHeader({ artistName }: ArtistHeaderProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [name, setName] = useState(artistName || '')
  const [profilePicture, setProfilePicture] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    // Fetch artist name if not provided
    if (!artistName) {
      fetchArtistName()
    }
  }, [artistName])

  useEffect(() => {
    // Close dropdown when clicking outside
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchArtistName = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setName(data.user?.name || data.user?.email || 'Artist')
        setProfilePicture(data.artist?.profilePicture || null)
      }
    } catch (error) {
      console.error('Failed to fetch artist name:', error)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      router.push('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Brand */}
          <div className="flex items-center">
            <Image 
              src="https://images.squarespace-cdn.com/content/v1/5c8c244bd7819e19909fe312/d7c9e4cc-7df2-402f-9df5-d97f7f967934/logo.png?format=2500w"
              alt="Fresh Faced"
              width={120}
              height={40}
              className="object-contain"
              priority
            />
          </div>

          {/* Artist Menu */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="w-8 h-8 bg-pink-100 rounded-full flex items-center justify-center overflow-hidden">
                {profilePicture ? (
                  <Image 
                    src={profilePicture} 
                    alt="Profile" 
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-5 h-5 text-pink-600" />
                )}
              </div>
              <span className="text-sm font-medium text-gray-700">{name}</span>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                <button
                  onClick={() => {
                    setIsDropdownOpen(false)
                    router.push('/(artist)/upload-profile-picture')
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="w-4 h-4 text-gray-500" />
                  Upload Profile Picture
                </button>

                <button
                  onClick={() => {
                    setIsDropdownOpen(false)
                    router.push('/(artist)/change-password')
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Lock className="w-4 h-4 text-gray-500" />
                  Change Password
                </button>
                
                <div className="border-t border-gray-100 my-1" />
                
                <button
                  onClick={() => {
                    setIsDropdownOpen(false)
                    handleLogout()
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
