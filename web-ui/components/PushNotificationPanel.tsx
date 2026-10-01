'use client'

import { useCallback, useEffect, useState } from 'react'

type PushConfig = {
  configured: boolean
  publicKey: string | null
}

type PanelState = 'loading' | 'ready' | 'unsupported' | 'error'

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = window.atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  binary.split('').forEach((character, index) => {
    bytes[index] = character.charCodeAt(0)
  })
  return bytes.buffer
}

function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export default function PushNotificationPanel() {
  const [state, setState] = useState<PanelState>('loading')
  const [config, setConfig] = useState<PushConfig | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadPushState = useCallback(async () => {
    if (!isPushSupported()) {
      setState('unsupported')
      return
    }

    setError('')
    try {
      const response = await fetch('/api/push')
      const data = await response.json() as PushConfig & { error?: string }
      if (!response.ok) throw new Error(data.error || `Unable to inspect push configuration (${response.status}).`)

      setConfig({ configured: Boolean(data.configured), publicKey: data.publicKey || null })
      const registration = await navigator.serviceWorker.register('/sw.js')
      const currentSubscription = await registration.pushManager.getSubscription()
      setSubscribed(Boolean(currentSubscription))
      setState('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to inspect push notification configuration.')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void loadPushState()
  }, [loadPushState])

  const subscribe = async () => {
    if (!config?.publicKey || busy) return
    setBusy(true)
    setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Notifications are blocked in your browser. Allow them for this site, then try again.'
          : 'Notification permission was not granted.')
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      const current = await registration.pushManager.getSubscription()
      const subscription = current || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(config.publicKey),
      })
      const response = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) {
        if (!current) await subscription.unsubscribe()
        throw new Error(data.error || `Unable to save your subscription (${response.status}).`)
      }
      setSubscribed(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to enable push notifications.')
    } finally {
      setBusy(false)
    }
  }

  const unsubscribe = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) await subscription.unsubscribe()

      const response = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: null }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || `Unable to remove your subscription (${response.status}).`)
      setSubscribed(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to disable push notifications.')
    } finally {
      setBusy(false)
    }
  }

  const browserPermission = isPushSupported() ? Notification.permission : 'unsupported'
  const statusLabel = state === 'loading'
    ? 'Checking configuration…'
    : state === 'unsupported'
      ? 'Not supported'
      : subscribed
        ? 'Enabled'
        : 'Disabled'

  return (
    <section aria-labelledby="push-notifications-heading" className="space-y-6">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-white/40">Preferences</p>
        <h1 id="push-notifications-heading" className="mt-2 text-3xl font-semibold tracking-tight">Push notifications</h1>
        <p className="mt-2 text-sm text-white/60">
          Choose whether GhostForge can send alerts to this browser, even when this page is not open.
        </p>
      </header>

      {state === 'loading' && <p role="status" className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-white/60">Inspecting push notification configuration…</p>}
      {state === 'unsupported' && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">This browser does not support push notifications. Try a current browser over HTTPS.</p>}
      {state === 'error' && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p>{error}</p>
          <button type="button" onClick={() => void loadPushState()} className="mt-3 rounded-lg border border-red-300/30 px-3 py-2 text-xs font-semibold hover:bg-red-300/10">Try again</button>
        </div>
      )}

      {state === 'ready' && config && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
              <p className="text-xs uppercase tracking-widest text-white/40">Server configuration</p>
              <p className={`mt-3 text-lg font-semibold ${config.configured ? 'text-emerald-300' : 'text-amber-200'}`}>
                {config.configured ? 'Ready to receive subscriptions' : 'Not configured'}
              </p>
              <p className="mt-2 text-xs leading-5 text-white/50">
                {config.configured ? 'The push service is configured for this GhostForge instance.' : 'The server has not provided a VAPID public key yet.'}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-[#0b1220] p-5">
              <p className="text-xs uppercase tracking-widest text-white/40">This browser</p>
              <p className={`mt-3 text-lg font-semibold ${subscribed ? 'text-emerald-300' : 'text-white/70'}`}>{statusLabel}</p>
              <p className="mt-2 text-xs leading-5 text-white/50">Browser permission: <span className="font-mono">{browserPermission}</span></p>
            </article>
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!config.configured || busy || subscribed} onClick={() => void subscribe()} className="min-h-10 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
              {busy && !subscribed ? 'Saving…' : 'Enable notifications'}
            </button>
            <button type="button" disabled={busy || !subscribed} onClick={() => void unsubscribe()} className="min-h-10 rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">
              {busy && subscribed ? 'Removing…' : 'Disable notifications'}
            </button>
          </div>
          {!config.configured && <p className="text-xs text-amber-200/70">Ask an administrator to configure the server VAPID key before enabling notifications.</p>}
        </>
      )}
    </section>
  )
}
