import { NextRequest, NextResponse } from 'next/server'

const ALL_MODELS = [
  { provider: 'google',      id: 'gemini-2.5-flash',                          label: 'Gemini 2.5 Flash',             free: true,  requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { provider: 'google',      id: 'gemini-2.5-pro',                            label: 'Gemini 2.5 Pro',               free: false, requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { provider: 'google',      id: 'gemini-2.0-flash',                          label: 'Gemini 2.0 Flash',             free: true,  requiresKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { provider: 'openrouter',  id: 'google/gemini-2.0-flash-exp:free',          label: 'Gemini 2.0 Flash Exp (Free)', free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'meta-llama/llama-3.3-70b-instruct:free',   label: 'Llama 3.3 70B (Free)',        free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'deepseek/deepseek-r1:free',                 label: 'DeepSeek R1 (Free)',           free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'mistralai/mistral-7b-instruct:free',        label: 'Mistral 7B (Free)',            free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'openrouter',  id: 'nvidia/nemotron-3-nano-30b-a3b:free',       label: 'Nemotron 30B (Free)',          free: true,  requiresKey: 'OPENROUTER_API_KEY' },
  { provider: 'omniroute',   id: 'auto/coding',                               label: 'OmniRoute Auto (Local)',       free: true,  requiresKey: null },
  { provider: 'omniroute',   id: 'auto/fast',                                 label: 'OmniRoute Fast (Local)',       free: true,  requiresKey: null },
]

export async function GET(req: NextRequest) {
  const token = req.cookies.get('gf_token')?.value
  if (!token || token !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const models = ALL_MODELS.map(m => ({
    ...m,
    available: m.requiresKey ? !!process.env[m.requiresKey] : true,
  }))

  // Determine current active provider/model from env
  const hasGemini = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const activeProvider = hasGemini ? 'google' : process.env.OPENROUTER_API_KEY ? 'openrouter' : 'omniroute'
  const activeModel = hasGemini
    ? (process.env.GEMINI_MODEL || 'gemini-2.5-flash')
    : (process.env.OPENROUTER_MODEL || process.env.OMNIROUTE_MODEL || 'auto/coding')

  return NextResponse.json({
    models,
    active: { provider: activeProvider, model: activeModel },
    integrations: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      github:     !!process.env.GITHUB_TOKEN,
      googleSearch: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
      discord:    !!process.env.DISCORD_WEBHOOK_URL,
    },
  })
}
