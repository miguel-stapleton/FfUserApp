'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthGate } from '@/components/AuthGate'
import { ArtistHeader } from '@/components/ArtistHeader'
import { Button } from '@/components/ui/button'
import Select from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { Toaster } from '@/components/ui/toaster'

interface DropdownItem {
  id: string
  name: string
  eventDate: string
}

export default function ConfirmBookingPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [items, setItems] = useState<DropdownItem[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const loadItems = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/confirm-booking/list', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load items')
      const data = await res.json()
      setItems(data.items || [])
      setError(null)
    } catch (e) {
      setError('Failed to load items. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  const handleConfirm = async () => {
    try {
      if (!selectedId) return
      setSubmitting(true)
      const res = await fetch('/api/confirm-booking/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: selectedId }),
      })
      const data = await res.json()
      if (!res.ok || data.success !== true) {
        throw new Error(data.error || 'Failed to confirm booking')
      }
      toast({
        title: 'Booking confirmed',
        description: 'We have recorded that the deposit was received.',
      })
      // Optionally refresh list and clear selection
      setSelectedId('')
      await loadItems()
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e?.message || 'Failed to confirm booking',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthGate requiredRole="ARTIST">
      <ArtistHeader />
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b">
          <div className="max-w-3xl mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold text-gray-900">Confirm a Booking</h1>
            <p className="text-gray-600">Select the bride to confirm deposit received</p>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 py-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
              <button
                onClick={loadItems}
                className="mt-2 text-red-600 hover:text-red-800 underline text-sm"
              >
                Try again
              </button>
            </div>
          )}

          <div className="bg-white rounded-lg border p-6 space-y-4">
            <div>
              <Select
                label="Bride"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={loading}
              >
                <option value="">{loading ? 'Loading...' : 'Select a bride'}</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} — {it.eventDate}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-gray-500 mt-2">
                Only clients with a future wedding date and matching status/phrase appear here.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleConfirm}
                disabled={!selectedId || submitting}
                className="bg-pink-600 hover:bg-pink-700"
              >
                {submitting ? 'Confirming…' : 'Confirm booking'}
              </Button>
              <Button variant="outline" onClick={() => router.push('/get-clients')}>Back</Button>
            </div>
          </div>
        </div>

        <Toaster />
      </div>
    </AuthGate>
  )
}
