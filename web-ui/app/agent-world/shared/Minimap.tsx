'use client'

import { useEffect, useRef } from 'react'

export type MinimapDot = { id: string; x: number; y: number; tone: 'needs' | 'working' | 'done' | 'ended' | 'you' | 'other'; selected?: boolean }
export type MinimapState = {
  /** World size in scene pixels. */
  width: number
  height: number
  /** The visible part of the world, in scene pixels. */
  view: { x: number; y: number; w: number; h: number }
  dots: MinimapDot[]
}

const TONE: Record<MinimapDot['tone'], string> = {
  needs: '#f5b041', working: '#4cc47e', done: '#c9c4ba', ended: '#7d786f', you: '#ffffff', other: '#7fb0ff',
}

/**
 * A small overview of a world scene: one dot per character and the camera's
 * viewport. `read` is polled from the live scene (positions are not in the
 * snapshot); clicking or dragging pans the scene there.
 */
export default function Minimap({
  read, onPan, width = 168, label,
}: {
  read: () => MinimapState | null
  onPan: (x: number, y: number) => void
  width?: number
  label: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ width: 1, height: 1 })
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    let frame = 0
    let last = 0
    const draw = (t: number) => {
      frame = requestAnimationFrame(draw)
      if (t - last < 150) return
      last = t
      const canvas = canvasRef.current
      const state = readRef.current()
      if (!canvas || !state || !state.width || !state.height) return
      const scale = width / state.width
      const h = Math.round(state.height * scale)
      if (canvas.width !== width || canvas.height !== h) { canvas.width = width; canvas.height = h }
      sizeRef.current = { width: state.width, height: state.height }
      const g = canvas.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, width, h)
      g.fillStyle = 'rgba(10, 14, 24, 0.55)'
      g.fillRect(0, 0, width, h)
      for (const dot of state.dots) {
        g.beginPath()
        g.fillStyle = TONE[dot.tone]
        g.arc(dot.x * scale, dot.y * scale, dot.selected ? 3.5 : 2.5, 0, Math.PI * 2)
        g.fill()
        if (dot.selected) { g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.stroke() }
      }
      const v = state.view
      g.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      g.lineWidth = 1
      g.strokeRect(v.x * scale + 0.5, v.y * scale + 0.5, Math.max(4, v.w * scale - 1), Math.max(4, v.h * scale - 1))
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [width])

  const pan = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { width: ww, height: wh } = sizeRef.current
    onPan(((e.clientX - rect.left) / rect.width) * ww, ((e.clientY - rect.top) / rect.height) * wh)
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={Math.round(width * 0.7)}
      aria-label={label}
      title="Minimap: click or drag to move the view"
      className="absolute bottom-2 end-2 z-10 cursor-crosshair touch-none rounded-md border border-white/30 shadow-lg"
      style={{ width }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pan(e) }}
      onPointerMove={e => { if (e.buttons) pan(e) }}
    />
  )
}
