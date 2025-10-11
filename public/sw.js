/* Service Worker for Fresh Faced PWA Push Notifications */

self.addEventListener('install', (event) => {
  // Activate worker immediately
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Become available to all pages
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {}

  const title = data.title || 'Fresh Faced'
  const body = data.body || 'You have a new notification.'
  const icon = data.icon || '/icon-192.png'
  const badge = data.badge || '/icon-192.png'
  const url = data.url || '/get-clients'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification?.data?.url || '/get-clients'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})
