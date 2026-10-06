// The Agent Town scene, framed by app/agent-world/town/TownWorld.tsx.
// It runs under the Pages Router so @pixi/react 7 gets the React 18 it needs
// (the App Router's bundled React 19 removed the internals it reads). Data
// arrives by postMessage from the parent page (same origin only); selections
// go back the same way. This page fetches nothing by itself.
import { useEffect, useState } from 'react'
import TownStage from '../../app/agent-world/shared/town/TownStage'
import type { WorldAgent } from '../../app/agent-world/shared/world-model'
import type { AgentTownCharacter } from '../../vendor/ai-town/src/types'

export type TownFrameState = { type: 'aw-town-state'; players: AgentTownCharacter[]; agents: WorldAgent[]; selectedId?: string }

export default function TownFrame() {
  const [state, setState] = useState<TownFrameState>()

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type === 'aw-town-state') setState(event.data as TownFrameState)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'aw-town-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="aw-town-frame bg-gf-surface font-plex text-gf-ink">
      {/* The parent sizes the iframe; the scene (vendored Game, sized in dvh) fills it below the toolbar. */}
      <style dangerouslySetInnerHTML={{ __html: '.aw-town-frame div[class*="70dvh"] { height: calc(100vh - 44px) !important; min-height: 0 !important }' }} />
      {state ? (
        <TownStage
          players={state.players}
          agents={state.agents}
          selectedId={state.selectedId}
          onSelect={element => window.parent.postMessage({ type: 'aw-town-select', id: element?.kind === 'player' ? element.id : undefined }, window.location.origin)}
        />
      ) : (
        <p role="status" className="p-4 text-sm text-gf-muted">Loading Agent Town…</p>
      )}
    </div>
  )
}
