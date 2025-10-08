'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { X, Clock, Users, CheckCircle, XCircle, Calendar, MapPin, FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { BackofficeClientInfo } from '@/lib/types'

interface BackofficeInfoModalProps {
  mondayClientItemId: string | null
  isOpen: boolean
  onClose: () => void
}

interface ArtistGroup {
  FOUNDER: Array<{ email: string; tier: string; respondedAt: string | null }>
  RESIDENT: Array<{ email: string; tier: string; respondedAt: string | null }>
  FRESH: Array<{ email: string; tier: string; respondedAt: string | null }>
}

export function BackofficeInfoModal({ 
  mondayClientItemId, 
  isOpen, 
  onClose 
}: BackofficeInfoModalProps) {
  const [clientInfo, setClientInfo] = useState<BackofficeClientInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && mondayClientItemId) {
      fetchClientInfo()
    }
  }, [isOpen, mondayClientItemId])

  const fetchClientInfo = async () => {
    if (!mondayClientItemId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/backoffice/clients/${mondayClientItemId}/info`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch client info')
      }

      const data = await response.json()
      setClientInfo(data)
    } catch (err) {
      console.error('Failed to fetch client info:', err)
      setError('Failed to load client information')
    } finally {
      setLoading(false)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    return formatInTimeZone(
      new Date(timestamp),
      'Europe/Lisbon',
      'MMM d, yyyy \'at\' h:mm a'
    )
  }

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'EEEE, MMMM d, yyyy')
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'undecided – inquire availabilities':
        return 'secondary'
      case 'travelling fee + inquire the artist':
        return 'default'
      case 'confirmed':
        return 'default'
      default:
        return 'outline'
    }
  }

  const renderArtistGroup = (
    title: string,
    artists: ArtistGroup,
    icon: React.ReactNode
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h4 className="font-semibold text-gray-900">{title}</h4>
      </div>
      
      {(['FOUNDER', 'RESIDENT', 'FRESH'] as const).map(tier => (
        artists[tier].length > 0 && (
          <div key={tier} className="ml-6">
            <h5 className="text-sm font-medium text-gray-700 mb-2">{tier}</h5>
            <div className="space-y-1">
              {artists[tier].map((artist, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{artist.email}</span>
                  {artist.respondedAt && (
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(artist.respondedAt)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      ))}
      
      {Object.values(artists).every(group => group.length === 0) && (
        <p className="ml-6 text-sm text-gray-500 italic">None</p>
      )}
    </div>
  )

  const getEventIcon = (event: string) => {
    switch (event) {
      case 'PROPOSAL_RESPONSE':
        return <CheckCircle className="w-4 h-4 text-green-600" />
      case 'BATCH_CREATED':
        return <Users className="w-4 h-4 text-blue-600" />
      case 'BATCH_COMPLETED':
        return <Clock className="w-4 h-4 text-orange-600" />
      default:
        return <Clock className="w-4 h-4 text-gray-500" />
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-pink-600" />
            Client Information
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pink-600"></div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
            <button
              onClick={fetchClientInfo}
              className="mt-2 text-red-600 hover:text-red-800 underline text-sm"
            >
              Try again
            </button>
          </div>
        )}

        {clientInfo && (
          <div className="space-y-6">
            {/* Client Details */}
            <div className="bg-gray-50 p-4 rounded-lg space-y-3">
              <h3 className="font-semibold text-lg text-gray-900">{clientInfo.clientName}</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <span>{formatDate(clientInfo.eventDate)}</span>
                </div>
                
                {clientInfo.beautyVenue && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-500" />
                    <span>{clientInfo.beautyVenue}</span>
                  </div>
                )}
              </div>

              {clientInfo.observations && (
                <div className="mt-3">
                  <p className="text-sm text-gray-600 bg-white p-3 rounded border">
                    {clientInfo.observations}
                  </p>
                </div>
              )}
            </div>

            {/* Current Status */}
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900">Current Status</h3>
              <div className="flex gap-4">
                <div>
                  <span className="text-sm font-medium text-gray-700">MUA Status:</span>
                  <Badge variant={getStatusBadgeVariant(clientInfo.mStatus || '')} className="ml-2">
                    {clientInfo.mStatus || 'Not set'}
                  </Badge>
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-700">HS Status:</span>
                  <Badge variant={getStatusBadgeVariant(clientInfo.hStatus || '')} className="ml-2">
                    {clientInfo.hStatus || 'Not set'}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            {/* Available Artists */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {renderArtistGroup(
                  'Available MUA Artists',
                  clientInfo.availableArtists.MUA,
                  <CheckCircle className="w-5 h-5 text-green-600" />
                )}
              </div>
              <div>
                {renderArtistGroup(
                  'Available Hair Artists',
                  clientInfo.availableArtists.HS,
                  <CheckCircle className="w-5 h-5 text-green-600" />
                )}
              </div>
            </div>

            <Separator />

            {/* Unavailable Artists */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {renderArtistGroup(
                  'Unavailable MUA Artists',
                  clientInfo.unavailableArtists.MUA,
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
              </div>
              <div>
                {renderArtistGroup(
                  'Unavailable Hair Artists',
                  clientInfo.unavailableArtists.HS,
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
              </div>
            </div>

            <Separator />

            {/* Timeline */}
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Clock className="w-5 h-5 text-pink-600" />
                Timeline
              </h3>
              
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {clientInfo.timeline.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No timeline events</p>
                ) : (
                  clientInfo.timeline.map((event, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                      {getEventIcon(event.event)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {event.description}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatTimestamp(event.timestamp)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
