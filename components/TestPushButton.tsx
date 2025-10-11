'use client'

import { useState } from 'react'

export default function TestPushButton() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle')

  const sendTest = async () => {
    try {
      setStatus('sending')
      const res = await fetch('/api/push/test', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      setStatus('ok')
      setTimeout(() => setStatus('idle'), 2000)
    } catch (e) {
      console.warn('Test push failed', e)
      setStatus('err')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <button
      onClick={sendTest}
      className="inline-flex items-center px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
      disabled={status === 'sending'}
      title="Send test notification"
    >
      {status === 'idle' && 'Test push'}
      {status === 'sending' && 'Sending…'}
      {status === 'ok' && 'Sent ✓'}
      {status === 'err' && 'Failed'}
    </button>
  )
}
