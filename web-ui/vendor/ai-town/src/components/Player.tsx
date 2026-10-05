import { Character } from './Character'
import { characters } from '../data/characters'
import type { AgentTownCharacter, SelectElement } from '../types'
import { worldMap } from '../world-map'

export const Player = ({
  player,
  isViewer,
  onClick,
}: {
  player: AgentTownCharacter
  isViewer: boolean
  onClick: SelectElement
}) => {
  const character = characters.find((item) => item.name === player.character)
  if (!character) return null

  const tileDim = worldMap.tileDim
  return (
    <Character
      x={player.x * tileDim + tileDim / 2}
      y={player.y * tileDim + tileDim / 2}
      orientation={player.orientation ?? 0}
      isMoving={player.isMoving ?? false}
      isThinking={player.isThinking}
      isSpeaking={player.isSpeaking}
      emoji={player.emoji ?? ''}
      isViewer={isViewer}
      textureUrl={character.textureUrl}
      spritesheetData={character.spritesheetData}
      speed={character.speed}
      onClick={() => onClick({ kind: 'player', id: player.id })}
    />
  )
}
