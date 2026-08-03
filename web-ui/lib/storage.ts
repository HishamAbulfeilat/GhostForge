'use client'

/**
 * Safe localStorage accessors — never throw, even when storage is
 * unavailable (private mode, quota, sandboxed iframes, SSR).
 */

export function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch { /* storage full / unavailable — ignore */ }
}

export function safeRemove(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch { /* ignore */ }
}

export function safeGetJSON<T>(key: string, fallback: T): T {
  const raw = safeGet(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
