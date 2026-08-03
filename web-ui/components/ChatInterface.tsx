'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CommandPanel } from '@/components/CommandPanel'
import { MacStatus } from '@/components/MacStatus'
import { MessageBubble, type ChatMessage } from '@/components/MessageBubble'
import { safeGetJSON, safeRemove, safeSet } from '@/lib/storage'
import type { BridgeStatus } from '@/lib/ws-client'

const QUICK_COMMANDS = [
  { label: '🌿 Carbon', cmd: 'ghostforge carbon status' },
  { label: '🏥 Health', cmd: 'ghostforge health-score score' },
  { label: '🗣️ Standup', cmd: 'ghostforge standup today' },
  { label: '🔍 Review', cmd: 'ghostforge ai-review staged' },
  { label: '📦 Bundle', cmd: 'ghostforge bundle track' },
  { label: '🩺 Deps', cmd: 'ghostforge dep-health check' },
]

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: '👻 GhostForge online. Operator-grade dev tools at your command. Ask me anything or run a command on your Mac.',
  timestamp: new Date(),
}

function parseSuggestedCommand(reply: string) {
  const match = reply.match(/\[RUN\]:\s*(.+)/)
  return match?.[1]?.trim() || null
}

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('unknown')
  const [copilotMode, setCopilotMode] = useState<'off' | 'suggest' | 'explain'>('off')
  const [listening, setListening] = useState(false)
  const [hasVoice, setHasVoice] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const prevBridgeStatus = useRef<BridgeStatus>('unknown')
  const router = useRouter()

  // ── Load chat history from localStorage ─────────────────────────────────
  useEffect(() => {
    // Support both old and new key for migration
    const saved =
      safeGetJSON<Array<{ role: string; content: string; timestamp: string }> | null>('gf_chat_history:v1', null) ??
      safeGetJSON<Array<{ role: string; content: string; timestamp: string }> | null>('gf_chat_history', null)
    if (saved && saved.length > 0) {
      setMessages(saved.map(m => ({ ...m, timestamp: new Date(m.timestamp) })) as ChatMessage[])
    }
  }, [])

  // ── Persist messages to localStorage ─────────────────────────────────────
  useEffect(() => {
    safeSet('gf_chat_history:v1', JSON.stringify(
      messages.slice(-100).map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
    ))
  }, [messages])

  // ── Request notification permission ──────────────────────────────────────
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  // ── Voice input setup ─────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SpeechRec = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (SpeechRec) {
      setHasVoice(true)
      const rec = new SpeechRec()
      rec.continuous = false
      rec.interimResults = true
      rec.lang = 'en-US'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('')
        setInput(transcript)
      }
      rec.onend = () => setListening(false)
      rec.onerror = () => setListening(false)
      recognitionRef.current = rec
    }
    return () => { recognitionRef.current?.abort() }
  }, [])

  const toggleVoice = () => {
    const rec = recognitionRef.current
    if (!rec) return
    if (listening) { rec.stop(); setListening(false) }
    else { rec.start(); setListening(true) }
  }

  const clearHistory = () => {
    setMessages([INITIAL_MESSAGE])
    safeRemove('gf_chat_history:v1')
    safeRemove('gf_chat_history')
  }

  const sendNotification = (title: string, body: string) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(title, { body, icon: '/favicon.ico' }) } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const checkBridge = () => {
      void fetch('/api/bridge-status').then(async res => {
        const data = (await res.json()) as { status?: string }
        const next: BridgeStatus = data.status === 'connected' ? 'connected'
          : data.status === 'unconfigured' ? 'unknown'
          : 'disconnected'
        // Notify if bridge just went offline
        if (prevBridgeStatus.current === 'connected' && next === 'disconnected') {
          sendNotification('🔴 GhostForge Bridge Offline', 'Run: bash ~/GhostForge/scripts/bridge.sh start')
        }
        prevBridgeStatus.current = next
        setBridgeStatus(next)
      }).catch(() => {
        if (prevBridgeStatus.current === 'connected') {
          sendNotification('🔴 GhostForge Bridge Offline', 'Bridge connection lost')
        }
        prevBridgeStatus.current = 'disconnected'
        setBridgeStatus('disconnected')
      })
    }
    checkBridge()
    const interval = setInterval(checkBridge, 15000)
    return () => clearInterval(interval)
  }, [])

  const payloadMessages = useMemo(
    () => messages.map(message => ({ role: message.role, content: message.content })),
    [messages],
  )

  const sendMessage = async (text?: string) => {
    const content = (text || input).trim()
    if (!content || loading) {
      return
    }

    const userMessage: ChatMessage = { role: 'user', content, timestamp: new Date() }
    const nextMessages = [...messages, userMessage]

    setInput('')
    setLoading(true)
    setMessages(nextMessages)

    // Copilot CLI mode — route to Mac bridge /copilot
    if (copilotMode !== 'off') {
      try {
        const response = await fetch('/api/copilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: content, mode: copilotMode }),
        })
        if (response.status === 401) { router.push('/login'); return }
        const data = (await response.json()) as { output?: string; error?: string; connected?: boolean }
        const reply = data.connected === false
          ? `🔌 ${data.error}`
          : `\`\`\`\n${data.output || 'No output'}\n\`\`\``
        setMessages(previous => [...previous, { role: 'assistant', content: reply, timestamp: new Date() }])
      } catch {
        setMessages(previous => [...previous, { role: 'assistant', content: '❌ Error reaching bridge', timestamp: new Date() }])
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...payloadMessages, { role: userMessage.role, content: userMessage.content }] }),
      })

      if (response.status === 401) {
        router.push('/login')
        return
      }

      const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string }

      if (!response.ok) {
        const errText = data.error || 'Unknown error'
        setMessages(previous => [...previous, { role: 'assistant', content: `❌ ${errText}`, timestamp: new Date() }])
        setLoading(false)
        return
      }

      const reply = data.reply || data.error || 'No response'
      setMessages(previous => [...previous, { role: 'assistant', content: reply, timestamp: new Date() }])
      setLoading(false)

      // Detect [RUN]: commands and show execute button after a short delay
      const command = parseSuggestedCommand(reply)
      if (command) {
        window.setTimeout(() => {
          setMessages(previous => [
            ...previous,
            {
              role: 'assistant',
              content: `💻 Run on your Mac: \`${command}\`\n\nTap the button below to execute via bridge:||RUN||${command}`,
              timestamp: new Date(),
            },
          ])
        }, 400)
      }
    } catch {
      setMessages(previous => [
        ...previous,
        { role: 'assistant', content: '❌ Error connecting to server', timestamp: new Date() },
      ])
    } finally {
      setLoading(false)
    }
  }

  const executeCommand = async (command: string) => {
    setMessages(previous => [
      ...previous,
      { role: 'assistant', content: `⚡ Executing: \`${command}\`...`, timestamp: new Date() },
    ])

    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      const data = (await response.json()) as { output?: string; error?: string; connected?: boolean }

      if (response.status === 401) {
        router.push('/login')
        return
      }

      if (data.connected === false) {
        setBridgeStatus('disconnected')
        setMessages(previous => [
          ...previous,
          {
            role: 'assistant',
            content: '🔌 Mac bridge not connected.\n\nStart it on your Mac:\n```\nbash ~/ghostforge/scripts/bridge.sh start\n```',
            timestamp: new Date(),
          },
        ])
        return
      }

      setBridgeStatus('connected')
      setMessages(previous => [
        ...previous,
        {
          role: 'assistant',
          content: `✅ Output:\n\`\`\`\n${data.output || data.error || 'No output'}\n\`\`\``,
          timestamp: new Date(),
        },
      ])
    } catch {
      setBridgeStatus('disconnected')
      setMessages(previous => [
        ...previous,
        { role: 'assistant', content: '❌ Failed to reach bridge', timestamp: new Date() },
      ])
    }
  }

  return (
    <div className="mx-auto flex h-screen max-w-2xl flex-col overflow-hidden bg-gray-950/80 bg-grid bg-[size:22px_22px]">
      <div className="border-b border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔫</span>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-[0.24em] text-white">GhostForge</h1>
              <p className="text-xs text-gray-400">Operator console · mobile access</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MacStatus status={bridgeStatus} />
            <button type="button"
              title="Toggle Copilot CLI mode (tap to cycle: GhostForge AI → Copilot Suggest → Copilot Explain)"
              onClick={() => setCopilotMode(m => m === 'off' ? 'suggest' : m === 'suggest' ? 'explain' : 'off')}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                copilotMode === 'off'
                  ? 'border-gray-700 text-gray-500 hover:text-gray-300'
                  : copilotMode === 'suggest'
                  ? 'border-sky-600 bg-sky-950 text-sky-400'
                  : 'border-purple-600 bg-purple-950 text-purple-400'
              }`}
            >
              {copilotMode === 'off' ? '🤖 GF AI' : copilotMode === 'suggest' ? '🐙 Suggest' : '🐙 Explain'}
            </button>
            <button type="button"
              onClick={() => setSearchOpen(o => !o)}
              title="Search chat history"
              className={`text-xs transition ${searchOpen ? 'text-sky-400' : 'text-gray-600 hover:text-sky-400'}`}
            >
              🔍
            </button>
            <button type="button"
              onClick={clearHistory}
              title="Clear chat history"
              className="text-xs text-gray-600 transition hover:text-red-400"
            >
              🗑️
            </button>
            <Link href="/terminal" className="text-xs text-gray-400 transition hover:text-emerald-400" title="Open TUI Terminal">
              💻
            </Link>
            <Link href="/dashboard" className="text-xs text-gray-400 transition hover:text-white">
              ⚙️
            </Link>
          </div>
        </div>
      </div>

      <CommandPanel commands={QUICK_COMMANDS} onSelect={command => void sendMessage(command)} />

      {/* ── Chat History Search ─────────────────────────────────────────── */}
      {searchOpen && (
        <div className="border-b border-gray-800 bg-gray-900/80 px-4 py-3">
          <input
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search messages…"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-sky-600"
          />
          {searchQuery.trim() && (() => {
            const q = searchQuery.toLowerCase()
            const hits = messages.filter(m => m.content.toLowerCase().includes(q))
            return hits.length > 0 ? (
              <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                {hits.map((m) => (
                  <div key={`${m.role}-${m.timestamp.toISOString()}`} className={`rounded-lg px-3 py-2 text-xs ${m.role === 'user' ? 'bg-sky-950/60 text-sky-200' : 'bg-gray-800/60 text-gray-300'}`}>
                    <span className="font-semibold opacity-60">{m.role === 'user' ? 'You' : 'AI'}</span>
                    {' · '}
                    <span>{m.content.substring(0, 120)}{m.content.length > 120 ? '…' : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-500">No messages match &quot;{searchQuery}&quot;</p>
            )
          })()}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message, index) => (
          <MessageBubble key={`${message.role}-${index}-${message.timestamp.toISOString()}`} message={message} onRunCommand={executeCommand} />
        ))}

        {loading ? (
          <div className="flex justify-start">
            <div className="rounded-[22px] border border-gray-800 bg-gray-900/90 px-4 py-3">
              <div className="flex gap-1 items-center py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:200ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:400ms]" />
              </div>
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          {hasVoice && (
            <button type="button"
              onClick={toggleVoice}
              title={listening ? 'Stop listening' : 'Voice input'}
              className={`rounded-2xl px-3 py-3 text-sm transition ${listening ? 'animate-pulse bg-red-600 text-white' : 'border border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}`}
            >
              🎤
            </button>
          )}
          <input
            type="text"
            placeholder={listening ? 'Listening...' : 'Ask GhostForge anything...'}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            className={`flex-1 rounded-2xl border bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-sky-500 ${listening ? 'border-red-600' : 'border-gray-700'}`}
          />
          <button type="button"
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            className="rounded-2xl bg-sky-600 px-4 py-3 text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-700"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
