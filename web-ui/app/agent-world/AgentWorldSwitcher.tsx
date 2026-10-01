'use client'

import { useEffect, useState } from 'react'

export const AGENT_WORLD_VIEWS = [
  { id: 'forge', label: 'Forge World' },
  { id: 'town', label: 'Agent Town' },
  { id: 'office', label: 'Agent Office' },
  { id: 'maintainer', label: 'Maintainer' },
  { id: 'team', label: 'Team' },
] as const

export type AgentWorldView = typeof AGENT_WORLD_VIEWS[number]['id']

function viewFromLocation(): AgentWorldView {
  if (typeof window === 'undefined') return 'forge'
  const requested = new URLSearchParams(window.location.search).get('world')
  return AGENT_WORLD_VIEWS.find(view => view.id === requested)?.id ?? 'forge'
}

export default function AgentWorldSwitcher({
  onChange,
}: {
  onChange: (view: AgentWorldView) => void
}) {
  const [activeView, setActiveView] = useState<AgentWorldView>('forge')

  useEffect(() => {
    const syncFromLocation = () => {
      const view = viewFromLocation()
      setActiveView(view)
      onChange(view)
    }
    syncFromLocation()
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [onChange])

  function selectView(view: AgentWorldView) {
    setActiveView(view)
    onChange(view)
    const url = new URL(window.location.href)
    if (view === 'forge') url.searchParams.delete('world')
    else url.searchParams.set('world', view)
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  return (
    <nav aria-label="Agent World views" className="overflow-x-auto rounded-2xl border border-gf-line bg-gf-surface p-2">
      <ul className="m-0 flex min-w-max list-none gap-2 p-0">
        {AGENT_WORLD_VIEWS.map(view => (
          <li key={view.id}>
            <button
              type="button"
              aria-pressed={activeView === view.id}
              onClick={() => selectView(view.id)}
              className="min-h-10 rounded-xl px-3 text-sm font-semibold outline-none hover:bg-gf-bar focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gf-accent"
              style={activeView === view.id ? { backgroundColor: '#2B1C12', color: '#F2A65A' } : undefined}
            >
              {view.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
