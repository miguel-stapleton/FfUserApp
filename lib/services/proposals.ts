import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import {
  ProposalBatchMode,
  BatchStartReason,
  ProposalResponse,
  ArtistProposalCard,
  RespondToProposalRequest,
} from '@/lib/types'
import {
  ffadmin,
  EMAIL_TO_POLL_COLUMN,
  EMAIL_TO_DISPLAY_NAME,
  resolveArtistEmailFromDisplayName,
  addFFadminActivityLog,
} from '@/lib/ffadmin'

// ── Batch creation ────────────────────────────────────────────────────────────

export async function createBatchAndProposals(
  clientServiceId: string,
  mode: ProposalBatchMode,
  reason: BatchStartReason,
): Promise<{ batchId: string; proposalCount: number }> {
  return await prisma.$transaction(async (tx) => {
    const clientService = await tx.clientService.findUnique({ where: { id: clientServiceId } })
    if (!clientService) throw new Error('Client service not found')

    const deadlineAt = new Date(Date.now() + 72 * 60 * 60 * 1000)
    const batch = await tx.proposalBatch.create({
      data: { clientServiceId, mode, state: 'OPEN', startReason: reason as any, deadlineAt },
    })

    let artists
    if (mode === 'SINGLE') {
      artists = await tx.artist.findMany({
        where: { active: true, type: clientService.service },
        orderBy: [{ tier: 'asc' }, { createdAt: 'asc' }],
        take: 1,
      })
    } else {
      artists = await tx.artist.findMany({ where: { active: true, type: clientService.service } })
    }

    const proposals = await Promise.all(
      artists.map(artist =>
        tx.proposal.create({
          data: { proposalBatchId: batch.id, clientServiceId: clientService.id, artistId: artist.id },
        })
      )
    )
    return { batchId: batch.id, proposalCount: proposals.length }
  })
}

export async function createBatchForSpecificArtists(
  clientServiceId: string,
  mode: ProposalBatchMode,
  reason: BatchStartReason,
  artistIds: string[],
): Promise<{ batchId: string; proposalCount: number }> {
  return await prisma.$transaction(async (tx) => {
    const clientService = await tx.clientService.findUnique({ where: { id: clientServiceId } })
    if (!clientService) throw new Error('Client service not found')

    const deadlineAt = new Date(Date.now() + 72 * 60 * 60 * 1000)
    const batch = await tx.proposalBatch.create({
      data: { clientServiceId, mode, state: 'OPEN', startReason: reason as any, deadlineAt },
    })

    const proposals = await Promise.all(
      artistIds.map(artistId =>
        tx.proposal.create({
          data: { proposalBatchId: batch.id, clientServiceId: clientService.id, artistId },
        })
      )
    )
    return { batchId: batch.id, proposalCount: proposals.length }
  })
}

// ── Open proposals for artist ─────────────────────────────────────────────────

export async function getOpenProposalsForArtist(userId: string): Promise<ArtistProposalCard[]> {
  const artist = await prisma.artist.findUnique({ where: { userId }, include: { user: true } })
  if (!artist) throw new Error('Artist not found')

  // ── 1. Bride proposals from local DB ─────────────────────────────────────
  const dbProposals = await prisma.proposal.findMany({
    where: {
      artistId: artist.id,
      response: null,
      proposalBatch: { state: 'OPEN', deadlineAt: { gt: new Date() } },
    },
    include: { proposalBatch: true, clientService: true },
    orderBy: { createdAt: 'desc' },
  })

  const respondedProposals = await prisma.proposal.findMany({
    where: { artistId: artist.id, response: { not: null } },
    include: { clientService: true },
  })
  const respondedClientIds = new Set(respondedProposals.map(p => p.clientService.clientItemId))
  const seenClientIds = new Set<string>()

  const proposals: ArtistProposalCard[] = dbProposals
    .filter(p => {
      const clientId = p.clientService.clientItemId
      if (respondedClientIds.has(clientId)) return false
      if (seenClientIds.has(clientId)) return false
      seenClientIds.add(clientId)
      return true
    })
    .map(p => ({
      id: p.clientService.clientItemId,
      batchId: p.proposalBatchId,
      clientName: p.clientService.bridesName,
      serviceType: artist.type as any,
      eventDate: p.clientService.weddingDate,
      beautyVenue: p.clientService.beautyVenue || '',
      observations: p.clientService.description || '',
      createdAt: p.createdAt,
      isExpired: false,
    }))

  // ── 2. Independent Guests from FFadmin Supabase ──────────────────────────
  try {
    const boolCol = artist.type === 'MUA' ? 'mu' : 'h'
    const { data: guests, error } = await ffadmin
      .from('independent_guests')
      .select('*')
      .eq(boolCol, true)

    if (error) {
      console.error('[proposals] FFadmin independent_guests fetch failed:', error)
    } else if (guests) {
      for (const g of guests) {
        const itemId = String(g.item_id_ind)
        if (respondedClientIds.has(itemId)) continue

        const eventDate = g.event_date ? new Date(g.event_date + 'T00:00:00') : null
        if (!eventDate || eventDate.getTime() <= Date.now()) continue

        proposals.push({
          id: `guest-${itemId}`,
          batchId: `guest-${itemId}`,
          clientName: g.client_name || g.client_name || 'Guest',
          serviceType: artist.type as any,
          eventDate,
          beautyVenue: g.beauty_venue || '',
          observations: '',
          createdAt: new Date(),
          isExpired: false,
          isIndependentGuest: true,
        })
      }
    }
  } catch (e) {
    console.error('[proposals] Failed to fetch independent guests from FFadmin:', e)
  }

  return proposals
}

// ── Respond to proposal ───────────────────────────────────────────────────────

export async function respondToProposal({
  proposalId,
  response,
  actorUserId,
}: RespondToProposalRequest): Promise<void> {
  // 1. Try direct DB proposal UUID match
  const dbProposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      proposalBatch: { include: { clientService: true } },
      artist: { include: { user: true } },
    },
  })

  if (dbProposal) {
    await prisma.$transaction(async (tx) => {
      if (dbProposal.response) throw new Error('Proposal has already been responded to')
      if (dbProposal.proposalBatch?.state !== 'OPEN') throw new Error('Proposal batch is not active')

      await tx.proposal.update({ where: { id: proposalId }, data: { response, respondedAt: new Date() } })
      await logAudit({
        userId: actorUserId,
        action: 'PROPOSAL_RESPONSE',
        entityType: 'PROPOSAL',
        entityId: proposalId,
        details: {
          proposalId,
          response,
          bridesName: dbProposal.proposalBatch?.clientService?.bridesName,
          artistEmail: dbProposal.artist?.email,
        },
      })
      if (dbProposal.proposalBatch?.mode === 'SINGLE' && response === 'YES') {
        await tx.proposalBatch.update({ where: { id: dbProposal.proposalBatchId }, data: { state: 'COMPLETED' as any } })
        await tx.proposal.updateMany({
          where: { proposalBatchId: dbProposal.proposalBatchId, response: null, id: { not: proposalId } },
          data: { response: 'NO', respondedAt: new Date() },
        })
      }
      const remaining = await tx.proposal.count({ where: { proposalBatchId: dbProposal.proposalBatchId, response: null } })
      if (remaining === 0 && dbProposal.proposalBatch?.state === 'OPEN') {
        await tx.proposalBatch.update({ where: { id: dbProposal.proposalBatchId }, data: { state: 'COMPLETED' as any } })
      }
    })
    return
  }

  // 2. Resolve acting artist
  const actor = await prisma.artist.findUnique({ where: { userId: actorUserId }, include: { user: true } })
  if (!actor) throw new Error('Artist not found')

  const displayName = EMAIL_TO_DISPLAY_NAME[actor.email] || actor.user?.username || actor.email

  const ensureOpenBatchId = async (clientServiceId: string): Promise<string> => {
    let batch = await prisma.proposalBatch.findFirst({ where: { clientServiceId, state: 'OPEN' as any } })
    if (!batch) {
      batch = await prisma.proposalBatch.create({
        data: {
          clientServiceId,
          mode: 'BROADCAST' as any,
          startReason: 'UNDECIDED' as any,
          deadlineAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
          state: 'OPEN' as any,
        },
      })
    }
    return batch.id
  }

  // 3. Independent Guest: proposalId = 'guest-<item_id_ind>'
  if (proposalId.startsWith('guest-')) {
    const guestItemId = proposalId.replace('guest-', '')

    // Ensure ClientService exists
    let clientService = await prisma.clientService.findFirst({
      where: { clientItemId: guestItemId, service: actor.type as any },
    })
    if (!clientService) {
      // Read guest data from FFadmin
      const { data: guest } = await ffadmin
        .from('independent_guests')
        .select('*')
        .eq('item_id_ind', Number(guestItemId))
        .single()

      const weddingDate = guest?.event_date ? new Date(guest.event_date + 'T00:00:00') : new Date()
      clientService = await prisma.clientService.create({
        data: {
          clientItemId: guestItemId,
          service: actor.type as any,
          bridesName: guest?.client_name || 'Guest',
          weddingDate,
          beautyVenue: guest?.beauty_venue || '',
          currentStatus: 'undecided',
        },
      })
    }

    const batchId = await ensureOpenBatchId(clientService.id)
    const existing = await prisma.proposal.findFirst({ where: { proposalBatchId: batchId, artistId: actor.id } })
    let targetProposalId = existing?.id
    if (!existing) {
      const created = await prisma.proposal.create({
        data: { proposalBatchId: batchId, clientServiceId: clientService.id, artistId: actor.id },
      })
      targetProposalId = created.id
    }
    await prisma.proposal.update({ where: { id: targetProposalId! }, data: { response, respondedAt: new Date() } })
    await logAudit({
      userId: actorUserId,
      action: 'PROPOSAL_RESPONSE',
      entityType: 'CLIENT_SERVICE',
      entityId: clientService.id,
      details: { clientItemId: guestItemId, response, artistEmail: actor.email },
    })

    // FFadmin side-effects for guests: update polls + activity log
    try {
      const pollColumn = EMAIL_TO_POLL_COLUMN[actor.email]
      const itemIdNum = Number(guestItemId)
      const logMessage = response === 'YES' ? `${displayName} pode` : `${displayName} não pode`

      // Find polls row by item_id = item_id_ind
      const { data: pollsRow } = await ffadmin
        .from('polls')
        .select('id')
        .eq('item_id', itemIdNum)
        .maybeSingle()

      if (pollsRow && pollColumn) {
        await ffadmin.from('polls').update({ [pollColumn]: response === 'YES' }).eq('id', pollsRow.id)
      }

      // Activity log on the guest item
      const { data: guestRow } = await ffadmin
        .from('independent_guests')
        .select('item_id_ind')
        .eq('item_id_ind', itemIdNum)
        .maybeSingle()

      if (guestRow) {
        await addFFadminActivityLog(itemIdNum, logMessage, 'Artist', 'artist', true)
      }
    } catch (e) {
      console.error('[proposals] FFadmin side-effects failed for guest:', e)
    }
    return
  }

  // 4. Bride proposals: proposalId = clientItemId (numeric string)
  if (/^\d+$/.test(proposalId)) {
    const clientItemId = proposalId

    // Ensure ClientService exists
    let clientServiceId: string
    let currentStatus: string | null = null
    let clientService = await prisma.clientService.findFirst({
      where: { clientItemId, service: actor.type as any },
    })
    if (clientService) {
      clientServiceId = clientService.id
      currentStatus = clientService.currentStatus ?? null
    } else {
      const created = await prisma.clientService.create({
        data: {
          clientItemId,
          service: actor.type as any,
          bridesName: 'Client',
          weddingDate: new Date(),
          beautyVenue: '',
        },
      })
      clientServiceId = created.id
    }

    const batchId = await ensureOpenBatchId(clientServiceId)
    const existing = await prisma.proposal.findFirst({ where: { proposalBatchId: batchId, artistId: actor.id } })
    let targetProposalId = existing?.id
    if (!existing) {
      const created = await prisma.proposal.create({
        data: { proposalBatchId: batchId, clientServiceId, artistId: actor.id },
      })
      targetProposalId = created.id
    }
    await prisma.proposal.update({ where: { id: targetProposalId! }, data: { response, respondedAt: new Date() } })
    await logAudit({
      userId: actorUserId,
      action: 'PROPOSAL_RESPONSE',
      entityType: 'CLIENT_SERVICE',
      entityId: clientServiceId,
      details: { clientItemId, response, artistEmail: actor.email },
    })

    // FFadmin side-effects based on currentStatus
    try {
      await applyBrideResponseSideEffects({
        clientItemId,
        response,
        actor,
        displayName,
        currentStatus,
      })
    } catch (e) {
      console.error('[proposals] FFadmin bride side-effects failed:', e)
    }
    return
  }

  throw new Error('Proposal not found')
}

async function applyBrideResponseSideEffects({
  clientItemId,
  response,
  actor,
  displayName,
  currentStatus,
}: {
  clientItemId: string
  response: ProposalResponse
  actor: any
  displayName: string
  currentStatus: string | null
}) {
  const itemIdNum = Number(clientItemId)
  const norm = (s: string | null) => (s || '').toLowerCase().trim()
  const st = norm(currentStatus)
  const pollColumn = EMAIL_TO_POLL_COLUMN[actor.email]
  const logMessage = response === 'YES' ? `${displayName} pode` : `${displayName} não pode`

  // "Inquire artist" / chosen artist branch
  if (st === 'inquire artist') {
    if (response === 'YES') {
      // PATCH clients.mua_pode or hs_pode = 'Pode!'
      const field = actor.type === 'MUA' ? 'mua_pode' : 'hs_pode'
      await ffadmin.from('clients').update({ [field]: 'Pode!' }).eq('item_id', itemIdNum)
      await addFFadminActivityLog(itemIdNum, `${displayName} pode`)
    } else {
      // Artist cannot — escalate to second option via FFadmin client-action
      const action = actor.type === 'MUA' ? 'artist_cannot_mua' : 'artist_cannot_hs'
      const ffadminUrl = process.env.FFADMIN_URL
      if (ffadminUrl) {
        await fetch(`${ffadminUrl}/api/client-action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ffuser-secret': process.env.FFADMIN_WEBHOOK_SECRET || '',
          },
          body: JSON.stringify({ item_id: itemIdNum, action }),
        }).catch(e => console.error('[proposals] client-action call failed:', e))
      } else {
        // Fallback: patch directly
        const statusField = actor.type === 'MUA' ? 'm_status' : 'h_status'
        const podeField = actor.type === 'MUA' ? 'mua_pode' : 'hs_pode'
        const secondOption = actor.type === 'MUA' ? 'inquire second option' : 'inquire second option'
        await ffadmin.from('clients')
          .update({ [statusField]: secondOption, [podeField]: 'Não pode' })
          .eq('item_id', itemIdNum)
        await addFFadminActivityLog(itemIdNum, `${displayName} foi escolhido mas não pode`)
      }
    }
    return
  }

  // "undecided" / "inquire second option" branch → polls + activity log
  if (st === 'undecided' || st === 'inquire second option') {
    const { data: pollsRow } = await ffadmin
      .from('polls')
      .select('id')
      .eq('item_id', itemIdNum)
      .maybeSingle()

    if (pollsRow && pollColumn) {
      await ffadmin.from('polls').update({ [pollColumn]: response === 'YES' }).eq('id', pollsRow.id)
    }

    await addFFadminActivityLog(itemIdNum, logMessage)
  }
}

// ── Proposal statistics ───────────────────────────────────────────────────────

export async function getArtistProposalStats(artistId: string) {
  const [totalProposals, acceptedProposals, rejectedProposals, pendingProposals] = await Promise.all([
    prisma.proposal.count({ where: { artistId } }),
    prisma.proposal.count({ where: { artistId, response: 'YES' } }),
    prisma.proposal.count({ where: { artistId, response: 'NO' } }),
    prisma.proposal.count({ where: { artistId, response: null } }),
  ])

  const responseRate = totalProposals > 0 ? ((acceptedProposals + rejectedProposals) / totalProposals) * 100 : 0
  const acceptanceRate = totalProposals > 0 ? (acceptedProposals / totalProposals) * 100 : 0

  return {
    totalProposals,
    acceptedProposals,
    rejectedProposals,
    pendingProposals,
    responseRate: Math.round(responseRate * 100) / 100,
    acceptanceRate: Math.round(acceptanceRate * 100) / 100,
  }
}
