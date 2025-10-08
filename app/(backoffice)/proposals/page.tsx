'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Info, Settings, Users } from 'lucide-react'
import { AuthGate } from '@/components/AuthGate'
import { BackofficeInfoModal } from '@/components/BackofficeInfoModal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BackofficeRow } from '@/lib/types'

interface ProposalsResponse {
  proposals: BackofficeRow[]
}

export default function BackofficeProposalsPage() {
  const [proposals, setProposals] = useState<BackofficeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const fetchProposals = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/backoffice/proposals', {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch proposals')
      }

      const data: ProposalsResponse = await response.json()
      setProposals(data.proposals)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch proposals:', err)
      setError('Failed to load proposals. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProposals()
  }, [])

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'MMM d, yyyy')
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'default'
      case 'COMPLETED':
        return 'secondary'
      case 'PENDING':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const getMStatusBadgeVariant = (mStatus: string) => {
    switch (mStatus?.toLowerCase()) {
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

  const formatArtistList = (artists: Array<{ email: string; tier: string; response: string | null; respondedAt: Date | null }>) => {
    if (artists.length === 0) return 'None'
    
    const grouped = artists.reduce((acc, artist) => {
      if (!acc[artist.tier]) acc[artist.tier] = []
      acc[artist.tier].push(artist)
      return acc
    }, {} as Record<string, typeof artists>)

    const tiers = ['FOUNDER', 'RESIDENT', 'FRESH']
    return tiers
      .filter(tier => grouped[tier]?.length > 0)
      .map(tier => `${tier}: ${grouped[tier].length}`)
      .join(', ')
  }

  const handleInfoClick = (mondayClientItemId: string) => {
    setSelectedClientId(mondayClientItemId)
    setIsModalOpen(true)
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    setSelectedClientId(null)
  }

  const LoadingState = () => (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="bg-white rounded-lg border">
            <div className="p-4 space-y-3">
              <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <AuthGate requiredRole="BACKOFFICE">
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-pink-600 rounded-lg flex items-center justify-center">
                <Settings className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Proposals Dashboard</h1>
                <p className="text-gray-600">Manage wedding proposals and artist assignments</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 py-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
              <button
                onClick={fetchProposals}
                className="mt-2 text-red-600 hover:text-red-800 underline text-sm"
              >
                Try again
              </button>
            </div>
          )}

          {loading ? (
            <LoadingState />
          ) : (proposals?.length || 0) === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="mx-auto w-24 h-24 bg-pink-100 rounded-full flex items-center justify-center mb-6">
                <Users className="w-12 h-12 text-pink-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No proposals yet
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                Wedding proposals will appear here when clients submit requests through Monday.com.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bride's Name</TableHead>
                    <TableHead>Wedding Date</TableHead>
                    <TableHead>Beauty Venue</TableHead>
                    <TableHead>MStatus</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>MUAs</TableHead>
                    <TableHead>HSs</TableHead>
                    <TableHead className="w-20">Info</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map((proposal) => (
                    <TableRow key={proposal.mondayClientItemId}>
                      <TableCell className="font-medium">
                        {proposal.clientName}
                      </TableCell>
                      <TableCell>
                        {formatDate(proposal.eventDate)}
                      </TableCell>
                      <TableCell>
                        {proposal.beautyVenue || 'Not specified'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getMStatusBadgeVariant(proposal.mStatus)}>
                          {proposal.mStatus || 'Not set'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(proposal.status)}>
                          {proposal.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatArtistList(proposal.muaArtists)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatArtistList(proposal.hsArtists)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleInfoClick(proposal.mondayClientItemId)}
                        >
                          <Info className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <BackofficeInfoModal
          mondayClientItemId={selectedClientId}
          isOpen={isModalOpen}
          onClose={handleModalClose}
        />
      </div>
    </AuthGate>
  )
}
