'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Wrench } from 'lucide-react'
import { coerceParam, paramWidget } from '@/lib/mark-liv-tool-params'

interface MarkLivToolsPanelProps {
  ringColor?: string
}

interface ToolParam {
  type?: string
  description?: string
  enum?: string[]
}

interface MarkLivTool {
  name: string
  description: string
  parameters?: { properties?: Record<string, ToolParam>; required?: string[] }
}

type Tab = 'weather' | 'flight' | 'reminder' | 'tools'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'weather', label: 'Weather' },
  { id: 'flight', label: 'Flights' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'tools', label: 'Tools' },
]

interface Outcome {
  kind: 'result' | 'error' | 'confirm'
  text: string
}

/**
 * Web panel for the Mark-LV bridge: weather, flight finder, reminders and a
 * runner for every Mark-LV tool. Talks only to the authenticated
 * /api/mark-liv-tools proxy — the bridge token never reaches the browser.
 */
export default function MarkLivToolsPanel({ ringColor = '#1a6fff' }: MarkLivToolsPanelProps) {
  const uid = useId()
  const [tab, setTab] = useState<Tab>('weather')
  const [online, setOnline] = useState<boolean | null>(null)
  const [tools, setTools] = useState<MarkLivTool[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const pendingRun = useRef<Record<string, unknown> | null>(null)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ weather: null, flight: null, reminder: null, tools: null })

  const [city, setCity] = useState('')
  const [flight, setFlight] = useState({ from_city: '', to_city: '', date: '', return_date: '', passengers: '1', cabin: 'economy' })
  const [reminder, setReminder] = useState({ date: '', time: '', message: '' })
  const [toolName, setToolName] = useState('')
  const [toolParams, setToolParams] = useState<Record<string, string>>({})

  const loadTools = useCallback(async () => {
    setOnline(null)
    setListError(null)
    try {
      const res = await fetch('/api/mark-liv-tools')
      const data = await res.json().catch(() => ({})) as { online?: boolean; tools?: MarkLivTool[]; error?: string }
      if (!res.ok) {
        setOnline(false)
        setListError(data.error || `Request failed (${res.status})`)
        return
      }
      setOnline(Boolean(data.online))
      setTools(data.tools ?? [])
      if (data.error) setListError(data.error)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => { void loadTools() }, [loadTools])

  const selectedTool = useMemo(() => tools.find(t => t.name === toolName), [tools, toolName])

  const submit = useCallback(async (payload: Record<string, unknown>) => {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    try {
      const res = await fetch('/api/mark-liv-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({})) as { result?: string; error?: string; confirm?: string; offline?: boolean }
      if (res.status === 409 && data.confirm) {
        pendingRun.current = payload
        setOutcome({ kind: 'confirm', text: data.confirm })
      } else if (!res.ok) {
        if (data.offline) setOnline(false)
        setOutcome({ kind: 'error', text: data.error || `Request failed (${res.status})` })
      } else {
        setOutcome({ kind: 'result', text: data.result ?? 'Done.' })
      }
    } catch {
      setOutcome({ kind: 'error', text: 'Network error reaching the bridge.' })
    } finally {
      setBusy(false)
    }
  }, [busy])

  const confirmPending = useCallback(() => {
    const payload = pendingRun.current
    pendingRun.current = null
    if (payload) void submit({ ...payload, confirm: true })
  }, [submit])

  const cancelPending = useCallback(() => {
    pendingRun.current = null
    setOutcome(null)
  }, [])

  const onTabKey = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = TABS.findIndex(t => t.id === tab)
    let next = idx
    // In RTL the visual order flips, so ArrowLeft/Right follow the reading direction.
    const rtl = typeof document !== 'undefined' && document.dir === 'rtl'
    if (e.key === 'ArrowRight') next = rtl ? idx - 1 : idx + 1
    else if (e.key === 'ArrowLeft') next = rtl ? idx + 1 : idx - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    const target = TABS[(next + TABS.length) % TABS.length].id
    setTab(target)
    tabRefs.current[target]?.focus()
  }, [tab])

  const onWeather = (e: FormEvent) => { e.preventDefault(); void submit({ kind: 'weather', city }) }
  const onFlight = (e: FormEvent) => { e.preventDefault(); void submit({ kind: 'flight', ...flight, passengers: Number(flight.passengers) }) }
  const onReminder = (e: FormEvent) => { e.preventDefault(); void submit({ kind: 'reminder', ...reminder }) }
  const onRun = (e: FormEvent) => {
    e.preventDefault()
    if (!selectedTool) return
    const props = selectedTool.parameters?.properties ?? {}
    const parameters: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(toolParams)) {
      if (value.trim() !== '' && key in props) parameters[key] = coerceParam(value.trim(), props[key].type)
    }
    void submit({ kind: 'run', name: selectedTool.name, parameters })
  }

  const offline = online === false
  const inputClass = 'w-full rounded border bg-transparent px-2 py-1 text-[10px] text-gray-200 placeholder-gray-600 focus:outline-none focus-visible:ring-1 disabled:opacity-40'
  const labelClass = 'mb-0.5 block text-[9px] tracking-wide text-gray-400'
  const buttonClass = 'rounded border px-2 py-1 text-[9px] transition disabled:opacity-30 focus:outline-none focus-visible:ring-1'
  const inputStyle = { borderColor: `${ringColor}33` }
  const buttonStyle = { borderColor: `${ringColor}33`, color: `${ringColor}cc`, background: `${ringColor}08` }
  const fid = (name: string) => `${uid}-${name}`

  return (
    <section className="flex flex-col gap-3 font-mono text-[10px]" aria-labelledby={fid('title')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench size={11} aria-hidden="true" style={{ color: ringColor, opacity: 0.8 }} />
          <h2 id={fid('title')} className="text-[11px] tracking-widest" style={{ color: ringColor }}>MARK-LV TOOLS</h2>
        </div>
        <span
          role="status"
          className="rounded px-1.5 py-0.5 text-[9px]"
          style={{
            background: online ? '#00ff8818' : `${ringColor}18`,
            color: online ? '#00ff88' : `${ringColor}99`,
          }}
        >
          {online === null ? 'CHECKING…' : online ? 'BRIDGE ONLINE' : 'BRIDGE OFFLINE'}
        </span>
      </div>

      {offline && (
        <div className="flex items-start justify-between gap-2 rounded border p-2" style={{ borderColor: `${ringColor}22` }}>
          <p className="text-[9px] leading-snug" style={{ color: `${ringColor}99` }}>
            The Mark-LV bridge is not running. Start it with <code>scripts/mark-liv.sh start</code>; actions will also try to start it.
          </p>
          <button type="button" onClick={() => void loadTools()} className={buttonClass} style={buttonStyle}>
            RETRY
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Mark-LV tool groups" className="flex flex-wrap gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[t.id] = el }}
            type="button"
            role="tab"
            id={fid(`tab-${t.id}`)}
            aria-selected={tab === t.id}
            aria-controls={fid(`panel-${t.id}`)}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={onTabKey}
            className="rounded border px-2 py-1 text-[9px] transition focus:outline-none focus-visible:ring-1"
            style={{
              borderColor: tab === t.id ? ringColor : `${ringColor}22`,
              color: tab === t.id ? ringColor : `${ringColor}88`,
              background: tab === t.id ? `${ringColor}12` : 'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={fid(`panel-${tab}`)} aria-labelledby={fid(`tab-${tab}`)} tabIndex={0} className="focus:outline-none">
        {tab === 'weather' && (
          <form onSubmit={onWeather} className="flex flex-col gap-2">
            <div>
              <label htmlFor={fid('city')} className={labelClass}>City</label>
              <input id={fid('city')} value={city} onChange={e => setCity(e.target.value)} required maxLength={100}
                placeholder="e.g. Riyadh" className={inputClass} style={inputStyle} />
            </div>
            <button type="submit" disabled={busy || !city.trim()} className={buttonClass} style={buttonStyle}>
              {busy ? 'WORKING…' : 'GET WEATHER'}
            </button>
          </form>
        )}

        {tab === 'flight' && (
          <form onSubmit={onFlight} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={fid('from')} className={labelClass}>From</label>
                <input id={fid('from')} value={flight.from_city} required maxLength={100}
                  onChange={e => setFlight(f => ({ ...f, from_city: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={fid('to')} className={labelClass}>To</label>
                <input id={fid('to')} value={flight.to_city} required maxLength={100}
                  onChange={e => setFlight(f => ({ ...f, to_city: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={fid('date')} className={labelClass}>Depart</label>
                <input id={fid('date')} type="date" value={flight.date}
                  onChange={e => setFlight(f => ({ ...f, date: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={fid('return')} className={labelClass}>Return (optional)</label>
                <input id={fid('return')} type="date" value={flight.return_date}
                  onChange={e => setFlight(f => ({ ...f, return_date: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={fid('pax')} className={labelClass}>Passengers</label>
                <input id={fid('pax')} type="number" min={1} max={9} value={flight.passengers}
                  onChange={e => setFlight(f => ({ ...f, passengers: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={fid('cabin')} className={labelClass}>Cabin</label>
                <select id={fid('cabin')} value={flight.cabin}
                  onChange={e => setFlight(f => ({ ...f, cabin: e.target.value }))} className={`${inputClass} bg-black`} style={inputStyle}>
                  <option value="economy">Economy</option>
                  <option value="premium">Premium economy</option>
                  <option value="business">Business</option>
                  <option value="first">First</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={busy || !flight.from_city.trim() || !flight.to_city.trim()} className={buttonClass} style={buttonStyle}>
              {busy ? 'WORKING…' : 'FIND FLIGHTS'}
            </button>
          </form>
        )}

        {tab === 'reminder' && (
          <form onSubmit={onReminder} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={fid('r-date')} className={labelClass}>Date</label>
                <input id={fid('r-date')} type="date" value={reminder.date} required
                  onChange={e => setReminder(r => ({ ...r, date: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label htmlFor={fid('r-time')} className={labelClass}>Time</label>
                <input id={fid('r-time')} type="time" value={reminder.time} required
                  onChange={e => setReminder(r => ({ ...r, time: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
            </div>
            <div>
              <label htmlFor={fid('r-msg')} className={labelClass}>Message</label>
              <input id={fid('r-msg')} value={reminder.message} required maxLength={500}
                onChange={e => setReminder(r => ({ ...r, message: e.target.value }))} className={inputClass} style={inputStyle} />
            </div>
            <button type="submit" disabled={busy || !reminder.date || !reminder.time || !reminder.message.trim()} className={buttonClass} style={buttonStyle}>
              {busy ? 'WORKING…' : 'SET REMINDER'}
            </button>
          </form>
        )}

        {tab === 'tools' && (
          <form onSubmit={onRun} className="flex flex-col gap-2">
            {listError && <p className="text-[9px] text-red-400/80">{listError}</p>}
            <div>
              <label htmlFor={fid('tool')} className={labelClass}>Tool ({tools.length})</label>
              <select id={fid('tool')} value={toolName} disabled={offline || tools.length === 0}
                onChange={e => { setToolName(e.target.value); setToolParams({}) }}
                className={`${inputClass} bg-black`} style={inputStyle}>
                <option value="">{offline ? 'Bridge offline' : tools.length ? 'Choose a tool…' : 'No tools found'}</option>
                {tools.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            {selectedTool && (
              <>
                <p id={fid('tool-desc')} className="text-[9px] leading-snug text-gray-400">{selectedTool.description}</p>
                {Object.entries(selectedTool.parameters?.properties ?? {}).map(([key, param]) => {
                  const required = selectedTool.parameters?.required?.includes(key) ?? false
                  const id = fid(`param-${key}`)
                  const widget = paramWidget(param)
                  return (
                    <div key={key}>
                      <label htmlFor={id} className={labelClass}>
                        {key}{required ? ' *' : ''}{param.type ? ` (${param.type.toLowerCase()})` : ''}
                      </label>
                      {widget === 'enum' ? (
                        <select id={id} value={toolParams[key] ?? ''} required={required}
                          onChange={e => setToolParams(p => ({ ...p, [key]: e.target.value }))}
                          className={`${inputClass} bg-black`} style={inputStyle}>
                          <option value="">—</option>
                          {(param.enum ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : widget === 'boolean' ? (
                        <select id={id} value={toolParams[key] ?? ''} required={required}
                          onChange={e => setToolParams(p => ({ ...p, [key]: e.target.value }))}
                          className={`${inputClass} bg-black`} style={inputStyle}>
                          <option value="">—</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input id={id} value={toolParams[key] ?? ''} required={required}
                          type={widget === 'number' ? 'number' : 'text'}
                          placeholder={param.description?.slice(0, 80)}
                          onChange={e => setToolParams(p => ({ ...p, [key]: e.target.value }))}
                          className={inputClass} style={inputStyle} />
                      )}
                    </div>
                  )
                })}
              </>
            )}
            <button type="submit" disabled={busy || offline || !selectedTool} className={buttonClass} style={buttonStyle}
              aria-describedby={selectedTool ? fid('tool-desc') : undefined}>
              {busy ? 'RUNNING…' : 'RUN TOOL'}
            </button>
          </form>
        )}
      </div>

      {/* Results are announced to screen readers as they arrive. */}
      <div aria-live="polite" aria-atomic="true" aria-busy={busy}>
        {outcome?.kind === 'error' && (
          <p role="alert" className="text-[9px] text-red-400/80">{outcome.text}</p>
        )}
        {outcome?.kind === 'confirm' && (
          <div className="flex flex-col gap-2 rounded border p-2" style={{ borderColor: '#ffaa0055' }}>
            <p className="text-[9px] text-amber-300">Confirm: {outcome.text}. Run it?</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={confirmPending} disabled={busy} className={buttonClass} style={buttonStyle}>CONFIRM</button>
              <button type="button" onClick={cancelPending} disabled={busy} className={buttonClass} style={buttonStyle}>CANCEL</button>
            </div>
          </div>
        )}
        {outcome?.kind === 'result' && (
          <div
            className="rounded border p-2 text-start text-[10px] leading-relaxed text-gray-300 whitespace-pre-wrap break-words"
            style={{ borderColor: `${ringColor}22`, background: `${ringColor}08` }}
          >
            {outcome.text}
          </div>
        )}
      </div>
    </section>
  )
}
