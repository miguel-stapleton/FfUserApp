import webpush from 'web-push'
import { prisma } from './prisma'

interface NotificationDeliveryLog {
  userId: string
  artistId?: string
  clientName?: string
  serviceType?: string
  status: 'SENT' | 'FAILED' | 'NO_SUBSCRIPTION' | 'INVALID_SUBSCRIPTION'
  subscriptionCount: number
  failureReason?: string
  timestamp: Date
}

/**
 * Log notification delivery attempts for debugging and monitoring
 */
async function logNotificationDelivery(log: NotificationDeliveryLog): Promise<void> {
  try {
    console.log('[push:delivery_log]', {
      userId: log.userId,
      artistId: log.artistId,
      clientName: log.clientName,
      status: log.status,
      subscriptionCount: log.subscriptionCount,
      failureReason: log.failureReason,
      timestamp: log.timestamp.toISOString(),
    })
    
    // Store in database for historical tracking
    await prisma.notificationDeliveryLog.create({
      data: {
        userId: log.userId,
        artistId: log.artistId,
        clientName: log.clientName,
        serviceType: log.serviceType,
        status: log.status,
        subscriptionCount: log.subscriptionCount,
        failureReason: log.failureReason,
        timestamp: log.timestamp,
      },
    }).catch(err => {
      // Don't fail the notification if logging fails
      console.warn('[push:delivery_log] Failed to store log in database:', err)
    })
  } catch (error) {
    console.error('[push:delivery_log] Error logging notification:', error)
  }
}

// Configure web-push with VAPID keys
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn('[push] VAPID keys are missing. Push sends will fail until set.')
}
webpush.setVapidDetails(
  'mailto:' + (process.env.VAPID_EMAIL || 'admin@freshfaced.com'),
  process.env.VAPID_PUBLIC_KEY || '',
  process.env.VAPID_PRIVATE_KEY || ''
)

export interface PushNotificationPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  url?: string
  data?: Record<string, any>
}

/**
 * Send push notification to a specific user
 */
export async function sendPushToUser(
  userId: string,
  payload: PushNotificationPayload
): Promise<void> {
  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    })

    if (subscriptions.length === 0) {
      console.log(`[push] No subscriptions for user ${userId}`)
      await logNotificationDelivery({
        userId,
        status: 'NO_SUBSCRIPTION',
        subscriptionCount: 0,
        clientName: payload.data?.clientName,
        serviceType: payload.data?.serviceType,
        timestamp: new Date(),
      })
      return
    }

    let successCount = 0
    let failureCount = 0
    let invalidCount = 0

    const pushPromises = subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(payload)
        )
        successCount++
      } catch (error: any) {
        console.error(`Failed to send push to subscription ${subscription.id}:`, error)
        
        // Remove invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          await prisma.pushSubscription.delete({
            where: { id: subscription.id },
          })
          console.log(`[push] Removed invalid subscription ${subscription.id}`)
          invalidCount++
        } else {
          failureCount++
        }
      }
    })

    await Promise.allSettled(pushPromises)
    
    // Log delivery outcome
    const status = successCount > 0 ? 'SENT' : (invalidCount > 0 ? 'INVALID_SUBSCRIPTION' : 'FAILED')
    await logNotificationDelivery({
      userId,
      status,
      subscriptionCount: subscriptions.length,
      clientName: payload.data?.clientName,
      serviceType: payload.data?.serviceType,
      failureReason: failureCount > 0 ? `${failureCount} subscriptions failed to send` : undefined,
      timestamp: new Date(),
    })
  } catch (error) {
    console.error('Error sending push notification:', error)
  }
}

/**
 * Send push notification to multiple users
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushNotificationPayload
): Promise<void> {
  console.log('[push:send]', { count: userIds.length, sample: userIds.slice(0, 5) })
  const pushPromises = userIds.map(userId => sendPushToUser(userId, payload))
  await Promise.allSettled(pushPromises)
}

/**
 * Send push notification to all artists of a specific type
 */
export async function sendPushToArtistsByType(
  artistType: 'MUA' | 'HS',
  payload: PushNotificationPayload
): Promise<void> {
  try {
    const artists = await prisma.artist.findMany({
      where: {
        type: artistType,
        active: true,
      },
      select: {
        userId: true,
      },
    })

    const eligibleUserIds = artists.map(artist => artist.userId)
    // Filter to users that have at least one subscription
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: eligibleUserIds } },
      select: { userId: true },
    })
    const subscribedUserIds = Array.from(new Set(subs.map(s => s.userId)))

    console.log('[push:broadcast]', {
      artistType,
      eligibleCount: eligibleUserIds.length,
      subscribedCount: subscribedUserIds.length,
      sample: subscribedUserIds.slice(0, 5),
    })
    await sendPushToUsers(subscribedUserIds, payload)
  } catch (error) {
    console.error('Error sending push to artists by type:', error)
  }
}

/**
 * Send new proposal notification to artists
 */
export async function sendNewProposalNotification(
  artistIds: string[],
  clientName: string,
  serviceType: string,
  eventDate?: string | Date | null
): Promise<void> {
  // Get user IDs for the artists
  const artists = await prisma.artist.findMany({
    where: {
      id: { in: artistIds },
    },
    select: {
      userId: true,
      id: true,
    },
  })

  const eligibleUserIds = artists.map(artist => artist.userId)
  // Filter to users that have at least one subscription
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: eligibleUserIds } },
    select: { userId: true },
  })
  const userIds = Array.from(new Set(subs.map(s => s.userId)))
  
  // Log artists without subscriptions
  const artistsWithSubs = new Set(userIds)
  for (const artist of artists) {
    if (!artistsWithSubs.has(artist.userId)) {
      await logNotificationDelivery({
        userId: artist.userId,
        artistId: artist.id,
        clientName,
        serviceType,
        status: 'NO_SUBSCRIPTION',
        subscriptionCount: 0,
        timestamp: new Date(),
      })
    }
  }

  // Format event date safely as DD/MM/YYYY
  let displayDate = ''
  if (eventDate) {
    try {
      const d = typeof eventDate === 'string' ? new Date(eventDate) : eventDate
      if (d && !isNaN(d.getTime())) {
        displayDate = ` on ${d.toLocaleDateString('en-GB')}`
      }
    } catch {}
  }

  const payload: PushNotificationPayload = {
    title: 'New Proposal Available',
    body: `${clientName} - ${serviceType}${displayDate}`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Route groups like (artist) are not part of the URL; use public path
    url: '/get-clients',
    data: {
      type: 'new_proposal',
      clientName,
      serviceType,
      eventDate: eventDate ? (typeof eventDate === 'string' ? eventDate : eventDate.toISOString()) : null,
    },
  }

  console.log('[push:new_proposal]', {
    eligibleCount: eligibleUserIds.length,
    subscribedCount: userIds.length,
    sample: userIds.slice(0, 5),
  })
  await sendPushToUsers(userIds, payload)
}
