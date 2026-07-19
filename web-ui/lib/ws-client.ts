import type { Socket } from 'socket.io-client'

export type BridgeStatus = 'unknown' | 'connected' | 'disconnected'

export interface ExecuteBridgeResponse {
  output?: string
  command?: string
  error?: string | boolean
  connected?: boolean
}

export function normalizeBridgeHttpUrl(url: string) {
  return url.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '')
}

export async function createBridgeSocket(bridgeUrl: string, token: string): Promise<Socket> {
  const { io } = await import('socket.io-client')
  return io(bridgeUrl, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { token },
  })
}

export async function executeBridgeCommand(bridgeUrl: string, bridgeToken: string, command: string) {
  const response = await fetch(`${normalizeBridgeHttpUrl(bridgeUrl)}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bridgeToken}`,
    },
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(30000),
  })

  return (await response.json()) as ExecuteBridgeResponse
}
