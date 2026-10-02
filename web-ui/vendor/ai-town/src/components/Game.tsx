'use client'

import { Stage } from '@pixi/react'
import { useEffect, useRef, useState } from 'react'
import { PixiGame } from './PixiGame'
import type { AgentTownCharacter, SelectElement } from '../types'

export default function Game({
  players,
  selectedId,
  onSelect,
}: {
  players: AgentTownCharacter[]
  selectedId?: string
  onSelect: SelectElement
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const resize = () => {
      setSize({
        width: Math.floor(host.clientWidth),
        height: Math.floor(host.clientHeight),
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="h-[min(70dvh,680px)] min-h-80 w-full overflow-hidden rounded-xl bg-[#7ab5ff]">
      {size.width > 0 && size.height > 0 && (
        <Stage width={size.width} height={size.height} options={{ backgroundColor: 0x7ab5ff }}>
          <PixiGame
            players={players}
            selectedId={selectedId}
            width={size.width}
            height={size.height}
            onSelect={onSelect}
          />
        </Stage>
      )}
    </div>
  )
}
