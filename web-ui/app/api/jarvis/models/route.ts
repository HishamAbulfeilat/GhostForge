import { NextRequest, NextResponse } from 'next/server'
import { chooseBestInstalledModel } from '@/lib/local-runtime'
import { totalmem } from 'os'
import { isAuthorizedRequest } from '@/lib/auth'
import { isOmniRouteUp } from '@/lib/ai'

const ALL_MODELS = [
  { provider: 'google',      id: 'gemini-2.0-flash',                          label: 'Gemini 2.0 Flash',             free: true,  requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { provider: 'google',      id: 'gemini-2.5-flash',                          label: 'Gemini 2.5 Flash',             free: true,  requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { provider: 'xai',         id: 'grok-3-mini',                               label: 'Grok 3 Mini (xAI) ⚡',        free: false, requiresKey: 'XAI_API_KEY' },
  { provider: 'xai',         id: 'grok-3',                                    label: 'Grok 3 (xAI) ⚡',             free: false, requiresKey: 'XAI_API_KEY' },
  { provider: 'xai',         id: 'grok-beta',                                 label: 'Grok Beta (xAI)',              free: false, requiresKey: 'XAI_API_KEY' },
  { provider: 'openrouter',  id: 'google/gemma-4-26b-a4b-it:free',           label: 'Gemma 4 26B (Free) ✓',        free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'nvidia/nemotron-3-super-120b-a12b:free',   label: 'Nemotron 120B (Free) ✓',      free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'nvidia/nemotron-nano-12b-v2-vl:free',      label: 'Nemotron Nano 12B (Free) ✓',  free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'deepseek/deepseek-r1:free',                label: 'DeepSeek R1 (Free)',           free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'ollama',      id: 'qwen3.5:9b',                               label: 'Qwen 3.5 9B (Recommended) 🔒', free: true, requiresKey: null },
  { provider: 'ollama',      id: 'qwen3.5:27b',                              label: 'Qwen 3.5 27B (Max Quality) 🔒', free: true, requiresKey: null },
  { provider: 'ollama',      id: 'qwen3.5:4b',                               label: 'Qwen 3.5 4B (Fast) 🔒',        free: true, requiresKey: null },
  { provider: 'ollama',      id: 'llama3.2:3b',                              label: 'Llama 3.2 3B (Local) 🔒',    free: true,  requiresKey: null },
  { provider: 'ollama',      id: 'qwen2.5-coder:7b',                        label: 'Qwen 2.5 Coder 7B (Local) 🔒', free: true, requiresKey: null },
  { provider: 'omniroute',   id: 'auto/coding',                              label: 'OmniRoute Auto (Local)',       free: true,  requiresKey: null },
]

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check Ollama availability
  let ollamaModels: string[] = []
  let ollamaRunning = false
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      const d = await res.json() as { models: Array<{ name: string }> }
      ollamaModels = d.models.map(m => m.name)
      ollamaRunning = true
    }
  } catch { /* not running */ }

  let llamaCppModels: string[] = []
  try {
    const baseURL = process.env.LLAMACPP_URL || 'http://localhost:8080/v1'
    const res = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ id?: string }> }
      llamaCppModels = (data.data || []).map(model => model.id || '').filter(Boolean)
    }
  } catch { /* not running */ }

  const models = await Promise.all(ALL_MODELS.map(async m => ({
    ...m,
    available: m.provider === 'ollama'
      ? ollamaRunning && ollamaModels.includes(m.id)
      : m.provider === 'omniroute'
        ? await isOmniRouteUp()
        : m.requiresKey ? !!process.env[m.requiresKey] : true,
  })))

  // Add any Ollama models not in the static list
  for (const name of ollamaModels) {
    if (!models.some(m => m.id === name)) {
      models.push({ provider: 'ollama', id: name, label: `${name} (Local) 🔒`, free: true, requiresKey: null, available: true })
    }
  }

  for (const name of llamaCppModels) {
    models.push({ provider: 'llamacpp', id: name, label: `${name} (llama.cpp) 🔒`, free: true, requiresKey: null, available: true })
  }

  const hasGemini = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY
  const bestLocal = chooseBestInstalledModel(ollamaModels, Math.round(totalmem() / 1024 ** 3), 'tools')?.name
  const activeProvider = hasGemini ? 'google' : hasOpenRouter ? 'openrouter' : bestLocal ? 'ollama' : llamaCppModels.length ? 'llamacpp' : 'omniroute'
  const activeModel = hasGemini
    ? (process.env.GEMINI_MODEL || 'gemini-2.0-flash')
    : hasOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free')
      : bestLocal || llamaCppModels[0] || 'auto/coding'

  const hasFishAudio  = !!process.env.FISH_AUDIO_API_KEY
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY
  const ttsEngine     = hasFishAudio ? 'fish-audio' : hasElevenLabs ? 'elevenlabs' : 'browser'

  return NextResponse.json({
    models,
    active: { provider: activeProvider, model: activeModel },
    ollama: { running: ollamaRunning, models: ollamaModels },
    llamaCpp: { running: llamaCppModels.length > 0, models: llamaCppModels },
    host: {
      platform: process.platform,
      macControl: process.platform === 'darwin',
      screenCapture: process.platform === 'darwin',
      browserControl: process.platform === 'darwin',
      shell: true,
      remoteClientControl: true,
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
      github:       !!process.env.GITHUB_TOKEN,
      googleSearch: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
      discord:      !!process.env.DISCORD_WEBHOOK_URL,
      grok:         !!process.env.XAI_API_KEY,
    },
  })
}
