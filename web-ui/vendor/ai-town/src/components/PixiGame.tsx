import { useApp } from '@pixi/react'
import { useRef, type MutableRefObject } from 'react'
import { Viewport } from 'pixi-viewport'
import { Player } from './Player'
import { PixiStaticMap } from './PixiStaticMap'
import PixiViewport from './PixiViewport'
import type { AgentTownCharacter, SelectElement } from '../types'
import { worldMap } from '../world-map'

export const PixiGame = ({
  players,
  width,
  height,
  selectedId,
  onSelect,
  viewportRef: hostViewportRef,
}: {
  players: AgentTownCharacter[]
  width: number
  height: number
  selectedId?: string
  onSelect: SelectElement
  viewportRef?: MutableRefObject<Viewport | undefined>
}) => {
  const pixiApp = useApp()
  const ownViewportRef = useRef<Viewport | undefined>()
  const viewportRef = hostViewportRef ?? ownViewportRef
  const { tileDim } = worldMap

  return (
    <PixiViewport
      app={pixiApp}
      screenWidth={width}
      screenHeight={height}
      worldWidth={worldMap.width * tileDim}
      worldHeight={worldMap.height * tileDim}
      viewportRef={viewportRef}
    >
      <PixiStaticMap map={worldMap} />
      {players.map((player) => (
        <Player
          key={`player-${player.id}`}
          player={player}
          isViewer={player.id === selectedId}
          onClick={onSelect}
        />
      ))}
    </PixiViewport>
  )
}

export default PixiGame
