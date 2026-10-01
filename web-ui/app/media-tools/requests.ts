export type MediaTarget = 'youtube' | 'game-updater'

export interface MediaRequest {
  target: MediaTarget
  action: string
  query?: string
  url?: string
  region?: string
  game_name?: string
}

export const YOUTUBE_URL = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i

export const YOUTUBE_ACTIONS = [
  { id: 'play', label: 'Search & play', input: 'query' },
  { id: 'summarize', label: 'Summarize video', input: 'url' },
  { id: 'get_info', label: 'Video info', input: 'url' },
  { id: 'trending', label: 'Trending', input: 'region' },
] as const

export const GAME_ACTIONS = [
  { id: 'list', label: 'List installed games', input: 'none' },
  { id: 'update', label: 'Update games', input: 'game', confirm: 'Start game updates? Downloads may use significant bandwidth.' },
  { id: 'download_status', label: 'Download status', input: 'none' },
  { id: 'schedule_status', label: 'Schedule status', input: 'none' },
] as const

/** Build a validated /api/device-controls body, or return a user-facing error. */
export function buildMediaRequest(
  target: MediaTarget,
  action: string,
  value: string,
  region = 'US',
): { request: MediaRequest } | { error: string } {
  const text = value.trim()
  if (target === 'youtube') {
    if (!YOUTUBE_ACTIONS.some(a => a.id === action)) return { error: 'Choose a YouTube action.' }
    if (action === 'play') {
      if (!text) return { error: 'Enter a search query.' }
      return { request: { target, action, query: text } }
    }
    if (action === 'trending') {
      const code = region.trim().toUpperCase()
      if (!/^[A-Z]{2,3}$/.test(code)) return { error: 'Enter a 2-3 letter country code.' }
      return { request: { target, action, region: code } }
    }
    if (!YOUTUBE_URL.test(text)) return { error: 'Enter a valid YouTube URL (youtube.com or youtu.be).' }
    return { request: { target, action, url: text } }
  }
  if (!GAME_ACTIONS.some(a => a.id === action)) return { error: 'Choose a game updater action.' }
  return { request: { target, action, ...(action === 'update' && text ? { game_name: text } : {}) } }
}
