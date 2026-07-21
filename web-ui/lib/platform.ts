/**
 * Platform detection utilities for GhostForge
 * Detects device type and determines which features are available
 */

'use client'

import { useState, useEffect } from 'react'

export type PlatformType = 'mac' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown'
export type LanguageCode = 'en' | 'ar' | 'fr' | 'es' | 'de' | 'zh' | 'ja' | 'ko' | string

export interface Platform {
  type: PlatformType
  isMobile: boolean
  isMac: boolean
  isIOS: boolean
  isAndroid: boolean
  isWindows: boolean
  isLinux: boolean
  isDesktop: boolean
  // Feature availability
  hasMacControl: boolean     // AppleScript, mac_control tool
  hasShellAccess: boolean    // terminal_command, execute_code (server-side)
  hasScreenCapture: boolean  // screencapture binary
  hasVoiceInput: boolean     // Web Speech API
  hasTouchscreen: boolean
  hasHover: boolean
  // Display
  prefersDark: boolean
  prefersReducedMotion: boolean
  browserLang: LanguageCode
  isRTL: boolean
}

/** Detect platform from user-agent */
function detectPlatform(): Platform {
  if (typeof window === 'undefined') {
    return defaultPlatform()
  }

  const ua = navigator.userAgent.toLowerCase()
  const lang = (navigator.language || 'en').split('-')[0].toLowerCase() as LanguageCode

  const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /android/.test(ua)
  const isMac = /macintosh|mac os x/.test(ua) && !isIOS
  const isWindows = /windows/.test(ua)
  const isLinux = /linux/.test(ua) && !isAndroid
  const isMobile = isIOS || isAndroid || /mobile/.test(ua)

  let type: PlatformType = 'unknown'
  if (isIOS) type = 'ios'
  else if (isAndroid) type = 'android'
  else if (isMac) type = 'mac'
  else if (isWindows) type = 'windows'
  else if (isLinux) type = 'linux'

  const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'dv'])
  const isRTL = RTL_LANGS.has(lang)

  // hasMacControl/hasShellAccess — these run server-side, only available when the
  // GhostForge server is running on a Mac. We detect via a server hint if available.
  // On the client: we allow them on all platforms (server will decide execution),
  // but we HIDE the Mac-specific UI on non-Mac clients.
  const hasMacControl = isMac  // only show in UI on Mac
  const hasShellAccess = true  // server-side always, but UI shows warning on mobile

  return {
    type,
    isMobile,
    isMac,
    isIOS,
    isAndroid,
    isWindows,
    isLinux,
    isDesktop: !isMobile,
    hasMacControl,
    hasShellAccess,
    hasScreenCapture: isMac,
    hasVoiceInput: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    hasTouchscreen: navigator.maxTouchPoints > 0,
    hasHover: window.matchMedia('(hover: hover)').matches,
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    browserLang: lang,
    isRTL,
  }
}

function defaultPlatform(): Platform {
  return {
    type: 'unknown', isMobile: false, isMac: false, isIOS: false,
    isAndroid: false, isWindows: false, isLinux: false, isDesktop: true,
    hasMacControl: false, hasShellAccess: true, hasScreenCapture: false,
    hasVoiceInput: false, hasTouchscreen: false, hasHover: true,
    prefersDark: true, prefersReducedMotion: false, browserLang: 'en', isRTL: false,
  }
}

/** Hook — returns platform info, updates after hydration */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>(defaultPlatform)

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  return platform
}

/** Detect language from text content (simple heuristic) */
export function detectLanguage(text: string): LanguageCode {
  // Arabic Unicode range: \u0600-\u06FF
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'
  // Chinese
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh'
  // Japanese
  if (/[\u3040-\u30FF]/.test(text)) return 'ja'
  // Korean
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'
  // French (common words)
  if (/\b(le|la|les|un|une|des|est|et|en|je|vous|nous|bonjour|merci)\b/i.test(text)) return 'fr'
  // Spanish
  if (/\b(el|la|los|las|un|una|es|y|en|yo|tu|hola|gracias)\b/i.test(text)) return 'es'
  return 'en'
}

/** Get speech recognition language code for a detected language */
export function getSpeechLang(lang: LanguageCode): string {
  const map: Record<string, string> = {
    ar: 'ar-SA', en: 'en-US', fr: 'fr-FR', es: 'es-ES',
    de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
  }
  return map[lang] || 'en-US'
}

/** Platform-specific feature label for UI */
export function platformLabel(platform: Platform): string {
  if (platform.isIOS) return '📱 iPhone/iPad'
  if (platform.isAndroid) return '📱 Android'
  if (platform.isMac) return '🖥 Mac'
  if (platform.isWindows) return '🖥 Windows'
  if (platform.isLinux) return '🖥 Linux'
  return '🌐 Web'
}
