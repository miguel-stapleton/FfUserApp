import { prisma } from '@/lib/prisma'
import { ffadmin } from '@/lib/ffadmin'
import { logAudit } from '@/lib/audit'
import { createBatchAndProposals } from '@/lib/services/proposals'
import { sendNewProposalNotification } from '@/lib/push'

const POLLS_DEADLINE_WEBHOOK = 'https://hook.eu2.make.com/z51admkidgbgqx16nq35fyuruhh4ceaz'

export interface ProcessDeadlinesResult {
  processed: number
  sentOptions: number
  noAvailability: number
  singleTosBroadcast: number
  errors: string[]
}

export async function runProcessDeadlines(): Promise<ProcessDeadlinesResult> {
  const result: ProcessDeadlinesResult = {
    processed: 0,
    sentOptions: 0,
    noAvailability: 0,
    singleTosBroadcast: 0,
    errors: [],
  }

  try {
    const now = new Date()
    const expiredBatches = await prisma.proposalBatch.findMany({
      where: { state: 'OPEN', deadlineAt: { lte: now } },
      include: {
        clientService: true,
        proposals: { include: { artist: true } },
      },
    })

    console.log(`Found ${expiredBatches.length} expired batches to process`)

    for (const batch of expiredBatches) {
      try {
        await processBatch(batch, result)
        result.processed++
      } catch (error) {
        const msg = `Failed to process batch ${batch.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        console.error(msg)
        result.errors.push(msg)
      }
    }

    return result
  } catch (error) {
    console.error('Error in runProcessDeadlines:', error)
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

async function processBatch(batch: any, result: ProcessDeadlinesResult) {
  const { proposals, clientService, mode } = batch

  if (mode === 'SINGLE') {
    const hasAnyResponse = proposals.some((p: any) => p.response !== null)
    if (!hasAnyResponse) {
      await handleSingleBatchTimeout(batch, clientService, result)
      return
    }
  }

  const hasYesResponses = proposals.some((p: any) => p.response === 'YES')
  if (hasYesResponses) {
    await handleSendOptions(batch, clientService, result)
  } else {
    await handleNoAvailability(batch, clientService, result)
  }
}

async function handleSingleBatchTimeout(batch: any, clientService: any, result: ProcessDeadlinesResult) {
  try {
    await prisma.proposalBatch.update({
      where: { id: batch.id },
      data: { state: 'EXPIRED_NO_ACTION' },
    })

    const broadcastResult = await createBatchAndProposals(
      clientService.id,
      'BROADCAST',
      'CHOSEN_NO' as any
    )

    try {
      const broadcastArtists = await prisma.artist.findMany({
        where: { active: true, type: clientService.service },
        select: { id: true },
      })
      if (broadcastArtists.length > 0) {
        await sendNewProposalNotification(
          broadcastArtists.map((a: any) => a.id),
          clientService.bridesName,
          clientService.service,
          clientService.weddingDate,
        )
      }
    } catch (pushError) {
      console.error(`Batch ${batch.id}: Failed to send push notifications:`, pushError)
    }

    await logAudit({
      action: 'SINGLE_BATCH_TIMEOUT_TO_BROADCAST',
      entityType: 'BATCH',
      entityId: batch.id,
      details: {
        originalBatchId: batch.id,
        newBroadcastBatchId: broadcastResult.batchId,
        clientServiceId: clientService.id,
        clientItemId: clientService.clientItemId,
        reason: 'No response within 72h for SINGLE batch',
        newProposalCount: broadcastResult.proposalCount,
        processedAt: new Date().toISOString(),
      },
    })

    result.singleTosBroadcast++
  } catch (error) {
    throw new Error(`Failed to handle single batch timeout: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function handleSendOptions(batch: any, clientService: any, result: ProcessDeadlinesResult) {
  try {
    await triggerDeadlineWebhook(clientService.clientItemId, 'Send options')

    await prisma.proposalBatch.update({
      where: { id: batch.id },
      data: { state: 'EXPIRED_NO_ACTION' },
    })

    await logAudit({
      action: 'EXPIRED_SENT_OPTIONS',
      entityType: 'BATCH',
      entityId: batch.id,
      details: {
        clientServiceId: clientService.id,
        clientItemId: clientService.clientItemId,
        clientName: clientService.bridesName,
        yesCount: batch.proposals.filter((p: any) => p.response === 'YES').length,
        totalProposals: batch.proposals.length,
        processedAt: new Date().toISOString(),
      },
    })

    result.sentOptions++
  } catch (error) {
    throw new Error(`Failed to handle send options: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function handleNoAvailability(batch: any, clientService: any, result: ProcessDeadlinesResult) {
  try {
    await triggerDeadlineWebhook(clientService.clientItemId, 'Send no availability')

    await prisma.proposalBatch.update({
      where: { id: batch.id },
      data: { state: 'EXPIRED_NO_ACTION' },
    })

    await logAudit({
      action: 'EXPIRED_NO_AVAILABILITY',
      entityType: 'BATCH',
      entityId: batch.id,
      details: {
        clientServiceId: clientService.id,
        clientItemId: clientService.clientItemId,
        clientName: clientService.bridesName,
        noCount: batch.proposals.filter((p: any) => p.response === 'NO').length,
        noResponseCount: batch.proposals.filter((p: any) => p.response === null).length,
        totalProposals: batch.proposals.length,
        processedAt: new Date().toISOString(),
      },
    })

    result.noAvailability++
  } catch (error) {
    throw new Error(`Failed to handle no availability: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

async function triggerDeadlineWebhook(clientItemId: string, action: string) {
  const itemIdNum = Number(clientItemId)

  // Fetch the full polls row from FFadmin to send to Make
  const { data: pollsRow, error } = await ffadmin
    .from('polls')
    .select('*')
    .eq('item_id', itemIdNum)
    .maybeSingle()

  if (error) {
    console.error('[triggerDeadlineWebhook] polls fetch error:', error)
  }

  const payload = {
    action,
    clientItemId,
    polls: pollsRow || null,
    triggeredAt: new Date().toISOString(),
  }

  const res = await fetch(POLLS_DEADLINE_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    throw new Error(`Deadline webhook responded ${res.status}: ${await res.text()}`)
  }
}
