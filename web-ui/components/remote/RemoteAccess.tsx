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

/** Copy text on any browser: the Clipboard API exists only on https/localhost pages, so plain-http LAN addresses fall back to a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall back */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length) // iOS Safari ignores select() alone
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
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
  const [copied, setCopied] = useState('')
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

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
                  <button type="button" className="shrink-0 rounded border border-gf-line px-2 py-1 text-xs hover:border-gf-accent" onClick={async () => setCopied(await copyText(l) ? l : `!${l}`)}>
                    {copied === l ? 'Copied' : 'Copy'}
                  </button>
                  {canShare && (
                    <button type="button" className="shrink-0 rounded border border-gf-line px-2 py-1 text-xs hover:border-gf-accent" onClick={() => void navigator.share({ title: 'GhostForge pairing link', url: l }).catch(() => {})}>Share</button>
                  )}
                </li>
              ))}
            </ul>
            {copied.startsWith('!') && (
              <p className="mt-2 text-xs text-gf-warn">This browser blocked copying. Long-press or select the link below to copy it:
                <input readOnly value={copied.slice(1)} onFocus={e => e.currentTarget.select()} aria-label="Pairing link" className="mt-1 block w-full rounded bg-gf-bar px-2 py-1 font-mono text-xs" />
              </p>
            )}
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
  const screenRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const clickTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)
  const down = useRef<{ x: number; y: number } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

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
          void load() // it may have switched itself off after being idle
          return
        }
      }
      setTimeout(() => void next(), 450)
    }
    void next()
    return () => { stopped = true; if (url) URL.revokeObjectURL(url) }
  }, [live, status?.enabled, load])

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
    if (!r || !r.width || !r.height) return null
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height }
  }

  // Mouse wheel / trackpad scroll over the screen scrolls the computer, not this page.
  // A native non-passive listener is needed to preventDefault (React's onWheel is passive).
  const sendRef = useRef(send)
  sendRef.current = send
  const hasFrame = Boolean(frame)
  // Bring the screen to the middle of the viewport when it first appears (bottom bars and banners cover the edges on small phones).
  useEffect(() => {
    if (hasFrame) screenRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [hasFrame])
  useEffect(() => {
    const el = screenRef.current
    if (!el || !hasFrame) return
    let acc = 0
    let last = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      acc += e.deltaY
      const now = Date.now()
      if (Math.abs(acc) < 60 || now - last < 120) return
      last = now
      void sendRef.current({ type: 'scroll', direction: acc > 0 ? 'down' : 'up', amount: Math.min(10, Math.max(1, Math.round(Math.abs(acc) / 100))) })
      acc = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasFrame])

  /** Tap/click with our own double-click detection (PointerEvent.detail is 0 in Chrome/Android). */
  const tap = (p: { x: number; y: number }) => {
    const now = Date.now()
    const prev = lastTap.current
    if (prev && now - prev.t < 350 && Math.abs(prev.x - p.x) < 0.03 && Math.abs(prev.y - p.y) < 0.03) {
      clearTimeout(clickTimer.current)
      lastTap.current = null
      void send({ type: 'click', ...prev, double: true })
      return
    }
    lastTap.current = { t: now, ...p }
    clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { lastTap.current = null; void send({ type: 'click', ...p }) }, 350)
  }

  /** Keys typed while the screen has focus (desktop browsers, or a phone's hardware keyboard). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    const named: Record<string, string> = {
      Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'escape', Delete: 'delete', Home: 'home', End: 'end',
      PageUp: 'pageup', PageDown: 'pagedown', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ' ': 'space',
    }
    const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.metaKey && 'cmd', e.shiftKey && 'shift'].filter(Boolean) as string[]
    let key = named[e.key] || (/^F([1-9]|1[0-2])$/.test(e.key) ? e.key.toLowerCase() : '')
    if (!key && e.key.length === 1) {
      // Plain characters (any language/layout) are typed as text; shortcuts are sent as key combos.
      if (!e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); void send({ type: 'text', text: e.key }); return }
      // Non-Latin layouts: ctrl+ф is still ctrl+a on the physical key
      key = /^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : (e.code.match(/^(?:Key([A-Z])|Digit(\d))$/)?.slice(1).find(Boolean) || '').toLowerCase()
    }
    if (!key || ['Control', 'Alt', 'Meta', 'Shift'].includes(e.key)) return
    e.preventDefault()
    const combo = [...mods.filter(m => !(m === 'shift' && key === 'space' && mods.length === 1)), key].join('+')
    void send({ type: 'key', key: combo })
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
          <p className="w-full text-sm text-gf-muted">Off. Turning it on lets your signed-in devices see this screen and use the mouse and keyboard. Enter your password to confirm. It turns itself off after 20 minutes without use.</p>
          <label className="grid gap-1 text-xs text-gf-muted">Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="min-h-10 rounded-lg border border-gf-line bg-gf-bar px-3 text-sm text-gf-ink" />
          </label>
          <button type="submit" className={btn} disabled={!password}>Turn on</button>
        </form>
      )}
      {status?.enabled && live && (
        <div className="mt-3 grid gap-2">
          {frame ? (
            <div
              ref={screenRef}
              tabIndex={0}
              role="application"
              aria-label="Remote screen. Click or tap to click; type to send keys."
              onKeyDown={onKeyDown}
              className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-gf-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={frame}
                alt="This computer's screen"
                // touch-action: manipulation keeps page scrolling and pinch-zoom on phones but drops the tap delay
                className="block w-full touch-manipulation select-none rounded-lg border border-gf-line"
                style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                draggable={false}
                onPointerDown={e => {
                  screenRef.current?.focus({ preventScroll: true })
                  down.current = { x: e.clientX, y: e.clientY }
                  longPressed.current = false
                  const p = pointAt(e.clientX, e.clientY)
                  if (e.pointerType === 'mouse') {
                    if (e.button === 2 && p) { longPressed.current = true; void send({ type: 'click', ...p, button: 'right' }) }
                    return
                  }
                  pressTimer.current = setTimeout(() => { longPressed.current = true; if (p) void send({ type: 'click', ...p, button: 'right' }) }, 550)
                }}
                onPointerMove={e => {
                  // A finger that moves is scrolling or zooming the page, not pressing
                  const d = down.current
                  if (d && e.pointerType !== 'mouse' && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) { clearTimeout(pressTimer.current); down.current = null }
                }}
                onPointerUp={e => {
                  clearTimeout(pressTimer.current)
                  const started = down.current
                  down.current = null
                  if (longPressed.current || !started || (e.pointerType === 'mouse' && e.button !== 0)) return
                  const p = pointAt(e.clientX, e.clientY)
                  if (p) tap(p)
                }}
                onPointerCancel={() => { clearTimeout(pressTimer.current); down.current = null }}
                onPointerLeave={() => clearTimeout(pressTimer.current)}
                onContextMenu={e => e.preventDefault()}
              />
            </div>
          ) : <p className="text-sm text-gf-muted">Connecting…</p>}
          <p className="text-xs text-gf-muted">Phone: tap to click · double-tap to double-click · press and hold to right-click · pinch to zoom. Computer: click, right-click and scroll with the mouse, and type straight into the screen after clicking it.</p>
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
