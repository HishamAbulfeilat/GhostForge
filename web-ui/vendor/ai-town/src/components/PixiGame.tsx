import { useApp } from '@pixi/react'
import { useRef } from 'react'
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
}: {
  players: AgentTownCharacter[]
  width: number
  height: number
  selectedId?: string
  onSelect: SelectElement
}) => {
  const pixiApp = useApp()
  const viewportRef = useRef<Viewport | undefined>()
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
