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
}

export type SelectElement = (element?: { kind: 'player'; id: string }) => void
