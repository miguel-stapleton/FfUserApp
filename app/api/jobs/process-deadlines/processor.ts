import { prisma } from '@/lib/prisma'
import { setEmailAutomation } from '@/lib/monday'
import { logAudit } from '@/lib/audit'
import { createBatchAndProposals } from '@/lib/services/proposals'
import { sendNewProposalNotification } from '@/lib/push'

export interface ProcessDeadlinesResult {
  processed: number
  sentOptions: number
  noAvailability: number
  singleTosBroadcast: number
  errors: string[]
}

/**
 * Process expired proposal batches and trigger appropriate email automations
 */
export async function runProcessDeadlines(): Promise<ProcessDeadlinesResult> {
  const result: ProcessDeadlinesResult = {
    processed: 0,
    sentOptions: 0,
    noAvailability: 0,
    singleTosBroadcast: 0,
    errors: [],
  }

  try {
    // Find all batches that have expired (72h deadline passed)
    const now = new Date()
    const expiredBatches = await prisma.proposalBatch.findMany({
      where: {
        state: 'OPEN',
        deadlineAt: {
          lte: now,
        },
      },
      include: {
        clientService: true,
        proposals: {
          include: {
            artist: true,
          },
        },
      },
    })

    console.log(`Found ${expiredBatches.length} expired batches to process`)

    for (const batch of expiredBatches) {
      try {
        await processBatch(batch, result)
        result.processed++
      } catch (error) {
        const errorMessage = `Failed to process batch ${batch.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        console.error(errorMessage)
        result.errors.push(errorMessage)
      }
    }

    console.log(`Deadline processing completed: ${result.processed} processed, ${result.sentOptions} sent options, ${result.noAvailability} no availability, ${result.singleTosBroadcast} single->broadcast, ${result.errors.length} errors`)

    return result
  } catch (error) {
    console.error('Error in runProcessDeadlines:', error)
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

async function processBatch(batch: any, result: ProcessDeadlinesResult) {
  const { proposals, clientService, mode } = batch

  // For SINGLE batches with no response, trigger CHOSEN_NO path (start BROADCAST)
  if (mode === 'SINGLE') {
    const hasAnyResponse = proposals.some((p: any) => p.response !== null)
    
    if (!hasAnyResponse) {
      // No response within 72h for SINGLE batch - treat as NO and start BROADCAST
      await handleSingleBatchTimeout(batch, clientService, result)
      return
    }
  }

  // Count YES responses for regular processing
  const yesResponses = proposals.filter((p: any) => p.response === 'YES')
  const hasYesResponses = yesResponses.length >= 1

  if (hasYesResponses) {
    // At least one YES response - send options
    await handleSendOptions(batch, clientService, result)
  } else {
    // No YES responses - send no availability
    await handleNoAvailability(batch, clientService, result)
  }
}

async function handleSingleBatchTimeout(batch: any, clientService: any, result: ProcessDeadlinesResult) {
  try {
    // Mark current SINGLE batch as expired
    await prisma.proposalBatch.update({
      where: { id: batch.id },
      data: {
        state: 'EXPIRED_NO_ACTION',
      },
    })

    // Create new BROADCAST batch with CHOSEN_NO reason
    const broadcastResult = await createBatchAndProposals(
      clientService.id,
      'BROADCAST',
      'CHOSEN_NO' as any
    )

    // Send push notifications to all artists in the new broadcast batch.
    // Without this, the BROADCAST batch is silently created in the DB but no
    // artist gets notified — they'd only see the proposal if they happen to
    // open the app. We mirror the artist selection used inside
    // `createBatchAndProposals` (all active artists of the service type).
    try {
      const broadcastArtists = await prisma.artist.findMany({
        where: {
          active: true,
          type: clientService.service,
        },
        select: { id: true },
      })

      if (broadcastArtists.length > 0) {
        await sendNewProposalNotification(
          broadcastArtists.map(a => a.id),
          clientService.bridesName,
          clientService.service,
          clientService.weddingDate,
        )
        console.log(`Batch ${batch.id}: Sent push notifications to ${broadcastArtists.length} ${clientService.service} artists for new BROADCAST batch ${broadcastResult.batchId}`)
      } else {
        console.warn(`Batch ${batch.id}: No active ${clientService.service} artists to notify for new BROADCAST batch ${broadcastResult.batchId}`)
      }
    } catch (pushError) {
      // Don't fail the batch escalation if push delivery fails — the DB rows
      // are already created and artists will see the proposal next time they
      // open the app. Just log so we can investigate.
      console.error(`Batch ${batch.id}: Failed to send push notifications for BROADCAST escalation:`, pushError)
    }

    // Log audit event
    await logAudit({
      action: 'SINGLE_BATCH_TIMEOUT_TO_BROADCAST',
      entityType: 'BATCH',
      entityId: batch.id,
      details: {
        originalBatchId: batch.id,
        newBroadcastBatchId: broadcastResult.batchId,
        clientServiceId: clientService.id,
        mondayClientItemId: clientService.mondayClientItemId,
        reason: 'No response within 72h for SINGLE batch',
        newProposalCount: broadcastResult.proposalCount,
        processedAt: new Date().toISOString(),
      },
    })

    result.singleTosBroadcast++
    console.log(`Batch ${batch.id}: SINGLE batch timeout, started BROADCAST batch ${broadcastResult.batchId} with ${broadcastResult.proposalCount} proposals`)

  } catch (error) {
    throw new Error(`Failed to handle single batch timeout: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function handleSendOptions(batch: any, clientService: any, result: ProcessDeadlinesResult) {
  try {
    // Set email automation in Monday.com
    const success = await setEmailAutomation(clientService.mondayClientItemId, 'Send options')
    
    if (!success) {
      throw new Error('Failed to set email automation in Monday.com')
    }

    // Update batch state
    await prisma.proposalBatch.update({
      where: { id: batch.id },
      data: {
        state: 'EXPIRED_NO_ACTION', 
      },
    })

    // Log audit event
    await logAudit({
      action: 'EXPIRED_SENT_OPTIONS',
      entityType: 'BATCH',
      entityId: batch.id,
      details: {
        clientServiceId: clientService.id,
        mondayClientItemId: clientService.mondayClientItemId,
        clientName: clientService.clientName,
        yesCount: batch.proposals.filter((p: any) => p.response === 'YES').length,
        totalProposals: batch.proposals.length,
        processedAt: new Date().toISOString(),
      },
    })

    result.sentOptions++
    console.log(`Batch ${batch.id}: Sent options for client ${clientService.clientName}`)

  } catch (error) {
    throw new Error(`Failed to handle send options: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function handleNoAvailability(batch: any, clientService: any, result: ProcessDeadlinesResult) {
  try {
    // Set email automation in Monday.com
    const success = await setEmailAutomation(clientService.mondayClientItemId, 'Send no availability')
    
    if (!success) {
      throw new Error('Failed to set email automation in Monday.com')
    }

    // Update batch state
    await prisma.proposalBatch.update({
      where: { id: batch.id },
      data: {
        state: 'EXPIRED_NO_ACTION', 
      },
    })

    // Log audit event
    await logAudit({
      action: 'EXPIRED_NO_AVAILABILITY',
      entityType: 'BATCH',
      entityId: batch.id,
      details: {
        clientServiceId: clientService.id,
        mondayClientItemId: clientService.mondayClientItemId,
        clientName: clientService.clientName,
        noCount: batch.proposals.filter((p: any) => p.response === 'NO').length,
        noResponseCount: batch.proposals.filter((p: any) => p.response === null).length,
        totalProposals: batch.proposals.length,
        processedAt: new Date().toISOString(),
      },
    })

    result.noAvailability++
    console.log(`Batch ${batch.id}: Sent no availability for client ${clientService.clientName}`)

  } catch (error) {
    throw new Error(`Failed to handle no availability: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
