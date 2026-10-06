import Anthropic from '@anthropic-ai/sdk'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type ModelMessage, type LanguageModel } from 'ai'
import { totalmem } from 'os'
import { buildLocalRuntimeOrder } from './local-runtime'
import {
  FREE_CATALOG, PROVIDERS, getCustomModel, getOmniRouteKey, getProviderKey, getSavedSelection, isProviderId, omniRouteBaseURL,
  type ProviderId,
} from './providers'

export { omniRouteBaseURL }

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
  /** Start the chain at free providers instead of the paid model selected in Settings */
  preferFree?: boolean
}

/**
 * GhostForge's provider-neutral generation options. `maxTokens` is mapped to
 * the AI SDK's `maxOutputTokens` (v5+) and to each raw provider's own field.
 */
export interface GenerateOpts {
  system?: string
  messages?: ModelMessage[]
  prompt?: string
  maxTokens?: number
  temperature?: number
}

export interface ModelEntry {
  provider: string
  modelId: string
  /** AI SDK model; absent for providers called through their own SDK (Anthropic) */
  model?: LanguageModel
  generate?: (opts: GenerateOpts) => Promise<string>
}

/** Build an OmniRoute LanguageModel; local gateways do not need a placeholder key. */
export function makeOmniRouteModel(modelId = 'auto'): LanguageModel {
  const apiKey = getOmniRouteKey()
  // An explicit empty key prevents the SDK from falling back to OPENAI_API_KEY.
  const omni = createOpenAI({ baseURL: omniRouteBaseURL(), apiKey: apiKey ?? '' })
  return omni.chat(modelId)
}

/** Map GhostForge options onto an AI SDK generateText call */
function toSdkCall(opts: GenerateOpts, model: LanguageModel) {
  const base = {
    model,
    maxRetries: 0,
    system: opts.system,
    maxOutputTokens: opts.maxTokens,
    temperature: opts.temperature,
  }
  return opts.messages?.length
    ? { ...base, messages: opts.messages }
    : { ...base, prompt: opts.prompt || '' }
}

/** Flatten generateText options into plain chat messages (system first) */
function toChatMessages(opts: GenerateOpts): Array<{ role: string; content: string }> {
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
  if (typeof opts.prompt === 'string' && opts.prompt.trim()) messages.push({ role: 'user', content: opts.prompt })
  return messages
}

/**
 * Claude through the official Anthropic SDK. Server-side refusal fallbacks are
 * enabled for the models that support them, so a declined request is retried
 * on another Claude model inside the same call.
 */
async function generateWithAnthropic(apiKey: string, modelId: string, opts: GenerateOpts): Promise<string> {
  const client = new Anthropic({ apiKey, maxRetries: 0 }) // the chain handles fallback
  const chat = toChatMessages(opts)
  const system = chat.filter(m => m.role === 'system').map(m => m.content).join('\n\n') || undefined
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const m of chat) {
    if (m.role !== 'user' && m.role !== 'assistant') continue
    if (messages.length === 0 && m.role === 'assistant') continue // must start with a user turn
    messages.push({ role: m.role, content: m.content })
  }
  while (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop() // no prefill
  if (messages.length === 0) messages.push({ role: 'user', content: 'Hello' })

  const supportsFallbacks = modelId === 'claude-opus-5' || modelId === 'claude-fable-5-1'
  const response = await client.beta.messages.create({
    model: modelId,
    max_tokens: 16000,
    system,
    messages,
    ...(supportsFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  })
  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined this request${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`)
  }
  const text = response.content.map(block => (block.type === 'text' ? block.text : '')).join('').trim()
  if (!text) throw new Error(`Anthropic ${modelId} returned an empty response`)
  return text
}

/** Chain entry for any registry provider with a key; null when the key is missing */
async function makeProviderEntry(provider: ProviderId, modelId: string): Promise<ModelEntry | null> {
  if (provider === 'omniroute') return makeOmniRouteEntry(modelId)
  if (provider === 'pollinations') {
    const baseURL = PROVIDERS.pollinations.baseURL!
    return {
      provider, modelId,
      generate: async opts => {
        // Pollinations is the always-on free gateway and fails transiently
        // (sporadic 500/402/429); retry with backoff, across both gateways.
        // gen.pollinations.ai rejects requests that include max_tokens (401),
        // and Pollinations' anonymous tier rejects `system` messages (401),
        // so its entries omit max_tokens and flatten system into the prompt.
        const { maxTokens, ...rest } = opts
        const sys = (rest.system ?? '').trim()
        let pollinationsOpts = rest
        if (sys) {
          if (Array.isArray(rest.messages) && rest.messages.length) {
            const msgs = [...rest.messages]
            const firstUser = msgs.findIndex(m => m.role === 'user')
            if (firstUser >= 0) {
              const cm = msgs[firstUser] as { role: string; content: unknown }
              const content = typeof cm.content === 'string' ? cm.content : JSON.stringify(cm.content)
              msgs[firstUser] = { ...(cm as object), content: `${sys}\n\n${content}` } as typeof msgs[number]
            } else {
              msgs.unshift({ role: 'user' as const, content: sys } as unknown as typeof msgs[number])
            }
            pollinationsOpts = { ...rest, system: undefined, messages: msgs }
          } else {
            pollinationsOpts = { ...rest, system: undefined, prompt: `${sys}\n\n${rest.prompt ?? ''}` }
          }
        }
        const baseURLs = ['https://gen.pollinations.ai/v1', baseURL]
        let last: unknown
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await generateOpenAICompatible('Pollinations', baseURLs[attempt % baseURLs.length], undefined, modelId, pollinationsOpts)
          } catch (e) {
            if (!isFallbackError(e)) throw e
            last = e
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
          }
        }
        throw last
      },
    }
  }
  const apiKey = getProviderKey(provider)
  if (!apiKey) return null
  if (provider === 'anthropic') {
    return { provider, modelId, generate: opts => generateWithAnthropic(apiKey, modelId, opts) }
  }
  if (provider === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    return { provider, modelId, model: createGoogleGenerativeAI({ apiKey })(modelId) }
  }
  if (provider === 'deepseek') {
    const { createDeepSeek } = await import('@ai-sdk/deepseek')
    const mapped = DEEPSEEK_MODEL_MAP[modelId] || modelId
    return { provider, modelId: mapped, model: createDeepSeek({ apiKey })(mapped) }
  }
  return { provider, modelId, model: createOpenAI({ baseURL: PROVIDERS[provider].baseURL, apiKey }).chat(modelId) }
}

/** Chain entry for a user-added OpenAI-compatible model */
function makeCustomEntry(customId: string): ModelEntry | null {
  const custom = getCustomModel(customId)
  if (!custom) return null
  return {
    provider: 'custom',
    modelId: custom.id,
    generate: opts => generateOpenAICompatible(custom.name, custom.baseURL, custom.apiKey, custom.model, opts),
  }
}

const DEEPSEEK_MODEL_MAP: Record<string, string> = {
  'deepseek-chat':     'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
  'deepseek-coder':    'deepseek-v4-flash',
}

/**
 * Plain OpenAI-compatible chat call (non-streaming). Used for OmniRoute,
 * Pollinations and custom endpoints: forcing stream:false avoids the AI SDK's
 * JSON handler choking on gateways that default to SSE (OmniRoute v3.8.48+).
 */
export async function generateOpenAICompatible(
  label: string,
  baseURL: string,
  apiKey: string | undefined,
  modelId: string,
  opts: GenerateOpts,
): Promise<string> {
  const messages = toChatMessages(opts)
  if (messages.length === 0) messages.push({ role: 'user', content: 'Hello' })

  let res: Response
  try {
    res = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: modelId, messages, stream: false, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}) }),
    })
  } catch (e) {
    throw new Error(`${label} connection failed: ${String(e).slice(0, 120)}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Carry the status so isFallbackError moves on to the next model
    throw Object.assign(new Error(`${label} returned ${res.status}: ${body.slice(0, 160)}`), { status: res.status })
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string | Array<unknown> } }>
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(`${label} ${modelId}: ${data.error.message.slice(0, 160)}`)
  const content = data.choices?.[0]?.message?.content
  const text = (typeof content === 'string' ? content : content ? JSON.stringify(content) : '').trim()
  if (!text) throw new Error(`${label} ${modelId} returned an empty response`)
  return text
}

export function generateWithOmniRoute(modelId: string, opts: GenerateOpts): Promise<string> {
  return generateOpenAICompatible('OmniRoute', omniRouteBaseURL(), getOmniRouteKey(), modelId, opts)
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
const FREE_OMNIROUTE_MODELS = ['auto', 'auto/coding', 'auto/fast', 'auto/best-free']

/** Whether an error should trigger a fallback to the next model */
export function isFallbackError(e: unknown): boolean {
  const msg = String(e).toLowerCase()
  const err = (typeof e === 'object' && e !== null ? e : {}) as { status?: unknown; statusCode?: unknown }
  const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 0
  const statusMatch =
    status === 400 || status === 401 || status === 402 || status === 403 || status === 404 || status === 429 || status >= 500 ||
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
        model: client.chat(entry.model),
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
      push({ provider: 'llamacpp', modelId: entry.model, model: client.chat(entry.model) })
    }
  }
  return chain
}

// ── Model chain cache (30s TTL per selection) — avoids Ollama ping + dynamic imports per request ──
const _chainCache = new Map<string, { chain: ModelEntry[]; ts: number }>()
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
      const apiKey = getOmniRouteKey()
      const res = await fetch(`${url}/models`, {
        ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
        signal: AbortSignal.timeout(1200),
      })
      // Any answer means the gateway is running: /v1/models can require a key
      // (401) even when chat completions do not
      const up = res.status < 500
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

const LOCAL_PROVIDERS = new Set(['ollama', 'llamacpp', 'llama.cpp'])
/** Free-tier providers used automatically when their key is set (best quality first) */
const FREE_TIER_FALLBACKS: ProviderId[] = ['google', 'groq', 'cerebras', 'openrouter', 'nvidia', 'together', 'huggingface']
/** How many of a provider's known-free models to try before moving on */
const FREE_MODELS_PER_PROVIDER = 3

/**
 * Build an ordered fallback chain of AI models.
 * Order: selected model (request override, else the model saved in Settings)
 *   → free-tier providers you have keys for → OmniRoute (only if running)
 *   → Pollinations (free, no key — always available) → local runtimes.
 * Paid providers (OpenAI, Anthropic, xAI, DeepSeek) are used only when
 * selected — never as a silent fallback. Cached for 30s per selection.
 */
export async function buildModelChain(opts?: ModelOverride): Promise<ModelEntry[]> {
  const offline = opts?.offline === true
  const override = opts?.activeProvider && opts?.activeModel
    ? { provider: opts.activeProvider, model: opts.activeModel }
    : null
  const selection = override ?? getSavedSelection()
  const localSelected = !!selection && LOCAL_PROVIDERS.has(selection.provider)
  const localOpts: ModelOverride = { ...opts, activeProvider: selection?.provider, activeModel: selection?.model }

  const cacheKey = `${offline}|${selection?.provider}|${selection?.model}|${opts?.task || ''}`
  const cached = _chainCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CHAIN_CACHE_TTL) return cached.chain

  const chain: ModelEntry[] = []
  const added = new Set<string>()
  const push = (entry: ModelEntry | null) => {
    if (!entry) return
    const key = `${entry.provider}/${entry.modelId}`
    if (!added.has(key)) { added.add(key); chain.push(entry) }
  }
  const omniUp = await isOmniRouteUp()

  // 1. Selected model (highest priority) — skipped when preferFree is set
  if (selection && !localSelected && opts?.preferFree !== true) {
    if (selection.provider === 'omniroute') {
      if (omniUp) push(makeOmniRouteEntry(selection.model))
    } else if (selection.provider === 'custom') {
      push(makeCustomEntry(selection.model))
    } else if (!offline && isProviderId(selection.provider)) {
      push(await makeProviderEntry(selection.provider, selection.model))
    }
  }

  if (offline || localSelected) {
    await appendLocalModels(chain, push, localOpts)
    // OmniRoute is a local gateway — keep it available in offline mode
    if (omniUp) for (const modelId of FREE_OMNIROUTE_MODELS) push(makeOmniRouteEntry(modelId))
  } else {
    // 2. Free-tier cloud providers you have keys for (the restored free list)
    for (const provider of FREE_TIER_FALLBACKS) {
      if (!getProviderKey(provider)) continue
      const preferred = provider === 'google' ? process.env.GEMINI_MODEL
        : provider === 'openrouter' && process.env.OPENROUTER_MODEL?.endsWith(':free') ? process.env.OPENROUTER_MODEL
          : undefined
      const ids = [preferred, ...(FREE_CATALOG[provider] || []).map(m => m.id)].filter((id): id is string => !!id)
      for (const modelId of ids.slice(0, FREE_MODELS_PER_PROVIDER)) push(await makeProviderEntry(provider, modelId))
    }

    // 3. OmniRoute — optional, only when it is running
    if (omniUp) for (const modelId of FREE_OMNIROUTE_MODELS) push(makeOmniRouteEntry(modelId))

    // 4. Pollinations — free and keyless, so JARVIS always has a model
    for (const m of FREE_CATALOG.pollinations || []) push(await makeProviderEntry('pollinations', m.id))

    // 5. Local runtimes: prefer Ollama, then an OpenAI-compatible llama.cpp server
    await appendLocalModels(chain, push, localOpts)
  }

  _chainCache.set(cacheKey, { chain, ts: Date.now() })
  return chain
}

// ── Cooldown: skip models that just failed, so a dead key doesn't slow every request ──
const _cooldown = new Map<string, number>()

function cooldownMs(e: unknown): number {
  const status = (e as { status?: number; statusCode?: number })?.status ?? (e as { statusCode?: number })?.statusCode ?? 0
  const msg = String(e).toLowerCase()
  if (status === 401 || status === 403 || msg.includes('api key not valid') || msg.includes('invalid api key') || msg.includes('unauthorized')) return 10 * 60_000
  if (status === 404 || msg.includes('not found') || msg.includes('does not exist')) return 30 * 60_000
  return 60_000 // rate limits, overload, timeouts
}

/** Models currently skipped after a failure (for status displays) */
export function coolingDownModels(): string[] {
  const now = Date.now()
  return [..._cooldown.entries()].filter(([, until]) => until > now).map(([key]) => key)
}

/**
 * Generate text with full automatic fallback chain.
 * Returns text + which model actually answered.
 */
export async function generateWithFallback(
  opts: GenerateOpts,
  overrides?: ModelOverride,
): Promise<{ text: string; usedProvider: string; usedModel: string }> {
  const chain = await buildModelChain(overrides)

  if (chain.length === 0) {
    throw new Error(overrides?.offline
      ? 'Offline mode needs a running Ollama, llama.cpp, or OmniRoute gateway with at least one installed model'
      : 'No AI model available. Start OmniRoute (omniroute serve), add a free key (Gemini, Groq, OpenRouter) in Settings → AI Models, or install an Ollama model')
  }

  // Skip models that just failed; if every model is cooling down, try them all anyway
  const now = Date.now()
  const ready = chain.filter(entry => (_cooldown.get(`${entry.provider}/${entry.modelId}`) ?? 0) <= now)
  const attempts = ready.length ? ready : chain

  let lastError: unknown
  for (const entry of attempts) {
    const key = `${entry.provider}/${entry.modelId}`
    try {
      let text: string
      if (entry.generate) text = await entry.generate(opts)
      else if (entry.model) text = (await generateText(toSdkCall(opts, entry.model))).text
      else continue
      _cooldown.delete(key)
      return { text, usedProvider: entry.provider, usedModel: entry.modelId }
    } catch (e) {
      if (isFallbackError(e)) {
        _cooldown.set(key, Date.now() + cooldownMs(e))
        console.warn(`[GhostForge] ${key} failed → trying next. Reason: ${String(e).slice(0, 80)}`)
        lastError = e
        continue
      }
      throw e
    }
  }

  const tried = chain.map(entry => `${entry.provider}/${entry.modelId}`).join(', ')
  const last = lastError instanceof Error ? lastError.message : String(lastError ?? '')
  throw new Error(
    `No AI model answered (tried ${tried}). ` +
    'Add a free key (Gemini, Groq, Cerebras, OpenRouter) or a custom model in Settings → AI Models, or install an Ollama model. ' +
    `Last error: ${last.slice(0, 200)}`,
  )
}

/** Legacy: selectAIModel kept for compatibility with streaming routes */
export async function selectAIModel(opts?: ModelOverride): Promise<{ model: LanguageModel; fallbackModel?: LanguageModel }> {
  const withModel = (await buildModelChain(opts)).filter(entry => entry.model)
  if (withModel.length === 0) throw new Error('No AI providers configured')
  return { model: withModel[0].model!, fallbackModel: withModel[1]?.model }
}

/** Legacy non-streaming helper */
export async function generateGhostforgeReply(messages: ModelMessage[], modelOverride?: ModelOverride) {
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
  const geminiKey = getProviderKey('google')
  const orKey = getProviderKey('openrouter')
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
      const model = or.chat('nvidia/nemotron-nano-12b-v2-vl:free')
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
