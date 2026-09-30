'use client'

import { useEffect, useMemo, useState } from 'react'
import { safeGet, safeSet } from '@/lib/storage'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isIosDevice(userAgent: string) {
  return /iphone|ipad|ipod/i.test(userAgent)
}

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)
  const [isIos, setIsIos] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(console.error)
    }

    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    const ios = isIosDevice(window.navigator.userAgent)
    const dismissed = safeGet('gf_pwa_dismissed')

    setIsStandalone(standalone)
    setIsIos(ios)

    if (ios && !standalone && !dismissed) setShow(true)

    const handler = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
      if (!dismissed) setShow(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const bannerCopy = useMemo(() => {
    if (isIos && !deferredPrompt) {
      return {
        title: 'Install GhostForge',
        body: 'Use Safari Share → Add to Home Screen for the best mobile experience.',
        actionLabel: 'Got it',
      }
    }

    return {
      title: 'Install GhostForge',
      body: 'Add to home screen for the best experience',
      actionLabel: 'Install',
    }
  }, [deferredPrompt, isIos])

  if (!show || isStandalone) return null

  const dismiss = () => {
    safeSet('gf_pwa_dismissed', '1')
    setShow(false)
  }

  const install = async () => {
    if (!deferredPrompt) {
      dismiss()
      return
    }

    await deferredPrompt.prompt()
    setShow(false)
  }

  return (
    <div className="fixed bottom-4 start-4 end-4 z-50 flex items-center gap-3 rounded-xl border border-zinc-600 bg-zinc-800 p-4 shadow-2xl md:start-auto md:end-4 md:w-80">
      <div className="text-2xl">⚡</div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">{bannerCopy.title}</p>
        <p className="text-xs text-zinc-400">{bannerCopy.body}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={dismiss} className="px-2 py-1 text-xs text-zinc-400 hover:text-white">Later</button>
        <button type="button" onClick={() => void install()} className="rounded-lg bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500">{bannerCopy.actionLabel}</button>
      </div>
    </div>
  )
}
