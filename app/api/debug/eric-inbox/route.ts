/**
 * Debug endpoint: inspect Eric's inbox situation in production.
 *
 * GATED to Miguel (info@miguelstapleton.art). Returns JSON.
 *
 * Visit in browser while logged in:
 *   https://<your-app>.vercel.app/api/debug/eric-inbox
 *
 * Read-only — no mutations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'

const ALLOWED_EMAILS = new Set(['info@miguelstapleton.art'])

export async function GET(request: NextRequest) {
  // Gate access
  const me = await getUserFromRequest(request)
  if (!me || !ALLOWED_EMAILS.has(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ERIC_EMAIL = 'riberic@gmail.com'

  const user = await prisma.user.findUnique({
    where: { email: ERIC_EMAIL },
    include: { artist: true },
  })
  if (!user || !user.artist) {
    return NextResponse.json({ error: `No artist for ${ERIC_EMAIL}` }, { status: 404 })
  }

  const now = new Date()

  // ── Open proposals for Eric ──────────────────────────────────────────────
  const openProposals = await prisma.proposal.findMany({
    where: {
      artistId: user.artist.id,
      response: null,
      proposalBatch: { state: 'OPEN', deadlineAt: { gt: now } },
    },
    include: { proposalBatch: true, clientService: true },
    orderBy: { createdAt: 'desc' },
  })

  // ── respondedClientIds set ───────────────────────────────────────────────
  const respondedAll = await prisma.proposal.findMany({
    where: { artistId: user.artist.id, response: { not: null } },
    include: { clientService: true },
  })
  const respondedClientIds = new Set(
    respondedAll.map(p => p.clientService.mondayClientItemId)
  )

  const seenClientIds = new Set<string>()
  const openProposalsAnnotated = openProposals.map(p => {
    const clientId = p.clientService.mondayClientItemId
    const respondedBlock = respondedClientIds.has(clientId)
    const dedupeBlock = !respondedBlock && seenClientIds.has(clientId)
    let visibility: string
    if (respondedBlock) visibility = 'HIDDEN_PRIOR_RESPONSE'
    else if (dedupeBlock) visibility = 'HIDDEN_DEDUPE'
    else {
      visibility = 'VISIBLE'
      seenClientIds.add(clientId)
    }
    return {
      bridesName: p.clientService.bridesName,
      mondayClientItemId: clientId,
      service: p.clientService.service,
      weddingDate: p.clientService.weddingDate.toISOString().slice(0, 10),
      proposalId: p.id,
      batchId: p.proposalBatchId,
      batchMode: p.proposalBatch.mode,
      batchStartReason: p.proposalBatch.startReason,
      batchDeadlineAt: p.proposalBatch.deadlineAt.toISOString(),
      batchCreatedAt: p.proposalBatch.createdAt.toISOString(),
      visibility,
    }
  })

  // ── Look up Rosemina specifically ────────────────────────────────────────
  const roseminaServices = await prisma.clientService.findMany({
    where: { bridesName: { contains: 'Rosemina', mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
  })

  let roseminaProposals: any[] = []
  if (roseminaServices.length > 0) {
    const csIds = roseminaServices.map(s => s.id)
    const props = await prisma.proposal.findMany({
      where: {
        artistId: user.artist.id,
        clientServiceId: { in: csIds },
      },
      include: { proposalBatch: true, clientService: true },
      orderBy: { proposalBatch: { createdAt: 'desc' } },
    })
    roseminaProposals = props.map(p => ({
      proposalId: p.id,
      response: p.response,
      respondedAt: p.respondedAt?.toISOString() ?? null,
      proposalCreatedAt: p.createdAt.toISOString(),
      batchId: p.proposalBatchId,
      batchMode: p.proposalBatch.mode,
      batchState: p.proposalBatch.state,
      batchStartReason: p.proposalBatch.startReason,
      batchDeadlineAt: p.proposalBatch.deadlineAt.toISOString(),
      batchCreatedAt: p.proposalBatch.createdAt.toISOString(),
      clientServiceId: p.clientServiceId,
      bridesName: p.clientService.bridesName,
      mondayClientItemId: p.clientService.mondayClientItemId,
    }))
  }

  // ── 20 most recent HS ClientServices ─────────────────────────────────────
  const recentHs = await prisma.clientService.findMany({
    where: { service: 'HS' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      bridesName: true,
      mondayClientItemId: true,
      weddingDate: true,
      createdAt: true,
    },
  })

  // ── 10 most recent HS ProposalBatches across all clients ─────────────────
  const recentBatches = await prisma.proposalBatch.findMany({
    where: { clientService: { service: 'HS' } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { clientService: true },
  })

  return NextResponse.json({
    artist: {
      email: user.artist.email,
      id: user.artist.id,
      type: user.artist.type,
    },
    summary: {
      openProposalsCount: openProposals.length,
      respondedClientCount: respondedClientIds.size,
      roseminaClientServiceFound: roseminaServices.length > 0,
      roseminaProposalForEricFound: roseminaProposals.length > 0,
    },
    openProposals: openProposalsAnnotated,
    rosemina: {
      services: roseminaServices.map(s => ({
        id: s.id,
        bridesName: s.bridesName,
        mondayClientItemId: s.mondayClientItemId,
        weddingDate: s.weddingDate.toISOString().slice(0, 10),
        createdAt: s.createdAt.toISOString(),
      })),
      proposalsForEric: roseminaProposals,
    },
    recentHsClientServices: recentHs.map(cs => ({
      bridesName: cs.bridesName,
      mondayClientItemId: cs.mondayClientItemId,
      weddingDate: cs.weddingDate.toISOString().slice(0, 10),
      createdAt: cs.createdAt.toISOString(),
    })),
    recentHsBatches: recentBatches.map(b => ({
      batchId: b.id,
      mode: b.mode,
      state: b.state,
      startReason: b.startReason,
      deadlineAt: b.deadlineAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
      bridesName: b.clientService.bridesName,
      mondayClientItemId: b.clientService.mondayClientItemId,
    })),
  })
}
