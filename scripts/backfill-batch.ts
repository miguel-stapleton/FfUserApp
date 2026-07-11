/**
 * Backfill a missing BROADCAST batch for a bride whose ClientService row
 * exists but who never got a batch created (the silent-failure case we hit
 * with Kim McDonald on 2026-06-29).
 *
 * Usage:
 *   set -a && source .env.local && set +a && \
 *     npx tsx scripts/backfill-batch.ts <clientItemId>
 *
 *   set -a && source .env.local && set +a && \
 *     npx tsx scripts/backfill-batch.ts <clientItemId> --dry-run
 *
 * For each service type (MUA + HS):
 *   1. Find the ClientService row for this Monday item ID.
 *   2. If no row, skip (nothing to backfill).
 *   3. If an OPEN batch already exists, skip (artists already see her).
 *   4. Otherwise, create a BROADCAST batch with `UNDECIDED` start reason,
 *      mirroring exactly what `handleUndecidedStatus` does in the webhook.
 *   5. Try to send push notifications (best-effort; not fatal if it fails).
 *
 * Safe to re-run. Will refuse to create a duplicate batch if one already
 * exists in the OPEN state. Pass --dry-run to preview without writing.
 */

import { prisma } from '../lib/prisma'
import { createBatchAndProposals } from '../lib/services/proposals'

const SERVICE_TYPES = ['MUA', 'HS'] as const

async function main() {
  const args = process.argv.slice(2)
  const clientItemId = args.find((a) => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')

  if (!clientItemId || !/^\d+$/.test(clientItemId)) {
    console.error('Usage: npx tsx scripts/backfill-batch.ts <clientItemId> [--dry-run]')
    process.exit(1)
  }

  console.log(`\n=== Backfill batch for Monday item ${clientItemId} ===`)
  if (dryRun) console.log('(dry run — no writes will be made)\n')

  const now = new Date()

  for (const serviceType of SERVICE_TYPES) {
    console.log(`\n--- ${serviceType} side ---`)

    const cs = await prisma.clientService.findFirst({
      where: { clientItemId: clientItemId, service: serviceType },
      include: {
        batches: {
          select: { id: true, mode: true, state: true, deadlineAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!cs) {
      console.log(`No ${serviceType} ClientService row found for ${clientItemId}. Skipping.`)
      continue
    }

    console.log(`ClientService ${cs.id}  bride=${cs.bridesName}  weddingDate=${cs.weddingDate.toISOString()}`)
    console.log(`  ${cs.batches.length} existing batch(es):`)
    for (const b of cs.batches) {
      const stillOpen = b.state === 'OPEN' && b.deadlineAt > now
      console.log(
        `    - ${b.id}  mode=${b.mode}  state=${b.state}  deadline=${b.deadlineAt.toISOString()}  stillOpen=${stillOpen}`,
      )
    }

    const openBatch = cs.batches.find((b) => b.state === 'OPEN' && b.deadlineAt > now)
    if (openBatch) {
      console.log(`  → already has an OPEN, in-window batch (${openBatch.id}). Skipping ${serviceType}.`)
      continue
    }

    // Count active artists of this type for a sanity check before writing
    const activeArtistCount = await prisma.artist.count({
      where: { active: true, type: serviceType },
    })
    console.log(`  Active ${serviceType} artists in DB: ${activeArtistCount}`)
    if (activeArtistCount === 0) {
      console.log(`  → No active ${serviceType} artists; cannot create a batch. Skipping.`)
      continue
    }

    if (dryRun) {
      console.log(`  → Would create BROADCAST batch for ${activeArtistCount} ${serviceType} artists. (dry run)`)
      continue
    }

    // Mirror what handleUndecidedStatus does
    const { batchId, proposalCount } = await createBatchAndProposals(
      cs.id,
      'BROADCAST',
      'UNDECIDED',
    )
    console.log(`  ✓ Created BROADCAST batch ${batchId} with ${proposalCount} proposal(s).`)

    // Best-effort push notification — same call the webhook makes
    try {
      const artists = await prisma.artist.findMany({
        where: { active: true, type: serviceType },
        select: { id: true },
      })
      const { sendNewProposalNotification } = await import('../lib/push')
      await sendNewProposalNotification(
        artists.map((a) => a.id),
        cs.bridesName,
        serviceType,
        cs.weddingDate,
      )
      console.log(`  ✓ Sent push notifications to ${artists.length} ${serviceType} artist(s).`)
    } catch (pushErr) {
      console.warn(`  ! Push notifications failed (DB rows are still in place):`, pushErr instanceof Error ? pushErr.message : pushErr)
    }
  }

  console.log('\nDone.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
