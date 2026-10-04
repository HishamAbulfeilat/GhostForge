'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => (
  <div className="flex h-full items-center justify-center text-sm text-white/30">Loading editor…</div>
)})

interface FileItem {
  name: string
  isDir: boolean
  icon: string
  ext: string
  path: string
}

interface DirData {
  type: 'dir'
  path: string
  items: FileItem[]
}

interface FileData {
  type: 'file'
  path: string
  content: string
}

const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.md': 'markdown', '.css': 'css', '.html': 'html',
  '.sh': 'shell', '.py': 'python', '.go': 'go', '.rs': 'rust',
  '.yml': 'yaml', '.yaml': 'yaml', '.env': 'ini', '.lock': 'json',
  '.txt': 'plaintext',
}

export default function FilesPage() {
  // /projects links here with ?path=<project>, so open that directory instead of
  // the default. A bad or unreadable path falls back to the default below.
  const initialPath = useSearchParams().get('path')
  const [currentPath, setCurrentPath] = useState(initialPath || '~/GhostForge')
  const [dirData, setDirData] = useState<DirData | null>(null)
  const [openFile, setOpenFile] = useState<FileData | null>(null)
  const [editContent, setEditContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<string[]>(['~/GhostForge'])

  const loadDir = useCallback(async (p: string) => {
    setLoading(true); setError(''); setOpenFile(null)
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(p)}`)
      const data = await res.json() as DirData | { error: string }
      if ('error' in data) { setError(data.error); return }
      setDirData(data as DirData)
      setCurrentPath(p)
    } catch { setError('Failed to load directory') }
    finally { setLoading(false) }
  }, [])

  const openFileHandler = useCallback(async (p: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(p)}&content=1`)
      const data = await res.json() as FileData | { error: string }
      if ('error' in data) { setError(data.error); return }
      setOpenFile(data as FileData)
      setEditContent((data as FileData).content)
      setDirty(false)
    } catch { setError('Failed to open file') }
    finally { setLoading(false) }
  }, [])

  const saveFile = async () => {
    if (!openFile) return
    setSaving(true)
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: openFile.path, content: editContent }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (data.error) { setError(data.error); return }
      setDirty(false)
    } catch { setError('Failed to save') }
    finally { setSaving(false) }
  }

  const navigate = (p: string) => {
    setHistory(h => [...h, p])
    loadDir(p)
  }

  const goBack = () => {
    if (history.length <= 1) return
    const newHistory = history.slice(0, -1)
    setHistory(newHistory)
    loadDir(newHistory[newHistory.length - 1])
  }

  // Re-runs when ?path changes, so a /projects → /files link opens that project.
  useEffect(() => { loadDir(initialPath || '~/GhostForge') }, [loadDir, initialPath])

  // Keyboard save ⌘S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && dirty) { e.preventDefault(); void saveFile() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const ext = openFile ? (openFile.path.match(/\.[^.]+$/)??[''])[0] : ''
  const lang = EXT_LANG[ext] ?? 'plaintext'

  // Breadcrumbs from absolute path
  const parts = (dirData?.path ?? currentPath).split('/').filter(Boolean)

  return (
    <div className="flex h-[100dvh] flex-col bg-gray-950">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-gray-950/95 px-4 py-2.5 backdrop-blur">
        <span className="text-lg">🗂️</span>
        <div className="flex flex-1 items-center gap-1 text-xs text-white/50 overflow-x-auto scrollbar-none min-w-0">
          <button type="button" aria-label="Go back" onClick={goBack} disabled={history.length <= 1} className="shrink-0 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white disabled:opacity-30 transition">←</button>
          <span className="shrink-0 text-white/20">/</span>
          {parts.map((part, i) => {
            const cumulativePath = '/' + parts.slice(0, i + 1).join('/')
            return (
              <span key={cumulativePath} className="flex items-center gap-1 shrink-0">
                <button type="button"
                  onClick={() => navigate(cumulativePath)}
                  className="hover:text-white transition"
                >{part}</button>
                {i < parts.length - 1 && <span className="text-white/20">/</span>}
              </span>
            )
          })}
        </div>
        {openFile && (
          <button type="button"
            onClick={saveFile}
            disabled={!dirty || saving}
            className={`shrink-0 rounded border px-2.5 py-1 text-xs transition ${
              dirty
                ? 'border-emerald-600 bg-emerald-950 text-emerald-300 hover:bg-emerald-900'
                : 'border-gray-700 text-gray-500'
            }`}
          >
            {saving ? 'Saving…' : dirty ? '💾 Save (⌘S)' : '✓ Saved'}
          </button>
        )}
        <Link href="/dashboard" className="shrink-0 text-xs text-white/30 hover:text-white transition">← Dashboard</Link>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-e border-white/[0.06] bg-gray-950/40">
          <div className="sticky top-0 border-b border-white/[0.04] bg-gray-950/80 px-3 py-2 backdrop-blur">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Files</p>
          </div>
          {loading && (
            <div className="space-y-1 p-2">
              {[80, 60, 70, 55, 65].map(w => (
                <div key={w} className="h-6 skeleton rounded" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
          {error && <div className="px-3 py-2 text-xs text-red-400 animate-fade-in">{error}</div>}
          {dirData?.items.map(item => (
            <button type="button"
              key={item.path}
              onClick={() => item.isDir ? navigate(item.path) : openFileHandler(item.path)}
              className={`group flex items-center gap-2 px-3 py-2 text-start text-xs transition-all ${
                openFile?.path === item.path
                  ? 'bg-sky-950/60 text-sky-300 border-e-2 border-sky-500'
                  : 'text-white/55 hover:bg-white/[0.04] hover:text-white/90'
              }`}
            >
              <span className="shrink-0 text-sm leading-none">{item.icon}</span>
              <span className="truncate flex-1">{item.name}</span>
              {item.isDir && (
                <span className="ms-auto shrink-0 text-white/20 group-hover:text-white/40 transition">›</span>
              )}
            </button>
          ))}
        </aside>

        {/* Editor / welcome */}
        <div className="flex-1 overflow-hidden">
          {openFile ? (
            <MonacoEditor
              height="100%"
              language={lang}
              theme="vs-dark"
              value={editContent}
              onChange={v => { setEditContent(v ?? ''); setDirty(true) }}
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                lineNumbers: 'on',
                renderLineHighlight: 'all',
                padding: { top: 12 },
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
              <span className="text-5xl">🗂️</span>
              <p className="text-sm">Select a file to view or edit</p>
              <p className="text-xs">⌘S to save · ⌘K command palette</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
