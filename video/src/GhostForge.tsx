import React from 'react'
import timeline from './timeline.json'
import { AbsoluteFill, Audio, Easing, Sequence, staticFile, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

const C = {
  bg: '#07090f',
  panel: '#111726',
  line: '#24304a',
  text: '#e8eefc',
  muted: '#8a97b3',
  cyan: '#38e1ff',
  violet: '#9b7bff',
  green: '#3ddc97',
  amber: '#ffc857',
}
const FONT = 'Inter, "Segoe UI", "DejaVu Sans", system-ui, sans-serif'
const MONO = '"JetBrains Mono", "DejaVu Sans Mono", monospace'

// Scene timeline (frames at 30 fps), shared with scripts/gen-audio.mjs so the soundtrack stays in sync
type SceneId = 'intro' | 'surfaces' | 'jarvis' | 'agents' | 'jobs' | 'market' | 'hosted' | 'outro'
const SCENES = timeline.scenes as { id: SceneId; len: number }[]
export const TOTAL = SCENES.reduce((n, s) => n + s.len, 0)

const ease = Easing.bezier(0.22, 1, 0.36, 1)
const fadeInOut = (f: number, len: number) =>
  interpolate(f, [0, 12, len - 12, len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
const rise = (f: number, delay = 0, dist = 40) =>
  interpolate(f - delay, [0, 18], [dist, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
const show = (f: number, delay = 0) =>
  interpolate(f - delay, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

const Background: React.FC = () => {
  const f = useCurrentFrame()
  const shift = (f * 0.4) % 80
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line}55 1px, transparent 1px), linear-gradient(90deg, ${C.line}55 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
          backgroundPosition: `0 ${shift}px`,
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(circle at 20% 15%, ${C.violet}22, transparent 45%), radial-gradient(circle at 85% 85%, ${C.cyan}1f, transparent 45%)` }} />
    </AbsoluteFill>
  )
}

const Ghost: React.FC<{ size: number }> = ({ size }) => {
  const f = useCurrentFrame()
  const bob = Math.sin(f / 12) * 6
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: `translateY(${bob}px)`, filter: `drop-shadow(0 0 24px ${C.cyan}88)` }}>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={C.cyan} />
          <stop offset="1" stopColor={C.violet} />
        </linearGradient>
      </defs>
      <path d="M50 8c-20 0-34 15-34 35v45l9-7 8 7 9-7 8 7 8-7 9 7 9-7 8 7V43C84 23 70 8 50 8z" fill="url(#g)" />
      <circle cx="38" cy="44" r="6" fill={C.bg} />
      <circle cx="62" cy="44" r="6" fill={C.bg} />
    </svg>
  )
}

const Title: React.FC<{ kicker: string; title: string; f: number }> = ({ kicker, title, f }) => (
  <div style={{ position: 'absolute', top: 110, left: 140, right: 140, opacity: show(f), transform: `translateY(${rise(f)}px)` }}>
    <div style={{ fontFamily: MONO, color: C.cyan, fontSize: 28, letterSpacing: 4, textTransform: 'uppercase' }}>{kicker}</div>
    <div style={{ fontFamily: FONT, color: C.text, fontSize: 76, fontWeight: 800, marginTop: 12, lineHeight: 1.05 }}>{title}</div>
  </div>
)

const Card: React.FC<{ f: number; delay: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ f, delay, children, style }) => {
  const { fps } = useVideoConfig()
  const s = spring({ frame: f - delay, fps, config: { damping: 14, mass: 0.7 } })
  return (
    <div
      style={{
        background: `linear-gradient(160deg, ${C.panel}, #0b1020)`,
        border: `1px solid ${C.line}`,
        borderRadius: 28,
        padding: 36,
        boxShadow: '0 30px 80px #0008',
        opacity: s,
        transform: `scale(${0.85 + 0.15 * s}) translateY(${(1 - s) * 40}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// 1. Intro
const Intro: React.FC = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: f, fps, config: { damping: 12 } })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: fadeInOut(f, 120) }}>
      <div style={{ transform: `scale(${s})` }}><Ghost size={220} /></div>
      <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: 120, color: C.text, marginTop: 20, opacity: show(f, 10), transform: `translateY(${rise(f, 10)}px)` }}>
        Ghost<span style={{ background: `linear-gradient(90deg, ${C.cyan}, ${C.violet})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>Forge</span>
        <span style={{ color: C.muted, fontWeight: 300 }}> JARVIS</span>
      </div>
      <div style={{ fontFamily: FONT, fontSize: 40, color: C.muted, marginTop: 10, opacity: show(f, 28) }}>
        Your AI development studio, with a voice assistant that never sleeps.
      </div>
    </AbsoluteFill>
  )
}

// 2. Surfaces
const SURFACES = [
  { icon: '🌐', name: 'Web studio', note: 'Next.js app, any browser' },
  { icon: '🖥️', name: 'Desktop', note: 'macOS · Windows · Linux' },
  { icon: '⌨️', name: 'Terminal UI', note: 'Everything from the shell' },
  { icon: '📱', name: 'Android', note: 'Pair with a QR code' },
]
const Surfaces: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ opacity: fadeInOut(f, 150) }}>
      <Title f={f} kicker="One studio" title="Every surface you work on" />
      <div style={{ position: 'absolute', top: 400, left: 140, right: 140, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 32 }}>
        {SURFACES.map((s, i) => (
          <Card key={s.name} f={f} delay={14 + i * 8} style={{ height: 360, display: 'flex', flexDirection: 'column', gap: 40 }}>
            <div style={{ fontSize: 96, height: 120, lineHeight: '120px' }}>{s.icon}</div>
            <div>
              <div style={{ fontFamily: FONT, fontSize: 44, fontWeight: 800, color: C.text }}>{s.name}</div>
              <div style={{ fontFamily: FONT, fontSize: 28, color: C.muted, marginTop: 8 }}>{s.note}</div>
            </div>
          </Card>
        ))}
      </div>
    </AbsoluteFill>
  )
}

// 3. JARVIS voice
const typed = (text: string, f: number, start: number, cps = 1.4) => text.slice(0, Math.max(0, Math.floor((f - start) * cps)))
const Jarvis: React.FC = () => {
  const f = useCurrentFrame()
  const ask = 'JARVIS, run the tests and open a PR.'
  const answer = 'Tests pass. Pull request opened for your review.'
  return (
    <AbsoluteFill style={{ opacity: fadeInOut(f, 180) }}>
      <Title f={f} kicker="Talk to JARVIS" title="Code, test and ship by voice" />
      <div style={{ position: 'absolute', top: 420, left: 140, width: 640, height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {Array.from({ length: 22 }).map((_, i) => {
          const h = 40 + Math.abs(Math.sin(f / 5 + i * 0.7)) * (f < 90 ? 240 : 90) * Math.sin(Math.PI * (i + 1) / 23)
          return <div key={i} style={{ width: 16, height: h, borderRadius: 8, background: `linear-gradient(${C.cyan}, ${C.violet})`, opacity: 0.9 }} />
        })}
      </div>
      <div style={{ position: 'absolute', top: 440, left: 860, right: 140, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Card f={f} delay={10} style={{ alignSelf: 'flex-end', padding: '26px 34px', borderColor: `${C.violet}88` }}>
          <div style={{ fontFamily: FONT, fontSize: 36, color: C.text }}>🎙️ {typed(ask, f, 14)}</div>
        </Card>
        <Card f={f} delay={70} style={{ padding: '26px 34px', borderColor: `${C.cyan}88` }}>
          <div style={{ fontFamily: FONT, fontSize: 36, color: C.text }}>
            <span style={{ color: C.cyan, fontWeight: 800 }}>JARVIS </span>{typed(answer, f, 80)}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 26, color: C.green, marginTop: 18, opacity: show(f, 130) }}>✔ npm test — all checks passed</div>
        </Card>
      </div>
    </AbsoluteFill>
  )
}

// 4. Agent team
const Agents: React.FC = () => {
  const f = useCurrentFrame()
  const boss = { x: 960, y: 470 }
  const workers = [
    { x: 520, y: 760, name: 'Worker · UI' },
    { x: 960, y: 820, name: 'Worker · API' },
    { x: 1400, y: 760, name: 'Worker · Tests' },
  ]
  return (
    <AbsoluteFill style={{ opacity: fadeInOut(f, 180) }}>
      <Title f={f} kicker="Agent team" title="Agents that plan, build and review" />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {workers.map((w, i) => {
          const p = interpolate(f, [20 + i * 6, 50 + i * 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const dot = ((f * 0.02 + i / 3) % 1)
          return (
            <g key={w.name}>
              <line x1={boss.x} y1={boss.y} x2={boss.x + (w.x - boss.x) * p} y2={boss.y + (w.y - boss.y) * p} stroke={C.line} strokeWidth={4} />
              {p === 1 && <circle cx={w.x + (boss.x - w.x) * dot} cy={w.y + (boss.y - w.y) * dot} r={9} fill={C.green} />}
            </g>
          )
        })}
      </svg>
      {[{ ...boss, name: '👑 Boss' }, ...workers].map((n, i) => (
        <div key={n.name} style={{ position: 'absolute', left: n.x - 170, top: n.y - 50, width: 340 }}>
          <Card f={f} delay={i * 8} style={{ padding: '22px 0', textAlign: 'center', borderColor: i === 0 ? `${C.amber}aa` : C.line }}>
            <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 800, color: i === 0 ? C.amber : C.text }}>{n.name}</div>
          </Card>
        </div>
      ))}
      <div style={{ position: 'absolute', bottom: 70, width: '100%', textAlign: 'center', fontFamily: MONO, fontSize: 28, color: C.muted, opacity: show(f, 80) }}>
        reviewed commits → <span style={{ color: C.green }}>agent/integration</span> · watch them live in Agent World
      </div>
    </AbsoluteFill>
  )
}

// 5. Job Hunter
const STEPS = [
  { icon: '🔎', t: 'Find', d: '15+ job boards & company ATS' },
  { icon: '🛡️', t: 'Screen', d: 'Drop stale, broken & scam listings' },
  { icon: '✍️', t: 'Tailor', d: 'CV + cover letter per job' },
  { icon: '✅', t: 'Apply', d: 'Fills the form, you approve' },
]
const GUARDS = ['No captcha solving', 'No invented answers', 'No auto-accepted terms', 'No double submits']
const Jobs: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ opacity: fadeInOut(f, 210) }}>
      <Title f={f} kicker="Job Hunter" title="Upload your CV. It does the rest." />
      <div style={{ position: 'absolute', top: 390, left: 140, right: 140, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 28 }}>
        {STEPS.map((s, i) => (
          <Card key={s.t} f={f} delay={12 + i * 14} style={{ height: 300 }}>
            <div style={{ fontSize: 72 }}>{s.icon}</div>
            <div style={{ fontFamily: FONT, fontSize: 46, fontWeight: 800, color: C.text, marginTop: 18 }}>
              <span style={{ fontFamily: MONO, color: C.cyan, fontSize: 30 }}>0{i + 1} </span>{s.t}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 28, color: C.muted, marginTop: 10 }}>{s.d}</div>
          </Card>
        ))}
      </div>
      <div style={{ position: 'absolute', top: 760, left: 140, right: 140, display: 'flex', gap: 16, flexWrap: 'nowrap' }}>
        {GUARDS.map((g, i) => (
          <div key={g} style={{ fontFamily: FONT, fontSize: 30, whiteSpace: 'nowrap', color: C.green, border: `2px solid ${C.green}66`, background: `${C.green}14`, borderRadius: 999, padding: '14px 24px', opacity: show(f, 90 + i * 10), transform: `translateY(${rise(f, 90 + i * 10, 20)}px)` }}>
            🔒 {g}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

// 6. Marketplace
const ITEMS = ['Gitleaks', 'Semgrep', 'Trivy', 'OSV-Scanner', 'Syft', 'Grype', 'TruffleHog', 'Security scan skill', 'Job Hunter skill', 'Claude Code mods', 'MCP servers', 'Agent templates']
const Market: React.FC = () => {
  const f = useCurrentFrame()
  const count = Math.round(interpolate(f, [10, 70], [0, 65], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }))
  return (
    <AbsoluteFill style={{ opacity: fadeInOut(f, 150) }}>
      <Title f={f} kicker="Marketplace" title="Agents, skills and tools" />
      <div style={{ position: 'absolute', top: 400, left: 140, width: 420 }}>
        <div style={{ fontFamily: FONT, fontSize: 200, fontWeight: 900, color: C.cyan, lineHeight: 1 }}>{count}</div>
        <div style={{ fontFamily: FONT, fontSize: 34, color: C.muted }}>catalog items, with defensive security scanners built in</div>
      </div>
      <div style={{ position: 'absolute', top: 400, left: 640, right: 140, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        {ITEMS.map((t, i) => (
          <div key={t} style={{ fontFamily: FONT, fontSize: 32, color: C.text, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '18px 26px', opacity: show(f, 14 + i * 5), transform: `translateY(${rise(f, 14 + i * 5, 24)}px)` }}>
            {t}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

// 7. Remote + hosted
const Hosted: React.FC = () => {
  const f = useCurrentFrame()
  const cells = Array.from({ length: 81 }, (_, i) => ((i * 37) % 7 < 3 || [0, 1, 9, 10, 7, 8, 16, 17, 63, 64, 72, 73].includes(i)))
  return (
    <AbsoluteFill style={{ opacity: fadeInOut(f, 150) }}>
      <Title f={f} kicker="Anywhere" title="Pair your phone. Share with friends." />
      <div style={{ position: 'absolute', top: 380, left: 220 }}>
        <Card f={f} delay={8} style={{ width: 360, height: 560, borderRadius: 48, padding: 30, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 26px)', gap: 3, padding: 16, background: '#fff', borderRadius: 12 }}>
            {cells.map((on, i) => <div key={i} style={{ width: 26, height: 26, background: on && show(f, 20 + (i % 9) * 2) > 0.5 ? '#000' : '#fff' }} />)}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 30, color: C.text, textAlign: 'center' }}>Scan to pair</div>
        </Card>
      </div>
      <div style={{ position: 'absolute', top: 420, left: 720, right: 140, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {[
          ['📲', 'Remote control', 'Answer Job Hunter questions and take over from your phone'],
          ['🏠', 'Hosted mode', 'Run one server for friends, each with their own account'],
          ['🧱', 'Fail-closed', 'Anything not on the allowlist is blocked by default'],
        ].map(([icon, t, d], i) => (
          <Card key={t} f={f} delay={30 + i * 14} style={{ padding: '26px 34px', display: 'flex', gap: 26, alignItems: 'center' }}>
            <div style={{ fontSize: 60 }}>{icon}</div>
            <div>
              <div style={{ fontFamily: FONT, fontSize: 40, fontWeight: 800, color: C.text }}>{t}</div>
              <div style={{ fontFamily: FONT, fontSize: 28, color: C.muted, marginTop: 6 }}>{d}</div>
            </div>
          </Card>
        ))}
      </div>
    </AbsoluteFill>
  )
}

// 8. Outro
const Outro: React.FC = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: f, fps, config: { damping: 12 } })
  const out = interpolate(f, [130, 150], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: Math.min(show(f), out) }}>
      <div style={{ transform: `scale(${s})` }}><Ghost size={180} /></div>
      <div style={{ fontFamily: FONT, fontSize: 96, fontWeight: 900, color: C.text, marginTop: 16 }}>Build with JARVIS.</div>
      <div style={{ fontFamily: FONT, fontSize: 38, color: C.muted, marginTop: 14, opacity: show(f, 20) }}>Open source · Web · Desktop · Terminal · Android</div>
      <div style={{ fontFamily: MONO, fontSize: 34, color: C.cyan, marginTop: 40, padding: '18px 34px', border: `2px solid ${C.cyan}66`, borderRadius: 16, opacity: show(f, 36) }}>
        github.com/HishamAbulfeilat/GhostForge
      </div>
    </AbsoluteFill>
  )
}

const VIEWS: Record<SceneId, React.FC> = {
  intro: Intro, surfaces: Surfaces, jarvis: Jarvis, agents: Agents, jobs: Jobs, market: Market, hosted: Hosted, outro: Outro,
}

export const GhostForge: React.FC = () => {
  let from = 0
  return (
    <AbsoluteFill>
      <Audio src={staticFile('soundtrack.wav')} />
      <Background />
      {SCENES.map(s => {
        const View = VIEWS[s.id]
        const el = (
          <Sequence key={s.id} from={from} durationInFrames={s.len}>
            <View />
          </Sequence>
        )
        from += s.len
        return el
      })}
    </AbsoluteFill>
  )
}
