'use client'

import { useState, useMemo, useCallback } from 'react'
import { Workflow } from 'lucide-react'
import { JARVIS_QUICK_ACTIONS, QUICK_ACTION_CATEGORIES, type QuickAction } from '@/lib/quick-actions'

interface MarkLPanelProps {
  onRunAction: (prompt: string, id: string) => void
  disabled?: boolean
  ringColor?: string
}

interface FeatureStatus {
  id: string
  active: boolean
  lastUsed?: string
}

function getStatusMap(): FeatureStatus[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('gf_markl_status')
    return raw ? JSON.parse(raw) as FeatureStatus[] : []
  } catch {
    return []
  }
}

function persistStatusMap(statuses: FeatureStatus[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('gf_markl_status', JSON.stringify(statuses))
  } catch { /* ignore */ }
}

export default function MarkLPanel({ onRunAction, disabled = false, ringColor = '#1a6fff' }: MarkLPanelProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<FeatureStatus[]>(getStatusMap)

  const toggleActive = useCallback((id: string) => {
    setStatuses(prev => {
      const next = prev.some(s => s.id === id)
        ? prev.map(s => s.id === id ? { ...s, active: !s.active } : s)
        : [...prev, { id, active: true, lastUsed: new Date().toISOString() }]
      persistStatusMap(next)
      return next
    })
  }, [])

  const filteredActions = useMemo(() => {
    const filtered = activeCategory
      ? JARVIS_QUICK_ACTIONS.filter(a => a.category === activeCategory)
      : JARVIS_QUICK_ACTIONS
    return filtered
  }, [activeCategory])

  const getStatus = useCallback((id: string): boolean => {
    return statuses.find(s => s.id === id)?.active ?? false
  }, [statuses])

  const activeCount = useMemo(() => statuses.filter(s => s.active).length, [statuses])

  return (
    <div className="flex flex-col gap-3 font-mono text-[10px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-widest" style={{ color: ringColor }}>MARK-L FEATURES</span>
          <span className="rounded px-1.5 py-0.5 text-[9px]"
            style={{ background: `${ringColor}18`, color: ringColor }}>
            {activeCount}/{JARVIS_QUICK_ACTIONS.length} ACTIVE
          </span>
        </div>
        <button
          type="button"
          onClick={() => setActiveCategory(null)}
          className="rounded px-1.5 py-0.5 border transition text-[9px]"
          style={{
            borderColor: !activeCategory ? ringColor : `${ringColor}33`,
            color: !activeCategory ? ringColor : `${ringColor}66`,
            background: !activeCategory ? `${ringColor}12` : 'transparent',
          }}
        >
          ALL
        </button>
        <div className="flex items-center gap-1.5 ms-auto">
          <Workflow size={11} style={{ color: ringColor, opacity: 0.6 }} />
          <span className="text-[8px]" style={{ color: `${ringColor}66` }}>N8N</span>
          <span className="h-1.5 w-1.5 rounded-full bg-green-500/60" title="n8n workflows available" />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1">
        {QUICK_ACTION_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
            className="rounded px-2 py-1 border transition text-[9px]"
            style={{
              borderColor: activeCategory === cat.id ? ringColor : `${ringColor}22`,
              color: activeCategory === cat.id ? ringColor : `${ringColor}66`,
              background: activeCategory === cat.id ? `${ringColor}12` : 'transparent',
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Feature grid */}
      <div className="markl-grid">
        {filteredActions.map(action => {
          const active = getStatus(action.id)
          return (
            <div
              key={action.id}
              className={`markl-card group ${active ? 'markl-active' : ''}`}
              style={{ borderColor: active ? `${ringColor}44` : undefined }}
            >
              <div className="flex items-start justify-between gap-1 mb-1.5">
                <span className="text-base leading-none">{action.icon || '⚡'}</span>
                <button
                  type="button"
                  onClick={() => toggleActive(action.id)}
                  className="shrink-0 h-3 w-6 rounded-full transition-colors relative"
                  style={{ background: active ? '#00ff8844' : 'rgba(255,255,255,0.08)' }}
                  title={active ? 'Mark as inactive' : 'Mark as active'}
                >
                  <span
                    className="absolute top-0.5 h-2 w-2 rounded-full bg-white transition-[left]"
                    style={{ left: active ? '14px' : '2px' }}
                  />
                </button>
              </div>
              <p className="text-[10px] font-medium text-gray-200 truncate">{action.label}</p>
              <p className="text-[8px] text-gray-500 truncate mt-0.5">{action.category}</p>
              <button
                type="button"
                onClick={() => onRunAction(action.prompt, action.id)}
                disabled={disabled}
                className="mt-1.5 w-full rounded border px-2 py-1 text-[9px] transition disabled:opacity-30 hover:border-blue-500/40"
                style={{ borderColor: `${ringColor}22`, color: `${ringColor}99`, background: `${ringColor}08` }}
              >
                RUN
              </button>
            </div>
          )
        })}
      </div>

      {filteredActions.length === 0 && (
        <p className="text-center text-gray-500 py-4">No features in this category.</p>
      )}
    </div>
  )
}
