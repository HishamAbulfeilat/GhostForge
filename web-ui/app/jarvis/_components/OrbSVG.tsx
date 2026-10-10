import { MODE_COLORS, type Mode } from './types'

// ── Orb SVG ───────────────────────────────────────────────────────────────────

export default function OrbSVG({ mode, audioLevel = 0 }: { mode: Mode; audioLevel?: number }) {
  const c = MODE_COLORS[mode]
  const isThinking = mode === 'thinking'
  const isListening = mode === 'listening'
  // Audio-reactive scaling: idle pulses gently, listening pulses with mic level
  const listenScale = isListening ? 1 + audioLevel * 0.4 : 1
  return (
    <svg width="220" height="220" viewBox="0 0 240 240" className="select-none">
      {isThinking && (
        <circle cx="120" cy="120" r="112" fill="none" stroke={c.ring} strokeWidth="1.5"
          strokeDasharray="60 300" strokeLinecap="round" opacity="0.7">
          <animateTransform attributeName="transform" type="rotate"
            from="0 120 120" to="360 120 120" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx="120" cy="120" r="108" fill="none" stroke={c.ring} strokeWidth="0.8" opacity="0.3"
        style={isListening ? { transform: `scale(${listenScale})`, transformOrigin: '120px 120px', transition: 'transform 0.08s ease-out' } : undefined}>
      </circle>
      <circle cx="120" cy="120" r="90" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.45"
        style={isListening ? { transform: `scale(${listenScale * 1.05})`, transformOrigin: '120px 120px', transition: 'transform 0.08s ease-out' } : undefined}>
      </circle>
      <circle cx="120" cy="120" r="78" fill="none" stroke={c.ring} strokeWidth="1.2"
        strokeDasharray="30 180" strokeLinecap="round" opacity="0.5">
        <animateTransform attributeName="transform" type="rotate"
          from="0 120 120" to={isThinking ? '-360 120 120' : '360 120 120'}
          dur={isThinking ? '2s' : '8s'} repeatCount="indefinite" />
      </circle>
      <circle cx="120" cy="120" r="64" fill={c.glow}
        style={isListening ? { opacity: 0.6 + audioLevel * 0.4, transition: 'opacity 0.08s ease-out' } : undefined}>
        {!isListening && <animate attributeName="opacity"
          values={mode === 'idle' ? '0.6;0.9;0.6' : '1;0.8;1'}
          dur={mode === 'idle' ? '3s' : '0.6s'} repeatCount="indefinite" />}
      </circle>
      <circle cx="120" cy="120" r="64" fill="none" stroke={c.ring} strokeWidth="1.5" opacity="0.7" />
      <circle cx="120" cy="120" r="44" fill="#050510" />
      <circle cx="120" cy="120" r="44" fill="none" stroke={c.ring} strokeWidth="2" opacity="0.8">
        <animate attributeName="stroke-width"
          values={mode === 'speaking' ? '2;3.5;2' : '2;2;2'} dur="0.4s" repeatCount="indefinite" />
      </circle>
      <text x="120" y="115" textAnchor="middle" dominantBaseline="middle"
        fontSize="11" fontFamily="monospace" fontWeight="bold" fill={c.ring} opacity="0.9" letterSpacing="2">
        G.F.A.I
      </text>
      <text x="120" y="130" textAnchor="middle" dominantBaseline="middle"
        fontSize="7" fontFamily="monospace" fill={c.ring} opacity="0.6" letterSpacing="1">
        {mode.toUpperCase()}
      </text>
      {mode === 'speaking' && [-3, -1.5, 0, 1.5, 3].map((offset, i) => (
        <rect key={i} x={120 + offset * 6 - 2} y="108" width="3" rx="1.5" fill={c.ring} opacity="0.8">
          <animate attributeName="height" values={`${4 + i * 3};${14 + i * 2};${4 + i * 3}`}
            dur={`${0.3 + i * 0.08}s`} repeatCount="indefinite" />
          <animate attributeName="y" values={`${120 - 2 - i};${120 - 7 - i};${120 - 2 - i}`}
            dur={`${0.3 + i * 0.08}s`} repeatCount="indefinite" />
        </rect>
      ))}
      {mode === 'listening' && (
        <circle cx="120" cy="120" r="20" fill="none" stroke={c.ring} strokeWidth="1" opacity="0.5">
          <animate attributeName="r" values="20;36;20" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}
