'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Remote access for any device: pair a phone with a QR code, reach this
 * computer from anywhere (Tailscale / Cloudflare tunnel), manage paired
 * devices, and view + control the screen. Works on Windows, macOS and Linux.
 */

type Address = { address: string; iface: string; kind: 'lan' | 'tailscale' | 'other'; url: string }
type Network = { addresses: Address[]; tailscale: { name: string; url: string } | null; tunnel: { running: boolean; url: string | null; error?: string }; canManageTunnel: boolean }
type Device = { id: string; username: string; name: string; pairedAt: string; lastSeen?: string }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string }
    throw new Error(err.error || `Request failed (${r.status})`)
  }
  return await r.json() as T
}

const card = 'rounded-2xl border border-gf-line bg-gf-surface p-4 sm:p-5'
const btn = 'min-h-10 rounded-lg border border-gf-line2 px-3 text-sm font-semibold hover:border-gf-accent disabled:opacity-50'

export default function RemoteAccess() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PairDevice />
        <ReachAnywhere />
      </div>
      <RemoteDesktop />
      <PairedDevices />
    </div>
  )
}

function PairDevice() {
  const [pair, setPair] = useState<{ links: string[]; qrSvg: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(0)

  useEffect(() => {
    if (!pair) return
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(pair.expiresAt) - Date.now()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [pair])

  const create = async () => {
    setBusy(true); setError('')
    try { setPair(await call('/api/remote/pair', { method: 'POST', body: JSON.stringify({ label: 'Phone' }) })) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <section className={card} aria-labelledby="rc-pair">
      <h2 id="rc-pair" className="font-display text-lg font-semibold">📱 Pair a phone or tablet</h2>
      <p className="mt-1 text-sm text-gf-muted">
        Scan the code with your phone&apos;s camera. It signs the phone in as you, once, within 10 minutes. No password typing on the phone.
      </p>
      {pair && left > 0 ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
          {/* QR SVG is generated server-side by the qrcode package from our own link */}
          <div className="w-56 max-w-full rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: pair.qrSvg }} aria-label="Pairing QR code" role="img" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>
            <p className="mt-2 text-gf-muted">Or open one of these on the phone (same Wi-Fi, Tailscale or tunnel):</p>
            <ul className="mt-1 grid list-none gap-1 p-0">
              {pair.links.map(l => (
                <li key={l} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-gf-bar px-2 py-1 text-xs">{l.replace(/code=.*/, 'code=…')}</code>
                  <button type="button" className="shrink-0 rounded border border-gf-line px-2 py-1 text-xs hover:border-gf-accent" onClick={() => void navigator.clipboard?.writeText(l)}>Copy</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gf-muted">The phone may warn about the certificate on the local address the first time; that is the local HTTPS certificate GhostForge created.</p>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => void create()} disabled={busy} className={`${btn} mt-4`}>{busy ? 'Creating…' : 'Show pairing code'}</button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-gf-danger">{error}</p>}
    </section>
  )
}

function ReachAnywhere() {
  const [net, setNet] = useState<Network | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => call<Network>('/api/remote/network').then(setNet, e => setError(String(e.message || e))), [])
  useEffect(() => { void load() }, [load])

  const tunnel = async (action: 'tunnel-start' | 'tunnel-stop') => {
    setBusy(true); setError('')
    try {
      const r = await call<{ tunnel: Network['tunnel'] & { error?: string } }>('/api/remote/network', { method: 'POST', body: JSON.stringify({ action }) })
      if (r.tunnel.error) setError(r.tunnel.error)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    setBusy(false)
  }

  return (
    <section className={card} aria-labelledby="rc-net">
      <h2 id="rc-net" className="font-display text-lg font-semibold">🌐 Reach this computer</h2>
      <dl className="mt-3 grid gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wider text-gf-muted">Same Wi-Fi</dt>
          <dd className="m-0 mt-1 grid gap-1">
            {net?.addresses.filter(a => a.kind !== 'tailscale').map(a => <code key={a.url} className="break-all text-xs">{a.url}</code>)}
            {net && !net.addresses.some(a => a.kind !== 'tailscale') && <span className="text-gf-muted">No network address found.</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-gf-muted">Anywhere, privately (Tailscale)</dt>
          <dd className="m-0 mt-1">
            {net?.tailscale ? <code className="break-all text-xs">{net.tailscale.url}</code> : (
              <span className="text-gf-muted">Install <a className="text-gf-accent underline" href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a> on this computer and your phone, sign both in, then refresh. Recommended: nothing is exposed to the internet.</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-gf-muted">Anywhere, by public link (Cloudflare)</dt>
          <dd className="m-0 mt-1 grid gap-2">
            {net?.tunnel.url ? <code className="break-all text-xs">{net.tunnel.url}</code> : <span className="text-gf-muted">Off. A temporary https link, still protected by your GhostForge login. Needs cloudflared installed.</span>}
            {net?.canManageTunnel && (
              <span className="flex flex-wrap gap-2">
                {net.tunnel.running
                  ? <button type="button" className={btn} disabled={busy} onClick={() => void tunnel('tunnel-stop')}>Stop public link</button>
                  : <button type="button" className={btn} disabled={busy} onClick={() => void tunnel('tunnel-start')}>{busy ? 'Starting…' : 'Start public link'}</button>}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {error && <p role="alert" className="mt-2 text-sm text-gf-danger">{error}</p>}
    </section>
  )
}

function PairedDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const load = useCallback(() => call<{ devices: Device[] }>('/api/remote/devices').then(r => setDevices(r.devices), () => setDevices([])), [])
  useEffect(() => { void load() }, [load])
  const revoke = async (id: string) => {
    if (!confirm('Sign this device out now?')) return
    await call(`/api/remote/devices?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
    void load()
  }
  return (
    <section className={card} aria-labelledby="rc-devices">
      <h2 id="rc-devices" className="font-display text-lg font-semibold">🔐 Paired devices</h2>
      {devices && devices.length ? (
        <ul className="mt-3 grid list-none gap-2 p-0">
          {devices.map(d => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gf-line p-2 text-sm">
              <span className="min-w-0 flex-1"><span className="font-semibold">{d.name}</span> <span className="text-gf-muted">· {d.username} · paired {new Date(d.pairedAt).toLocaleDateString()}{d.lastSeen ? ` · seen ${new Date(d.lastSeen).toLocaleString()}` : ''}</span></span>
              <button type="button" className="rounded border border-gf-line px-2 py-1 text-xs hover:border-gf-danger" onClick={() => void revoke(d.id)}>Revoke</button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-gf-muted">{devices ? 'No paired devices.' : 'Loading…'}</p>}
    </section>
  )
}

type DesktopStatus = { enabled: boolean; support: { capture: boolean; control: boolean; install: string } }

/** Live screen with tap-to-click, typing, keys and scroll. Admins only. */
function RemoteDesktop() {
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const [denied, setDenied] = useState('')
  const [frame, setFrame] = useState<string>()
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [password, setPassword] = useState('')
  const [text, setText] = useState('')
  const imgRef = useRef<HTMLImageElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)

  const load = useCallback(async () => {
    try { setStatus(await call<DesktopStatus>('/api/remote/desktop')); setDenied('') } catch (e) { setDenied(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Poll frames while live (about 2 per second); stop when the tab is hidden.
  useEffect(() => {
    if (!live || !status?.enabled) return
    let stopped = false
    let url: string | undefined
    const next = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        try {
          const r = await fetch('/api/remote/desktop?frame=1', { cache: 'no-store' })
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Frame failed (${r.status})`)
          const blob = await r.blob()
          const nextUrl = URL.createObjectURL(blob)
          setFrame(nextUrl)
          if (url) URL.revokeObjectURL(url)
          url = nextUrl
          setError('')
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setLive(false)
          return
        }
      }
      setTimeout(() => void next(), 450)
    }
    void next()
    return () => { stopped = true; if (url) URL.revokeObjectURL(url) }
  }, [live, status?.enabled])

  const send = async (input: Record<string, unknown>) => {
    try { await call('/api/remote/desktop', { method: 'POST', body: JSON.stringify({ input }) }) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const toggle = async (enable: boolean) => {
    setError('')
    try {
      await call('/api/remote/desktop', { method: 'POST', body: JSON.stringify(enable ? { action: 'enable', password } : { action: 'disable' }) })
      setPassword(''); setLive(enable); await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const pointAt = (clientX: number, clientY: number) => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r) return null
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  if (denied) return null // non-admins don't see remote desktop at all

  return (
    <section className={card} aria-labelledby="rc-desktop">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rc-desktop" className="font-display text-lg font-semibold">🖥️ Control this computer</h2>
        {status?.enabled && (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => setLive(l => !l)}>{live ? 'Pause view' : 'Show screen'}</button>
            <button type="button" className={`${btn} hover:border-gf-danger`} onClick={() => void toggle(false)}>Turn off</button>
          </span>
        )}
      </div>
      {status && !status.support.capture && (
        <p className="mt-2 text-sm text-gf-warn">Screen capture is not installed on this computer: <code className="text-xs">{status.support.install}</code></p>
      )}
      {status && !status.enabled && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void toggle(true) }}>
          <p className="w-full text-sm text-gf-muted">Off. Turning it on lets your signed-in devices see this screen and use the mouse and keyboard. Enter your password to confirm.</p>
          <label className="grid gap-1 text-xs text-gf-muted">Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="min-h-10 rounded-lg border border-gf-line bg-gf-bar px-3 text-sm text-gf-ink" />
          </label>
          <button type="submit" className={btn} disabled={!password}>Turn on</button>
        </form>
      )}
      {status?.enabled && live && (
        <div className="mt-3 grid gap-2">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={frame}
              alt="This computer's screen"
              className="w-full touch-none select-none rounded-lg border border-gf-line"
              draggable={false}
              onPointerDown={e => {
                longPressed.current = false
                const p = pointAt(e.clientX, e.clientY)
                pressTimer.current = setTimeout(() => { longPressed.current = true; if (p) void send({ type: 'click', ...p, button: 'right' }) }, 550)
              }}
              onPointerUp={e => {
                clearTimeout(pressTimer.current)
                if (longPressed.current) return
                const p = pointAt(e.clientX, e.clientY)
                if (p) void send({ type: 'click', ...p, double: e.detail === 2 })
              }}
              onPointerLeave={() => clearTimeout(pressTimer.current)}
              onContextMenu={e => e.preventDefault()}
            />
          ) : <p className="text-sm text-gf-muted">Connecting…</p>}
          <p className="text-xs text-gf-muted">Tap to click · double-tap to double-click · press and hold to right-click.</p>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (text) void send({ type: 'text', text }); setText('') }}>
            <input value={text} onChange={e => setText(e.target.value)} placeholder="Type on the computer…" aria-label="Text to type" className="min-h-10 min-w-0 flex-1 rounded-lg border border-gf-line bg-gf-bar px-3 text-sm" />
            <button type="submit" className={btn}>Type</button>
          </form>
          <div className="flex flex-wrap gap-2">
            {['enter', 'backspace', 'tab', 'escape', 'up', 'down', 'left', 'right', 'ctrl+c', 'ctrl+v', 'alt+tab', 'win'].map(k => (
              <button key={k} type="button" className="min-h-9 rounded-md border border-gf-line px-2.5 text-xs hover:border-gf-accent" onClick={() => void send({ type: 'key', key: k })}>{k}</button>
            ))}
            <button type="button" className="min-h-9 rounded-md border border-gf-line px-2.5 text-xs hover:border-gf-accent" onClick={() => void send({ type: 'scroll', direction: 'up' })}>Scroll ↑</button>
            <button type="button" className="min-h-9 rounded-md border border-gf-line px-2.5 text-xs hover:border-gf-accent" onClick={() => void send({ type: 'scroll', direction: 'down' })}>Scroll ↓</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-gf-danger">{error}</p>}
    </section>
  )
}
