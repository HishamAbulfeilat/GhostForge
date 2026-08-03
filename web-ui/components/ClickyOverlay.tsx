'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'

interface CursorTarget {
  x: number
  y: number
  label?: string
  screen?: number
  timestamp: number
}

interface ClickyOverlayProps {
  target?: CursorTarget | null
  point?: { x: number; y: number; label?: string | null } | null
  highlight?: { x: number; y: number; w: number; h: number } | null
  duration?: number
  onDismiss?: () => void
}

export default function ClickyOverlay({ target, point, highlight, duration = 5000, onDismiss }: ClickyOverlayProps) {
  // Normalize: point prop maps to target internally. Memoized so parent
  // re-renders don't recreate the object and restart the animation/dismiss timer.
  const effectiveTarget = useMemo(
    () => target || (point ? { ...point, timestamp: Date.now() } : null),
    [target, point]
  )
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [label, setLabel] = useState<string | null>(null)
  const [pulse, setPulse] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animRef = useRef<number | null>(null)

  const animate = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const start = performance.now()
    const duration = 400

    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)

      setPosition({
        x: from.x + (to.x - from.x) * ease,
        y: from.y + (to.y - from.y) * ease,
      })

      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        setPulse(true)
        if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
        pulseTimeoutRef.current = setTimeout(() => setPulse(false), 600)
      }
    }

    animRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (!effectiveTarget) {
      setVisible(false)
      return
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (animRef.current) cancelAnimationFrame(animRef.current)
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)

    const from = { x: position.x || effectiveTarget.x - 100, y: position.y || effectiveTarget.y - 100 }
    const to = { x: effectiveTarget.x, y: effectiveTarget.y }

    setVisible(true)
    setLabel(effectiveTarget.label || null)
    animate(from, to)

    timeoutRef.current = setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, duration)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current)
    }
  }, [effectiveTarget, duration, onDismiss, animate])

  // Highlight overlay
  if (highlight) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[9999]">
        <div
          className="absolute rounded-lg"
          style={{
            left: highlight.x,
            top: highlight.y,
            width: highlight.w,
            height: highlight.h,
            border: '2px solid rgba(59,130,246,0.7)',
            background: 'rgba(59,130,246,0.08)',
            boxShadow: '0 0 16px rgba(59,130,246,0.3)',
            animation: 'clickyFadeIn 0.2s ease-out',
          }}
        />
      </div>
    )
  }

  if (!visible || !effectiveTarget) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {/* Blue cursor */}
      <div
        className="absolute"
        style={{
          left: position.x,
          top: position.y,
          transform: 'translate(-2px, -2px)',
          transition: 'none',
        }}
      >
        {/* Cursor dot */}
        <div
          className="relative"
          style={{
            width: 16,
            height: 16,
          }}
        >
          {/* Outer ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(59,130,246,0.8) 0%, rgba(59,130,246,0.3) 50%, transparent 70%)',
              transform: pulse ? 'scale(2.5)' : 'scale(1.5)',
              transition: 'transform 0.3s ease-out',
            }}
          />
          {/* Inner dot */}
          <div
            className="absolute rounded-full"
            style={{
              width: 8,
              height: 8,
              left: 4,
              top: 4,
              background: '#3b82f6',
              boxShadow: '0 0 12px 4px rgba(59,130,246,0.6)',
            }}
          />
          {/* Crosshair lines */}
          <div
            className="absolute"
            style={{
              width: 1,
              height: 24,
              left: 7.5,
              top: -4,
              background: 'linear-gradient(to bottom, transparent, rgba(59,130,246,0.4), transparent)',
            }}
          />
          <div
            className="absolute"
            style={{
              width: 24,
              height: 1,
              left: -4,
              top: 7.5,
              background: 'linear-gradient(to right, transparent, rgba(59,130,246,0.4), transparent)',
            }}
          />
        </div>

        {/* Label */}
        {label && (
          <div
            className="absolute left-5 top-5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium text-white shadow-lg"
            style={{
              background: 'rgba(15, 23, 42, 0.92)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(59,130,246,0.3)',
              animation: 'clickyFadeIn 0.2s ease-out',
            }}
          >
            {label}
          </div>
        )}
      </div>
    </div>
  )
}

export type { CursorTarget }
