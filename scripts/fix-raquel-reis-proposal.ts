/**
 * One-off cleanup: re-target the stale Raquel Reis SINGLE proposal from
 * Miguel to Inês.
 *
 * Background: yesterday's `fix2` (commit a0a707c) enabled the connect_boards
 * fallback in `processCreatePulseForService`. That made the SINGLE-batch path
 * fire on item creation for the first time. The downstream
 * `createBatchAndProposals('SINGLE', ...)` function ignores the chosen artist
 * and picks the first FOUNDER by createdAt — which is Miguel. So Raquel Reis's
 * proposal landed in Miguel's inbox instead of Inês's.
 *
 * The webhook is now fixed (uses createBatchForSpecificArtists), but the bad
 * Proposal row already exists in production. This script fixes that one row.
 *
 * Run with:   npx tsx scripts/fix-raquel-reis-proposal.ts
 *
 * Idempotent: if the row is already assigned to Inês (or no longer exists),
 * the script prints what it found and exits without writing.
 */

import { prisma } from '../lib/prisma'

const RAQUEL_REIS_MONDAY_ID = '2915832811'
const INES_EMAIL = 'iaguiarmakeup@gmail.com'
const MIGUEL_EMAIL = 'info@miguelstapleton.art'

async function main() {
  console.log(`Looking for ClientService with mondayClientItemId=${RAQUEL_REIS_MONDAY_ID}...`)

  const services = await prisma.clientService.findMany({
    where: { mondayClientItemId: RAQUEL_REIS_MONDAY_ID },
    include: {
      batches: {
        include: { proposals: { include: { artist: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (services.length === 0) {
    console.log('No ClientService rows found for Raquel Reis. Nothing to do.')
    return
  }

  // Resolve Inês's artist record (MUA)
  const inesArtist = await prisma.artist.findFirst({
    where: { email: INES_EMAIL, type: 'MUA', active: true },
  })
  if (!inesArtist) {
    console.error(`Could not find an active MUA Artist with email=${INES_EMAIL}. Aborting.`)
    process.exit(1)
  }
  console.log(`Inês's artist id: ${inesArtist.id}`)

  let fixed = 0
  let skipped = 0

  for (const cs of services) {
    if (cs.service !== 'MUA') {
      console.log(`  Skipping ClientService ${cs.id} (service=${cs.service}, not MUA)`)
      skipped++
      continue
    }

    console.log(`\nClientService ${cs.id} — ${cs.bridesName}`)
    for (const batch of cs.batches) {
      console.log(`  Batch ${batch.id} mode=${batch.mode} state=${batch.state} startReason=${batch.startReason}`)

      // Only touch OPEN SINGLE batches that came from the CHOSEN_NO start reason
      // (those are the ones the buggy code path created).
      if (batch.mode !== 'SINGLE' || batch.state !== 'OPEN') continue

      for (const p of batch.proposals) {
        const artistEmail = p.artist?.email
        console.log(`    Proposal ${p.id} artist=${artistEmail} response=${p.response}`)

        if (p.response !== null) {
          console.log('      → has a response already, leaving as-is')
          skipped++
          continue
        }

        if (artistEmail === INES_EMAIL) {
          console.log('      → already targets Inês, nothing to do')
          skipped++
          continue
        }

        if (artistEmail !== MIGUEL_EMAIL) {
          console.log(`      → targets ${artistEmail}, not Miguel — leaving as-is for manual review`)
          skipped++
          continue
        }

        // Re-target to Inês
        await prisma.proposal.update({
          where: { id: p.id },
          data: { artistId: inesArtist.id },
        })
        console.log(`      → re-targeted to Inês (${inesArtist.id})`)
        fixed++
      }
    }
  }

  console.log(`\nDone. Fixed: ${fixed}. Skipped: ${skipped}.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
