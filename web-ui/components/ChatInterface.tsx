'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CommandPanel } from '@/components/CommandPanel'
import { MacStatus } from '@/components/MacStatus'
import { MessageBubble, type ChatMessage } from '@/components/MessageBubble'
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    void fetch('/api/auth').then(response => {
      if (!response.ok) {
        router.push('/login')
      }
    })
  }, [router])

  useEffect(() => {
    const checkBridge = () => {
      void fetch('/api/bridge-status').then(async res => {
        const data = (await res.json()) as { status?: string }
        if (data.status === 'connected') setBridgeStatus('connected')
        else if (data.status === 'unconfigured') setBridgeStatus('unknown')
        else setBridgeStatus('disconnected')
      }).catch(() => setBridgeStatus('disconnected'))
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

      const data = (await response.json()) as { message?: string; error?: string }
      const reply = data.message || data.error || 'No response'

      setMessages(previous => [...previous, { role: 'assistant', content: reply, timestamp: new Date() }])

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
            <button
              type="button"
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

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message, index) => (
          <MessageBubble key={`${message.role}-${index}-${message.timestamp.toISOString()}`} message={message} onRunCommand={executeCommand} />
        ))}

        {loading ? (
          <div className="flex justify-start">
            <div className="rounded-[22px] border border-gray-800 bg-gray-900/90 px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:120ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:240ms]" />
              </div>
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ask GhostForge anything..."
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            className="flex-1 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-sky-500"
          />
          <button
            type="button"
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
