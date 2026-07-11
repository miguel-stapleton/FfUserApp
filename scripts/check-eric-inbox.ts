/**
 * Diagnostic: dump everything relevant to Eric's inbox right now.
 *
 *   npx tsx scripts/check-eric-inbox.ts
 *
 * Read-only. Lists:
 *   1. Every currently-OPEN Proposal for Eric with response=null and
 *      deadline in the future (these are the "4 open" from the earlier log).
 *   2. For each one, whether it would be hidden by respondedClientIds
 *      (i.e. Eric answered another batch for the same client at some point).
 *   3. The 20 most recently created ClientServices so we can spot Rosemina
 *      under whatever name she's actually stored as.
 */

import { prisma } from '../lib/prisma'

async function main() {
  const ERIC_EMAIL = 'riberic@gmail.com'

  const user = await prisma.user.findUnique({
    where: { email: ERIC_EMAIL },
    include: { artist: true },
  })
  if (!user || !user.artist) {
    console.error(`No user/artist found for ${ERIC_EMAIL}`)
    process.exit(1)
  }
  console.log(`Artist: ${user.artist.email} (id=${user.artist.id}, type=${user.artist.type})\n`)

  const now = new Date()

  // ── 1. Currently-open proposals for Eric ─────────────────────────────────
  const openProposals = await prisma.proposal.findMany({
    where: {
      artistId: user.artist.id,
      response: null,
      proposalBatch: { state: 'OPEN', deadlineAt: { gt: now } },
    },
    include: { proposalBatch: true, clientService: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log(`=== Currently-open Proposals for Eric: ${openProposals.length} ===`)

  // Build respondedClientIds the same way the inbox does
  const respondedAll = await prisma.proposal.findMany({
    where: { artistId: user.artist.id, response: { not: null } },
    include: { clientService: true },
  })
  const respondedClientIds = new Set(
    respondedAll.map(p => p.clientService.clientItemId)
  )

  const seenClientIds = new Set<string>()
  for (const p of openProposals) {
    const clientId = p.clientService.clientItemId
    const respondedBlock = respondedClientIds.has(clientId)
    const dedupeBlock = !respondedBlock && seenClientIds.has(clientId)
    let visibility: string
    if (respondedBlock) visibility = 'HIDDEN (prior response on another batch)'
    else if (dedupeBlock) visibility = 'HIDDEN (newer batch for same client already shown)'
    else {
      visibility = 'VISIBLE'
      seenClientIds.add(clientId)
    }

    console.log(`
  bridesName        = "${p.clientService.bridesName}"
    clientItemId = ${clientId}
    service            = ${p.clientService.service}
    weddingDate        = ${p.clientService.weddingDate.toISOString().slice(0, 10)}
    proposalId         = ${p.id}
    batchId            = ${p.proposalBatchId}
    batch.mode         = ${p.proposalBatch.mode}
    batch.startReason  = ${p.proposalBatch.startReason}
    batch.deadlineAt   = ${p.proposalBatch.deadlineAt.toISOString()}
    batch.createdAt    = ${p.proposalBatch.createdAt.toISOString()}
    visibility         = ${visibility}`)
  }

  // ── 2. For each hidden one, show the responses that are blocking ─────────
  console.log(`\n=== Prior responses Eric has given that block any of the above ===`)
  const blockingMondayIds = new Set<string>()
  for (const p of openProposals) {
    if (respondedClientIds.has(p.clientService.clientItemId)) {
      blockingMondayIds.add(p.clientService.clientItemId)
    }
  }
  if (blockingMondayIds.size === 0) {
    console.log('  (none — no hidden-by-response cases)')
  } else {
    const blockers = await prisma.proposal.findMany({
      where: {
        artistId: user.artist.id,
        response: { not: null },
        clientService: { clientItemId: { in: Array.from(blockingMondayIds) } },
      },
      include: { clientService: true, proposalBatch: true },
      orderBy: { respondedAt: 'desc' },
    })
    for (const b of blockers) {
      console.log(`
  bridesName=${b.clientService.bridesName}  clientItemId=${b.clientService.clientItemId}
    proposalId=${b.id}  response=${b.response}  respondedAt=${b.respondedAt?.toISOString()}
    batchState=${b.proposalBatch.state}  batchCreatedAt=${b.proposalBatch.createdAt.toISOString()}`)
    }
  }

  // ── 3. 20 most recent ClientServices (to find Rosemina under any name) ───
  console.log(`\n=== 20 most recently created ClientService rows (for HS) ===`)
  const recent = await prisma.clientService.findMany({
    where: { service: 'HS' },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  for (const cs of recent) {
    console.log(
      `  ${cs.createdAt.toISOString().slice(0, 19)}  bridesName="${cs.bridesName}"  monday=${cs.clientItemId}  weddingDate=${cs.weddingDate.toISOString().slice(0, 10)}`
    )
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
