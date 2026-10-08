'use client'

import { useState } from 'react'

// ── Tool result card ──────────────────────────────────────────────────────────

export default function ToolCard({ tool, result, ringColor }: { tool: string; result: string; ringColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = result.length > 120
  const display = isLong && !expanded ? result.slice(0, 120) + '…' : result
  return (
    <div className="mt-1.5 rounded border text-[10px] font-mono"
      style={{ borderColor: `${ringColor}33`, background: `${ringColor}08` }}>
      <div className="flex items-center justify-between px-2 py-1 border-b"
        style={{ borderColor: `${ringColor}22` }}>
        <span style={{ color: ringColor }}>⚡ {tool.replace(/_/g, ' ').toUpperCase()}</span>
        {isLong && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            className="text-blue-400/50 hover:text-blue-300 transition text-[9px]">
            {expanded ? '▲ less' : '▼ more'}
          </button>
        )}
      </div>
      <pre className="px-2 py-1.5 whitespace-pre-wrap text-blue-200/60 leading-relaxed max-h-40 overflow-y-auto">
        {display}
      </pre>
    </div>
  )
}
