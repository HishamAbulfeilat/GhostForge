'use client'

import { memo, useEffect, useRef } from 'react'
import ToolCard from './ToolCard'
import type { Message } from './types'

/**
 * Chat transcript. Memoised so typing in the input box or other page state
 * changes don't re-render every message.
 */
function MessageList({ messages, ringColor }: { messages: Message[]; ringColor: string }) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mc = { ring: ringColor }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="gfai-scroll flex-1 w-full max-w-2xl overflow-y-auto px-4 py-3 space-y-2">
      {messages.map(m => {
        const borderColor = m.role === 'user' ? '#1a6fff' : (m.emotion === 'alert' ? '#ff4444' : mc.ring)
        return (
          <div key={m.id}
            className={`gfai-fade rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'gfai-msg-user ms-8' : 'gfai-msg-ai me-8'}`}
            style={{ borderLeftColor: borderColor }}>
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="font-mono text-[10px] opacity-60" style={{ color: borderColor }}>
                {m.role === 'user' ? 'YOU' : 'G.F.A.I.'}
              </span>
              {m.tool && (
                <span className="font-mono text-[9px] rounded px-1 py-0.5"
                  style={{ background: `${mc.ring}22`, color: mc.ring }}>
                  ⚙ {m.tool.replace(/_/g, ' ')}
                </span>
              )}
              {m.domain && m.domain !== 'general' && m.role === 'ai' && (
                <span className="font-mono text-[9px] rounded px-1 py-0.5 uppercase tracking-wide"
                  style={{ background: 'rgba(170,68,255,0.12)', color: 'rgba(170,68,255,0.8)', border: '1px solid rgba(170,68,255,0.2)' }}>
                  {m.domain}
                </span>
              )}
              {m.confidence !== undefined && m.role === 'ai' && (
                <span className="flex items-center gap-1" title={`Confidence: ${m.confidence}%`}>
                  <span className="font-mono text-[9px]" style={{ color: m.confidence >= 80 ? '#00ff88' : m.confidence >= 50 ? '#ffaa00' : '#ff4444' }}>
                    {m.confidence}%
                  </span>
                  <span className="h-1 w-12 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <span className="h-full block rounded-full transition-[width]" style={{
                      width: `${m.confidence}%`,
                      background: m.confidence >= 80 ? '#00ff88' : m.confidence >= 50 ? '#ffaa00' : '#ff4444',
                    }} />
                  </span>
                </span>
              )}
            </div>
            <p className="text-gray-100 leading-relaxed">{m.text}</p>
            {m.tool && m.toolResult && m.toolResult !== 'Done' && (
              <ToolCard tool={m.tool} result={m.toolResult} ringColor={mc.ring} />
            )}
          </div>
        )
      })}
      <div ref={messagesEndRef} />
    </div>
  )
}

export default memo(MessageList)
