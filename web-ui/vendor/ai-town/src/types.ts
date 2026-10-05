export type AgentTownCharacter = {
  id: string
  name: string
  character: string
  description: string
  status: string
  role: string
  x: number
  y: number
  isBoss: boolean
  isSpeaking: boolean
  isThinking: boolean
  // agent-world-external: optional pose for walking, as upstream's Player
  // derives it from the game engine. Degrees: 0 right, 90 down, 180 left, 270 up.
  orientation?: number
  isMoving?: boolean
  // agent-world: upstream Character's emoji bubble, e.g. ⏳ waiting, ☕ on a break.
  emoji?: string
}

export type SelectElement = (element?: { kind: 'player'; id: string }) => void
