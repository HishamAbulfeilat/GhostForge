'use client'

import { useEffect, useState } from 'react'

// ── Clock ─────────────────────────────────────────────────────────────────────

export default function Clock() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="text-end font-mono">
      <div className="text-xl font-bold text-blue-300 tracking-widest">{time}</div>
      <div className="text-[9px] text-blue-400/60 tracking-widest uppercase">{date}</div>
    </div>
  )
}
