'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { Calendar, MapPin, Clock, User } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ArtistProposalCard } from '@/lib/types'

interface ProposalCardProps {
  proposal: ArtistProposalCard
  onRespond: (proposalId: string, response: 'YES' | 'NO') => Promise<void>
}

export function ProposalCard({ proposal, onRespond }: ProposalCardProps) {
  const [isResponding, setIsResponding] = useState(false)

  const handleResponse = async (response: 'YES' | 'NO') => {
    setIsResponding(true)
    try {
      await onRespond(proposal.id, response)
    } finally {
      setIsResponding(false)
    }
  }

  const formatDate = (dateString: string | Date) => {
    try {
      const dateStr = typeof dateString === 'string' ? dateString : dateString.toISOString()
      return format(new Date(dateStr), 'EEEE, MMMM d, yyyy')
    } catch (error) {
      return 'Invalid date'
    }
  }

  const formatDeadline = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM d, yyyy \'at\' h:mm a')
    } catch {
      return dateString
    }
  }

  const isNearDeadline = (dateString: string) => {
    try {
      const deadline = new Date(dateString)
      const now = new Date()
      const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60)
      return hoursUntilDeadline <= 6 && hoursUntilDeadline > 0
    } catch {
      return false
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <User className="h-5 w-5 text-pink-600" />
              {proposal.clientName}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Calendar className="h-4 w-4" />
              <span>{formatDate(proposal.eventDate)}</span>
            </div>
          </div>
          <Badge variant="secondary" className="bg-pink-100 text-pink-800">
            {proposal.serviceType === 'MUA' ? 'Makeup' : 'Hair Styling'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {proposal.beautyVenue && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-700">Beauty Venue</p>
              <p className="text-gray-600">{proposal.beautyVenue}</p>
            </div>
          </div>
        )}

        {proposal.observations && (
          <div className="space-y-2">
            <p className="font-medium text-gray-700 text-sm">Description & Observations</p>
            <p className="text-gray-600 text-sm leading-relaxed bg-gray-50 p-3 rounded-md">
              {proposal.observations}
            </p>
          </div>
        )}
      </CardContent>

      <Separator />

      <CardFooter className="pt-4">
        <div className="flex gap-3 w-full">
          <Button
            onClick={() => handleResponse('YES')}
            disabled={isResponding}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            {isResponding ? 'Responding...' : 'Yes, I\'m Available'}
          </Button>
          <Button
            onClick={() => handleResponse('NO')}
            disabled={isResponding}
            variant="outline"
            className="flex-1 border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
          >
            {isResponding ? 'Responding...' : 'Not Available'}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
