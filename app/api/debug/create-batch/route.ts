import { NextRequest, NextResponse } from 'next/server'
import { requireBackoffice } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createBatchAndProposals } from '@/lib/services/proposals'
import { logAudit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  try {
    // Require BACKOFFICE authentication
    const user = await requireBackoffice(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Access denied. BACKOFFICE role required.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { serviceType, batchMode, deadlineMinutes = 10 } = body

    if (!serviceType || !batchMode) {
      return NextResponse.json(
        { error: 'serviceType and batchMode are required' },
        { status: 400 }
      )
    }

    if (!['MUA', 'HS'].includes(serviceType)) {
      return NextResponse.json(
        { error: 'serviceType must be MUA or HS' },
        { status: 400 }
      )
    }

    if (!['SINGLE', 'BROADCAST'].includes(batchMode)) {
      return NextResponse.json(
        { error: 'batchMode must be SINGLE or BROADCAST' },
        { status: 400 }
      )
    }

    // Create fake ClientService
    const weddingDate = new Date()
    weddingDate.setDate(weddingDate.getDate() + 30) // 30 days from now

    const clientService = await prisma.clientService.create({
      data: {
        mondayClientItemId: `debug-${Date.now()}`,
        service: serviceType,
        bridesName: `Test Bride ${serviceType} ${Date.now()}`,
        weddingDate,
        beautyVenue: 'Debug Test Venue',
        description: `Debug test client service for ${serviceType} - ${batchMode} batch`,
        currentStatus: 'undecided',
      },
    })

    // Create batch and proposals
    const result = await createBatchAndProposals(
      clientService.id,
      batchMode,
      'UNDECIDED'
    )

    // Update deadline to specified minutes from now
    const deadlineAt = new Date(Date.now() + deadlineMinutes * 60 * 1000)
    await prisma.proposalBatch.update({
      where: { id: result.batchId },
      data: { deadlineAt },
    })

    // Log audit event
    await logAudit({
      userId: user.id,
      action: 'DEBUG_CREATE_BATCH',
      details: {
        clientServiceId: clientService.id,
        batchId: result.batchId,
        serviceType,
        batchMode,
        proposalCount: result.proposalCount,
        deadlineMinutes,
      },
    })

    return NextResponse.json({
      success: true,
      clientServiceId: clientService.id,
      batchId: result.batchId,
      proposalCount: result.proposalCount,
      deadlineAt: deadlineAt.toISOString(),
    })

  } catch (error) {
    console.error('Failed to create debug batch:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
