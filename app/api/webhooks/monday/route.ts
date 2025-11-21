import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'
import { prisma } from '@/lib/prisma'
import { upsertClientServiceFromMonday } from '@/lib/services/clients'
import { createBatchAndProposals, createBatchForSpecificArtists } from '@/lib/services/proposals'
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
const TARGET_SECOND_OPTION_M = normalizeStatus('inquire second option')
const TARGET_SECOND_OPTION_H = normalizeStatus('Travelling fee + inquire second option')
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
  const BOARD_INDEPENDENT_GUESTS = 1913629164

  // Independent Guests: broadcast to relevant artists when MU?/H? is true
  if (event?.boardId === BOARD_INDEPENDENT_GUESTS) {
    try {
      const rawItemId: any = (event as any).itemId ?? (event as any).pulseId ?? (event as any).item_id ?? (event as any).pulse_id
      const itemId: number | undefined = typeof rawItemId === 'string' || typeof rawItemId === 'number' ? Number(rawItemId) : undefined
      if (!itemId) return

      // Fetch item with column values
      const query = `
        query GetItem($itemId: ID!) {
          items(ids: [$itemId]) {
            id
            name
            column_values { id text value }
          }
        }
      `
      const resp = await axios.post(
        'https://api.monday.com/v2',
        { query, variables: { itemId } },
        { headers: { Authorization: process.env.MONDAY_API_TOKEN || '', 'Content-Type': 'application/json' } }
      )
      if (resp.data?.errors) {
        console.warn('[monday:create_pulse:guests] Monday errors', resp.data.errors)
        return
      }
      const item = resp.data?.data?.items?.[0]
      if (!item) return

      const cols: any[] = item.column_values || []
      const getCol = (id: string) => cols.find(c => c.id === id)
      const parseBool = (col: any): boolean => {
        if (!col) return false
        const t = (col.text || '').toString().toLowerCase().trim()
        if (t === 'true' || t === 'checked') return true
        if (col.value) {
          try {
            const v = JSON.parse(col.value)
            if (v && (v.checked === 'true' || v.checked === true)) return true
          } catch {}
        }
        return false
      }
      const MU_BOOL_ID = 'booleancr88sq6z' // MU?
      const HS_BOOL_ID = 'booleany6w6zo7p' // H? / False
      const DATE_COL_ID = 'date6'
      const NAME_COL_ID = 'short_text8'

      const muTrue = parseBool(getCol(MU_BOOL_ID))
      const hsTrue = parseBool(getCol(HS_BOOL_ID))

      // Extract event date and require future date
      let displayDate = ''
      let eventDate: Date | null = null
      const dateCol = getCol(DATE_COL_ID)
      if (dateCol?.value) {
        try {
          const dv = JSON.parse(dateCol.value)
          if (dv?.date) {
            const d = new Date(dv.date)
            if (!isNaN(d.getTime())) eventDate = d
          }
        } catch {}
      } else if (dateCol?.text) {
        const d = new Date(dateCol.text)
        if (!isNaN(d.getTime())) eventDate = d
      }
      // Only push for future dates
      if (!eventDate || eventDate.getTime() <= Date.now()) {
        return
      }
      displayDate = ' on ' + eventDate.toLocaleDateString('en-GB')

      // Prefer Client's Name for display
      const nameCol = getCol(NAME_COL_ID)
      const displayName = (nameCol?.text || '').trim() || item.name

      if (muTrue) {
        await sendPushToArtistsByType('MUA', {
          title: 'New Independent Guest',
          body: `${displayName}${displayDate}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/get-clients',
          data: { type: 'new_proposal', board: 'Independent Guests', itemId: String(item.id) },
        })
      }
      if (hsTrue) {
        await sendPushToArtistsByType('HS', {
          title: 'New Independent Guest',
          body: `${displayName}${displayDate}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/get-clients',
          data: { type: 'new_proposal', board: 'Independent Guests', itemId: String(item.id) },
        })
      }
    } catch (e) {
      console.error('[monday:create_pulse:guests] failed', e)
    }
    return
  }

  // Clients board: existing logic
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
  let serviceType: 'MUA' | 'HS' = mStatusNorm === TARGET_TRAVELLING ? 'MUA' : 'HS'
  const PRIMARY_MAPPING = serviceType === 'MUA' ? NAME_TO_EMAIL : NAME_TO_EMAIL_HS
  const SECONDARY_MAPPING = serviceType === 'MUA' ? NAME_TO_EMAIL_HS : NAME_TO_EMAIL

  // Attempts to read updates immediately, with up to 2 short retries
  let attempts = 0
  let chosenEmail: string | null = null
  let matchedServiceType: 'MUA' | 'HS' | null = null
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
        // First, try primary mapping based on which status was set
        for (const nameKey of Object.keys(PRIMARY_MAPPING)) {
          const keyNorm = normalizeText(nameKey)
          if (tail.startsWith(keyNorm) || tail.includes(` ${keyNorm}`) || tail.includes(`${keyNorm} `)) {
            chosenEmail = PRIMARY_MAPPING[nameKey]
            matchedServiceType = serviceType
            break
          }
        }
        // If not found, try the secondary mapping and set service type accordingly
        if (!chosenEmail) {
          for (const nameKey of Object.keys(SECONDARY_MAPPING)) {
            const keyNorm = normalizeText(nameKey)
            if (tail.startsWith(keyNorm) || tail.includes(` ${keyNorm}`) || tail.includes(`${keyNorm} `)) {
              chosenEmail = SECONDARY_MAPPING[nameKey]
              matchedServiceType = serviceType === 'MUA' ? 'HS' : 'MUA'
              break
            }
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

  // If we matched via the secondary map, update the serviceType accordingly
  if (matchedServiceType) {
    serviceType = matchedServiceType
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

    // Handle item creation events (support both create_pulse and create_item)
    if ((event as any)?.type === 'create_pulse' || (event as any)?.type === 'create_item') {
      await handleCreatePulse(event)
      return NextResponse.json({ success: true, note: 'create handled' })
    }

    // Only handle column value changes
    if (event.type !== 'update_column_value') {
      return NextResponse.json({ success: true, message: 'Event type not handled' })
    }

    // Some Monday recipes send itemId as pulseId/item_id
    const rawItemId: any = (event as any).itemId ?? (event as any).pulseId ?? (event as any).item_id ?? (event as any).pulse_id
    const itemId: number | undefined = typeof rawItemId === 'string' || typeof rawItemId === 'number' ? Number(rawItemId) : undefined
    const { columnId } = event as any

    // Extra visibility logs
    console.log('[monday:webhook:id]', { rawItemId, computedItemId: itemId, columnId })

    // Parse value/previousValue when Monday sends JSON strings
    const parseValue = (v: any) => {
      try {
        if (typeof v === 'string') return JSON.parse(v)
      } catch {}
      return v
    }
    const value = parseValue((event as any).value)
    const previousValue = parseValue((event as any).previousValue)

    // Independent Guests: when MU?/H? boolean flips to TRUE, broadcast
    try {
      const BOARD_INDEPENDENT_GUESTS = 1913629164
      const MU_BOOL_ID = 'booleancr88sq6z'
      const HS_BOOL_ID = 'booleany6w6zo7p'
      const DATE_COL_ID = 'date6'

      const getChecked = (val: any): boolean => {
        try {
          if (!val) return false
          if (typeof val === 'string') {
            const p = JSON.parse(val)
            return p?.checked === 'true' || p?.checked === true
          }
          return val?.checked === 'true' || val?.checked === true
        } catch {
          return false
        }
      }

      if (event.boardId === BOARD_INDEPENDENT_GUESTS && (columnId === MU_BOOL_ID || columnId === HS_BOOL_ID)) {
        const nowChecked = getChecked(value)
        const prevChecked = getChecked(previousValue)
        if (nowChecked && !prevChecked && itemId) {
          try {
            // Fetch item to read name/date for message
            const q = `
              query GetItem($itemId: ID!) {
                items(ids: [$itemId]) {
                  id
                  name
                  column_values { id text value }
                }
              }
            `
            const r = await axios.post(
              'https://api.monday.com/v2',
              { query: q, variables: { itemId } },
              { headers: { Authorization: process.env.MONDAY_API_TOKEN || '', 'Content-Type': 'application/json' } }
            )
            const it = r.data?.data?.items?.[0]
            const cols: any[] = it?.column_values || []
            const getCol = (id: string) => cols.find(c => c.id === id)

            // Prefer Client's Name (short_text8) for display if present
            const nameCol = getCol('short_text8')
            const displayName = (nameCol?.text || '').trim() || it?.name || 'Independent Guest'

            // Event date must be in the future to send push
            let displayDate = ''
            let eventDate: Date | null = null
            const dCol = getCol(DATE_COL_ID)
            if (dCol?.value) {
              try {
                const dv = JSON.parse(dCol.value)
                if (dv?.date) {
                  const d = new Date(dv.date)
                  if (!isNaN(d.getTime())) eventDate = d
                }
              } catch {}
            } else if (dCol?.text) {
              const d = new Date(dCol.text)
              if (!isNaN(d.getTime())) eventDate = d
            }
            if (!eventDate || eventDate.getTime() <= Date.now()) {
              return NextResponse.json({ success: true, note: 'guest boolean flip ignored (past/no date)' })
            }
            displayDate = ' on ' + eventDate.toLocaleDateString('en-GB')

            if (columnId === MU_BOOL_ID) {
              await sendPushToArtistsByType('MUA', {
                title: 'New Independent Guest',
                body: `${displayName}${displayDate}`,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                url: '/get-clients',
                data: { type: 'new_proposal', board: 'Independent Guests', itemId: String(itemId) },
              })
            } else if (columnId === HS_BOOL_ID) {
              await sendPushToArtistsByType('HS', {
                title: 'New Independent Guest',
                body: `${displayName}${displayDate}`,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                url: '/get-clients',
                data: { type: 'new_proposal', board: 'Independent Guests', itemId: String(itemId) },
              })
            }
          } catch (e) {
            console.error('[monday:update_column_value:guests] failed', e)
          }
        }
      }
    } catch (e) {
      console.error('[monday:webhook] guests-boolean handling failed', e)
    }

    // Validate env configuration and apply safe defaults for column IDs
    const ENV_M_COL = process.env.MONDAY_MSTATUS_COLUMN_ID?.trim()
    const ENV_H_COL = process.env.MONDAY_HSTATUS_COLUMN_ID?.trim()
    const DEFAULT_M_COL = 'project_status'
    const DEFAULT_H_COL = 'dup__of_mstatus'
    const M_COL = !ENV_M_COL || ENV_M_COL === 'mua_status_column_id' ? DEFAULT_M_COL : ENV_M_COL
    const H_COL = !ENV_H_COL || ENV_H_COL === 'hs_status_column_id' ? DEFAULT_H_COL : ENV_H_COL
    if (!M_COL || !H_COL) {
      console.warn('[monday:webhook] Missing MONDAY_MSTATUS_COLUMN_ID or MONDAY_HSTATUS_COLUMN_ID env in this environment')
    }

    // Visibility: show matching decisions
    console.log('[monday:webhook:match]', {
      columnId,
      M_COL,
      H_COL,
      isMcol: columnId === M_COL,
      isHcol: columnId === H_COL,
      newStatus: normalizeStatus(value?.label?.text || value?.text || value?.label || ''),
      TARGET_UNDECIDED,
      statusMatchesUndecided: normalizeStatus(value?.label?.text || value?.text || value?.label || '') === TARGET_UNDECIDED,
      TARGET_TRAVELLING,
      statusMatchesTravelling: normalizeStatus(value?.label?.text || value?.text || value?.label || '') === TARGET_TRAVELLING,
    })

    // Extract status texts and normalize
    const newStatus = normalizeStatus(value?.label?.text || value?.text || value?.label || '')
    const oldStatus = normalizeStatus(previousValue?.label?.text || previousValue?.text || previousValue?.label || '')

    // Handle Mstatus changes (MUA services)
    if (columnId === M_COL) {
      // If we have no itemId, send a generic broadcast push to MUA and exit early
      if (!itemId) {
        console.warn('[monday:webhook] Missing itemId/pulseId in event. Sending broadcast push without batch creation (MUA).')
        // Log target count for visibility
        try {
          const targets = await prisma.artist.count({ where: { type: 'MUA', active: true } })
          console.log('[monday:webhook:broadcast]', { service: 'MUA', targets })
        } catch (e) {
          console.warn('[monday:webhook:broadcast] Failed to count MUA targets', e)
        }
        await sendPushToArtistsByType('MUA', {
          title: 'New Proposal Available',
          body: 'A new client needs availability (MUA).',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/get-clients',
          data: { type: 'new_proposal' },
        })
        return NextResponse.json({ success: true, note: 'Broadcast sent without itemId (MUA)' })
      }
      await handleStatusChange(
        itemId.toString(),
        'MUA',
        newStatus,
        oldStatus,
        timestamp
      )
    }

    // Handle Hstatus changes (HS services)
    if (columnId === H_COL) {
      if (!itemId) {
        console.warn('[monday:webhook] Missing itemId/pulseId in event. Sending broadcast push without batch creation (HS).')
        // Log target count for visibility
        try {
          const targets = await prisma.artist.count({ where: { type: 'HS', active: true } })
          console.log('[monday:webhook:broadcast]', { service: 'HS', targets })
        } catch (e) {
          console.warn('[monday:webhook:broadcast] Failed to count HS targets', e)
        }
        await sendPushToArtistsByType('HS', {
          title: 'New Proposal Available',
          body: 'A new client needs availability (HS).',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: '/get-clients',
          data: { type: 'new_proposal' },
        })
        return NextResponse.json({ success: true, note: 'Broadcast sent without itemId (HS)' })
      }
      await handleStatusChange(
        itemId.toString(),
        'HS',
        newStatus,
        oldStatus,
        timestamp
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Monday webhook error:', error)
    // Always return 200 to prevent Monday.com from retrying
    return NextResponse.json({ success: false, error: 'Internal error' })
  }
}

async function handleStatusChange(
  mondayItemId: string,
  serviceType: 'MUA' | 'HS',
  newStatus: string,
  previousStatus: string,
  timestamp: Date
) {
  try {
    // Determine service type enum (Prisma)
    const serviceTypeEnum: PrismaServiceType = serviceType === 'MUA' ? 'MUA' : 'HS'

    // Handle "undecided – inquire availabilities" (normalize dashes/spaces)
    if (newStatus === TARGET_UNDECIDED) {
      await handleUndecidedStatus(mondayItemId, serviceType, serviceTypeEnum, timestamp)
    }

    // Handle "inquire second option" (MUA) and HS variant
    if (serviceType === 'MUA' && newStatus === TARGET_SECOND_OPTION_M) {
      await handleSecondOptionStatus(mondayItemId, 'MUA', serviceTypeEnum, timestamp)
    }
    if (serviceType === 'HS' && newStatus === TARGET_SECOND_OPTION_H) {
      await handleSecondOptionStatus(mondayItemId, 'HS', serviceTypeEnum, timestamp)
    }

    // Handle "Travelling fee + inquire the artist"
    if (newStatus === TARGET_TRAVELLING) {
      await handleTravellingFeeStatus(mondayItemId, serviceType, serviceTypeEnum, timestamp)
    }

  } catch (error) {
    console.error(`Error handling ${serviceType} status change:`, error)
    // Do not write an AuditLog row here because entityId would not reference ClientService
    // (AuditLog.entityId has an FK to ClientService.id). Use console for visibility only.
  }
}

// Handle "second option" status: broadcast to all except the exception account referenced by the whatsapp phrase
async function handleSecondOptionStatus(
  mondayItemId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: PrismaServiceType,
  timestamp: Date
) {
  console.log('[monday:webhook] Handling SECOND_OPTION for', { mondayItemId, serviceType })

  // Resolve exception email from updates
  let attempts = 0
  let exceptionEmail: string | null = null
  const PRIMARY_MAPPING = serviceType === 'MUA' ? NAME_TO_EMAIL : NAME_TO_EMAIL_HS
  const phrase = 'copy paste para whatsapp de '

  while (attempts < 3 && !exceptionEmail) {
    attempts++
    const updates = await getItemUpdates(mondayItemId)
    const combinedTexts = updates
      .map(u => normalizeText(u.text_body || u.body || ''))
      .filter(Boolean)
    for (const text of combinedTexts) {
      if (text.includes(phrase)) {
        const tail = text.slice(text.indexOf(phrase) + phrase.length).trim()
        for (const nameKey of Object.keys(PRIMARY_MAPPING)) {
          const keyNorm = normalizeText(nameKey)
          if (tail.startsWith(keyNorm) || tail.includes(` ${keyNorm}`) || tail.includes(`${keyNorm} `)) {
            exceptionEmail = PRIMARY_MAPPING[nameKey]
            break
          }
        }
        if (exceptionEmail) break
      }
    }
    if (!exceptionEmail && attempts < 3) await new Promise(res => setTimeout(res, 2000))
  }

  // Get target artists = all active of type minus exception (if found)
  const artists = await prisma.artist.findMany({ where: { type: serviceType, active: true } })
  const filtered = exceptionEmail ? artists.filter(a => a.email !== exceptionEmail) : artists
  if (filtered.length === 0) {
    console.log(`[monday:webhook] No active ${serviceType} artists (after exception filter) for second option`)
    return
  }

  // Ensure ClientService exists; if it fails, send a broadcast push as a fallback
  let clientServiceId: string
  try {
    clientServiceId = await upsertClientServiceFromMonday(mondayItemId, serviceTypeEnum as any)
  } catch (e) {
    console.warn('[monday:webhook] upsertClientServiceFromMonday failed (second option), sending broadcast fallback', e)
    await sendPushToArtistsByType(serviceType, {
      title: 'New Proposal Available',
      body: 'A new client needs availability.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url: '/get-clients',
      data: { type: 'new_proposal' },
    })
    return
  }

  // Create BROADCAST batch for filtered artists only
  const { batchId, proposalCount } = await createBatchForSpecificArtists(
    clientServiceId,
    'BROADCAST',
    'UNDECIDED',
    filtered.map(a => a.id)
  )

  // Log audit
  await logAudit({
    action: 'STARTED',
    entityType: 'BATCH',
    entityId: clientServiceId,
    details: {
      batchId,
      mode: 'BROADCAST',
      serviceType,
      proposalCount,
      exceptionEmail: exceptionEmail || null,
      timestamp: timestamp.toISOString(),
      note: 'BROADCAST second option (excluded exception account if found)',
    },
  })

  // Push to filtered artists
  const clientData = await getClientFromMonday(mondayItemId)
  await sendNewProposalNotification(
    filtered.map(a => a.id),
    clientData?.name || 'New Client',
    serviceTypeEnum,
    clientData?.eventDate || null
  )

  console.log(`Created BROADCAST batch ${batchId} for ${filtered.length} ${serviceType} artists (second option)`) 
}

async function handleUndecidedStatus(
  mondayItemId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: PrismaServiceType,
  timestamp: Date
) {
  console.log('[monday:webhook] Handling UNDECIDED for', { mondayItemId, serviceType })

  // Try to upsert client service; if it fails, send a broadcast push as a fallback
  let clientServiceId: string
  try {
    clientServiceId = await upsertClientServiceFromMonday(
      mondayItemId,
      serviceTypeEnum as any
    )
  } catch (e) {
    console.warn('[monday:webhook] upsertClientServiceFromMonday failed, sending broadcast fallback', e)
    try {
      const targets = await prisma.artist.count({ where: { type: serviceType, active: true } })
      console.log('[monday:webhook:broadcast:fallback]', { service: serviceType, targets })
    } catch {}
    await sendPushToArtistsByType(serviceType, {
      title: 'New Proposal Available',
      body: 'A new client needs availability.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url: '/get-clients',
      data: { type: 'new_proposal' },
    })
    return
  }

  // Log the status change
  await logAudit({
    action: 'MARKED_UNDECIDED',
    entityType: 'CLIENT_SERVICE',
    entityId: clientServiceId,
    details: {
      mondayItemId,
      serviceType,
      timestamp: timestamp.toISOString(),
    },
  })

  // Get all active artists of the specified type
  const artists = await prisma.artist.findMany({
    where: {
      type: serviceType,
      active: true,
    },
    select: {
      id: true,
      userId: true,
      email: true,
    },
  })

  if (artists.length === 0) {
    console.log(`No active ${serviceType} artists found for broadcast`)
    return
  }

  // Create BROADCAST batch with 24h deadline
  const { batchId, proposalCount } = await createBatchAndProposals(
    clientServiceId,
    'BROADCAST',
    'UNDECIDED'
  )

  // Log batch creation
  await logAudit({
    action: 'STARTED',
    entityType: 'BATCH',
    // Use ClientService ID to satisfy FK constraint in AuditLog.entityId
    entityId: clientServiceId,
    details: {
      batchId,
      mode: 'BROADCAST',
      serviceType,
      proposalCount,
      deadline: new Date(timestamp.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      timestamp: timestamp.toISOString(),
    },
  })

  // Get client info for push notification
  const clientData = await getClientFromMonday(mondayItemId)
  if (clientData) {
    // Send push notifications to all artists
    await sendNewProposalNotification(
      artists.map(a => a.id),
      clientData.name,
      serviceTypeEnum,
      clientData.eventDate
    )
  } else {
    console.warn('[monday:webhook] getClientFromMonday returned null, sending fallback notification')
    try {
      await sendNewProposalNotification(
        artists.map(a => a.id),
        'New Client',
        serviceTypeEnum,
        null
      )
    } catch (pushError) {
      console.error('Fallback push failed:', pushError)
    }
  }

  console.log(`Created BROADCAST batch ${batchId} for ${proposalCount} ${serviceType} artists`)
}

async function handleTravellingFeeStatus(
  mondayItemId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: PrismaServiceType,
  timestamp: Date
) {
  console.log('[monday:webhook] Handling TRAVELLING for', { mondayItemId, serviceType })

  // Get the chosen artist from Monday.com
  const chosenArtistColumnId = serviceType === 'MUA' 
    ? process.env.MONDAY_CHOSEN_MUA_COLUMN_ID 
    : process.env.MONDAY_CHOSEN_HS_COLUMN_ID

  if (!chosenArtistColumnId) {
    console.error(`No chosen artist column ID configured for ${serviceType}`)
    return
  }

  // Get client data to find the chosen artist
  const clientData = await getClientFromMonday(mondayItemId)
  if (!clientData) {
    console.error(`Client not found in Monday.com: ${mondayItemId}`)
    return
  }

  // Get the chosen artist Monday item ID from the client record
  const chosenArtistMondayId = await getChosenArtistFromClient(mondayItemId, serviceType)
  
  if (!chosenArtistMondayId) {
    console.log(`[monday:webhook:travelling] No chosen artist found for ${serviceType} client ${mondayItemId}`)
    return
  }

  console.log(`[monday:webhook:travelling] Looking up artist in database`, {
    chosenArtistMondayId,
    serviceType
  })

  // Find the artist in our database
  const artist = await prisma.artist.findFirst({
    where: {
      mondayItemId: chosenArtistMondayId,
      type: serviceType,
      active: true,
    },
  })

  if (!artist) {
    console.error(`[monday:webhook:travelling] Chosen artist not found in database`, {
      chosenArtistMondayId,
      serviceType,
      note: 'Artist may not be synced to database or mondayItemId mismatch'
    })
    
    // Try to find all artists to help debug
    const allArtists = await prisma.artist.findMany({
      where: { type: serviceType, active: true },
      select: { id: true, email: true, mondayItemId: true }
    })
    console.log(`[monday:webhook:travelling] Available ${serviceType} artists in database:`, allArtists)
    return
  }

  console.log(`[monday:webhook:travelling] Found artist`, {
    artistId: artist.id,
    email: artist.email,
    mondayItemId: artist.mondayItemId
  })

  // Ensure ClientService exists; if it fails, send fallback push and return
  let clientServiceId: string
  try {
    clientServiceId = await upsertClientServiceFromMonday(
      mondayItemId,
      serviceTypeEnum as any
    )
  } catch (e) {
    console.warn('[monday:webhook] upsertClientServiceFromMonday failed (single), sending fallback', e)
    try {
      const targets = await prisma.artist.count({ where: { type: serviceType, active: true } })
      console.log('[monday:webhook:broadcast:fallback]', { service: serviceType, targets })
    } catch {}
    await sendPushToArtistsByType(serviceType, {
      title: 'New Proposal Available',
      body: 'A new client needs availability.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url: '/get-clients',
      data: { type: 'new_proposal' },
    })
    return
  }

  // Create SINGLE batch for the chosen artist
  const { batchId, proposalCount } = await createBatchAndProposals(
    clientServiceId,
    'SINGLE',
    'CHOSEN_NO',
    1 // Target count of 1 for single mode
  )

  // Log batch creation
  await logAudit({
    action: 'STARTED',
    entityType: 'BATCH',
    // Use ClientService ID to satisfy FK constraint in AuditLog.entityId
    entityId: clientServiceId,
    details: {
      batchId,
      mode: 'SINGLE',
      serviceType,
      chosenArtistId: artist.id,
      chosenArtistEmail: artist.email,
      proposalCount,
      timestamp: timestamp.toISOString(),
      note: 'SINGLE batch started from create_pulse Travelling fee',
    },
  })

  // Send push notification to the chosen artist
  if (clientData) {
    await sendNewProposalNotification(
      [artist.id],
      clientData.name,
      serviceTypeEnum,
      clientData.eventDate
    )
  } else {
    console.warn('[monday:webhook] getClientFromMonday returned null (single), sending fallback notification')
    try {
      await sendNewProposalNotification(
        [artist.id],
        'New Client',
        serviceTypeEnum,
        null
      )
    } catch (pushError) {
      console.error('Fallback push failed (single):', pushError)
    }
  }

  console.log(`Created SINGLE batch ${batchId} for chosen ${serviceType} artist ${artist.email}`)
}

// Helper function to get chosen artist from Monday.com client record
async function getChosenArtistFromClient(
  mondayItemId: string,
  serviceType: 'MUA' | 'HS'
): Promise<string | null> {
  try {
    const chosenArtistColumnId = serviceType === 'MUA' 
      ? process.env.MONDAY_CHOSEN_MUA_COLUMN_ID 
      : process.env.MONDAY_CHOSEN_HS_COLUMN_ID

    if (!chosenArtistColumnId) {
      console.error(`[getChosenArtist] No column ID configured for ${serviceType}`)
      return null
    }

    console.log(`[getChosenArtist] Fetching chosen artist for client ${mondayItemId}, column ${chosenArtistColumnId}`)

    // Query Monday.com to get the chosen artist column value
    const query = `
      query GetChosenArtist($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          column_values(ids: ["${chosenArtistColumnId}"]) {
            id
            text
            value
          }
        }
      }
    `

    const response = await axios.post(
      'https://api.monday.com/v2',
      { query, variables: { itemId: mondayItemId } },
      { headers: { Authorization: process.env.MONDAY_API_TOKEN || '', 'Content-Type': 'application/json' } }
    )

    const item = response.data?.data?.items?.[0]
    if (!item) {
      console.log(`[getChosenArtist] Item ${mondayItemId} not found`)
      return null
    }

    const chosenArtistColumn = item.column_values?.[0]
    if (!chosenArtistColumn) {
      console.log(`[getChosenArtist] Column ${chosenArtistColumnId} not found on item ${mondayItemId}`)
      return null
    }

    console.log(`[getChosenArtist] Column data:`, {
      id: chosenArtistColumn.id,
      text: chosenArtistColumn.text,
      value: chosenArtistColumn.value
    })

    // Parse the connect_boards column value to get the linked artist item ID
    // Monday.com connect_boards columns return JSON with linked_pulse_ids
    if (chosenArtistColumn.value) {
      try {
        const parsed = JSON.parse(chosenArtistColumn.value)
        const linkedIds = parsed?.linkedPulseIds || parsed?.linked_pulse_ids || []
        
        if (linkedIds.length > 0) {
          const artistId = String(linkedIds[0]?.linkedPulseId || linkedIds[0])
          console.log(`[getChosenArtist] Found chosen artist ID: ${artistId}`)
          return artistId
        }
      } catch (e) {
        console.error(`[getChosenArtist] Failed to parse column value:`, e)
      }
    }

    console.log(`[getChosenArtist] No chosen artist found for ${serviceType} client ${mondayItemId}`)
    return null
  } catch (error) {
    console.error('[getChosenArtist] Error getting chosen artist from Monday.com:', error)
    return null
  }
}
