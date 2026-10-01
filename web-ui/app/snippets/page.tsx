'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Listing = { docs: string[]; snippets: string[] }
type Selection = { kind: 'doc' | 'snippet'; name: string }

export default function SnippetsPage() {
  const router = useRouter()
  const [listing, setListing] = useState<Listing | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'doc', name: 'README.md' })
  const [content, setContent] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/snippets')
      .then(res => {
        if (res.status === 401) { router.push('/login'); return null }
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        return res.json() as Promise<Listing>
      })
      .then(data => { if (data) setListing(data) })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load.'))
  }, [router])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/snippets?${selection.kind}=${encodeURIComponent(selection.name)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`)
        return data as { content: string }
      })
      .then(data => { if (!cancelled) { setContent(data.content); setError('') } })
      .catch(err => { if (!cancelled) { setContent(''); setError(err instanceof Error ? err.message : 'Failed to load.') } })
    return () => { cancelled = true }
  }, [selection])

  const item = (kind: Selection['kind'], name: string) => {
    const active = selection.kind === kind && selection.name === name
    return (
      <li key={`${kind}:${name}`}>
        <button
          type="button"
          onClick={() => setSelection({ kind, name })}
          className={`w-full rounded px-3 py-1.5 text-start text-sm ${active ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5'}`}
        >
          {name}
        </button>
      </li>
    )
  }

  return (
    <main className="mx-auto max-w-6xl p-6 text-gray-200">
      <h1 className="mb-1 text-2xl font-semibold">Snippets, Changelog &amp; README</h1>
      <p className="mb-6 text-sm text-gray-500">Read-only view of the repository snippet library and project docs.</p>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="shrink-0 md:w-64" aria-label="Documents and snippets">
          <h2 className="mb-2 px-3 text-xs uppercase tracking-wide text-gray-500">Docs</h2>
          <ul className="mb-4">{(listing?.docs ?? ['README.md', 'CHANGELOG.md']).map(n => item('doc', n))}</ul>
          <h2 className="mb-2 px-3 text-xs uppercase tracking-wide text-gray-500">Snippets</h2>
          <ul>{(listing?.snippets ?? []).map(n => item('snippet', n))}</ul>
        </nav>
        <section className="min-w-0 flex-1" aria-live="polite">
          {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/30 p-4 text-sm" dir="auto">{content}</pre>
        </section>
      </div>
    </main>
  )
}
