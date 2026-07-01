import { prisma } from '../prisma'
import { createBatchAndProposals } from './proposals'
import { sendNewProposalNotification } from '../push'
import { logAudit } from '../audit'

/**
 * Self-healing sweep: finds recently-created ClientService rows that never
 * got a ProposalBatch attached, and backfills the missing BROADCAST batch
 * (and notifications).
 *
 * Background: handleUndecidedStatus in the Monday webhook can silently fail
 * between creating the ClientService row and creating the ProposalBatch
 * (e.g. a transient Supabase error, a Vercel function timeout). When that
 * happens, no artist sees the bride in their FFuser inbox.
 *
 * This sweep is called at the end of every Monday webhook POST so that
 * orphans heal themselves within minutes during normal activity, without
 * needing an external cron.
 *
 * Constraints (avoid waking up old orphans):
 *   - Only ClientServices created within `windowMinutes` (default 60 min,
 *     pass 24*60 from the manual route).
 *   - Only future weddings (don't create batches for past weddings).
 *   - Only ClientServices with zero ProposalBatches.
 */

export interface SweepResult {
  scanned: number
  healed: number
  errors: Array<{ clientServiceId: string; error: string }>
}

export async function sweepOrphanedClientServices(opts?: {
  windowMinutes?: number
}): Promise<SweepResult> {
  const windowMinutes = opts?.windowMinutes ?? 60
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000)
  const result: SweepResult = { scanned: 0, healed: 0, errors: [] }

  const orphans = await prisma.clientService.findMany({
    where: {
      createdAt: { gt: cutoff },
      weddingDate: { gt: new Date() },
      batches: { none: {} },
    },
  })

  result.scanned = orphans.length
  if (orphans.length === 0) return result

  console.log(`[sweep-orphans] Found ${orphans.length} orphan ClientService row(s) to heal`)

  for (const cs of orphans) {
    try {
      // Re-check inside the loop in case a concurrent webhook just created
      // a batch between findMany and now. Cheap belt-and-braces.
      const stillOrphan = await prisma.clientService.findFirst({
        where: { id: cs.id, batches: { none: {} } },
        select: { id: true },
      })
      if (!stillOrphan) {
        console.log(`[sweep-orphans] ClientService ${cs.id} no longer orphaned (concurrent backfill); skipping`)
        continue
      }

      // Mirror what handleUndecidedStatus does
      const { batchId, proposalCount } = await createBatchAndProposals(
        cs.id,
        'BROADCAST',
        'UNDECIDED',
      )

      await logAudit({
        action: 'STARTED',
        entityType: 'BATCH',
        entityId: cs.id,
        details: {
          batchId,
          mode: 'BROADCAST',
          serviceType: cs.service,
          proposalCount,
          source: 'sweep-orphans',
          bridesName: cs.bridesName,
          mondayClientItemId: cs.mondayClientItemId,
        },
      })

      // Best-effort push (don't fail the heal if push subsystem errors)
      try {
        const artists = await prisma.artist.findMany({
          where: { active: true, type: cs.service },
          select: { id: true },
        })
        if (artists.length > 0) {
          await sendNewProposalNotification(
            artists.map((a) => a.id),
            cs.bridesName,
            cs.service,
            cs.weddingDate,
          )
        }
      } catch (pushErr) {
        console.warn(`[sweep-orphans] Push failed for ${cs.id} (DB rows still healed):`, pushErr)
      }

      result.healed++
      console.log(`[sweep-orphans] Healed ClientService ${cs.id} (${cs.service}, ${cs.bridesName}) → batch ${batchId}, ${proposalCount} proposals`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push({ clientServiceId: cs.id, error: msg })
      console.error(`[sweep-orphans] Failed to heal ${cs.id}:`, err)
    }
  }

  return result
}
