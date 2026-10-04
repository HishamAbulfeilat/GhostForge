'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccess } from '@/components/AccessGuard'
import { canAccessPage } from '@/lib/title-profiles'

interface Command {
  id: string
  label: string
  description?: string
  icon?: string
  /** Page the command opens; gated by the same rule as the navbar */
  path?: string
  action: () => void
  keywords?: string[]
}

function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const router = useRouter()
  const { user } = useAccess()
  const inputRef = useRef<HTMLInputElement>(null)

  const navigate = (path: string) => {
    router.push(path)
    setOpen(false)
    setQuery('')
  }

  const go = (path: string) => ({ path, action: () => navigate(path) })

  const commands: Command[] = [
    { id: 'jarvis', label: 'Open JARVIS', icon: '🤖', description: 'AI Assistant', ...go('/jarvis'), keywords: ['ai', 'chat', 'voice'] },
    { id: 'dashboard', label: 'Dashboard', icon: '📊', description: 'Project overview', ...go('/dashboard'), keywords: ['home', 'overview'] },
    { id: 'models', label: 'Model Manager', icon: '🧠', description: 'Manage AI models & LLMfit', ...go('/models'), keywords: ['llm', 'ollama', 'llmfit'] },
    { id: 'terminal', label: 'Web Terminal', icon: '💻', description: 'Browser terminal', ...go('/terminal'), keywords: ['shell', 'bash', 'cli'] },
    { id: 'files', label: 'File Explorer', icon: '📁', description: 'Browse project files', ...go('/files'), keywords: ['explorer', 'browse'] },
    { id: 'features', label: 'Features', icon: '⚡', description: 'All GhostForge features', ...go('/features'), keywords: ['commands', 'tools'] },
    { id: 'marketplace', label: 'Marketplace', icon: '🛒', description: 'Extensions & plugins', ...go('/marketplace'), keywords: ['plugins', 'extensions'] },
    { id: 'snippets', label: 'Snippets', icon: '📋', description: 'Saved code snippets', ...go('/snippets'), keywords: ['code', 'clipboard', 'templates'] },
    { id: 'settings',label: 'Settings', icon: '⚙️', description: 'Configure GhostForge', ...go('/settings'), keywords: ['config', 'preferences'] },
    { id: 'history', label: 'JARVIS History', icon: '📜', description: 'Past conversations', ...go('/history'), keywords: ['memory', 'sessions', 'timeline'] },
    { id: 'mac-control', label: 'Mac Control', icon: '🖥️', description: 'System automation', ...go('/mac-control'), keywords: ['automation', 'system'] },
    { id: 'health', label: 'Health Check', icon: '🏥', description: 'Project health status', ...go('/dashboard'), keywords: ['check', 'status'] },
    { id: 'users', label: 'Users', icon: '👥', description: 'Manage accounts and access', ...go('/users'), keywords: ['admin', 'accounts', 'permissions'] },
    { id: 'security', label: 'Security Scan', icon: '🛡️', description: 'Run defensive security scans', ...go('/security'), keywords: ['admin', 'audit', 'secrets', 'cve'] },
    { id: 'testing', label: 'Test Runner', icon: '🧪', description: 'Run the project test suites', ...go('/testing'), keywords: ['admin', 'tests', 'qa'] },
    { id: 'code-health', label: 'Code Health', icon: '🩺', description: 'Perf, bundle, unused code and dependencies', ...go('/code-health'), keywords: ['admin', 'bundle', 'deps', 'perf'] },
    { id: 'projects', label: 'Projects', icon: '🗂️', description: 'Registered projects and scaffolding', ...go('/projects'), keywords: ['admin', 'scaffold', 'create', 'template'] },
    { id: 'reload', label: 'Reload Page', icon: '🔄', description: 'Hard reload current page', action: () => { setOpen(false); window.location.reload() }, keywords: ['refresh'] },
    { id: 'theme-toggle', label: 'Toggle Theme', icon: '🎨', description: 'Switch light/dark mode', action: () => { document.documentElement.classList.toggle('light'); setOpen(false) }, keywords: ['dark', 'light', 'mode'] },
  ]

  // Same rule as the navbar and page guard: only pages this user may open.
  // Until the session loads (user is null) only ungated pages are listed.
  const allowed = commands.filter(command => !command.path || canAccessPage(user, command.path))

  const filtered = query.trim() === ''
    ? allowed
    : allowed.filter(command => {
        const loweredQuery = query.toLowerCase()
        return command.label.toLowerCase().includes(loweredQuery)
          || command.description?.toLowerCase().includes(loweredQuery)
          || command.keywords?.some(keyword => keyword.includes(loweredQuery))
      })

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(isOpen => !isOpen)
        setQuery('')
      }

      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timeout)
  }, [open])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex(index => Math.min(index + 1, filtered.length - 1))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex(index => Math.max(index - 1, 0))
    }
    if (event.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close command palette"
        onClick={() => setOpen(false)}
        className="absolute inset-0"
      />
      <div className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <label htmlFor="command-palette-input" className="sr-only">Search commands</label>
          <span className="text-lg text-zinc-400">⌘</span>
          <input
            id="command-palette-input"
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, pages, features..."
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
          />
          <kbd className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-500">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No results for &ldquo;{query}&rdquo;</p>
          ) : filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              onClick={command.action}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors ${index === selectedIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}
            >
              <span className="w-7 text-center text-xl">{command.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{command.label}</p>
                {command.description && <p className="truncate text-xs text-zinc-500">{command.description}</p>}
              </div>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-600">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>⌘K toggle</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
export { CommandPalette }
