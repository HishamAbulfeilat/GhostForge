import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { isAuthorizedRequest } from '@/lib/auth'
import { isOmniRouteUp } from '@/lib/ai'

const MODELS_PATH = path.join(os.homedir(), 'GhostForge/marketplace/custom-models.json')
const SETTINGS_PATH = path.join(os.homedir(), '.ghostforge/settings.json')

function readJSON<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T } catch { return fallback }
}

const BUILTIN_MODELS = [
  {
    id: 'auto/coding',
    name: 'OmniRoute Auto/Coding 🆓',
    provider: 'omniroute',
    providerName: 'OmniRoute',
    description: 'Quality-first routing across 250+ providers. Auto-fallback, ~1.6B free tokens/mo. Requires: npx omniroute',
    free: true,
    requiresKey: null,
    category: 'free',
    context: 'varies',
  },
  {
    id: 'auto/fast',
    name: 'OmniRoute Auto/Fast 🆓',
    provider: 'omniroute',
    providerName: 'OmniRoute',
    description: 'Lowest-latency routing. Free-forever providers (Kiro, Pollinations, LongCat…).',
    free: true,
    requiresKey: null,
    category: 'free',
    context: 'varies',
  },
  {
    id: 'auto',
    name: 'OmniRoute Auto 🆓',
    provider: 'omniroute',
    providerName: 'OmniRoute',
    description: 'Balanced LKGP routing across 90+ free tiers. No API key needed.',
    free: true,
    requiresKey: null,
    category: 'free',
    context: 'varies',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    providerName: 'Google AI',
    description: 'Most capable Gemini model. Best for complex reasoning.',
    free: false,
    requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    category: 'premium',
    context: '1M tokens',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    providerName: 'Google AI',
    description: 'Fast & smart. Best balance of speed and quality.',
    free: false,
    requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    category: 'recommended',
    context: '1M tokens',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    providerName: 'Google AI',
    description: 'Previous generation, still very capable.',
    free: true,
    requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    category: 'free',
    context: '1M tokens',
  },
  {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    name: 'NVIDIA Nemotron Nano',
    provider: 'openrouter',
    providerName: 'OpenRouter',
    description: 'Free NVIDIA model via OpenRouter. No quota limits.',
    free: true,
    requiresKey: 'OPENROUTER_API_KEY',
    category: 'free',
    context: '128K tokens',
  },
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    name: 'Llama 3.2 3B (Free)',
    provider: 'openrouter',
    providerName: 'OpenRouter',
    description: 'Meta\'s compact Llama 3.2 model, free tier.',
    free: true,
    requiresKey: 'OPENROUTER_API_KEY',
    category: 'free',
    context: '128K tokens',
  },
  {
    id: 'google/gemma-3-12b-it:free',
    name: 'Gemma 3 12B (Free)',
    provider: 'openrouter',
    providerName: 'OpenRouter',
    description: 'Google Gemma 3, free via OpenRouter.',
    free: true,
    requiresKey: 'OPENROUTER_API_KEY',
    category: 'free',
    context: '128K tokens',
  },
  {
    id: 'llama-3.1-70b-versatile',
    name: 'Llama 3.1 70B (Groq)',
    provider: 'groq',
    providerName: 'Groq',
    description: 'Ultra-fast inference via Groq. Free tier available.',
    free: true,
    requiresKey: 'GROQ_API_KEY',
    category: 'free',
    context: '128K tokens',
  },
  {
    id: 'fish-audio/jarvis',
    name: 'Fish Audio JARVIS Voice 🆓',
    provider: 'fish-audio',
    providerName: 'Fish Audio',
    description: 'Movie-accurate JARVIS voice from Iron Man. Free tier — no quota limits.',
    free: true,
    requiresKey: 'FISH_AUDIO_API_KEY',
    category: 'free',
    context: 'voice · 500 chars',
  },
  {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B (NVIDIA NIM)',
    provider: 'nvidia',
    providerName: 'NVIDIA NIM',
    description: 'High-quality Llama via NVIDIA NIM free tier.',
    free: true,
    requiresKey: 'NVIDIA_API_KEY',
    category: 'free',
    context: '128K tokens',
  },
]

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const settings = readJSON<{ activeModel?: string; activeProvider?: string }>(SETTINGS_PATH, {})
  const customModels = readJSON<{ free_model_providers?: unknown[] }>(MODELS_PATH, {})

  // Detect which API keys / local services are configured
  const hasGoogle = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY
  const hasGroq = !!process.env.GROQ_API_KEY
  const hasNvidia = !!process.env.NVIDIA_API_KEY
  const hasFishAudio = !!process.env.FISH_AUDIO_API_KEY
  // OmniRoute runs locally — report its REAL status (down = not usable)
  const omniRouteUp = await isOmniRouteUp()

  const keysAvailable = {
    google: hasGoogle,
    openrouter: hasOpenRouter,
    groq: hasGroq,
    nvidia: hasNvidia,
    fish: hasFishAudio,
    'fish-audio': hasFishAudio,
    omniroute: omniRouteUp,
  }

  const activeModel = settings.activeModel ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-pro'
  const activeProvider = settings.activeProvider ?? 'google'

  return NextResponse.json({
    models: BUILTIN_MODELS,
    activeModel,
    activeProvider,
    keysAvailable,
    providers: customModels.free_model_providers ?? [],
  })
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsed: { modelId?: string; provider?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { modelId, provider } = parsed as { modelId: string; provider: string }

  const settings = readJSON<Record<string, unknown>>(SETTINGS_PATH, {})
  settings.activeModel = modelId
  settings.activeProvider = provider

  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2))
  } catch {
    return NextResponse.json({ error: 'Cannot write settings' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, activeModel: modelId, activeProvider: provider })
}
