'use client'

import { memo, useEffect, useRef, useState } from 'react'
import ClipboardPanel from './ClipboardPanel'
import type { ClipboardPanelState } from './types'

type ClipboardAction = 'EXPLAIN' | 'SUMMARISE' | 'TRANSLATE' | 'FIX'

const PROMPTS: Record<ClipboardAction, (text: string) => string> = {
  EXPLAIN: text => `Explain this: ${text}`,
  SUMMARISE: text => `Summarise this: ${text}`,
  TRANSLATE: text => `Translate this: ${text}`,
  FIX: text => `Fix this: ${text}`,
}

/**
 * Clipboard intelligence: polls the clipboard every 3 s (desktop only) and
 * offers explain / summarise / translate / fix for new text. Owns its own
 * state and timer, so polling never re-renders the page.
 */
function ClipboardWatcher({ enabled, onPrompt }: { enabled: boolean; onPrompt: (prompt: string) => void }) {
  const [clipboardPanel, setClipboardPanel] = useState<ClipboardPanelState>({ text: '', visible: false })
  const clipboardWatchRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clipboardDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clipboardPrimedRef = useRef(false)
  const lastClipboardRef = useRef('')

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.clipboard?.readText) return

    let active = true
    let dismissTimer: ReturnType<typeof setTimeout> | null = null

    const dismissPanel = () => {
      if (dismissTimer) clearTimeout(dismissTimer)
      dismissTimer = setTimeout(() => {
        if (!active) return
        setClipboardPanel(prev => ({ ...prev, visible: false }))
      }, 10_000)
      clipboardDismissRef.current = dismissTimer
    }

    const pollClipboard = async () => {
      if (document.hidden) return
      try {
        const nextValue = (await navigator.clipboard.readText()).trim()
        if (!active) return
        if (!clipboardPrimedRef.current) {
          clipboardPrimedRef.current = true
          lastClipboardRef.current = nextValue
          return
        }
        if (nextValue.length < 15 || nextValue === lastClipboardRef.current) return
        lastClipboardRef.current = nextValue
        setClipboardPanel({ text: nextValue, visible: true })
        dismissPanel()
      } catch {
        // Clipboard access can be denied by the browser; stay silent.
      }
    }

    void pollClipboard()
    clipboardWatchRef.current = setInterval(() => { void pollClipboard() }, 3000)

    return () => {
      active = false
      if (clipboardWatchRef.current) clearInterval(clipboardWatchRef.current)
      if (dismissTimer) clearTimeout(dismissTimer)
    }
  }, [enabled])

  const sendClipboardAction = (action: ClipboardAction) => {
    const text = clipboardPanel.text.trim()
    if (!text) return
    setClipboardPanel(prev => ({ ...prev, visible: false }))
    if (clipboardDismissRef.current) clearTimeout(clipboardDismissRef.current)
    onPrompt(PROMPTS[action](text))
  }

  if (!clipboardPanel.visible) return null
  return (
    <ClipboardPanel
      text={clipboardPanel.text}
      onAction={sendClipboardAction}
      onClose={() => setClipboardPanel(prev => ({ ...prev, visible: false }))}
    />
  )
}

export default memo(ClipboardWatcher)
