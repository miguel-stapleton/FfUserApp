// Client-side push notification utilities
export class PushNotificationManager {
  private static instance: PushNotificationManager
  private registration: ServiceWorkerRegistration | null = null
  private subscription: PushSubscription | null = null

  private constructor() {}

  static getInstance(): PushNotificationManager {
    if (!PushNotificationManager.instance) {
      PushNotificationManager.instance = new PushNotificationManager()
    }
    return PushNotificationManager.instance
  }

  // Check if push notifications are supported
  isSupported(): boolean {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  }

  // Get current permission status
  getPermissionStatus(): NotificationPermission {
    return Notification.permission
  }

  // Register service worker
  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!this.isSupported()) {
      console.warn('Push notifications not supported')
      return null
    }

    try {
      this.registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
      })

      console.log('Service Worker registered:', this.registration)
      return this.registration
    } catch (error) {
      console.error('Service Worker registration failed:', error)
      return null
    }
  }

  // Request notification permission
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) {
      return 'denied'
    }

    const permission = await Notification.requestPermission()
    console.log('Notification permission:', permission)
    return permission
  }

  // Subscribe to push notifications
  async subscribe(): Promise<PushSubscription | null> {
    if (!this.registration) {
      await this.registerServiceWorker()
    }

    if (!this.registration) {
      console.error('No service worker registration available')
      return null
    }

    const permission = await this.requestPermission()
    if (permission !== 'granted') {
      console.warn('Push notification permission denied')
      return null
    }

    try {
      // Get VAPID public key from environment
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) {
        console.error('VAPID public key not configured')
        return null
      }

      this.subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey),
      })

      // Send subscription to server
      await this.sendSubscriptionToServer(this.subscription)
      
      console.log('Push subscription successful:', this.subscription)
      return this.subscription
    } catch (error) {
      console.error('Push subscription failed:', error)
      return null
    }
  }

  // Unsubscribe from push notifications
  async unsubscribe(): Promise<boolean> {
    if (!this.subscription) {
      return true
    }

    try {
      // Remove subscription from server
      await this.removeSubscriptionFromServer(this.subscription)
      
      // Unsubscribe from browser
      const success = await this.subscription.unsubscribe()
      if (success) {
        this.subscription = null
        console.log('Push unsubscription successful')
      }
      return success
    } catch (error) {
      console.error('Push unsubscription failed:', error)
      return false
    }
  }

  // Get current subscription
  async getSubscription(): Promise<PushSubscription | null> {
    if (!this.registration) {
      await this.registerServiceWorker()
    }

    if (!this.registration) {
      return null
    }

    try {
      this.subscription = await this.registration.pushManager.getSubscription()
      return this.subscription
    } catch (error) {
      console.error('Failed to get push subscription:', error)
      return null
    }
  }

  // Initialize push notifications (call after login)
  async initialize(): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('Push notifications not supported')
      return false
    }

    try {
      // Register service worker
      await this.registerServiceWorker()
      
      // Check if already subscribed
      const existingSubscription = await this.getSubscription()
      if (existingSubscription) {
        console.log('Already subscribed to push notifications')
        return true
      }

      // Subscribe to push notifications
      const subscription = await this.subscribe()
      return subscription !== null
    } catch (error) {
      console.error('Push notification initialization failed:', error)
      return false
    }
  }

  // Send subscription to server
  private async sendSubscriptionToServer(subscription: PushSubscription): Promise<void> {
    const subscriptionData = {
      endpoint: subscription.endpoint,
      p256dh: this.arrayBufferToBase64(subscription.getKey('p256dh')!),
      auth: this.arrayBufferToBase64(subscription.getKey('auth')!),
    }

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscriptionData),
    })

    if (!response.ok) {
      throw new Error(`Failed to save subscription: ${response.statusText}`)
    }
  }

  // Remove subscription from server
  private async removeSubscriptionFromServer(subscription: PushSubscription): Promise<void> {
    const response = await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to remove subscription: ${response.statusText}`)
    }
  }

  // Convert VAPID key to Uint8Array
  private urlBase64ToUint8Array(base64String: string): BufferSource {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  // Convert ArrayBuffer to base64
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }
}

// Export singleton instance
export const pushManager = PushNotificationManager.getInstance()

// Hook for React components
export function usePushNotifications() {
  const manager = PushNotificationManager.getInstance()

  return {
    isSupported: manager.isSupported(),
    getPermissionStatus: () => manager.getPermissionStatus(),
    initialize: () => manager.initialize(),
    subscribe: () => manager.subscribe(),
    unsubscribe: () => manager.unsubscribe(),
    getSubscription: () => manager.getSubscription(),
  }
}
