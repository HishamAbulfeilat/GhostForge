import { NextRequest, NextResponse } from 'next/server'
import { chooseBestInstalledModel } from '@/lib/local-runtime'
import { totalmem } from 'os'
import { getCurrentUser, isAuthorizedRequest } from '@/lib/auth'
import { isOmniRouteUp } from '@/lib/ai'
import { isHostedMode, ownerEnv } from '@/lib/hosted'
import { PROVIDERS, getProviderKey, getSavedSelection, listCustomModels, listProviderModels, runWithAIUser, type ProviderId } from '@/lib/providers'

interface JarvisModel {
  provider: string
  id: string
  label: string
  free: boolean
  requiresKey: string | null
  available: boolean
}

/** Suggested local models, shown (unavailable) until pulled into Ollama */
const LOCAL_SUGGESTIONS = [
  { id: 'qwen3.5:9b',       label: 'Qwen 3.5 9B (Recommended) 🔒' },
  { id: 'qwen3.5:27b',      label: 'Qwen 3.5 27B (Max Quality) 🔒' },
  { id: 'qwen3.5:4b',       label: 'Qwen 3.5 4B (Fast) 🔒' },
  { id: 'llama3.2:3b',      label: 'Llama 3.2 3B (Local) 🔒' },
  { id: 'qwen2.5-coder:7b', label: 'Qwen 2.5 Coder 7B (Local) 🔒' },
]

/**
 * Every provider's models: the live list when usable, else its known-free list
 * (or default) as an unavailable placeholder. Pollinations needs no key.
 */
async function cloudModels(omniUp: boolean): Promise<JarvisModel[]> {
  const lists = await Promise.all((Object.keys(PROVIDERS) as ProviderId[]).map(async provider => {
    const info = PROVIDERS[provider]
    if (provider === 'omniroute' && !omniUp) return []
    const usable = provider === 'omniroute' || !info.keyEnv || !!getProviderKey(provider)
    const listed = (await listProviderModels(provider)).models
    const models = listed.length ? listed : [{ id: info.defaultModel, label: info.defaultModel, free: !info.paid }]
    return models.map(m => ({
      provider,
      id: m.id,
      label: `${m.label}${m.free ? ' (Free)' : ''} · ${info.name}`,
      free: m.free,
      requiresKey: info.keyEnv,
      available: usable,
    }))
  }))
  const custom = listCustomModels().map(m => ({
    provider: 'custom',
    id: m.id,
    label: `${m.name} (${m.model}) · Custom`,
    free: !!m.free,
    requiresKey: null,
    available: true,
  }))
  return [...lists.flat(), ...custom]
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const me = await getCurrentUser(req)
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Hosted mode: the caller's own keys and model choice
  return runWithAIUser(me.id, () => listJarvisModels())
}

async function listJarvisModels() {
  const hosted = isHostedMode()

  // Check Ollama availability (the host's local runtimes are not offered when hosted)
  let ollamaModels: string[] = []
  let ollamaRunning = false
  if (!hosted) try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      const d = await res.json() as { models: Array<{ name: string }> }
      ollamaModels = d.models.map(m => m.name)
      ollamaRunning = true
    }
  } catch { /* not running */ }

  let llamaCppModels: string[] = []
  if (!hosted) try {
    const baseURL = process.env.LLAMACPP_URL || 'http://localhost:8080/v1'
    const res = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ id?: string }> }
      llamaCppModels = (data.data || []).map(model => model.id || '').filter(Boolean)
    }
  } catch { /* not running */ }

  const omniUp = await isOmniRouteUp()
  const models: JarvisModel[] = await cloudModels(omniUp)

  // Installed Ollama models, then suggestions that aren't pulled yet
  for (const name of ollamaModels) {
    models.push({ provider: 'ollama', id: name, label: `${name} (Local) 🔒`, free: true, requiresKey: null, available: true })
  }
  for (const s of hosted ? [] : LOCAL_SUGGESTIONS) {
    if (!ollamaModels.includes(s.id)) {
      models.push({ provider: 'ollama', id: s.id, label: s.label, free: true, requiresKey: null, available: false })
    }
  }

  for (const name of llamaCppModels) {
    models.push({ provider: 'llamacpp', id: name, label: `${name} (llama.cpp) 🔒`, free: true, requiresKey: null, available: true })
  }

  // Active model: the one saved in Settings, else automatic free models
  // (free-tier keys → OmniRoute if running → keyless Pollinations → local)
  const saved = getSavedSelection()
  const firstFreeKeyed = (['google', 'groq', 'cerebras', 'openrouter', 'nvidia'] as ProviderId[]).find(p => getProviderKey(p))
  const fallback = firstFreeKeyed
    ? { provider: firstFreeKeyed, model: PROVIDERS[firstFreeKeyed].defaultModel }
    : omniUp
      ? { provider: 'omniroute', model: PROVIDERS.omniroute.defaultModel }
      : { provider: 'pollinations', model: PROVIDERS.pollinations.defaultModel }
  const activeProvider = saved?.provider ?? fallback.provider
  const activeModel = saved?.model ?? fallback.model

  const hasFishAudio  = !!ownerEnv('FISH_AUDIO_API_KEY')
  const hasElevenLabs = !!ownerEnv('ELEVENLABS_API_KEY')
  const ttsEngine     = hasFishAudio ? 'fish-audio' : hasElevenLabs ? 'elevenlabs' : 'browser'

  return NextResponse.json({
    models,
    active: { provider: activeProvider, model: activeModel },
    ollama: { running: ollamaRunning, models: ollamaModels },
    llamaCpp: { running: llamaCppModels.length > 0, models: llamaCppModels },
    host: {
      platform: process.platform,
      hosted,
      macControl: !hosted && process.platform === 'darwin',
      screenCapture: !hosted && process.platform === 'darwin',
      browserControl: !hosted && process.platform === 'darwin',
      shell: !hosted,
      remoteClientControl: !hosted,
      freeLocalAI: ollamaRunning || llamaCppModels.length > 0,
    },
    tts: {
      engine: ttsEngine,
      fishAudio:    hasFishAudio,
      elevenLabs:   hasElevenLabs,
      jarvisVoice:  hasFishAudio,
      jarvisModelId: process.env.FISH_AUDIO_JARVIS_MODEL || '36b6f66cfecf466caac7fcba1f8b59c8',
    },
    integrations: {
      elevenlabs:   hasElevenLabs,
      fishAudio:    hasFishAudio,
      github:       !!ownerEnv('GITHUB_TOKEN'),
      googleSearch: !!(ownerEnv('GOOGLE_SEARCH_API_KEY') && ownerEnv('GOOGLE_SEARCH_CX')),
      discord:      !!ownerEnv('DISCORD_WEBHOOK_URL'),
      grok:         !!getProviderKey('xai'),
    },
  })
}
