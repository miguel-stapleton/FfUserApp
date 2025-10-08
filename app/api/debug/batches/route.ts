import { NextRequest, NextResponse } from 'next/server'
import { requireBackoffice } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    // Require BACKOFFICE authentication
    const user = await requireBackoffice(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Access denied. BACKOFFICE role required.' },
        { status: 403 }
      )
    }

    // Get all batches with their client services and proposal counts
    const batches = await prisma.proposalBatch.findMany({
      include: {
        clientService: true,
        proposals: {
          select: {
            id: true,
            response: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Transform the data for the frontend
    const batchInfo = batches.map(batch => ({
      id: batch.id,
      mode: batch.mode,
      state: batch.state,
      startReason: batch.startReason,
      deadlineAt: batch.deadlineAt.toISOString(),
      createdAt: batch.createdAt.toISOString(),
      clientService: {
        bridesName: batch.clientService.bridesName,
        service: batch.clientService.service,
        weddingDate: batch.clientService.weddingDate.toISOString(),
      },
      proposalCount: batch.proposals.length,
      responses: {
        yes: batch.proposals.filter(p => p.response === 'YES').length,
        no: batch.proposals.filter(p => p.response === 'NO').length,
        pending: batch.proposals.filter(p => p.response === null).length,
      },
    }))

    return NextResponse.json({
      success: true,
      batches: batchInfo,
    })

  } catch (error) {
    console.error('Failed to fetch batches:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
