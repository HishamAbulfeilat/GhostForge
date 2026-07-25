'use client'

import { useState, useCallback } from 'react'

export interface HFModel {
  id: string
  author: string
  name: string
  type: string
  downloads: number
  likes: number
  license: string
  size: string
  pipelineTag: string
  tags: string[]
  lastModified: string | null
}

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  LLM:      { bg: 'bg-violet-900/50', text: 'text-violet-300', border: 'border-violet-700/50', icon: '💬' },
  Vision:   { bg: 'bg-sky-900/50', text: 'text-sky-300', border: 'border-sky-700/50', icon: '👁️' },
  Audio:    { bg: 'bg-amber-900/50', text: 'text-amber-300', border: 'border-amber-700/50', icon: '🔊' },
  Video:    { bg: 'bg-rose-900/50', text: 'text-rose-300', border: 'border-rose-700/50', icon: '🎬' },
  NLP:      { bg: 'bg-emerald-900/50', text: 'text-emerald-300', border: 'border-emerald-700/50', icon: '📝' },
  Diffusion:{ bg: 'bg-pink-900/50', text: 'text-pink-300', border: 'border-pink-700/50', icon: '🎨' },
  Other:    { bg: 'bg-gray-900/50', text: 'text-gray-300', border: 'border-gray-700/50', icon: '📦' },
}

const LICENSE_COLORS: Record<string, string> = {
  'mit':                'bg-emerald-900/40 text-emerald-400 border-emerald-700/40',
  'apache-2.0':         'bg-sky-900/40 text-sky-400 border-sky-700/40',
  'lgpl-2.1':           'bg-amber-900/40 text-amber-400 border-amber-700/40',
  'lgpl-3.0':           'bg-amber-900/40 text-amber-400 border-amber-700/40',
  'gpl-2.0':            'bg-red-900/40 text-red-400 border-red-700/40',
  'gpl-3.0':            'bg-red-900/40 text-red-400 border-red-700/40',
  'cc-by-nc-sa-4.0':    'bg-gray-900/40 text-gray-400 border-gray-700/40',
  'cc-by-4.0':          'bg-gray-900/40 text-gray-400 border-gray-700/40',
  'artificial-ai-2.0':  'bg-purple-900/40 text-purple-400 border-purple-700/40',
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function licenseClass(license: string): string {
  const key = license.toLowerCase().replace(/\s+/g, '-')
  return LICENSE_COLORS[key] ?? 'bg-gray-900/40 text-gray-500 border-gray-700/40'
}

interface HFModelCardProps {
  model: HFModel
  onSelect?: (model: HFModel) => void
  onDownload?: (model: HFModel) => void
  selected?: boolean
}

export default function HFModelCard({ model, onSelect, onDownload, selected }: HFModelCardProps) {
  const [downloading, setDownloading] = useState(false)

  const typeStyle = TYPE_STYLES[model.type] ?? TYPE_STYLES.Other

  const handleDownload = useCallback(async () => {
    if (downloading) return
    setDownloading(true)
    try {
      if (onDownload) {
        await onDownload(model)
      } else {
        await fetch('/api/models/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: model.id, type: 'huggingface' }),
        })
      }
    } catch { /* ignore */ }
    setDownloading(false)
  }, [model, downloading, onDownload])

  return (
    <div className={`group flex flex-col gap-2.5 rounded-lg border p-3.5 transition-all ${
      selected
        ? 'border-sky-600/50 bg-sky-950/20 ring-1 ring-sky-600/20'
        : 'border-white/[0.06] bg-[#080d18] hover:border-white/[0.12]'
    }`}>
      {/* Top row: author + type badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-500 truncate">{model.author}</p>
          <p className="text-sm font-semibold text-gray-100 truncate leading-tight">{model.name}</p>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${typeStyle.bg} ${typeStyle.text} ${typeStyle.border}`}>
          {typeStyle.icon} {model.type}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1" title="Downloads">
          ↓ {formatNumber(model.downloads)}
        </span>
        <span className="flex items-center gap-1" title="Likes">
          ♥ {formatNumber(model.likes)}
        </span>
        {model.size !== 'Unknown' && (
          <span className="flex items-center gap-1" title="Parameters">
            ◆ {model.size}
          </span>
        )}
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${licenseClass(model.license)}`}>
          {model.license}
        </span>
        {model.tags.slice(0, 2).map(tag => (
          <span key={tag} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-gray-600">
            {tag}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-auto flex gap-1.5">
        {onSelect && (
          <button
            type="button"
            onClick={() => onSelect(model)}
            className={`flex-1 rounded border px-3 py-1.5 text-xs font-medium transition ${
              selected
                ? 'border-sky-700/50 bg-sky-900/40 text-sky-300'
                : 'border-white/[0.08] bg-white/[0.03] text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            {selected ? '✓ Selected' : 'Set Active'}
          </button>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="flex-1 rounded border border-emerald-800/50 bg-emerald-950/30 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-900/40 disabled:opacity-50"
        >
          {downloading ? '…' : '↓ Download'}
        </button>
      </div>
    </div>
  )
}
