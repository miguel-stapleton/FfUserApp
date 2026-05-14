/**
 * Diagnostic script: inspect Eric's Proposal history for Rosemina.
 *
 * Run with:   npx tsx scripts/check-rosemina.ts
 *
 * Prints every Proposal row for riberic@gmail.com tied to any ClientService
 * whose bridesName contains "Rosemina", along with the parent ProposalBatch
 * state/deadline. This tells us whether `respondedClientIds` is the block.
 */

import { prisma } from '../lib/prisma'

async function main() {
  const ERIC_EMAIL = 'riberic@gmail.com'

  // Resolve Eric's artist record
  const user = await prisma.user.findUnique({
    where: { email: ERIC_EMAIL },
    include: { artist: true },
  })
  if (!user || !user.artist) {
    console.error(`No user/artist found for ${ERIC_EMAIL}`)
    process.exit(1)
  }
  console.log(`Artist: ${user.artist.email} (id=${user.artist.id}, type=${user.artist.type})`)

  // Find all ClientServices whose bridesName mentions Rosemina
  const services = await prisma.clientService.findMany({
    where: {
      bridesName: { contains: 'Rosemina', mode: 'insensitive' },
    },
  })
  if (services.length === 0) {
    console.log('No ClientService rows found matching "Rosemina".')
    process.exit(0)
  }
  console.log(`\nClientService rows matching "Rosemina": ${services.length}`)
  for (const cs of services) {
    console.log(
      `  - id=${cs.id}  mondayClientItemId=${cs.mondayClientItemId}  service=${cs.service}  bridesName="${cs.bridesName}"`
    )
  }

  const csIds = services.map(s => s.id)

  // All proposals for Eric tied to those services, newest batch first
  const proposals = await prisma.proposal.findMany({
    where: {
      artistId: user.artist.id,
      clientServiceId: { in: csIds },
    },
    include: {
      proposalBatch: true,
      clientService: true,
    },
    orderBy: { proposalBatch: { createdAt: 'desc' } },
  })

  console.log(`\nProposal rows for Eric tied to Rosemina: ${proposals.length}`)
  if (proposals.length === 0) {
    console.log(
      '  (none — the webhook never wrote a Proposal row for Eric for this client)'
    )
  }

  const now = new Date()
  for (const p of proposals) {
    const b = p.proposalBatch
    const isOpen = b?.state === 'OPEN' && b.deadlineAt > now
    console.log(`
  Proposal id=${p.id}
    response=${p.response ?? 'NULL'}
    respondedAt=${p.respondedAt?.toISOString() ?? '-'}
    createdAt=${p.createdAt.toISOString()}
    batch:
      id=${b?.id}
      mode=${b?.mode}
      state=${b?.state}
      startReason=${b?.startReason}
      deadlineAt=${b?.deadlineAt.toISOString()}
      createdAt=${b?.createdAt.toISOString()}
      currentlyOpen=${isOpen}`)
  }

  // Verdict
  console.log('\n=== Verdict ===')
  const hasPriorResponse = proposals.some(p => p.response !== null)
  const hasOpenBatchWithNullResponse = proposals.some(
    p =>
      p.response === null &&
      p.proposalBatch?.state === 'OPEN' &&
      p.proposalBatch.deadlineAt > now
  )

  if (hasOpenBatchWithNullResponse && hasPriorResponse) {
    console.log(
      'BLOCK CONFIRMED: there is an open, unanswered Proposal for Eric, but a prior response (on another batch) is hiding Rosemina from his inbox via the respondedClientIds filter.'
    )
    const oldResponded = proposals.filter(p => p.response !== null)
    console.log('Old responded Proposal IDs to clear:')
    for (const p of oldResponded) {
      console.log(`  - ${p.id}  (response=${p.response}, respondedAt=${p.respondedAt?.toISOString()})`)
    }
  } else if (hasOpenBatchWithNullResponse && !hasPriorResponse) {
    console.log(
      'No prior response found. The new batch SHOULD be visible — something else is filtering it. Investigate seenClientIds / multiple OPEN batches.'
    )
  } else if (!hasOpenBatchWithNullResponse) {
    console.log(
      'No currently-open Proposal for Eric. The webhook did not create one, or the new batch was already closed. Try toggling HStatus again and re-run this script.'
    )
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
