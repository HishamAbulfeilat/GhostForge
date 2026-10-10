import type { Dispatch, SetStateAction } from 'react'

interface PermissionBannerProps {
  permissions: { mic: boolean; camera: boolean; screen: boolean }
  permissionError: string | null
  requestAllPermissions: () => Promise<void>
  setShowPermissionBanner: Dispatch<SetStateAction<boolean>>
}

/** Asks for mic and camera access; shows what has been granted so far. */
export default function PermissionBanner({ permissions, permissionError, requestAllPermissions, setShowPermissionBanner }: PermissionBannerProps) {
  return (
    <div className="gfai-fade relative z-20 border-b px-4 py-2 font-mono text-[10px]"
      style={{ borderColor: '#ff6b3522', background: 'rgba(255,107,53,0.05)' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="gfai-blink h-1.5 w-1.5 rounded-full" style={{ background: '#ff6b35' }} />
          <span style={{ color: '#ff6b35' }}>PERMISSIONS REQUIRED</span>
          <span className="text-blue-400/40">— mic &amp; camera needed for voice and vision</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void requestAllPermissions()}
            className="rounded px-3 py-1 border transition text-[10px]"
            style={{ borderColor: '#ff6b3566', color: '#ff6b35', background: 'rgba(255,107,53,0.1)' }}>
            GRANT PERMISSIONS
          </button>
          <button type="button" aria-label="Dismiss permissions banner" onClick={() => setShowPermissionBanner(false)}
            className="text-blue-400/40 hover:text-blue-300 transition">✕</button>
        </div>
      </div>
      {permissionError && (
        <p className="mt-1 text-[9px] text-red-400/70">{permissionError}</p>
      )}
      <div className="mt-1 flex items-center gap-4 text-[9px]">
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full" style={{ background: permissions.mic ? '#00ff88' : '#ff444466' }} />
          <span style={{ color: permissions.mic ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>
            Microphone {permissions.mic ? '✓' : '✗'}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1 w-1 rounded-full" style={{ background: permissions.camera ? '#00ff88' : '#ff444466' }} />
          <span style={{ color: permissions.camera ? '#00ff88' : 'rgba(255,100,100,0.5)' }}>
            Camera {permissions.camera ? '✓' : '✗'}
          </span>
        </span>
      </div>
    </div>
  )
}
