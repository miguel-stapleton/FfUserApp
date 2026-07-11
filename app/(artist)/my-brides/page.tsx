'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AuthGate } from '@/components/AuthGate'
import { ArtistHeader } from '@/components/ArtistHeader'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/toaster'
import { Heart, MapPin, Calendar, User } from 'lucide-react'

interface Companion {
  name: string
  type: 'MUA' | 'HS'
  profilePicture: string | null
}

interface BookedBride {
  clientItemId: string
  brideName: string
  weddingDate: string | null
  beautyVenue: string
  companion: Companion | null
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function CompanionAvatar({ companion, label }: { companion: Companion; label: string }) {
  const [imgError, setImgError] = useState(false)
  const initial = companion.name.charAt(0).toUpperCase()

  return (
    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
      <div className="w-10 h-10 rounded-full overflow-hidden bg-pink-100 flex items-center justify-center flex-shrink-0">
        {companion.profilePicture && !imgError ? (
          <Image
            src={companion.profilePicture}
            alt={companion.name}
            width={40}
            height={40}
            className="object-cover w-full h-full"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="text-pink-600 font-semibold text-sm">{initial}</span>
        )}
      </div>
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-sm font-semibold text-gray-800">{companion.name}</p>
      </div>
    </div>
  )
}

function BrideCard({ bride, companionLabel }: { bride: BookedBride; companionLabel: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{bride.brideName}</h2>
        </div>
        <span className="flex-shrink-0 inline-flex items-center gap-1 bg-pink-50 text-pink-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-pink-200">
          <Heart className="w-3 h-3" />
          Booked
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span>{formatDate(bride.weddingDate)}</span>
        </div>
        {bride.beautyVenue && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span>{bride.beautyVenue}</span>
          </div>
        )}
      </div>

      {bride.companion ? (
        <CompanionAvatar companion={bride.companion} label={companionLabel} />
      ) : (
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-400">
          <User className="w-4 h-4" />
          <span>No {companionLabel.toLowerCase()} assigned yet</span>
        </div>
      )}
    </div>
  )
}

export default function MyBridesPage() {
  const router = useRouter()
  const [brides, setBrides] = useState<BookedBride[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // We need the artist type to know the companion label
  const [artistType, setArtistType] = useState<'MUA' | 'HS' | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)

        // Fetch current user's artist type
        const meRes = await fetch('/api/auth/me', { credentials: 'include' })
        if (meRes.ok) {
          const me = await meRes.json()
          setArtistType(me?.artist?.type ?? null)
        }

        const res = await fetch('/api/artist/my-booked-brides', { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to load booked brides')
        const data = await res.json()
        setBrides(data.brides || [])
        setError(null)
      } catch (e) {
        setError('Could not load your booked brides. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // MUA sees who's doing hair (HS), HS sees who's doing makeup (MUA)
  const companionLabel =
    artistType === 'MUA' ? 'Hairstylist' : artistType === 'HS' ? 'Makeup Artist' : 'Companion Artist'

  return (
    <AuthGate requiredRole="ARTIST">
      <ArtistHeader />
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">My Booked Brides</h1>
              <p className="text-gray-500 text-sm mt-0.5">Your confirmed wedding bookings</p>
            </div>
            <Button variant="outline" onClick={() => router.push('/get-clients')}>
              Back
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-4 py-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 text-red-600 hover:text-red-800 underline text-sm"
              >
                Try again
              </button>
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse bg-white rounded-xl border p-5">
                  <div className="h-5 bg-gray-200 rounded w-48 mb-3" />
                  <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-40" />
                  <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
                    <div className="w-10 h-10 rounded-full bg-gray-200" />
                    <div className="space-y-1">
                      <div className="h-3 bg-gray-200 rounded w-16" />
                      <div className="h-4 bg-gray-200 rounded w-24" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : brides.length === 0 ? (
            <div className="text-center py-20">
              <div className="mx-auto w-16 h-16 bg-pink-50 rounded-full flex items-center justify-center mb-4">
                <Heart className="w-8 h-8 text-pink-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">No bookings yet</h3>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">
                Your confirmed brides will appear here once bookings are locked in.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">
                {brides.length} {brides.length === 1 ? 'bride' : 'brides'} booked
              </p>
              <div className="space-y-4">
                {brides.map((bride) => (
                  <BrideCard
                    key={bride.clientItemId}
                    bride={bride}
                    companionLabel={companionLabel}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <Toaster />
      </div>
    </AuthGate>
  )
}
