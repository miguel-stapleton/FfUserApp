/**
 * Debug endpoint: clear a single Proposal's response (set response=NULL,
 * respondedAt=NULL). Used to manually unblock an artist when a previous
 * response is hiding a client from their inbox via the respondedClientIds
 * filter in getOpenProposalsForArtist().
 *
 * Gated to Miguel. Requires a confirm=yes query param to prevent accidents.
 *
 * Usage:
 *   /api/debug/clear-response?proposalId=cmp3a131x0003kv04ebs800yn&confirm=yes
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserFromRequest } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

const ALLOWED_EMAILS = new Set(['info@miguelstapleton.art'])

export async function GET(request: NextRequest) {
  const me = await getUserFromRequest(request)
  if (!me || !ALLOWED_EMAILS.has(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const proposalId = request.nextUrl.searchParams.get('proposalId')
  const confirm = request.nextUrl.searchParams.get('confirm')

  if (!proposalId) {
    return NextResponse.json(
      { error: 'Missing proposalId query param' },
      { status: 400 }
    )
  }
  if (confirm !== 'yes') {
    return NextResponse.json(
      {
        error: 'Missing confirm=yes query param. Append &confirm=yes to actually apply the change.',
        wouldClearProposalId: proposalId,
      },
      { status: 400 }
    )
  }

  const existing = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      artist: true,
      clientService: true,
      proposalBatch: true,
    },
  })
  if (!existing) {
    return NextResponse.json(
      { error: `No Proposal with id=${proposalId}` },
      { status: 404 }
    )
  }
  if (existing.response === null) {
    return NextResponse.json({
      ok: true,
      changed: false,
      message: 'Proposal already has response=NULL; nothing to do.',
      proposal: {
        id: existing.id,
        artistEmail: existing.artist.email,
        bridesName: existing.clientService.bridesName,
      },
    })
  }

  const before = {
    response: existing.response,
    respondedAt: existing.respondedAt?.toISOString() ?? null,
  }

  const updated = await prisma.proposal.update({
    where: { id: proposalId },
    data: { response: null, respondedAt: null },
  })

  await logAudit({
    userId: me.id,
    action: 'ADMIN_CLEARED_PROPOSAL_RESPONSE',
    entityType: 'PROPOSAL',
    entityId: proposalId,
    details: {
      clearedByEmail: me.email,
      before,
      proposalArtistEmail: existing.artist.email,
      bridesName: existing.clientService.bridesName,
      clientItemId: existing.clientService.clientItemId,
      batchId: existing.proposalBatchId,
      batchState: existing.proposalBatch.state,
      reason: 'Manual unblock via /api/debug/clear-response',
    },
  })

  return NextResponse.json({
    ok: true,
    changed: true,
    proposal: {
      id: updated.id,
      artistEmail: existing.artist.email,
      bridesName: existing.clientService.bridesName,
      clientItemId: existing.clientService.clientItemId,
    },
    before,
    after: { response: null, respondedAt: null },
  })
}
