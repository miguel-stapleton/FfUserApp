'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'

interface BatchInfo {
  id: string
  mode: string
  state: string
  startReason: string
  deadlineAt: string
  createdAt: string
  clientService: {
    bridesName: string
    service: string
    weddingDate: string
  }
  proposalCount: number
}

export default function DebugPage() {
  const [batches, setBatches] = useState<BatchInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const { toast } = useToast()

  // Check authentication and role
  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me')
      if (response.ok) {
        const userData = await response.json()
        if (userData.user.role !== 'BACKOFFICE') {
          window.location.href = '/login'
          return
        }
        setUser(userData.user)
      } else {
        window.location.href = '/login'
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      window.location.href = '/login'
    }
  }

  const createFakeClientService = async (serviceType: 'MUA' | 'HS', batchMode: 'SINGLE' | 'BROADCAST') => {
    setLoading(true)
    try {
      const response = await fetch('/api/debug/create-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          serviceType,
          batchMode,
          deadlineMinutes: 10, // 10 minutes from now
        }),
      })

      if (response.ok) {
        const result = await response.json()
        toast({
          title: 'Success',
          description: `Created ${batchMode} batch for ${serviceType} service with ${result.proposalCount} proposals`,
        })
        loadBatches() // Refresh the list
      } else {
        const error = await response.json()
        toast({
          title: 'Error',
          description: error.error || 'Failed to create batch',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Network error occurred',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const loadBatches = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/debug/batches')
      if (response.ok) {
        const data = await response.json()
        setBatches(data.batches)
      } else {
        toast({
          title: 'Error',
          description: 'Failed to load batches',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Network error occurred',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const processDeadlines = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/jobs/process-deadlines', {
        method: 'POST',
      })

      if (response.ok) {
        const result = await response.json()
        toast({
          title: 'Deadline Processing Complete',
          description: `Processed: ${result.processed}, Sent Options: ${result.sentOptions}, No Availability: ${result.noAvailability}, Single->Broadcast: ${result.singleTosBroadcast || 0}`,
        })
        loadBatches() // Refresh the list
      } else {
        const error = await response.json()
        toast({
          title: 'Error',
          description: error.error || 'Failed to process deadlines',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Network error occurred',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-GB', {
      timeZone: 'Europe/Lisbon',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getTimeRemaining = (deadlineString: string) => {
    const deadline = new Date(deadlineString)
    const now = new Date()
    const diffMs = deadline.getTime() - now.getTime()
    
    if (diffMs <= 0) return 'EXPIRED'
    
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const hours = Math.floor(diffMinutes / 60)
    const minutes = diffMinutes % 60
    
    return `${hours}h ${minutes}m`
  }

  if (!user) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Debug Panel</h1>
        <p className="text-muted-foreground">
          Testing tools for proposal batches and deadline processing
        </p>
        <Badge variant="secondary" className="mt-2">
          BACKOFFICE ONLY
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Create Test Batches */}
        <Card>
          <CardHeader>
            <CardTitle>Create Test Batches</CardTitle>
            <CardDescription>
              Create fake ClientService and start proposal batches with 10-minute deadlines
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => createFakeClientService('MUA', 'SINGLE')}
                disabled={loading}
                variant="outline"
              >
                MUA SINGLE
              </Button>
              <Button
                onClick={() => createFakeClientService('MUA', 'BROADCAST')}
                disabled={loading}
                variant="outline"
              >
                MUA BROADCAST
              </Button>
              <Button
                onClick={() => createFakeClientService('HS', 'SINGLE')}
                disabled={loading}
                variant="outline"
              >
                HS SINGLE
              </Button>
              <Button
                onClick={() => createFakeClientService('HS', 'BROADCAST')}
                disabled={loading}
                variant="outline"
              >
                HS BROADCAST
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Control Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Control Panel</CardTitle>
            <CardDescription>
              Manual operations for testing and debugging
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={loadBatches}
              disabled={loading}
              className="w-full"
              variant="secondary"
            >
              Refresh Batches
            </Button>
            <Button
              onClick={processDeadlines}
              disabled={loading}
              className="w-full"
            >
              Process Deadlines
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Batches List */}
      <Card>
        <CardHeader>
          <CardTitle>Open Batches</CardTitle>
          <CardDescription>
            Current proposal batches and their deadlines
          </CardDescription>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No batches found. Create some test batches above.
            </p>
          ) : (
            <div className="space-y-4">
              {batches.map((batch) => (
                <div key={batch.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={batch.mode === 'SINGLE' ? 'default' : 'secondary'}>
                        {batch.mode}
                      </Badge>
                      <Badge variant={batch.state === 'OPEN' ? 'destructive' : 'outline'}>
                        {batch.state}
                      </Badge>
                      <span className="text-sm font-medium">
                        {batch.clientService.bridesName}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {batch.proposalCount} proposals
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Service:</span> {batch.clientService.service}
                    </div>
                    <div>
                      <span className="font-medium">Wedding:</span> {formatDate(batch.clientService.weddingDate)}
                    </div>
                    <div>
                      <span className="font-medium">Reason:</span> {batch.startReason}
                    </div>
                  </div>
                  
                  <Separator className="my-3" />
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Created:</span> {formatDate(batch.createdAt)}
                    </div>
                    <div>
                      <span className="font-medium">Deadline:</span> {formatDate(batch.deadlineAt)}
                    </div>
                    <div>
                      <span className="font-medium">Time Remaining:</span>{' '}
                      <Badge variant={getTimeRemaining(batch.deadlineAt) === 'EXPIRED' ? 'destructive' : 'outline'}>
                        {getTimeRemaining(batch.deadlineAt)}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
