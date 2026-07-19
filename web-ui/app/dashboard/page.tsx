'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MacStatus } from '@/components/MacStatus'

const envVars = [
  { key: 'ACCESS_PIN', desc: 'Your login PIN (e.g. 9876)', required: true },
  { key: 'AUTH_SECRET', desc: 'Any random secret string', required: true },
  { key: 'OPENROUTER_API_KEY', desc: 'From openrouter.ai/keys (free models)', required: false },
  { key: 'GOOGLE_GENERATIVE_AI_API_KEY', desc: 'From aistudio.google.com (free)', required: false },
  { key: 'WS_BRIDGE_URL', desc: 'Tunnel URL from bridge.sh (optional)', required: false },
  { key: 'WS_BRIDGE_TOKEN', desc: 'Bridge auth token (from bridge.sh output)', required: false },
]

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    void fetch('/api/auth').then(response => {
      if (!response.ok) {
        router.push('/login')
      }
    })
  }, [router])

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-gray-950 px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push('/chat')} className="text-gray-400 transition hover:text-white">
            ←
          </button>
          <h1 className="text-lg font-bold text-white">⚙️ GhostForge Dashboard</h1>
        </div>
        <MacStatus status="unknown" />
      </div>

      <div className="mb-4 rounded-[28px] border border-gray-800 bg-gray-900/95 p-5 shadow-tactical">
        <h2 className="mb-3 text-white font-semibold">🔌 Mac Bridge Setup</h2>
        <p className="mb-3 text-sm text-gray-400">Connect your Mac to run commands remotely from this UI.</p>
        <div className="mb-3 rounded-xl bg-gray-800 p-3 font-mono text-sm text-emerald-400">
          # On your Mac:
          <br />
          bash ~/ghostforge-agents/scripts/bridge.sh start
        </div>
        <p className="text-xs text-gray-500">
          The bridge starts a local server plus optional Cloudflare tunnel. Copy the tunnel URL and add it as
          <span className="mx-1 text-sky-400">WS_BRIDGE_URL</span>
          in Vercel.
        </p>
      </div>

      <div className="mb-4 rounded-[28px] border border-gray-800 bg-gray-900/95 p-5 shadow-tactical">
        <h2 className="mb-3 text-white font-semibold">🔑 Required Environment Variables</h2>
        <div className="space-y-2 text-sm">
          {envVars.map(variable => (
            <div key={variable.key} className="flex items-start gap-2">
              <span
                className={`mt-0.5 rounded px-1.5 py-0.5 text-xs ${
                  variable.required ? 'bg-red-950 text-red-300' : 'bg-gray-800 text-gray-400'
                }`}
              >
                {variable.required ? 'required' : 'optional'}
              </span>
              <div>
                <code className="text-sky-400">{variable.key}</code>
                <span className="ml-2 text-gray-400">{variable.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[28px] border border-gray-800 bg-gray-900/95 p-5 shadow-tactical">
        <h2 className="mb-3 text-white font-semibold">🚀 Deploy to Vercel</h2>
        <div className="space-y-2 text-sm text-gray-300">
          <p>1. <code className="text-emerald-400">cd ~/ghostforge-agents/web-ui && npm install</code></p>
          <p>2. <code className="text-emerald-400">npx vercel login</code></p>
          <p>3. <code className="text-emerald-400">npx vercel --prod</code></p>
          <p>4. Add env vars in Vercel dashboard → Settings → Environment Variables</p>
          <p>5. Redeploy after adding env vars</p>
        </div>
      </div>
    </div>
  )
}
