'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Calendar, CheckCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { AuthGate } from '@/components/AuthGate'
import { ProposalCard } from '@/components/ProposalCard'
import { ArtistProposalCard } from '@/lib/types'
import { useToast } from '@/components/ui/use-toast'
import { Toaster } from '@/components/ui/toaster'
import { Button } from '@/components/ui/button'
import { ArtistHeader } from '@/components/ArtistHeader'

interface ProposalsResponse {
  proposals: ArtistProposalCard[]
}

export default function GetClientsPage() {
  const router = useRouter()
  const [proposals, setProposals] = useState<ArtistProposalCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const fetchProposals = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/proposals/list', {
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

  const handleProposalResponse = async (proposalId: string, response: 'YES' | 'NO') => {
    try {
      const apiResponse = await fetch('/api/proposals/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          proposalId,
          response,
        }),
      })

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json()
        throw new Error(errorData.error || 'Failed to submit response')
      }

      // Optimistically remove the card from the list
      setProposals(prev => prev.filter(p => p.id !== proposalId))

      // Show success toast
      toast({
        title: 'Response Submitted',
        description: `You responded "${response}" to the proposal successfully.`,
        duration: 4000,
      })

    } catch (err) {
      console.error('Failed to respond to proposal:', err)
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to submit response',
        variant: 'destructive',
        duration: 5000,
      })
    }
  }

  useEffect(() => {
    fetchProposals()
  }, [])

  const EmptyState = () => (
    <div className="text-center py-16 px-6">
      <div className="mx-auto w-24 h-24 bg-white rounded-full flex items-center justify-center mb-6">
        <Image 
          src="/icon-512-FF.png" 
          alt="Fresh Faced" 
          width={80} 
          height={80}
          className="object-contain"
        />
      </div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">
        No proposals right now
      </h3>
      <p className="text-gray-600 max-w-md mx-auto mb-6">
        You're all caught up! New wedding proposals will appear here when they become available.
      </p>
      <div className="flex items-center justify-center gap-2 text-sm text-pink-600">
        <Sparkles className="w-4 h-4" />
        <span>Ready to make someone's special day beautiful</span>
      </div>
    </div>
  )

  const LoadingState = () => (
    <div className="space-y-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse">
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <div className="h-6 bg-gray-200 rounded w-48"></div>
                <div className="h-4 bg-gray-200 rounded w-32"></div>
              </div>
              <div className="h-6 bg-gray-200 rounded w-20"></div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-full"></div>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            </div>
            <div className="flex gap-3 pt-4">
              <div className="h-10 bg-gray-200 rounded flex-1"></div>
              <div className="h-10 bg-gray-200 rounded flex-1"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <AuthGate requiredRole="ARTIST">
      <ArtistHeader />
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                  <Image 
                    src="/icon-512-FF.png" 
                    alt="Fresh Faced" 
                    width={40} 
                    height={40}
                    className="object-contain"
                  />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Wedding Proposals</h1>
                  <p className="text-gray-600">Respond to new client requests</p>
                </div>
              </div>
              <Button
                onClick={() => router.push('/log-trial')}
                className="bg-pink-600 hover:bg-pink-700"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Log a Trial
              </Button>
              <Button
                onClick={() => router.push('/confirm-booking')}
                variant="outline"
                className="ml-2 border-pink-600 text-pink-700 hover:bg-pink-50"
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Confirm a Booking!
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-4 py-8">
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
          ) : proposals.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-6">
              {proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  onRespond={handleProposalResponse}
                />
              ))}
            </div>
          )}
        </div>

        <Toaster />
      </div>
    </AuthGate>
  )
}
