'use client'

import { useState } from 'react'

/** Collapsible: the session object exactly as the detail endpoint returned it. */
export default function RawJson({ value, source }: { value: unknown; source: string }) {
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(value, null, 2)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }
  return (
    <details className="group border-t border-gf-line py-4">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-gf-muted hover:text-gf-ink">
        Raw JSON <span className="font-normal normal-case tracking-normal">· {source}</span>
      </summary>
      <div className="relative mt-3">
        <button type="button" onClick={copy}
          className="absolute end-2 top-2 rounded border border-gf-line bg-gf-surface px-2 py-0.5 text-[11px] hover:border-gf-accent">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <pre className="max-h-96 overflow-auto rounded-lg border border-gf-line bg-gf-bar p-3 font-mono text-[11px] leading-relaxed">{text}</pre>
      </div>
    </details>
  )
}
