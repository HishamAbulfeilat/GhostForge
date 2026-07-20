'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface PaletteItem {
  id: string
  label: string
  description?: string
  icon: string
  action: () => void
  group: string
}

const STATIC_ITEMS: Omit<PaletteItem, 'action'>[] = [
  { id: 'nav-chat',        label: 'Open Chat',         icon: '💬', description: 'AI chat assistant',         group: 'Navigate' },
  { id: 'nav-terminal',    label: 'Open Terminal',     icon: '🖥️', description: 'Remote Mac terminal',        group: 'Navigate' },
  { id: 'nav-dashboard',   label: 'Open Dashboard',   icon: '📊', description: 'GitHub & project metrics',   group: 'Navigate' },
  { id: 'nav-files',       label: 'File Browser',     icon: '🗂️', description: 'Browse and edit Mac files',  group: 'Navigate' },
  { id: 'nav-features',    label: 'Features',         icon: '⚡', description: 'Quick command buttons',      group: 'Navigate' },
  { id: 'nav-marketplace', label: 'Marketplace',      icon: '🏪', description: 'Agents, skills, plugins',    group: 'Navigate' },
  { id: 'nav-settings',    label: 'Settings',         icon: '⚙️', description: 'AI model & preferences',     group: 'Navigate' },
  { id: 'cmd-carbon',      label: 'Carbon Status',    icon: '🌿', description: 'ghostforge carbon status',   group: 'Commands' },
  { id: 'cmd-health',      label: 'Health Score',     icon: '🏥', description: 'ghostforge health-score score', group: 'Commands' },
  { id: 'cmd-standup',     label: 'Standup Today',    icon: '🗣️', description: 'ghostforge standup today',   group: 'Commands' },
  { id: 'cmd-review',      label: 'AI Review Staged', icon: '🔍', description: 'ghostforge ai-review staged', group: 'Commands' },
  { id: 'cmd-doctor',      label: 'Doctor Check',     icon: '🩺', description: 'ghostforge doctor',          group: 'Commands' },
]

const ROUTE_MAP: Record<string, string> = {
  'nav-chat':        '/chat',
  'nav-terminal':    '/terminal',
  'nav-dashboard':   '/dashboard',
  'nav-files':       '/files',
  'nav-features':    '/features',
  'nav-marketplace': '/marketplace',
  'nav-settings':    '/settings',
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => { setOpen(false); setQuery(''); setSelected(0) }, [])

  // Build items with actions
  const allItems: PaletteItem[] = STATIC_ITEMS.map(item => ({
    ...item,
    action: () => {
      const route = ROUTE_MAP[item.id]
      if (route) { router.push(route); close() }
      else if (item.id.startsWith('cmd-')) {
        close()
        // Send as chat message by dispatching a custom event
        window.dispatchEvent(new CustomEvent('gf:palette-cmd', { detail: item.description }))
        router.push('/terminal')
      }
    },
  }))

  const filtered = query.trim()
    ? allItems.filter(i =>
        i.label.toLowerCase().includes(query.toLowerCase()) ||
        i.description?.toLowerCase().includes(query.toLowerCase()) ||
        i.group.toLowerCase().includes(query.toLowerCase())
      )
    : allItems

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [close])

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  useEffect(() => { setSelected(0) }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && filtered[selected]) { filtered[selected].action() }
  }

  if (!open) return null

  const groups = [...new Set(filtered.map(i => i.group))]

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]" onClick={close}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-gray-900/95 shadow-2xl backdrop-blur-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="text-lg">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, pages, tools…"
            className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
          />
          <kbd className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/40">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-white/30">No results for &quot;{query}&quot;</p>
          )}
          {groups.map(group => (
            <div key={group}>
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30">{group}</p>
              {filtered.filter(i => i.group === group).map((item, idx) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <button
                    key={item.id}
                    onClick={item.action}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      globalIdx === selected ? 'bg-sky-600/20 text-white' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      {item.description && (
                        <p className="text-xs text-white/40 truncate">{item.description}</p>
                      )}
                    </div>
                    {group === 'Navigate' && <span className="text-[10px] text-white/20">→</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2 text-[11px] text-white/30">
          <span><kbd className="rounded border border-white/20 px-1 py-0.5">↑↓</kbd> navigate</span>
          <span><kbd className="rounded border border-white/20 px-1 py-0.5">↵</kbd> select</span>
          <span><kbd className="rounded border border-white/20 px-1 py-0.5">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  )
}
