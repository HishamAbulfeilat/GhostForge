'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async () => {
    if (!pin.trim()) {
      setError('Enter your PIN')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })

      if (res.ok) {
        router.push('/chat')
        return
      }

      setError('Wrong PIN')
    } catch {
      setError('Unable to reach GhostForge auth')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm rounded-[28px] border border-sky-950/60 bg-gray-900/95 p-8 shadow-tactical backdrop-blur">
        <div className="mb-6 text-center">
          <div className="mb-2 text-4xl">🔫</div>
          <h1 className="text-2xl font-bold text-white">GhostForge</h1>
          <p className="mt-1 text-sm text-gray-400">Operator-grade dev tools</p>
        </div>
        <input
          type="password"
          placeholder="Enter PIN"
          value={pin}
          onChange={event => setPin(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && void handleLogin()}
          className="mb-3 w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none transition focus:border-sky-500"
        />
        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
        <button
          type="button"
          onClick={() => void handleLogin()}
          disabled={loading}
          className="w-full rounded-xl bg-sky-600 py-3 font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700"
        >
          {loading ? 'Verifying…' : 'Enter'}
        </button>
        <p className="mt-4 text-center text-xs text-gray-600">Developed by Hisham Abulfeilat</p>
      </div>
    </div>
  )
}
