import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type CoreMessage, type LanguageModel } from 'ai'
import { totalmem } from 'os'
import { buildLocalRuntimeOrder } from './local-runtime'

export const GHOSTFORGE_SYSTEM = `You are GhostForge AI — an operator-grade developer assistant built by Hisham Abulfeilat.
You help with React, Next.js, TypeScript, Tailwind CSS, Git, CI/CD, Carbon tracking, and all GhostForge toolkit features.
You are concise, technical, and direct. You speak like a senior developer.
Available GhostForge commands the user can run on their Mac: ghostforge carbon status, ghostforge carbon track <cmd>, ghostforge ai-review staged, ghostforge standup today, ghostforge dep-health check, ghostforge health-score score, ghostforge bundle track, ghostforge lighthouse run <url>, and many more.
When user asks to run a command, prefix with [RUN]: ghostforge <command> — the UI will offer to execute it.`

export interface ModelOverride {
  activeModel?: string
  activeProvider?: string
  offline?: boolean
  task?: string
}

export interface ModelEntry {
  provider: string
  modelId: string
  model: LanguageModel
  generate?: (opts: Omit<Parameters<typeof generateText>[0], 'model'>) => Promise<string>
}

/** Build an OmniRoute LanguageModel — no API key required */
export function makeOmniRouteModel(modelId = 'auto/coding'): LanguageModel {
  const raw = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'
  const baseURL = raw.endsWith('/v1') ? raw : `${raw.replace(/\/+$/, '')}/v1`
  const omni = createOpenAI({ baseURL, apiKey: 'omniroute' })
  return omni(modelId)
}

export function omniRouteBaseURL(): string {
  const raw = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'
  return raw.endsWith('/v1') ? raw : `${raw.replace(/\/+$/, '')}/v1`
}

/**
 * Direct HTTP fallback for OmniRoute. The AI SDK's JSON handler cannot consume
 * OmniRoute's streaming responses (v3.8.48 defaults to SSE even when `stream` is
 * omitted, so `generateText` throws `AI_APICallError: Invalid JSON response`).
 * Forcing `stream:false` returns a plain OpenAI-compatible JSON body.
 */
export async function generateWithOmniRoute(
  modelId: string,
  opts: Omit<Parameters<typeof generateText>[0], 'model'>,
): Promise<string> {
  const baseURL = omniRouteBaseURL()
  const messages: Array<{ role: string; content: string }> = []
  if (typeof opts.system === 'string' && opts.system.trim()) {
    messages.push({ role: 'system', content: opts.system })
  }
  if (Array.isArray(opts.messages)) {
    for (const message of opts.messages) {
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      if (content) messages.push({ role: message.role, content })
    }
  }
  if (messages.length === 0) messages.push({ role: 'user', content: 'Hello' })

  let res: Response
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer omniroute' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: false,
        max_tokens: opts.maxTokens || 800,
      }),
    })
  } catch (e) {
    throw new Error(`OmniRoute connection failed: ${String(e).slice(0, 120)}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OmniRoute returned ${res.status}: ${body.slice(0, 160)}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | Array<unknown>; reasoning_content?: string } }>
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(`OmniRoute ${modelId}: ${data.error.message.slice(0, 160)}`)
  const content = data.choices?.[0]?.message?.content
  const text = (typeof content === 'string' ? content : content ? JSON.stringify(content) : '').trim()
  if (!text) throw new Error(`OmniRoute ${modelId} returned an empty response`)
  return text
}

/** OmniRoute chain entry: custom generate fixes the SDK streaming-parse incompatibility */
function makeOmniRouteEntry(modelId: string): ModelEntry {
  return {
    provider: 'omniroute',
    modelId,
    model: makeOmniRouteModel(modelId),
    generate: (opts) => generateWithOmniRoute(modelId, opts),
  }
}

/** Working OmniRoute free models — worst-first ordering gives automatic fallback between them */
const FREE_OMNIROUTE_MODELS = ['auto/coding', 'auto/best-free', 'auto/coding:free', 'oc/deepseek-v4-flash-free']

/** Whether an error should trigger a fallback to the next model */
export function isFallbackError(e: unknown): boolean {
  const msg = String(e).toLowerCase()
  const err = (typeof e === 'object' && e !== null ? e : {}) as { status?: unknown; statusCode?: unknown }
  const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 0
  const statusMatch =
    status === 400 || status === 401 || status === 403 || status === 404 || status === 429 || status === 502 || status === 503 ||
    msg.includes('status 400') || msg.includes('status 401') || msg.includes('status 403') || msg.includes('status 404') ||
    msg.includes('status 429') || msg.includes('status 502') || msg.includes('status 503')
  return (
    statusMatch ||
    msg.includes('invalid api key') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('no such model') ||
    msg.includes('model not found') ||
    msg.includes('permission') ||
    msg.includes('quota') ||
    msg.includes('exceeded') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('no longer available') ||
    msg.includes('not found') ||
    msg.includes('deprecated') ||
    msg.includes('unavailable') ||
    msg.includes('model_not_found') ||
    msg.includes('invalid model') ||
    msg.includes('does not exist') ||
    msg.includes('not supported') ||
    msg.includes('no endpoints') ||
    msg.includes('provider returned error') ||
    msg.includes('resource_exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('connection refused') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('invalid json response') ||
    msg.includes('invalid response data') ||
    msg.includes('empty response') ||
    msg.includes('connection failed')
  )
}

async function detectLocalModels(opts?: ModelOverride) {
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/v1\/?$/, '')
  const llamaCppUrl = (() => {
    const raw = (process.env.LLAMACPP_URL || 'http://localhost:8080/v1').replace(/\/+$/, '')
    return raw.endsWith('/v1') ? raw : `${raw}/v1`
  })()
  const [ollamaResult, llamaCppResult] = await Promise.allSettled([
    fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1200) }),
    fetch(`${llamaCppUrl}/models`, { signal: AbortSignal.timeout(1200) }),
  ])

  let ollamaModels: string[] = []
  if (ollamaResult.status === 'fulfilled' && ollamaResult.value.ok) {
    const data = await ollamaResult.value.json() as { models?: Array<{ name?: string }> }
    ollamaModels = (data.models || []).map(model => model.name || '').filter(Boolean)
  }

  let llamaCppModel = ''
  if (llamaCppResult.status === 'fulfilled' && llamaCppResult.value.ok) {
    const data = await llamaCppResult.value.json() as { data?: Array<{ id?: string }> }
    llamaCppModel = data.data?.[0]?.id || process.env.LLAMACPP_MODEL || 'local-model'
  }

  return {
    ollamaUrl,
    llamaCppUrl,
    order: buildLocalRuntimeOrder({
      selectedProvider: opts?.activeProvider,
      selectedModel: opts?.activeModel,
      ollamaModels,
      ramGB: Math.round(totalmem() / 1024 ** 3),
      task: opts?.task || 'tools',
      llamaCppModel,
    }) as Array<{ provider: 'ollama' | 'llamacpp'; model: string }>,
  }
}

async function appendLocalModels(chain: ModelEntry[], push: (entry: ModelEntry) => void, opts?: ModelOverride) {
  const local = await detectLocalModels(opts)
  for (const entry of local.order) {
    if (entry.provider === 'ollama') {
      const client = createOpenAI({ baseURL: `${local.ollamaUrl}/v1`, apiKey: 'ollama' })
      push({
        provider: 'ollama',
        modelId: entry.model,
        model: client(entry.model),
        generate: async (opts) => {
          const messages: Array<{ role: string; content: string }> = []
          if (typeof opts.system === 'string' && opts.system.trim()) {
            messages.push({ role: 'system', content: opts.system })
          }
          if (Array.isArray(opts.messages)) {
            for (const message of opts.messages) {
              messages.push({
                role: message.role,
                content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
              })
            }
          }

          const response = await fetch(`${local.ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(120_000),
            body: JSON.stringify({
              model: entry.model,
              messages,
              stream: false,
              think: false,
              options: { num_predict: opts.maxTokens || 800 },
            }),
          })
          if (!response.ok) throw new Error(`Ollama returned ${response.status}`)
          const data = await response.json() as { message?: { content?: string }; error?: string }
          const content = data.message?.content?.trim()
          if (!content) throw new Error(data.error || 'Ollama returned an empty response')
          return content
        },
      })
    } else {
      const client = createOpenAI({ baseURL: local.llamaCppUrl, apiKey: 'llama.cpp' })
      push({ provider: 'llamacpp', modelId: entry.model, model: client(entry.model) })
    }
  }
  return chain
}

// ── Model chain cache (30s TTL) — avoids Ollama ping + dynamic imports per request ──
let _chainCache: { chain: ModelEntry[]; ts: number } | null = null
const CHAIN_CACHE_TTL = 30_000

// ── OmniRoute health probe (per-URL cache) — skips dead local gateway instead of failing ──
const OMNI_PROBE_TTL_POSITIVE = 30_000
const OMNI_PROBE_TTL_NEGATIVE = 5_000
const _omniProbeCache = new Map<string, { up: boolean; ts: number }>()
const _omniProbesInFlight = new Map<string, Promise<boolean>>()

export async function isOmniRouteUp(omniUrl?: string): Promise<boolean> {
  const raw = (omniUrl || process.env.OMNIROUTE_URL || 'http://localhost:20128/v1').replace(/\/+$/, '')
  const url = raw.endsWith('/v1') ? raw : `${raw}/v1`
  const now = Date.now()
  const cached = _omniProbeCache.get(url)
  if (cached) {
    const ttl = cached.up ? OMNI_PROBE_TTL_POSITIVE : OMNI_PROBE_TTL_NEGATIVE
    if (now - cached.ts < ttl) return cached.up
  }
  const inFlight = _omniProbesInFlight.get(url)
  if (inFlight) return inFlight
  const probe = (async () => {
    try {
      const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(1200) })
      const up = res.ok
      _omniProbeCache.set(url, { up, ts: Date.now() })
      return up
    } catch {
      _omniProbeCache.set(url, { up: false, ts: Date.now() })
      return false
    } finally {
      _omniProbesInFlight.delete(url)
    }
  })()
  _omniProbesInFlight.set(url, probe)
  return probe
}

/**
 * Build an ordered fallback chain of AI models.
 * Order: user-selected → gemini → openrouter → xAI → deepseek → ollama → omniroute
 * Result is cached for 30s unless a model override is specified.
 */
export async function buildModelChain(opts?: ModelOverride): Promise<ModelEntry[]> {
  const localSelected = opts?.activeProvider === 'ollama' || opts?.activeProvider === 'llamacpp' || opts?.activeProvider === 'llama.cpp'
  const offline = opts?.offline === true
  // An override object with no actual override fields (no provider/model/offline)
  // must not bypass the cache — treat it as a default call.
  const isDefaultCall = !opts || (!opts.activeProvider && !opts.activeModel && !opts.offline)

  // Return cached chain for default (no override) calls
  if (isDefaultCall && _chainCache && Date.now() - _chainCache.ts < CHAIN_CACHE_TTL) {
    return _chainCache.chain
  }

  const chain: ModelEntry[] = []
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const orKey     = process.env.OPENROUTER_API_KEY
  const omniUrl   = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'

  const added = new Set<string>()
  const push = (entry: ModelEntry) => {
    const key = `${entry.provider}/${entry.modelId}`
    if (!added.has(key)) { added.add(key); chain.push(entry) }
  }

  const deepseekModelMap: Record<string, string> = {
    'deepseek-chat':     'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-flash',
    'deepseek-coder':    'deepseek-v4-flash',
  }

  // 1. User-selected model (highest priority)
  if (opts?.activeProvider && opts?.activeModel) {
    const { activeProvider: ap, activeModel: am } = opts
    if (ap === 'google' && geminiKey) {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      push({ provider: 'google', modelId: am, model: createGoogleGenerativeAI({ apiKey: geminiKey })(am) })
    } else if (ap === 'openrouter' && orKey) {
      push({ provider: 'openrouter', modelId: am, model: createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })(am) })
    } else if (ap === 'xai') {
      const xKey = process.env.XAI_API_KEY
      if (xKey) push({ provider: 'xai', modelId: am, model: createOpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: xKey })(am) })
    } else if (ap === 'groq') {
      const gKey = process.env.GROQ_API_KEY
      if (gKey) push({ provider: 'groq', modelId: am, model: createOpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: gKey })(am) })
    } else if (ap === 'nvidia') {
      const nKey = process.env.NVIDIA_API_KEY
      if (nKey) push({ provider: 'nvidia', modelId: am, model: createOpenAI({ baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: nKey })(am) })
    } else if (ap === 'deepseek') {
      const dsKey = process.env.DEEPSEEK_API_KEY
      if (dsKey) {
        const { createDeepSeek } = await import('@ai-sdk/deepseek')
        // Map to the canonical id so step 5 doesn't push the same model twice
        const mapped = deepseekModelMap[am] || am
        push({ provider: 'deepseek', modelId: mapped, model: createDeepSeek({ apiKey: dsKey })(mapped) })
      }
    } else if (ap === 'omniroute' && !offline && (await isOmniRouteUp(omniUrl))) {
      push(makeOmniRouteEntry(am))
    }
  }

  if (offline || localSelected) {
    await appendLocalModels(chain, push, opts)
    // OmniRoute is a local gateway — keep it available in offline mode
    if (offline && (await isOmniRouteUp(omniUrl))) {
      if (opts?.activeProvider === 'omniroute') {
        const modelId = opts.activeModel || 'auto/coding'
        push(makeOmniRouteEntry(modelId))
      }
      for (const modelId of FREE_OMNIROUTE_MODELS) push(makeOmniRouteEntry(modelId))
    }
    return chain
  }

  // 2. Gemini (fastest cloud option)
  if (geminiKey) {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const mid = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    push({ provider: 'google', modelId: mid, model: createGoogleGenerativeAI({ apiKey: geminiKey })(mid) })
  }

  // 3. OpenRouter free models
  if (orKey) {
    const or = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })
    push({ provider: 'openrouter', modelId: 'google/gemma-4-26b-a4b-it:free', model: or('google/gemma-4-26b-a4b-it:free') })
    push({ provider: 'openrouter', modelId: 'nvidia/nemotron-3-super-120b-a12b:free', model: or('nvidia/nemotron-3-super-120b-a12b:free') })
    const mid = process.env.OPENROUTER_MODEL
    if (mid && mid !== 'google/gemma-2.0-flash-exp:free' && mid !== 'google/gemini-2.0-flash-exp:free') {
      push({ provider: 'openrouter', modelId: mid, model: or(mid) })
    }
    push({ provider: 'openrouter', modelId: 'nvidia/nemotron-nano-12b-v2-vl:free', model: or('nvidia/nemotron-nano-12b-v2-vl:free') })
  }

  // 4. xAI Grok
  const xaiKey = process.env.XAI_API_KEY
  if (xaiKey) {
    const grok = createOpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: xaiKey })
    const grokModel = opts?.activeProvider === 'xai' ? (opts.activeModel || 'grok-3-mini') : 'grok-3-mini'
    push({ provider: 'xai', modelId: grokModel, model: grok(grokModel) })
  }

  // 5. DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  if (deepseekKey) {
    const { createDeepSeek } = await import('@ai-sdk/deepseek')
    const deepseek = createDeepSeek({ apiKey: deepseekKey })
    const dsModel = opts?.activeProvider === 'deepseek'
      ? (deepseekModelMap[opts.activeModel || ''] || opts.activeModel || 'deepseek-v4-flash')
      : 'deepseek-v4-flash'
    push({ provider: 'deepseek', modelId: dsModel, model: deepseek(dsModel) })
  }

  // 6. Local runtimes: prefer Ollama, then an OpenAI-compatible llama.cpp server.
  await appendLocalModels(chain, push, opts)

  // 7. OmniRoute (local free gateway, always last — only when actually running)
  if (omniUrl && (await isOmniRouteUp(omniUrl))) {
    for (const modelId of FREE_OMNIROUTE_MODELS) push(makeOmniRouteEntry(modelId))
  }

  // Cache default chain only (not user-overridden)
  if (isDefaultCall) {
    _chainCache = { chain, ts: Date.now() }
  }

  return chain
}

/**
 * Generate text with full automatic fallback chain.
 * Returns text + which model actually answered.
 */
export async function generateWithFallback(
  opts: Omit<Parameters<typeof generateText>[0], 'model'>,
  overrides?: ModelOverride,
): Promise<{ text: string; usedProvider: string; usedModel: string }> {
  const chain = await buildModelChain(overrides)

  if (chain.length === 0) {
    throw new Error(overrides?.offline
      ? 'Offline mode needs a running Ollama, llama.cpp, or OmniRoute gateway with at least one installed model'
      : 'No AI providers configured. Start Ollama/llama.cpp or add a cloud provider key to .env.local')
  }

  let lastError: unknown
  for (const entry of chain) {
    try {
      const text = entry.generate
        ? await entry.generate(opts)
        : (await generateText({ ...opts, model: entry.model, maxRetries: 0 })).text
      return { text, usedProvider: entry.provider, usedModel: entry.modelId }
    } catch (e) {
      if (isFallbackError(e)) {
        console.warn(`[GhostForge] ${entry.provider}/${entry.modelId} failed → trying next. Reason: ${String(e).slice(0, 80)}`)
        lastError = e
        continue
      }
      throw e
    }
  }

  throw lastError || new Error('All AI providers failed')
}

/** Legacy: selectAIModel kept for compatibility with streaming routes */
export async function selectAIModel(opts?: ModelOverride): Promise<{ model: LanguageModel; fallbackModel?: LanguageModel }> {
  const chain = await buildModelChain(opts)
  if (chain.length === 0) throw new Error('No AI providers configured')
  return { model: chain[0].model, fallbackModel: chain[1]?.model }
}

/** Legacy non-streaming helper */
export async function generateGhostforgeReply(messages: CoreMessage[], modelOverride?: ModelOverride) {
  const { text } = await generateWithFallback(
    { system: GHOSTFORGE_SYSTEM, messages },
    modelOverride,
  )
  return text
}

// ── Vision: generate with image (for screen understanding) ──

interface VisionOpts {
  prompt: string
  imageBase64: string
  system?: string
  maxTokens?: number
  mimeType?: string
}

/**
 * Vision-capable model list — used to auto-select when images are present.
 * Order: Gemini (native vision) → Ollama vision models → OpenRouter VL → fallback
 */
const VISION_MODEL_PREFERENCES = [
  { provider: 'google', model: 'gemini-2.0-flash' },
  { provider: 'ollama', model: 'qwen2.5vl:7b' },
  { provider: 'ollama', model: 'qwen3-vl:8b' },
  { provider: 'ollama', model: 'moondream' },
  { provider: 'ollama', model: 'llama3.2-vision:11b' },
  { provider: 'ollama', model: 'gemma4' },
  { provider: 'openrouter', model: 'nvidia/nemotron-nano-12b-v2-vl:free' },
]

/**
 * Generate a response using a vision-capable model with an image.
 * Tries Ollama vision models first (local, free), then cloud providers.
 */
export async function generateVision(opts: VisionOpts): Promise<{ text: string; usedProvider: string; usedModel: string }> {
  const ollamaUrl = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/v1\/?$/, '')
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  const mimeType = opts.mimeType || 'image/jpeg'

  // 1. Try Ollama vision models (local, free)
  try {
    const tagsRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (tagsRes.ok) {
      const { models = [] } = await tagsRes.json() as { models?: Array<{ name: string }> }
      const installed = models.map(m => m.name)

      for (const pref of VISION_MODEL_PREFERENCES.filter(p => p.provider === 'ollama')) {
        const match = installed.find(m => m.startsWith(pref.model))
        if (match) {
          const messages: Array<{ role: string; content: string; images?: string[] }> = []
          if (opts.system) messages.push({ role: 'system', content: opts.system })
          messages.push({ role: 'user', content: opts.prompt, images: [opts.imageBase64] })

          const res = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(120_000),
            body: JSON.stringify({
              model: match,
              messages,
              stream: false,
              think: false,
              options: { num_predict: opts.maxTokens || 1000 },
            }),
          })
          if (res.ok) {
            const data = await res.json() as { message?: { content?: string } }
            const text = data.message?.content?.trim()
            if (text) return { text, usedProvider: 'ollama', usedModel: match }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[GhostForge] Ollama vision probe failed:', e)
  }

  // 2. Try Gemini (native vision)
  if (geminiKey) {
    try {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      const gemini = createGoogleGenerativeAI({ apiKey: geminiKey })
      const model = gemini('gemini-2.0-flash')
      const { text } = await generateText({
        model,
        maxRetries: 0,
        messages: [
          ...(opts.system ? [{ role: 'user' as const, content: opts.system }] : []),
          {
            role: 'user' as const,
            content: [
              { type: 'text', text: opts.prompt },
              { type: 'image', image: `data:${mimeType};base64,${opts.imageBase64}` },
            ],
          },
        ],
      })
      if (text) return { text, usedProvider: 'google', usedModel: 'gemini-2.0-flash' }
    } catch (e) {
      console.warn('[GhostForge] Gemini vision failed:', e)
    }
  }

  // 3. Try OpenRouter VL models
  if (orKey) {
    try {
      const or = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: orKey })
      const model = or('nvidia/nemotron-nano-12b-v2-vl:free')
      const { text } = await generateText({
        model,
        maxRetries: 0,
        messages: [
          ...(opts.system ? [{ role: 'user' as const, content: opts.system }] : []),
          {
            role: 'user' as const,
            content: [
              { type: 'text', text: opts.prompt },
              { type: 'image', image: `data:${mimeType};base64,${opts.imageBase64}` },
            ],
          },
        ],
      })
      if (text) return { text, usedProvider: 'openrouter', usedModel: 'nvidia/nemotron-nano-12b-v2-vl:free' }
    } catch (e) {
      console.warn('[GhostForge] OpenRouter vision failed:', e)
    }
  }

  throw new Error('No vision-capable model available. Install a vision model: ollama pull moondream')
}
