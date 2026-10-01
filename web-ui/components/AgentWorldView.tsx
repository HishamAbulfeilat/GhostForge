'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccess } from '@/components/AccessGuard'
import {
  collectAgentWorldData,
  type AgentWorldRecord,
} from '@/app/agent-world/agent-world-model'
import AgentOfficeMap from '@/components/agent-world/AgentOfficeMap'
import WorkflowDependencyGraph from '@/components/agent-world/WorkflowDependencyGraph'
import {
  THEME_OPTIONS,
  type AgentWorldEdge,
  type AgentWorldNode,
  type AgentWorldProjection,
  type AgentWorldTheme,
  type AgentWorldVariant,
  deriveAgentWorldProjection,
  getThemeStorageKey,
  layoutWorldNodes,
  migrateStoredTheme,
} from '@/lib/agent-world'

type Payload = {
  snapshot?: AgentWorldRecord
  connectorSnapshot?: AgentWorldRecord
}

type ThemeStyle = {
  page: string
  panel: string
  panelStrong: string
  line: string
  text: string
  muted: string
  quiet: string
  accent: string
  accentSoft: string
  focus: string
  edge: string
  scene: string
}

const themeStyles: Record<AgentWorldTheme, ThemeStyle> = {
  forge: {
    page: 'bg-[#070b10] text-white',
    panel: 'border-sky-900/80 bg-[#0b141d]',
    panelStrong: 'border-sky-700/70 bg-[#101d28]',
    line: 'border-sky-900/80',
    text: 'text-white',
    muted: 'text-sky-100/80',
    quiet: 'text-sky-200/60',
    accent: 'bg-orange-400 text-orange-950',
    accentSoft: 'border-orange-400/40 bg-orange-400/10 text-orange-100',
    focus: 'focus-visible:ring-orange-300',
    edge: '#fb923c',
    scene: 'border-sky-800 bg-[#07131c]',
  },
  office: {
    page: 'bg-[#e9e3d6] text-stone-950',
    panel: 'border-stone-300 bg-[#f5f0e6]',
    panelStrong: 'border-stone-400 bg-white',
    line: 'border-stone-300',
    text: 'text-stone-950',
    muted: 'text-stone-700',
    quiet: 'text-stone-600',
    accent: 'bg-orange-800 text-white',
    accentSoft: 'border-orange-800/30 bg-orange-800/10 text-orange-950',
    focus: 'focus-visible:ring-orange-800',
    edge: '#9a3412',
    scene: 'border-stone-400 bg-[#f7f2e8]',
  },
  town: {
    page: 'bg-[#06140f] text-white',
    panel: 'border-emerald-800 bg-[#0b2118]',
    panelStrong: 'border-emerald-700 bg-[#103124]',
    line: 'border-emerald-800',
    text: 'text-white',
    muted: 'text-emerald-50/80',
    quiet: 'text-emerald-100/60',
    accent: 'bg-lime-300 text-lime-950',
    accentSoft: 'border-lime-300/40 bg-lime-300/10 text-lime-100',
    focus: 'focus-visible:ring-lime-300',
    edge: '#bef264',
    scene: 'border-emerald-700 bg-[#0b281b]',
  },
}

const kindLabels: Record<AgentWorldNode['kind'], string> = {
  agent: 'Agent figure',
  session: 'Session figure',
  workflow: 'Workflow station',
  source: 'Source building',
}

function ForgeBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-0 bottom-0 h-[48%] bg-[linear-gradient(rgba(56,189,248,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.12)_1px,transparent_1px)] bg-[size:48px_48px] [transform:perspective(500px)_rotateX(48deg)] [transform-origin:bottom]" />
      <div className="absolute start-1/2 top-[10%] h-24 w-40 -translate-x-1/2 rounded-t-full border border-orange-400/50 bg-orange-500/10 shadow-[0_24px_80px_rgba(249,115,22,0.22)]" />
      <div className="absolute start-[8%] end-[8%] top-[46%] h-px bg-orange-400/30" />
      <div className="absolute start-[10%] top-[57%] h-28 w-28 rounded-full border border-sky-500/20" />
      <div className="absolute end-[10%] top-[57%] h-28 w-28 rounded-full border border-sky-500/20" />
    </div>
  )
}

function OfficeBackdrop() {
  const desks = Array.from({ length: 8 }, (_, index) => ({
    id: index,
    left: 11 + (index % 4) * 14,
    top: 34 + Math.floor(index / 4) * 28,
  }))
  return (
    <div className="absolute inset-0 text-stone-700" aria-hidden="true">
      <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(120,113,108,0.05)_25%,transparent_25%,transparent_75%,rgba(120,113,108,0.05)_75%),linear-gradient(45deg,rgba(120,113,108,0.05)_25%,transparent_25%,transparent_75%,rgba(120,113,108,0.05)_75%)] bg-[position:0_0,12px_12px] bg-[size:24px_24px]" />
      <div className="absolute start-[4%] end-[34%] top-[18%] bottom-[9%] border-4 border-stone-400 bg-[#efe8d8]/80 shadow-[8px_8px_0_rgba(87,83,78,0.22)]" />
      {desks.map(desk => (
        <span
          key={desk.id}
          className="absolute h-9 w-20 border-2 border-stone-600 bg-amber-200 shadow-[4px_4px_0_rgba(87,83,78,0.22)] before:absolute before:start-2 before:top-2 before:h-3 before:w-6 before:border before:border-stone-600 before:bg-sky-100 after:absolute after:end-2 after:top-2 after:h-2 after:w-2 after:bg-emerald-700"
          style={{ left: `${desk.left}%`, top: `${desk.top}%` }}
        />
      ))}
      <div className="absolute end-[5%] top-[7%] h-[26%] w-[23%] border-4 border-stone-500 bg-white/75 shadow-[6px_6px_0_rgba(87,83,78,0.2)]" />
      <div className="absolute end-[5%] bottom-[9%] h-[47%] w-[23%] border-4 border-dashed border-orange-800/40 bg-orange-100/60" />
      <div className="absolute end-[7%] top-[23%] h-8 w-8 border-2 border-emerald-800 bg-emerald-600 shadow-[3px_3px_0_rgba(87,83,78,0.2)]" />
      <span className="absolute end-[12%] top-[10%] text-xs font-black uppercase tracking-[0.12em]">Boss room</span>
      <span className="absolute end-[10%] bottom-[12%] text-xs font-black uppercase tracking-[0.12em]">Review pod</span>
      <span className="absolute start-[7%] top-[20%] text-xs font-black uppercase tracking-[0.12em]">Team floor</span>
    </div>
  )
}

function TownBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[#123c28] bg-[linear-gradient(90deg,rgba(190,242,100,0.04)_1px,transparent_1px),linear-gradient(rgba(190,242,100,0.04)_1px,transparent_1px)] bg-[size:16px_16px]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 600" preserveAspectRatio="none">
        <path d="M30 150 C220 190 260 90 450 160 S760 220 970 140" fill="none" stroke="#d7c18b" strokeWidth="34" strokeLinecap="square" opacity="0.5" />
        <path d="M80 430 C260 350 390 470 560 390 S780 330 950 460" fill="none" stroke="#a78b62" strokeWidth="42" strokeLinecap="square" opacity="0.42" />
        <path d="M500 150 V520" fill="none" stroke="#ead9a7" strokeWidth="22" strokeLinecap="square" opacity="0.38" />
      </svg>
      <div className="absolute start-[8%] top-[13%] h-24 w-28 border-4 border-amber-950 bg-amber-200 shadow-[8px_8px_0_rgba(2,44,34,0.65)] before:absolute before:-top-8 before:start-[-4px] before:h-8 before:w-28 before:bg-red-700 before:[clip-path:polygon(50%_0,100%_100%,0_100%)] after:absolute after:bottom-0 after:start-1/2 after:h-10 after:w-5 after:-translate-x-1/2 after:bg-amber-950" />
      <div className="absolute end-[11%] top-[16%] h-20 w-24 border-4 border-sky-950 bg-sky-200 shadow-[8px_8px_0_rgba(2,44,34,0.65)] before:absolute before:-top-7 before:start-[-4px] before:h-7 before:w-24 before:bg-sky-800 before:[clip-path:polygon(50%_0,100%_100%,0_100%)] after:absolute after:bottom-3 after:start-3 after:h-5 after:w-5 after:bg-sky-950" />
      <div className="absolute start-[15%] bottom-[12%] h-16 w-20 border-4 border-emerald-950 bg-lime-200 shadow-[6px_6px_0_rgba(2,44,34,0.65)]" />
      <div className="absolute end-[15%] bottom-[10%] h-20 w-28 border-4 border-violet-950 bg-violet-200 shadow-[8px_8px_0_rgba(2,44,34,0.65)]" />
      <span className="absolute start-[5%] top-[5%] text-xs font-black uppercase tracking-[0.12em] text-emerald-100/70">Source district</span>
      <span className="absolute start-[5%] bottom-[6%] text-xs font-black uppercase tracking-[0.12em] text-emerald-100/70">Delivery commons</span>
    </div>
  )
}

function FigureGlyph({ node, theme }: { node: AgentWorldNode; theme: AgentWorldTheme }) {
  const activeTone = node.stale
    ? 'border-amber-400 bg-amber-400/20'
    : node.active
      ? theme === 'office' ? 'border-emerald-700 bg-emerald-100' : 'border-emerald-300 bg-emerald-300/15'
      : theme === 'office' ? 'border-stone-500 bg-stone-100' : 'border-current bg-current/10'

  if (node.kind === 'source') {
    return (
      <span className={`relative block h-12 w-14 border-2 ${activeTone}`}>
        <span className="absolute -top-3 start-1/2 h-5 w-9 -translate-x-1/2 rotate-45 border-s-2 border-t-2 border-current bg-inherit" />
        <span className="absolute bottom-0 start-1/2 h-5 w-3 -translate-x-1/2 border border-current" />
      </span>
    )
  }

  if (node.kind === 'workflow') {
    return (
      <span className={`relative block h-10 w-16 rounded-sm border-2 ${activeTone}`}>
        <span className="absolute start-2 end-2 top-2 h-1 bg-current opacity-50" />
        <span className="absolute start-2 end-5 top-5 h-1 bg-current opacity-40" />
      </span>
    )
  }

  const emote = node.stale ? '…' : node.status === 'blocked' || node.status === 'error' ? '×' : node.active ? '!' : 'z'
  const pixelFigure = theme === 'office' || theme === 'town'

  return (
    <span className="relative block h-14 w-12">
      <span className={`absolute -end-2 -top-3 z-10 min-w-5 border border-current bg-inherit px-1 text-[9px] font-black leading-4 shadow-[2px_2px_0_rgba(0,0,0,0.2)] ${node.active ? 'motion-safe:animate-pulse' : ''}`}>{emote}</span>
      <span className={`absolute start-1/2 top-1 h-5 w-5 -translate-x-1/2 border-2 ${pixelFigure ? '' : 'rounded-full'} ${activeTone}`}>
        {pixelFigure && <span className="absolute start-1 top-1 h-1 w-1 bg-current shadow-[8px_0_0_current]" />}
      </span>
      <span className={`absolute bottom-1 start-1/2 h-7 w-9 -translate-x-1/2 border-2 ${pixelFigure ? 'shadow-[3px_3px_0_rgba(0,0,0,0.25)]' : 'rounded-t-full'} ${activeTone}`} />
      {pixelFigure && <span className="absolute bottom-0 start-1/2 h-1 w-11 -translate-x-1/2 bg-black/20" />}
      {node.leader && <span className="absolute -top-3 start-1/2 -translate-x-1/2 text-sm" aria-hidden="true">◆</span>}
    </span>
  )
}

function WorldNodeFigure({ node, theme, x, y }: { node: AgentWorldNode; theme: AgentWorldTheme; x: number; y: number }) {
  const style = themeStyles[theme]
  return (
    <button
      type="button"
      className={`group absolute z-20 w-28 -translate-x-1/2 -translate-y-1/2 rounded-lg px-1 py-1 text-center outline-none motion-safe:transition-transform motion-safe:hover:scale-105 focus-visible:ring-2 ${style.focus}`}
      style={{ left: `${x / 10}%`, top: `${y / 6}%` }}
      aria-label={`${kindLabels[node.kind]} ${node.label}. Role ${node.role}. Source ${node.source}. Status ${node.status}. Current task ${node.task}.`}
    >
      <span className="mx-auto flex justify-center" aria-hidden="true"><FigureGlyph node={node} theme={theme} /></span>
      <span className="mt-1 block truncate text-[11px] font-black">{node.label}</span>
      <span className={`block truncate text-[9px] uppercase tracking-[0.08em] ${style.quiet}`}>{node.status}</span>
      {node.progress !== null && (
        <span
          className="sr-only"
          role="progressbar"
          aria-label={`${node.label} reported progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(node.progress * 100)}
        />
      )}
      <span className={`pointer-events-none absolute start-1/2 top-full z-40 mt-2 hidden w-56 -translate-x-1/2 border p-3 text-start text-xs shadow-xl group-hover:block group-focus:block ${style.panelStrong}`}>
        <strong className="block text-sm">{node.label}</strong>
        <span className={`mt-1 block ${style.muted}`}>{node.role} · {node.source}</span>
        <span className="mt-2 block">{node.task}</span>
        {node.details.map(detail => <span key={detail} className={`mt-1 block ${style.quiet}`}>{detail}</span>)}
      </span>
    </button>
  )
}

function EdgeTopology({
  edges,
  positions,
  theme,
}: {
  edges: AgentWorldEdge[]
  positions: Map<string, { x: number; y: number }>
  theme: AgentWorldTheme
}) {
  const color = themeStyles[theme].edge
  return (
    <svg className="absolute inset-0 z-10 h-full w-full" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-label="Live workflow node-edge topology">
      <defs>
        <marker id={`world-arrow-${theme}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
      </defs>
      {edges.map(edge => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (!from || !to) return null
        const bend = Math.max(24, Math.abs(to.y - from.y) * 0.22)
        const path = `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}`
        return (
          <path
            key={edge.id}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={edge.type === 'dependency' ? 2.5 : 1.5}
            strokeDasharray={edge.type === 'message' ? '6 5' : undefined}
            opacity={edge.type === 'source' ? 0.32 : 0.68}
            markerEnd={`url(#world-arrow-${theme})`}
          >
            <title>{`${edge.from} ${edge.label} ${edge.to}`}</title>
          </path>
        )
      })}
    </svg>
  )
}

function SpatialWorld({ projection, theme }: { projection: AgentWorldProjection; theme: AgentWorldTheme }) {
  const positions = useMemo(() => layoutWorldNodes(projection.nodes, theme), [projection.nodes, theme])
  const style = themeStyles[theme]

  return (
    <section aria-labelledby="spatial-world-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="spatial-world-heading" className="text-xl font-black tracking-tight">
            {THEME_OPTIONS.find(option => option.id === theme)?.label}
          </h2>
          <p className={`mt-1 text-sm ${style.muted}`}>
            Every occupied station and path comes from the current snapshot.
          </p>
        </div>
        <p className={`text-xs ${style.quiet}`}>Tab through figures for role, status, source, and current task.</p>
      </div>
      <div className={`overflow-x-auto border ${style.scene}`}>
        <div className="relative h-[620px] min-w-[900px] overflow-hidden">
          {theme === 'forge' && <ForgeBackdrop />}
          {theme === 'office' && <OfficeBackdrop />}
          {theme === 'town' && <TownBackdrop />}
          <EdgeTopology edges={projection.edges} positions={positions} theme={theme} />
          {projection.nodes.map(node => {
            const position = positions.get(node.id)
            return position
              ? <WorldNodeFigure key={node.id} node={node} theme={theme} x={position.x} y={position.y} />
              : null
          })}
        </div>
      </div>
    </section>
  )
}

function TopologyFallback({ edges, theme }: { edges: AgentWorldEdge[]; theme: AgentWorldTheme }) {
  const style = themeStyles[theme]
  return (
    <details className={`border ${style.panel}`}>
      <summary className={`cursor-pointer px-4 py-3 font-bold outline-none focus-visible:ring-2 ${style.focus}`}>Workflow relationship list</summary>
      {edges.length ? (
        <ol className={`grid gap-2 border-t p-4 md:grid-cols-2 ${style.line}`}>
          {edges.map(edge => (
            <li key={edge.id} className={`flex min-w-0 items-center gap-2 border px-3 py-2 text-sm ${style.panelStrong}`}>
              <span className="truncate font-semibold">{edge.from}</span>
              <span aria-hidden="true">→</span>
              <span className="truncate font-semibold">{edge.to}</span>
              <span className={`ms-auto shrink-0 text-xs ${style.quiet}`}>{edge.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={`border-t px-4 py-3 text-sm ${style.muted}`}>No real relationships were reported.</p>
      )}
    </details>
  )
}

function AccessibleSnapshot({ nodes, theme }: { nodes: AgentWorldNode[]; theme: AgentWorldTheme }) {
  const style = themeStyles[theme]
  return (
    <details className={`border ${style.panel}`}>
      <summary className={`cursor-pointer px-4 py-3 font-bold outline-none focus-visible:ring-2 ${style.focus}`}>Accessible snapshot table</summary>
      <div className={`overflow-x-auto border-t ${style.line}`}>
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">Current real Agent World records</caption>
          <thead>
            <tr className={style.panelStrong}>
              {['Name', 'Type', 'Role', 'Source', 'Status', 'Current task'].map(label => (
                <th key={label} scope="col" className="px-3 py-2 text-start font-bold">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map(node => (
              <tr key={node.id} className={`border-t ${style.line}`}>
                <th scope="row" className="px-3 py-2 text-start font-semibold">{node.label}</th>
                <td className="px-3 py-2">{node.kind}</td>
                <td className="px-3 py-2">{node.role}</td>
                <td className="px-3 py-2">{node.source}</td>
                <td className="px-3 py-2">{node.stale ? `${node.status} / stale` : node.status}</td>
                <td className="max-w-md px-3 py-2">{node.task}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function AgentWorldView({ variant, title, subtitle }: { variant: AgentWorldVariant; title: string; subtitle: string }) {
  const { user } = useAccess()
  const [theme, setTheme] = useState<AgentWorldTheme>('forge')
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const requestSequence = useRef(0)
  const canMaintain = user?.role === 'admin' || user?.permissions.includes('admin_tools')

  useEffect(() => {
    try {
      const stored = migrateStoredTheme(localStorage.getItem(getThemeStorageKey(variant)))
      if (stored) setTheme(stored)
    } catch {
      // Storage is optional; the selected scene still works for this visit.
    }
  }, [variant])

  useEffect(() => {
    try {
      localStorage.setItem(getThemeStorageKey(variant), theme)
    } catch {
      // Storage is optional.
    }
  }, [theme, variant])

  const load = useCallback(async (background = false) => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const requestId = ++requestSequence.current
    if (background) setRefreshing(true)
    else setLoading(true)
    try {
      const endpoint = variant === 'product' ? '/api/agents?view=public' : '/api/agents'
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      if (!response.ok) {
        if (response.status === 401) throw new Error('Sign in to load the live Agent World snapshot.')
        if (response.status === 403) throw new Error('The private maintainer world requires the admin_tools permission.')
        const body = await response.json().catch(() => ({})) as { error?: unknown }
        throw new Error(typeof body.error === 'string' ? body.error : `The agent snapshot request failed (${response.status}).`)
      }
      const nextPayload = await response.json() as Payload
      if (requestId !== requestSequence.current) return
      setPayload(nextPayload)
      setLastUpdated(new Date())
      setError(null)
    } catch (loadError) {
      if (controller.signal.aborted || requestId !== requestSequence.current) return
      setError(loadError instanceof Error ? loadError.message : 'The agent snapshot could not be loaded.')
    } finally {
      if (requestId !== requestSequence.current) return
      activeRequest.current = null
      setLoading(false)
      setRefreshing(false)
    }
  }, [variant])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load(true) }, 20_000)
    return () => {
      window.clearInterval(timer)
      activeRequest.current?.abort()
    }
  }, [load])

  const data = useMemo(() => {
    const snapshot = payload?.snapshot ?? {}
    return collectAgentWorldData(snapshot, payload?.connectorSnapshot)
  }, [payload])
  const projection = useMemo(() => {
    const snapshot = payload?.snapshot ?? {}
    return deriveAgentWorldProjection(data, variant, {
      health: typeof snapshot.health === 'number' ? snapshot.health : null,
      phase: typeof snapshot.phase === 'number' ? snapshot.phase : 1,
      running: snapshot.running === true,
      workflow: snapshot.workflow && typeof snapshot.workflow === 'object' && !Array.isArray(snapshot.workflow)
        ? snapshot.workflow as AgentWorldRecord
        : null,
    })
  }, [data, payload, variant])
  const style = themeStyles[theme]

  return (
    <main className={`min-h-[calc(100dvh-49px)] font-plex ${style.page}`}>
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <header className={`border p-5 sm:p-7 ${style.panelStrong}`}>
          <div className="grid gap-6 xl:grid-cols-[1fr_auto] xl:items-end">
            <div>
              <h1 className="max-w-4xl font-display text-3xl font-black tracking-[-0.03em] sm:text-5xl">{title}</h1>
              <p className={`mt-3 max-w-3xl text-sm sm:text-base ${style.muted}`}>{subtitle}</p>
              <div className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ${style.quiet}`} aria-live="polite">
                <span>Phase {projection.summary.phase}</span>
                <span>{payload?.snapshot?.running === true ? 'Live local runtime' : 'Local runtime offline or unknown'}</span>
                <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for snapshot'}</span>
              </div>
            </div>
            <div className="space-y-4">
              <nav aria-label="Agent World views" className="flex flex-wrap gap-2 xl:justify-end">
                <Link href="/agent-world" className={`border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 ${style.panel} ${style.focus}`}>Agent World</Link>
                {canMaintain && (
                  <>
                    <Link href="/maintainer-world" className={`border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 ${style.panel} ${style.focus}`}>Maintainer World</Link>
                    <Link href="/agents" className={`border px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 ${style.panel} ${style.focus}`}>Team controls</Link>
                  </>
                )}
              </nav>
              <fieldset>
                <legend className={`mb-2 text-xs font-bold uppercase tracking-[0.14em] ${style.quiet}`}>Spatial world</legend>
                <div className="flex flex-wrap gap-2 xl:justify-end">
                  {THEME_OPTIONS.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      className={`border px-3 py-2 text-start text-sm outline-none motion-safe:transition-colors focus-visible:ring-2 ${style.focus} ${theme === option.id ? style.accent : style.panel}`}
                      onClick={() => setTheme(option.id)}
                      aria-pressed={theme === option.id}
                      title={option.description}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`border px-3 py-2 text-sm font-semibold outline-none motion-safe:transition-colors focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60 ${style.panel} ${style.focus}`}
                    onClick={() => void load(true)}
                    disabled={refreshing}
                  >
                    {refreshing ? 'Refreshing…' : 'Refresh snapshot'}
                  </button>
                </div>
              </fieldset>
            </div>
          </div>
        </header>

        <dl className={`grid border-x border-b sm:grid-cols-4 xl:grid-cols-8 ${style.line}`} aria-label="Agent World summary">
          {[
            ['Online', String(projection.summary.online)],
            ['Sessions', String(projection.summary.sessions)],
            ['Tasks', String(projection.summary.tasks)],
            ['Active', String(projection.summary.active)],
            ['Blocked', String(projection.summary.blocked)],
            ['Sources', String(projection.summary.sources)],
            ['Health', projection.summary.health === null ? '—' : `${projection.summary.health}%`],
            ['World', THEME_OPTIONS.find(option => option.id === theme)?.label ?? theme],
          ].map(([label, value]) => (
            <div key={label} className={`border-b p-3 last:border-b-0 sm:border-b-0 sm:border-e ${style.line}`}>
              <dt className={`text-[11px] font-bold uppercase tracking-[0.12em] ${style.quiet}`}>{label}</dt>
              <dd className="mt-1 truncate text-lg font-black">{value}</dd>
            </div>
          ))}
        </dl>

        {error && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-red-400/50 bg-red-950 px-4 py-3 text-sm text-red-50" role="alert">
            <span>{error}</span>
            {error.startsWith('Sign in') && <Link href={`/login?next=/${variant === 'product' ? 'agent-world' : 'maintainer-world'}`} className="font-bold underline">Sign in</Link>}
          </div>
        )}
        {loading && !payload && <div className={`mt-5 border p-6 text-sm ${style.panel}`} role="status">Loading real local and federated records…</div>}
        {!loading && projection.notices.length > 0 && (
          <div className="mt-5 space-y-2" aria-label="Snapshot notices">
            {projection.notices.map(notice => <p key={notice} className={`border px-4 py-3 text-sm ${style.panel}`}>{notice}</p>)}
          </div>
        )}
        {!loading && projection.ready && (
          <div className="mt-7 space-y-6">
            <SpatialWorld projection={projection} theme={theme} />
            <AgentOfficeMap
              sessions={data.sessions}
              emptyMessage="No sessions were reported by the available snapshots."
            />
            <WorkflowDependencyGraph tasks={data.tasks} />
            <TopologyFallback edges={projection.edges} theme={theme} />
            <AccessibleSnapshot nodes={projection.nodes} theme={theme} />
          </div>
        )}
        {!loading && !projection.ready && (
          <div className={`mt-7 border border-dashed p-8 text-center ${style.panel}`}>
            <h2 className="text-lg font-bold">No real Agent World records yet</h2>
            <p className={`mt-2 text-sm ${style.muted}`}>Start or connect an agent source, then refresh. This view never creates placeholder occupancy.</p>
          </div>
        )}
      </div>
    </main>
  )
}

export default AgentWorldView
