'use client'

import { useEffect, useState } from 'react'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary')
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export default function EnablePushButton() {
  const [supported, setSupported] = useState(false)
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    const isSupported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'Notification' in window
    setSupported(isSupported)
    if (isSupported && Notification.permission === 'granted') {
      setStatus('done')
    }
  }, [])

  const enablePush = async () => {
    try {
      setStatus('working')
      setMessage('')

      const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPub) {
        throw new Error('Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY')
      }

      // Preflight: ensure /sw.js is available on this deployment
      const swUrl = '/sw.js'
      const swResp = await fetch(swUrl, { cache: 'no-store' })
      if (!swResp.ok) {
        throw new Error('Service worker not found at /sw.js. Redeploy with public/sw.js present.')
      }

      // Register the service worker (must be at /sw.js)
      const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' })

      // Request permission (must be user-initiated)
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setStatus('idle')
        setMessage('Permission was not granted')
        return
      }

      // Subscribe
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPub),
      })

      // Transform to backend shape
      const json = subscription.toJSON() as any
      const endpoint: string = json.endpoint
      const p256dh: string = json.keys?.p256dh
      const auth: string = json.keys?.auth
      if (!endpoint || !p256dh || !auth) {
        throw new Error('Invalid subscription data')
      }

      const resp = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint, p256dh, auth }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save subscription')
      }

      setStatus('done')
    } catch (e: any) {
      console.error('Enable push failed:', e)
      setStatus('error')
      setMessage(e?.message || 'Failed to enable notifications')
    }
  }

  if (!supported || status === 'done') return null

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={enablePush}
        className="inline-flex items-center px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
        disabled={status === 'working'}
        title="Enable notifications"
      >
        {status === 'working' ? 'Enabling…' : 'Enable notifications'}
      </button>
      {message && (
        <span className="text-[11px] text-gray-500">{message}</span>
      )}
    </div>
  )
}
