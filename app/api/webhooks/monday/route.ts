import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { upsertClientServiceFromMonday } from '@/lib/services/clients'
import { createBatchAndProposals } from '@/lib/services/proposals'
import { logAudit } from '@/lib/audit'
import { sendNewProposalNotification, sendPushToArtistsByType } from '@/lib/push'
import { getClientFromMonday, getItemUpdates, getArtistByMondayId } from '@/lib/monday'
import { ServiceType as PrismaServiceType } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MondayWebhookPayload {
  event: {
    type: string
    boardId: number
    itemId: number
    columnId?: string
    value?: any
    previousValue?: any
  }
  challenge?: string
}

function normalizeStatus(s: string | undefined | null) {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[\u2013\u2014\-]+/g, '-') // unify dashes (en/em/minus) to '-'
    .replace(/\s*\-\s*/g, ' - ') // normalize spaces around dash
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
}

const TARGET_UNDECIDED = normalizeStatus('undecided – inquire availabilities')
const TARGET_TRAVELLING = normalizeStatus('Travelling fee + inquire the artist')
const WEBHOOK_VERSION = 'monday-webhook-v3-2025-10-11-12:56'

// Name -> email mapping for "copy paste para whatsapp de ..."
const NAME_TO_EMAIL: Record<string, string> = {
  'lola': 'gi.lola@gmail.com',
  'miguel': 'info@miguelstapleton.art',
  'teresa': 'tecadete@gmail.com',
  'ines': 'iaguiarmakeup@gmail.com', // Inês
  'inês': 'iaguiarmakeup@gmail.com',
  'rita': 'ritarnunes.mua@gmail.com',
  'sofia': 'anaferreira.geral@hotmail.com',
  'filipa': 'filipawahnon.mua@gmail.com',
  'ana neves': 'anacatarinanev@gmail.com',
  'ana “neves': 'anacatarinanev@gmail.com', // smart quote variant
  'ana neves”': 'anacatarinanev@gmail.com',
  'sara': 'sara.jogo@hotmail.com',
  'ana roma': 'anaroma.makeup@gmail.com',
}

// HS (hair) name -> email mapping
const NAME_TO_EMAIL_HS: Record<string, string> = {
  'olga h': 'olga.amaral.hilario@gmail.com',
  'lilia': 'liliapcosta@gmail.com', // Lília
  'oksana': 'kseniya.hairstylist@gmail.com',
  'eric': 'riberic@gmail.com',
  'andreia': 'andreiadematoshair@gmail.com',
  'agne': 'hi@letshair.com',
  'joana': 'joanacarvalho_@hotmail.com',
}

function normalizeText(s: string | undefined | null) {
  if (!s) return ''
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[\u2018\u2019\u201C\u201D\u00AB\u00BB\u2039\u203A\u275B\u275C\u275D\u275E]/g, '"') // unify quotes
    .replace(/[\u2013\u2014\-]+/g, '-') // unify dashes
    .replace(/\s+/g, ' ')
    .trim()
}

async function handleCreatePulse(event: any) {
  const BOARD_CLIENTS = 1260828829
  if (event?.boardId !== BOARD_CLIENTS) {
    return
  }

  // Some recipes provide pulseId/item_id
  const rawItemId: any = (event as any).itemId ?? (event as any).pulseId ?? (event as any).item_id ?? (event as any).pulse_id
  const itemId: number | undefined = typeof rawItemId === 'string' || typeof rawItemId === 'number' ? Number(rawItemId) : undefined
  if (!itemId) return

  console.log('[monday:create_pulse]', { itemId })

  // Fetch client to read M/H statuses
  const client = await getClientFromMonday(String(itemId))
  if (!client) {
    console.warn('[monday:create_pulse] Client not found for item', itemId)
    return
  }

  const mStatusNorm = normalizeStatus(client.mStatus || '')
  const hStatusNorm = normalizeStatus(client.hStatus || '')
  console.log('[monday:create_pulse:status]', { mRaw: client.mStatus, mNorm: mStatusNorm, hRaw: client.hStatus, hNorm: hStatusNorm, TARGET_TRAVELLING })
  if (mStatusNorm !== TARGET_TRAVELLING && hStatusNorm !== TARGET_TRAVELLING) {
    return // Only act on Travelling fee at creation (either MUA or HS)
  }
  const serviceType: 'MUA' | 'HS' = mStatusNorm === TARGET_TRAVELLING ? 'MUA' : 'HS'
  const MAPPING = serviceType === 'MUA' ? NAME_TO_EMAIL : NAME_TO_EMAIL_HS

  // Attempts to read updates immediately, with up to 2 short retries
  let attempts = 0
  let chosenEmail: string | null = null
  while (attempts < 3 && !chosenEmail) {
    attempts++
    const updates = await getItemUpdates(String(itemId))
    const combinedTexts = updates
      .map(u => normalizeText(u.text_body || u.body || ''))
      .filter(Boolean)

    const phrase = 'copy paste para whatsapp de '
    for (const text of combinedTexts) {
      if (text.includes(phrase)) {
        // Extract tail after the phrase up to newline or end
        const idx = text.indexOf(phrase)
        const tail = text.slice(idx + phrase.length).trim()
        // Try to match any known name against tail
        for (const nameKey of Object.keys(MAPPING)) {
          const keyNorm = normalizeText(nameKey)
          if (tail.startsWith(keyNorm) || tail.includes(` ${keyNorm}`) || tail.includes(`${keyNorm} `)) {
            chosenEmail = MAPPING[nameKey]
            break
          }
        }
        if (chosenEmail) break
      }
    }

    if (!chosenEmail && attempts < 3) {
      console.log('[monday:create_pulse] No whatsapp name yet, retrying shortly...', { attempts })
      await new Promise(res => setTimeout(res, 2000))
    }
  }

  if (!chosenEmail) {
    console.warn('[monday:create_pulse] Could not resolve chosen artist from updates after retries', { itemId })
    return
  }

  // Find artist by email
  const artist = await prisma.artist.findFirst({ where: { email: chosenEmail, type: serviceType, active: true } })
  if (!artist) {
    console.warn('[monday:create_pulse] Chosen artist not found or inactive', { chosenEmail })
    return
  }

  // Ensure ClientService
  let clientServiceId: string
  try {
    clientServiceId = await upsertClientServiceFromMonday(String(itemId), serviceType as any)
  } catch (e) {
    console.error('[monday:create_pulse] upsertClientServiceFromMonday failed', e)
    return
  }

  // Create SINGLE batch targeting chosen artist
  const { batchId, proposalCount } = await createBatchAndProposals(
    clientServiceId,
    'SINGLE',
    'CHOSEN_NO',
    1
  )

  // Audit
  await logAudit({
    action: 'STARTED',
    entityType: 'BATCH',
    entityId: clientServiceId,
    details: {
      batchId,
      mode: 'SINGLE',
      serviceType,
      chosenArtistId: artist.id,
      chosenArtistEmail: artist.email,
      proposalCount,
      timestamp: new Date().toISOString(),
      note: 'SINGLE batch started from create_pulse Travelling fee',
    },
  })

  // Send push
  await sendNewProposalNotification(
    [artist.id],
    client.name,
    serviceType,
    client.eventDate
  )
}

export async function POST(request: NextRequest) {
  try {
    console.log('[monday:webhook:version]', WEBHOOK_VERSION)
    const body: MondayWebhookPayload = await request.json()

    // Handle Monday.com challenge for webhook verification
    if (body.challenge) {
      return NextResponse.json({ challenge: body.challenge })
    }

    const { event } = body
    const timestamp = new Date()

    // Helpful logging for debugging webhook payloads
    try {
      const valueText = event?.value?.label?.text || event?.value?.text || ''
      const prevText = event?.previousValue?.label?.text || event?.previousValue?.text || ''
      console.log('[monday:webhook]', {
        type: event?.type,
        boardId: event?.boardId,
        itemId: (event as any)?.itemId,
        pulseId: (event as any)?.pulseId,
        item_id: (event as any)?.item_id,
        pulse_id: (event as any)?.pulse_id,
        columnId: event?.columnId,
        valueText,
        previousText: prevText,
        normalizedValue: normalizeStatus(valueText),
      })
    } catch {}

    // Handle item creation events
    if ((event as any)?.type === 'create_pulse') {
      await handleCreatePulse(event)
      return NextResponse.json({ success: true, note: 'create_pulse handled' })
    }

    // Only handle column value changes
    if (event.type !== 'update_column_value') {
      return NextResponse.json({ success: true, message: 'Event type not handled' })
    }

    // ... rest of the code remains the same ...
