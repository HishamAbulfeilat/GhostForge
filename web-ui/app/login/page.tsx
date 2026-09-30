'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const [mode, setMode] = useState<'password' | 'pin'>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    try {
      const payload = mode === 'pin'
        ? { pin: pin.trim() }
        : { username: username.trim(), password }
      if (mode === 'password' && (!username.trim() || !password)) {
        setError('Enter your username and password')
        setLoading(false)
        return
      }
      if (mode === 'pin' && !pin.trim()) {
        setError('Enter your PIN')
        setLoading(false)
        return
      }
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        // Auto-register this browser/device under the signed-in user
        import('@/lib/client-device').then(m => m.reportDevice()).catch(() => {})
        const from = searchParams.get('next') ?? searchParams.get('from') ?? '/dashboard'
        const safeFrom = from.startsWith('/') && !from.startsWith('//') && !from.includes('\\')
          ? from
          : '/dashboard'
        router.push(safeFrom)
        return
      }
      const data = await res.json().catch(() => null)
      setError(data?.error || 'Invalid credentials')
    } catch {
      setError('Unable to reach GhostForge auth')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'mb-3 w-full rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none transition focus:border-sky-500'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm rounded-[28px] border border-sky-950/60 bg-gray-900/95 p-8 shadow-tactical backdrop-blur">
        <div className="mb-6 text-center">
          <div className="mb-2 text-4xl">👻</div>
          <h1 className="text-2xl font-bold text-white">GhostForge</h1>
          <p className="mt-1 text-sm text-gray-400">Operator-grade dev tools</p>
        </div>

        {mode === 'password' ? (
          <>
            <input
              type="text"
              placeholder="Username"
              aria-label="Username"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleLogin()}
              className={inputCls}
            />
            <input
              type="password"
              placeholder="Password"
              aria-label="Password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleLogin()}
              className={inputCls}
            />
          </>
        ) : (
          <input
            type="password"
            placeholder="Enter PIN"
            aria-label="PIN"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleLogin()}
            className={inputCls}
          />
        )}

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <button type="button"
          onClick={() => void handleLogin()}
          disabled={loading}
          className="w-full rounded-xl bg-sky-600 py-3 font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700"
        >
          {loading ? 'Verifying…' : 'Sign in'}
        </button>

        <button type="button"
          onClick={() => { setMode(mode === 'password' ? 'pin' : 'password'); setError('') }}
          className="mt-3 w-full text-center text-xs text-gray-500 transition hover:text-gray-300"
        >
          {mode === 'password' ? 'Use PIN instead' : 'Use username & password instead'}
        </button>

        <p className="mt-4 text-center text-xs text-gray-600">Developed by Hisham Abulfeilat</p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
