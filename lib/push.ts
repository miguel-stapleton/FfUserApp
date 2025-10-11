import webpush from 'web-push'
import { prisma } from './prisma'

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
      console.log(`No push subscriptions found for user ${userId}`)
      return
    }

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
      } catch (error: any) {
        console.error(`Failed to send push to subscription ${subscription.id}:`, error)
        
        // Remove invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          await prisma.pushSubscription.delete({
            where: { id: subscription.id },
          })
          console.log(`Removed invalid subscription ${subscription.id}`)
        }
      }
    })

    await Promise.allSettled(pushPromises)
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

    const userIds = artists.map(artist => artist.userId)
    await sendPushToUsers(userIds, payload)
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
  eventDate: Date
): Promise<void> {
  // Get user IDs for the artists
  const artists = await prisma.artist.findMany({
    where: {
      id: { in: artistIds },
    },
    select: {
      userId: true,
    },
  })

  const userIds = artists.map(artist => artist.userId)

  const payload: PushNotificationPayload = {
    title: 'New Proposal Available',
    body: `${clientName} - ${serviceType} on ${eventDate.toLocaleDateString()}`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: '/(artist)',
    data: {
      type: 'new_proposal',
      clientName,
      serviceType,
      eventDate: eventDate.toISOString(),
    },
  }

  await sendPushToUsers(userIds, payload)
}
