import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { upsertClientServiceFromMonday } from '@/lib/services/clients'
import { createBatchAndProposals } from '@/lib/services/proposals'
import { logAudit } from '@/lib/audit'
import { sendNewProposalNotification } from '@/lib/push'
import { getClientFromMonday, getArtistByMondayId } from '@/lib/monday'
import { ServiceType } from '@/lib/types'

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

export async function POST(request: NextRequest) {
  try {
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
        itemId: event?.itemId,
        columnId: event?.columnId,
        valueText,
        previousText: prevText,
        normalizedValue: normalizeStatus(valueText),
      })
    } catch {}

    // Only handle column value changes
    if (event.type !== 'update_column_value') {
      return NextResponse.json({ success: true, message: 'Event type not handled' })
    }

    const { itemId, columnId, value, previousValue } = event

    // Validate env configuration and log if missing
    const M_COL = process.env.MONDAY_MSTATUS_COLUMN_ID
    const H_COL = process.env.MONDAY_HSTATUS_COLUMN_ID
    if (!M_COL || !H_COL) {
      console.warn('[monday:webhook] Missing MONDAY_MSTATUS_COLUMN_ID or MONDAY_HSTATUS_COLUMN_ID env in this environment')
    }

    // Extract status texts and normalize
    const newStatus = normalizeStatus(value?.label?.text || value?.text || '')
    const oldStatus = normalizeStatus(previousValue?.label?.text || previousValue?.text || '')

    // Handle Mstatus changes (MUA services)
    if (columnId === M_COL) {
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
    // Determine service type enum
    const serviceTypeEnum: ServiceType = serviceType === 'MUA' ? 'WEDDING' : 'WEDDING' // Adjust as needed

    // Handle "undecided – inquire availabilities" (normalize dashes/spaces)
    if (newStatus === TARGET_UNDECIDED) {
      await handleUndecidedStatus(mondayItemId, serviceType, serviceTypeEnum, timestamp)
    }

    // Handle "Travelling fee + inquire the artist"
    if (newStatus === TARGET_TRAVELLING) {
      await handleTravellingFeeStatus(mondayItemId, serviceType, serviceTypeEnum, timestamp)
    }

  } catch (error) {
    console.error(`Error handling ${serviceType} status change:`, error)
    
    // Log the error for audit purposes
    await logAudit({
      action: 'ERROR',
      entityType: 'WEBHOOK',
      entityId: mondayItemId,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        serviceType,
        newStatus,
        previousStatus,
      },
    })
  }
}

async function handleUndecidedStatus(
  mondayItemId: string,
  serviceType: 'MUA' | 'HS',
  serviceTypeEnum: ServiceType,
  timestamp: Date
) {
  // Ensure ClientService exists
  const clientServiceId = await upsertClientServiceFromMonday(
    mondayItemId,
    serviceTypeEnum as any
  )

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
    'MANUAL'
  )

  // Log batch creation
  await logAudit({
    action: 'STARTED',
    entityType: 'BATCH',
    entityId: batchId,
    details: {
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

    // Send push notifications to all selected artists
    try {
      await sendNewProposalNotification(
        artists.map(a => a.id),
        clientData.name,
        serviceTypeEnum,
        clientData.eventDate
      )
    } catch (pushError) {
      console.error('Failed to send push notifications:', pushError)
      // Don't fail the webhook for push notification errors
    }
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
  serviceTypeEnum: ServiceType,
  timestamp: Date
) {
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
  // This would need to be implemented based on Monday.com API structure
  const chosenArtistMondayId = await getChosenArtistFromClient(mondayItemId, serviceType)
  
  if (!chosenArtistMondayId) {
    console.log(`No chosen artist found for ${serviceType} client ${mondayItemId}`)
    return
  }

  // Find the artist in our database
  const artist = await prisma.artist.findFirst({
    where: {
      mondayItemId: chosenArtistMondayId,
      type: serviceType,
      active: true,
    },
  })

  if (!artist) {
    console.error(`Chosen artist not found in database: ${chosenArtistMondayId}`)
    return
  }

  // Ensure ClientService exists
  const clientServiceId = await upsertClientServiceFromMonday(
    mondayItemId,
    serviceTypeEnum as any
  )

  // Create SINGLE batch for the chosen artist
  const { batchId, proposalCount } = await createBatchAndProposals(
    clientServiceId,
    'SINGLE',
    'MANUAL',
    1 // Target count of 1 for single mode
  )

  // Log batch creation
  await logAudit({
    action: 'STARTED',
    entityType: 'BATCH',
    entityId: batchId,
    details: {
      mode: 'SINGLE',
      serviceType,
      chosenArtistId: artist.id,
      chosenArtistEmail: artist.email,
      proposalCount,
      timestamp: timestamp.toISOString(),
      note: 'SINGLE batch - no 24h auto-timeout until status changes to undecided',
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

    // Send push notifications to selected artists
    try {
      await sendNewProposalNotification(
        [artist.id],
        clientData.name,
        serviceTypeEnum,
        clientData.eventDate
      )
    } catch (pushError) {
      console.error('Failed to send push notification:', pushError)
      // Don't fail the webhook for push notification errors
    }
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
    // This would need to be implemented based on your Monday.com board structure
    // For now, returning null as placeholder
    // You would make an API call to Monday.com to get the chosen artist column value
    
    const chosenArtistColumnId = serviceType === 'MUA' 
      ? process.env.MONDAY_CHOSEN_MUA_COLUMN_ID 
      : process.env.MONDAY_CHOSEN_HS_COLUMN_ID

    // Implementation would go here to fetch the chosen artist from Monday.com
    // This is a placeholder - you'll need to implement based on Monday.com API
    
    return null
  } catch (error) {
    console.error('Error getting chosen artist from Monday.com:', error)
    return null
  }
}
