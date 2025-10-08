'use client'

import { useEffect, useState } from 'react'
import { Calendar, ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AuthGate } from '@/components/AuthGate'
import { ArtistHeader } from '@/components/ArtistHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

interface BookedClient {
  mondayItemId: string
  brideName: string
}

export default function LogTrialPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [fetchingClients, setFetchingClients] = useState(true)
  const [bookedClients, setBookedClients] = useState<BookedClient[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')

  useEffect(() => {
    fetchBookedClients()
  }, [])

  const fetchBookedClients = async () => {
    try {
      setFetchingClients(true)
      const response = await fetch('/api/artist/booked-clients', {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch booked clients')
      }

      const data = await response.json()
      setBookedClients(data.clients || [])
    } catch (err) {
      console.error('Failed to fetch booked clients:', err)
    } finally {
      setFetchingClients(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    
    // TODO: Implement trial logging logic
    
    setLoading(false)
  }

  return (
    <AuthGate requiredRole="ARTIST">
      <ArtistHeader />
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/get-clients')}
                className="mr-2"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="w-10 h-10 bg-pink-600 rounded-lg flex items-center justify-center">
                <Calendar className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Log a Trial</h1>
                <p className="text-gray-600">Record a trial session with a client</p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Card>
            <CardHeader>
              <CardTitle>Trial Session Details</CardTitle>
              <CardDescription>
                Enter the details of your trial session below
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fetchingClients ? (
                <div className="py-8 text-center text-gray-500">
                  Loading your booked clients...
                </div>
              ) : bookedClients.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-gray-600 mb-2">No booked clients found</p>
                  <p className="text-sm text-gray-500">
                    You don't have any clients with confirmed bookings yet.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="clientId">Bride's Name</Label>
                    <Select
                      id="clientId"
                      name="clientId"
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      required
                    >
                      <option value="">Select a bride</option>
                      {bookedClients.map((client) => (
                        <option key={client.mondayItemId} value={client.mondayItemId}>
                          {client.brideName}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="trialDate">Trial Date</Label>
                    <Input
                      id="trialDate"
                      name="trialDate"
                      type="date"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">Notes (Optional)</Label>
                    <Input
                      id="notes"
                      name="notes"
                      placeholder="Add any notes about the trial session"
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/get-clients')}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={loading}
                      className="flex-1 bg-pink-600 hover:bg-pink-700"
                    >
                      {loading ? 'Saving...' : 'Log Trial'}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthGate>
  )
}
