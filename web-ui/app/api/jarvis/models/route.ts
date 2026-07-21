import { NextRequest, NextResponse } from 'next/server'

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
  { provider: 'ollama',      id: 'llama3.2:3b',                              label: 'Llama 3.2 3B (Local) 🔒',    free: true,  requiresKey: null },
  { provider: 'ollama',      id: 'qwen2.5-coder:7b',                        label: 'Qwen 2.5 Coder 7B (Local) 🔒', free: true, requiresKey: null },
  { provider: 'omniroute',   id: 'auto/coding',                              label: 'OmniRoute Auto (Local)',       free: true,  requiresKey: null },
]

export async function GET(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
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

  const models = ALL_MODELS.map(m => ({
    ...m,
    available: m.provider === 'ollama'
      ? ollamaRunning && ollamaModels.includes(m.id)
      : m.requiresKey ? !!process.env[m.requiresKey] : true,
  }))

  // Add any Ollama models not in the static list
  for (const name of ollamaModels) {
    if (!models.some(m => m.id === name)) {
      models.push({ provider: 'ollama', id: name, label: `${name} (Local) 🔒`, free: true, requiresKey: null, available: true })
    }
  }

  const hasGemini = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const activeProvider = hasGemini ? 'google' : process.env.OPENROUTER_API_KEY ? 'openrouter' : ollamaRunning ? 'ollama' : 'omniroute'
  const activeModel    = hasGemini
    ? (process.env.GEMINI_MODEL || 'gemini-2.0-flash')
    : ollamaRunning ? ollamaModels[0] || 'llama3.2:3b'
    : (process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free')

  const hasFishAudio  = !!process.env.FISH_AUDIO_API_KEY
  const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY
  const ttsEngine     = hasFishAudio ? 'fish-audio' : hasElevenLabs ? 'elevenlabs' : 'browser'

  return NextResponse.json({
    models,
    active: { provider: activeProvider, model: activeModel },
    ollama: { running: ollamaRunning, models: ollamaModels },
    tts: {
      engine: ttsEngine,
      fishAudio:    hasFishAudio,
      elevenLabs:   hasElevenLabs,
      jarvisVoice:  hasFishAudio,
      jarvisModelId: process.env.FISH_AUDIO_JARVIS_MODEL || '612b878b113047d9a770c069c8b4fdfe',
    },
    integrations: {
      elevenlabs:   hasElevenLabs,
      github:       !!process.env.GITHUB_TOKEN,
      googleSearch: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
      discord:      !!process.env.DISCORD_WEBHOOK_URL,
      grok:         !!process.env.XAI_API_KEY,
    },
  })
}
