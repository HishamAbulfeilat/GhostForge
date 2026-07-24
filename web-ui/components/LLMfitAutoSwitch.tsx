'use client'

import { useEffect, useRef, useState } from 'react'

interface ModelMetrics {
  model: string
  avgLatency: number
  responseTimes: number[]
  shortResponses: number
  totalResponses: number
  qualityScore: number
  lastUpdated: number
}

const STORAGE_KEY = 'gf_model_metrics'
const MAX_LATENCY = 8000
const MAX_SHORT_RATIO = 0.4

function loadMetrics(): Record<string, ModelMetrics> {
  if (typeof window === 'undefined') return {}

  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, ModelMetrics>
  } catch {
    return {}
  }
}

function saveMetrics(metrics: Record<string, ModelMetrics>) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics))
}

declare global {
  interface Window {
    __gf_recordModelResponse?: (model: string, latency: number, responseLength: number) => void
  }
}

interface Props {
  currentModel: string
  enabled: boolean
  onSwitch: (newModel: string, reason: string) => void
}

export default function LLMfitAutoSwitch({ currentModel, enabled, onSwitch }: Props) {
  const [, setMetrics] = useState<Record<string, ModelMetrics>>(loadMetrics)
  const [suggestion, setSuggestion] = useState<{ model: string; reason: string } | null>(null)

  const recordResponse = (model: string, latency: number, responseLength: number) => {
    const metrics = loadMetrics()

    if (!metrics[model]) {
      metrics[model] = {
        model,
        avgLatency: latency,
        responseTimes: [latency],
        shortResponses: 0,
        totalResponses: 0,
        qualityScore: 100,
        lastUpdated: Date.now(),
      }
    }

    const entry = metrics[model]
    entry.responseTimes = [...entry.responseTimes.slice(-10), latency]
    entry.avgLatency = entry.responseTimes.reduce((sum, value) => sum + value, 0) / entry.responseTimes.length
    entry.totalResponses += 1

    if (responseLength < 20) entry.shortResponses += 1

    const shortRatio = entry.shortResponses / Math.max(entry.totalResponses, 1)
    entry.qualityScore = Math.max(0, 100 - (entry.avgLatency / 100) - (shortRatio * 50))
    entry.lastUpdated = Date.now()

    saveMetrics(metrics)
    setMetrics({ ...metrics })

    if (!enabled || (entry.avgLatency <= MAX_LATENCY && shortRatio <= MAX_SHORT_RATIO)) return

    const candidates = Object.values(metrics).filter(candidate => (
      candidate.model !== model &&
      candidate.model !== currentModel &&
      candidate.totalResponses >= 3
    ))

    if (candidates.length === 0) return

    const best = candidates.sort((a, b) => b.qualityScore - a.qualityScore)[0]
    if (best.qualityScore <= entry.qualityScore + 10) return

    const reason = entry.avgLatency > MAX_LATENCY
      ? `High latency (${Math.round(entry.avgLatency)}ms)`
      : 'Too many short responses'

    setSuggestion({ model: best.model, reason })
  }

  const recordRef = useRef(recordResponse)
  recordRef.current = recordResponse

  useEffect(() => {
    window.__gf_recordModelResponse = (model: string, latency: number, responseLength: number) => {
      recordRef.current(model, latency, responseLength)
    }

    return () => {
      delete window.__gf_recordModelResponse
    }
  }, [])

  useEffect(() => {
    if (suggestion?.model === currentModel) {
      setSuggestion(null)
    }
  }, [currentModel, suggestion])

  if (!suggestion || !enabled) return null

  return (
    <div className="fixed bottom-20 right-4 z-50 max-w-xs rounded-xl border border-yellow-500/50 bg-zinc-800 p-3 shadow-xl">
      <div className="flex items-start gap-2">
        <span className="text-lg text-yellow-400">⚡</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Auto-Switch Suggested</p>
          <p className="mt-0.5 text-xs text-zinc-400">{suggestion.reason}</p>
          <p className="mt-1 text-xs text-zinc-300">Switch to <span className="text-blue-400">{suggestion.model}</span>?</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            onSwitch(suggestion.model, suggestion.reason)
            setSuggestion(null)
          }}
          className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs text-white transition-colors hover:bg-blue-500"
        >
          Switch
        </button>
        <button
          type="button"
          onClick={() => setSuggestion(null)}
          className="flex-1 rounded-lg bg-zinc-700 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-600"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
