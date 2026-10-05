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
  // Optional pose for walking. Upstream's Player derives it from its game
  // engine; degrees: 0 right, 90 down, 180 left, 270 up. App/agent-world/town/
  // drives it so working agents move instead of standing in fixed slots.
  orientation?: number
  isMoving?: boolean
}

export type SelectElement = (element?: { kind: 'player'; id: string }) => void
