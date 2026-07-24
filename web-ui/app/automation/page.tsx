'use client'

import { useEffect, useState } from 'react'

interface Trigger {
  id: string
  source: string
  eventType: string
  action: string
}

interface WebhookLogEntry {
  source: string
  event: string
  prompt: string
  receivedAt?: string
}

const SOURCE_OPTIONS = ['GitHub', 'Slack', 'Custom'] as const
const EVENT_SUGGESTIONS: Record<(typeof SOURCE_OPTIONS)[number], string[]> = {
  GitHub: ['pull_request', 'push', 'workflow_run'],
  Slack: ['message_posted', 'reaction_added', 'mention'],
  Custom: ['build_complete', 'deployment_failed', 'ticket_created'],
}

export default function AutomationPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [logs, setLogs] = useState<WebhookLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('https://your-domain/api/webhook')
  const [form, setForm] = useState({
    source: 'GitHub',
    eventType: 'pull_request',
    action: 'Review the incoming pull request, summarise the change, and highlight risk areas.',
  })

  const loadData = async () => {
    setLoading(true)
    try {
      const [triggerRes, logRes] = await Promise.all([
        fetch('/api/webhook', { cache: 'no-store' }),
        fetch('/api/webhook?log=1', { cache: 'no-store' }),
      ])
      const [triggerData, logData] = await Promise.all([triggerRes.json(), logRes.json()])
      setTriggers(Array.isArray(triggerData) ? triggerData : [])
      setLogs(Array.isArray(logData) ? logData : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') setWebhookUrl(`${window.location.origin}/api/webhook`)
    void loadData()
  }, [])

  const persistTriggers = async (nextTriggers: Trigger[]) => {
    setSaving(true)
    try {
      const response = await fetch('/api/webhook?config=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextTriggers),
      })
      if (!response.ok) throw new Error('Failed to save triggers')
      setTriggers(nextTriggers)
    } finally {
      setSaving(false)
    }
  }

  const addTrigger = async () => {
    const action = form.action.trim()
    const eventType = form.eventType.trim()
    if (!action || !eventType) return

    const nextTriggers = [
      {
        id: `${Date.now()}`,
        source: form.source,
        eventType,
        action,
      },
      ...triggers,
    ]

    await persistTriggers(nextTriggers)
    setForm(current => ({
      ...current,
      action: '',
      eventType: EVENT_SUGGESTIONS[current.source as keyof typeof EVENT_SUGGESTIONS][0],
    }))
  }

  const removeTrigger = async (id: string) => {
    await persistTriggers(triggers.filter(trigger => trigger.id !== id))
  }

  const clearLog = async () => {
    await fetch('/api/webhook', { method: 'DELETE' })
    setLogs([])
  }

  const copyWebhookUrl = async () => {
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-6 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-400/70">Automation Layer</p>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Automation &amp; Webhooks</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                  Pipe GitHub, Slack, and custom system events into JARVIS so it can react, review, and brief the team without manual nudges.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 lg:max-w-xl">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Webhook endpoint</p>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="flex-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-cyan-300">
                  {webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyWebhookUrl()}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-medium text-cyan-300 transition hover:border-cyan-400/50 hover:bg-cyan-500/20"
                >
                  {copied ? 'Copied' : 'Copy URL'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-50">Configured triggers</h2>
                  <p className="mt-1 text-sm text-zinc-500">Source rules that save prompt templates for inbound automation events.</p>
                </div>
                <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">{triggers.length} active</span>
              </div>

              <div className="mt-5 space-y-3">
                {loading ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-5 text-sm text-zinc-500">Loading triggers…</div>
                ) : triggers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-8 text-sm text-zinc-500">
                    No triggers yet. Add one below to give JARVIS a webhook playbook.
                  </div>
                ) : (
                  triggers.map(trigger => (
                    <div key={trigger.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 uppercase tracking-[0.2em] text-zinc-300">{trigger.source}</span>
                            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-cyan-300">{trigger.eventType}</span>
                          </div>
                          <p className="text-sm leading-6 text-zinc-300">{trigger.action}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeTrigger(trigger.id)}
                          className="self-start rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-red-500/40 hover:text-red-300"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-50">Recent webhook events</h2>
                  <p className="mt-1 text-sm text-zinc-500">Latest payloads received and the JARVIS prompts they spawned.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void clearLog()}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:border-red-500/40 hover:text-red-300"
                >
                  Clear log
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {loading ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-5 text-sm text-zinc-500">Loading webhook activity…</div>
                ) : logs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-8 text-sm text-zinc-500">
                    Nothing received yet. Point GitHub, CI, or Slack here and events will appear live.
                  </div>
                ) : (
                  logs.map((entry, index) => (
                    <article key={`${entry.receivedAt || 'entry'}-${index}`} className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 uppercase tracking-[0.18em] text-zinc-300">{entry.source}</span>
                        <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-300">{entry.event}</span>
                        <span className="text-zinc-500">{entry.receivedAt ? new Date(entry.receivedAt).toLocaleString() : 'Unknown time'}</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{entry.prompt}</p>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400/70">Add Trigger</p>
              <h2 className="mt-2 text-lg font-semibold text-zinc-50">Define an automation reaction</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                Store a source, event type, and prompt template JARVIS should follow when that event arrives.
              </p>
            </div>

            <div className="mt-6 space-y-5">
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Source</span>
                <select
                  value={form.source}
                  onChange={event => {
                    const source = event.target.value as (typeof SOURCE_OPTIONS)[number]
                    setForm({
                      source,
                      eventType: EVENT_SUGGESTIONS[source][0],
                      action: form.action,
                    })
                  }}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
                >
                  {SOURCE_OPTIONS.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Event type</span>
                <input
                  list="automation-events"
                  value={form.eventType}
                  onChange={event => setForm(current => ({ ...current, eventType: event.target.value }))}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
                  placeholder="pull_request"
                />
                <datalist id="automation-events">
                  {EVENT_SUGGESTIONS[form.source as keyof typeof EVENT_SUGGESTIONS].map(option => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">Action / JARVIS prompt template</span>
                <textarea
                  value={form.action}
                  onChange={event => setForm(current => ({ ...current, action: event.target.value }))}
                  rows={8}
                  className="w-full rounded-[1.5rem] border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/50"
                  placeholder="Explain the deployment failure, identify the failing step, and suggest the fastest fix."
                />
              </label>

              <button
                type="button"
                onClick={() => void addTrigger()}
                disabled={saving}
                className="inline-flex items-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-300 transition hover:border-cyan-400/50 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Add Trigger'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
