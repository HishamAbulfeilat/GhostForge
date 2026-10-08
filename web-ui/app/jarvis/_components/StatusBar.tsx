interface StatusBarProps {
  mc: { ring: string; glow: string }
  liveModel: { provider: string; model: string } | null
  selectedProvider: string
  selectedModel: string
  activeModel: { provider: string; model: string } | null
  offlineMode: boolean
}

/** Bottom HUD bar: version, current model and privacy mode. */
export default function StatusBar({ mc, liveModel, selectedProvider, selectedModel, activeModel, offlineMode }: StatusBarProps) {
  return (
    <div className="relative z-10 flex shrink-0 items-center justify-between border-t px-4 py-1 font-mono text-[9px]"
      style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,5,20,0.92)', color: `${mc.ring}55` }}>
      <span>G.F.A.I. v4.7 — GHOSTFORGE AI SYSTEM</span>
      <span style={{ color: liveModel ? mc.ring : `${mc.ring}44` }}>
        {liveModel
          ? `⚡ ${liveModel.provider}/${liveModel.model?.split('/').pop()?.split(':')[0]}`
          : selectedProvider
            ? `→ ${selectedModel?.split('/').pop()?.split(':')[0]} (pending)`
            : activeModel
              ? `${activeModel.provider}/${activeModel.model}`
              : 'AI ENGINE STANDBY'}
      </span>
      <span>{offlineMode ? 'OFFLINE · LOCAL ONLY · SECURE' : 'PRIVATE · LOCAL · SECURE'}</span>
    </div>
  )
}
