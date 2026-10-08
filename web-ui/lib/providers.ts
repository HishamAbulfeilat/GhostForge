/**
 * AI provider registry — one place that knows every provider GhostForge can
 * talk to, where its API key comes from, and how to list its models live.
 *
 * Keys saved through Settings (~/.ghostforge/provider-keys.json, owner-only
 * file mode) take precedence over the environment (.env / .env.local).
 * Pollinations' anonymous endpoint needs no key or install, but has limits
 * and may be unavailable. Local models provide a no-account alternative.
 *
 * Hosted mode (GHOSTFORGE_MODE=hosted) is different: the environment is never
 * read for keys, and keys, the model choice and custom models are stored per
 * user (~/.ghostforge/hosted-ai/<userId>.json). The user comes from
 * runWithAIUser() (or ModelOverride.userId in lib/ai.ts); with no user there
 * is no key, so only keyless free models (Pollinations) answer.
 * OmniRoute is optional — used when it is running.
 */
import Anthropic from '@anthropic-ai/sdk'
import { AsyncLocalStorage } from 'async_hooks'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isHostedMode } from './hosted'
import { isSafePublicUrl } from './net-guard'

export type ProviderId =
  | 'pollinations' | 'omniroute' | 'openai' | 'anthropic' | 'google'
  | 'openrouter' | 'groq' | 'cerebras' | 'nvidia' | 'together' | 'huggingface'
  | 'xai' | 'deepseek'

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** Env var holding the API key; null = no key needed */
  keyEnv: string | null
  keyUrl?: string
  /** Paid providers are only used when selected, never as silent fallbacks */
  paid: boolean
  defaultModel: string
  /** OpenAI-compatible base URL (chat + /models) */
  baseURL?: string
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  pollinations: { id: 'pollinations', name: 'Pollinations (free, no key)', keyEnv: null, paid: false, defaultModel: 'openai', baseURL: 'https://text.pollinations.ai/openai' },
  omniroute:  { id: 'omniroute',  name: 'OmniRoute (optional)', keyEnv: null, paid: false, defaultModel: 'auto' },
  openai:     { id: 'openai',     name: 'OpenAI (ChatGPT)',  keyEnv: 'OPENAI_API_KEY', keyUrl: 'https://platform.openai.com/api-keys', paid: true, defaultModel: 'gpt-4o-mini', baseURL: 'https://api.openai.com/v1' },
  anthropic:  { id: 'anthropic',  name: 'Anthropic (Claude)', keyEnv: 'ANTHROPIC_API_KEY', keyUrl: 'https://console.anthropic.com/settings/keys', paid: true, defaultModel: 'claude-opus-5' },
  google:     { id: 'google',     name: 'Google (Gemini)',   keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY', keyUrl: 'https://aistudio.google.com/apikey', paid: false, defaultModel: 'gemini-2.5-flash' },
  openrouter: { id: 'openrouter', name: 'OpenRouter',        keyEnv: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys', paid: false, defaultModel: 'google/gemma-4-26b-a4b-it:free', baseURL: 'https://openrouter.ai/api/v1' },
  groq:       { id: 'groq',       name: 'Groq',              keyEnv: 'GROQ_API_KEY', keyUrl: 'https://console.groq.com/keys', paid: false, defaultModel: 'llama-3.3-70b-versatile', baseURL: 'https://api.groq.com/openai/v1' },
  xai:        { id: 'xai',        name: 'xAI (Grok)',        keyEnv: 'XAI_API_KEY', keyUrl: 'https://console.x.ai', paid: true, defaultModel: 'grok-3-mini', baseURL: 'https://api.x.ai/v1' },
  nvidia:     { id: 'nvidia',     name: 'NVIDIA NIM',        keyEnv: 'NVIDIA_API_KEY', keyUrl: 'https://build.nvidia.com', paid: false, defaultModel: 'meta/llama-3.3-70b-instruct', baseURL: 'https://integrate.api.nvidia.com/v1' },
  cerebras:   { id: 'cerebras',   name: 'Cerebras',          keyEnv: 'CEREBRAS_API_KEY', keyUrl: 'https://cloud.cerebras.ai', paid: false, defaultModel: 'llama-3.3-70b', baseURL: 'https://api.cerebras.ai/v1' },
  together:   { id: 'together',   name: 'Together AI',       keyEnv: 'TOGETHER_API_KEY', keyUrl: 'https://api.together.ai', paid: false, defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', baseURL: 'https://api.together.xyz/v1' },
  huggingface: { id: 'huggingface', name: 'Hugging Face',    keyEnv: 'HF_TOKEN', keyUrl: 'https://huggingface.co/settings/tokens', paid: false, defaultModel: 'meta-llama/Llama-3.3-70B-Instruct', baseURL: 'https://router.huggingface.co/v1' },
  deepseek:   { id: 'deepseek',   name: 'DeepSeek',          keyEnv: 'DEEPSEEK_API_KEY', keyUrl: 'https://platform.deepseek.com/api_keys', paid: true, defaultModel: 'deepseek-v4-flash', baseURL: 'https://api.deepseek.com/v1' },
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS
}

/**
 * Known-free models per provider (the list GhostForge shipped before live
 * catalogs). Shown even when a provider has no key yet, merged with the live
 * list once it does.
 */
export const FREE_CATALOG: Partial<Record<ProviderId, Array<{ id: string; label: string }>>> = {
  pollinations: [
    { id: 'openai',      label: 'GPT-OSS (default)' },
    { id: 'openai-fast', label: 'GPT-OSS 20B (fast)' },
  ],
  google: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
  openrouter: [
    { id: 'google/gemma-4-26b-a4b-it:free',         label: 'Gemma 4 26B' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B' },
    { id: 'nvidia/nemotron-nano-12b-v2-vl:free',    label: 'Nemotron Nano 12B VL' },
    { id: 'deepseek/deepseek-r1:free',              label: 'DeepSeek R1' },
    { id: 'meta-llama/llama-3.2-3b-instruct:free',  label: 'Llama 3.2 3B' },
    { id: 'google/gemma-3-12b-it:free',             label: 'Gemma 3 12B' },
    { id: 'mistralai/mistral-7b-instruct:free',     label: 'Mistral 7B' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B Instant' },
    { id: 'gemma2-9b-it',            label: 'Gemma 2 9B' },
  ],
  cerebras: [
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
    { id: 'llama3.1-8b',   label: 'Llama 3.1 8B' },
  ],
  nvidia: [
    { id: 'meta/llama-3.3-70b-instruct',        label: 'Llama 3.3 70B' },
    { id: 'meta/llama-3.1-8b-instruct',         label: 'Llama 3.1 8B' },
    { id: 'mistralai/mistral-7b-instruct-v0.3', label: 'Mistral 7B' },
    { id: 'microsoft/phi-3-mini-128k-instruct', label: 'Phi-3 Mini 128K' },
  ],
  together: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',    label: 'Mixtral 8x7B' },
  ],
  huggingface: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B' },
    { id: 'microsoft/Phi-3-mini-4k-instruct',  label: 'Phi-3 Mini' },
  ],
}

// ── Storage ─────────────────────────────────────────────────────────────────

const GF_DIR = path.join(os.homedir(), '.ghostforge')
const KEYS_PATH = path.join(GF_DIR, 'provider-keys.json')
const SETTINGS_PATH = path.join(GF_DIR, 'settings.json')

function readJSON<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T } catch { return fallback }
}

// ── Hosted mode: per-user AI settings ───────────────────────────────────────

const aiUser = new AsyncLocalStorage<string>()

/** Run `fn` with `userId` as the owner of any AI key looked up inside it (hosted mode) */
export function runWithAIUser<T>(userId: string, fn: () => T): T {
  return aiUser.run(userId, fn)
}

/** The user whose keys apply right now (hosted mode); undefined = nobody's */
export function currentAIUser(): string | undefined {
  return aiUser.getStore()
}

interface HostedAISettings {
  keys?: Record<string, string>
  activeProvider?: string
  activeModel?: string
  customModels?: CustomModel[]
}

const HOSTED_AI_DIR = path.join(GF_DIR, 'hosted-ai')

function hostedAIPath(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error('Invalid user id')
  return path.join(HOSTED_AI_DIR, `${userId}.json`)
}

function readHostedAI(userId = currentAIUser()): HostedAISettings {
  if (!userId) return {}
  return readJSON<HostedAISettings>(hostedAIPath(userId), {})
}

function writeHostedAI(update: (s: HostedAISettings) => HostedAISettings): void {
  const userId = currentAIUser()
  if (!userId) throw new Error('Sign in to save AI settings')
  const next = update(readHostedAI(userId))
  fs.mkdirSync(HOSTED_AI_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(hostedAIPath(userId), JSON.stringify(next, null, 2), { mode: 0o600 })
}

// ── API keys ────────────────────────────────────────────────────────────────

function readStoredKeys(): Record<string, string> {
  if (isHostedMode()) return readHostedAI().keys || {}
  return readJSON<Record<string, string>>(KEYS_PATH, {})
}

/**
 * A key saved in Settings overrides the environment, so a stale .env key can
 * be fixed from the UI. Hosted mode: only the current user's saved key —
 * never the server's environment.
 */
export function getProviderKey(provider: ProviderId): string | undefined {
  const env = PROVIDERS[provider].keyEnv
  if (!env) return undefined
  if (isHostedMode()) return readStoredKeys()[env] || undefined
  return readStoredKeys()[env] || process.env[env] || undefined
}

/** OmniRoute is a local gateway by default; only send an auth header when configured. */
export function getOmniRouteKey(): string | undefined {
  if (isHostedMode()) return undefined
  const key = process.env.OMNIROUTE_API_KEY?.trim()
  return key || undefined
}

/** Where a provider's key comes from — never the key itself */
export function keySource(provider: ProviderId): 'none-needed' | 'env' | 'settings' | 'missing' {
  const env = PROVIDERS[provider].keyEnv
  if (!env) return 'none-needed'
  if (readStoredKeys()[env]) return 'settings'
  if (!isHostedMode() && process.env[env]) return 'env'
  return 'missing'
}

/** Save (or clear, with an empty key) a provider key from Settings */
export function saveProviderKey(provider: ProviderId, key: string): void {
  const env = PROVIDERS[provider].keyEnv
  if (!env) throw new Error(`${PROVIDERS[provider].name} does not use an API key`)
  _modelCache.delete(modelCacheKey(provider))
  if (isHostedMode()) {
    writeHostedAI(s => {
      const keys = { ...(s.keys || {}) }
      if (key.trim()) keys[env] = key.trim()
      else delete keys[env]
      return { ...s, keys }
    })
    return
  }
  const keys = readStoredKeys()
  if (key.trim()) keys[env] = key.trim()
  else delete keys[env]
  fs.mkdirSync(GF_DIR, { recursive: true })
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), { mode: 0o600 })
}

// ── Saved model selection (shared by chat, JARVIS, TUI) ─────────────────────

/** Anything a user can pick: a registry provider, a custom model, or a local runtime */
export type SelectableProvider = ProviderId | 'custom' | 'ollama' | 'llamacpp'

export function isSelectableProvider(value: unknown): value is SelectableProvider {
  return isProviderId(value) || value === 'custom' || value === 'ollama' || value === 'llamacpp'
}

export interface ModelSelection { provider: SelectableProvider; model: string }

export function getSavedSelection(): ModelSelection | null {
  const s = isHostedMode() ? readHostedAI() : readJSON<{ activeProvider?: string; activeModel?: string }>(SETTINGS_PATH, {})
  if (!isSelectableProvider(s.activeProvider) || !s.activeModel) return null
  // Local runtimes and OmniRoute belong to the host, not to a hosted user
  if (isHostedMode() && (s.activeProvider === 'ollama' || s.activeProvider === 'llamacpp' || s.activeProvider === 'omniroute')) return null
  return { provider: s.activeProvider, model: s.activeModel }
}

/** Forget the saved choice — back to automatic free models */
export function clearSelection(): void {
  if (isHostedMode()) {
    writeHostedAI(s => {
      const next = { ...s }
      delete next.activeProvider
      delete next.activeModel
      return next
    })
    return
  }
  const s = readJSON<Record<string, unknown>>(SETTINGS_PATH, {})
  delete s.activeProvider
  delete s.activeModel
  fs.mkdirSync(GF_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2))
}

// ── Custom models (any OpenAI-compatible endpoint) ──────────────────────────

const CUSTOM_MODELS_PATH = path.join(GF_DIR, 'custom-models.json')

export interface CustomModel {
  id: string
  name: string
  /** OpenAI-compatible base URL, e.g. https://api.example.com/v1 */
  baseURL: string
  /** Model id sent to the endpoint */
  model: string
  apiKey?: string
  free?: boolean
}

/** Public view: never includes the key */
export type CustomModelInfo = Omit<CustomModel, 'apiKey'> & { hasKey: boolean }

function readCustomModels(): CustomModel[] {
  const list = isHostedMode() ? readHostedAI().customModels : readJSON<CustomModel[]>(CUSTOM_MODELS_PATH, [])
  return Array.isArray(list) ? list : []
}

function writeCustomModels(list: CustomModel[]): void {
  if (isHostedMode()) {
    writeHostedAI(s => ({ ...s, customModels: list }))
    return
  }
  fs.mkdirSync(GF_DIR, { recursive: true })
  fs.writeFileSync(CUSTOM_MODELS_PATH, JSON.stringify(list, null, 2), { mode: 0o600 })
}

export function listCustomModels(): CustomModelInfo[] {
  return readCustomModels().map(({ apiKey, ...rest }) => ({ ...rest, hasKey: !!apiKey }))
}

export function getCustomModel(id: string): CustomModel | undefined {
  return readCustomModels().find(m => m.id === id)
}

export function saveCustomModel(input: Omit<CustomModel, 'id'> & { id?: string }): CustomModelInfo {
  const list = readCustomModels()
  const id = input.id || `${input.name}-${input.model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const existing = list.find(m => m.id === id)
  const entry: CustomModel = {
    id,
    name: input.name,
    baseURL: input.baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
    model: input.model,
    // keep the stored key when an edit leaves the key field empty
    apiKey: input.apiKey || existing?.apiKey || undefined,
    free: input.free,
  }
  // Hosted: no plain http, no loopback / private hosts (Ollama, the bridge, cloud metadata).
  // Literal check here; the route also checks DNS, and every request re-checks at connect time.
  if (isHostedMode() && !isSafePublicUrl(entry.baseURL)) {
    throw new Error('On the hosted version a custom model needs a public https:// URL')
  }
  writeCustomModels([...list.filter(m => m.id !== id), entry])
  const { apiKey, ...rest } = entry
  return { ...rest, hasKey: !!apiKey }
}

export function deleteCustomModel(id: string): boolean {
  const list = readCustomModels()
  const next = list.filter(m => m.id !== id)
  if (next.length === list.length) return false
  writeCustomModels(next)
  return true
}

export function saveSelection(selection: ModelSelection): void {
  if (isHostedMode()) {
    if (selection.provider === 'ollama' || selection.provider === 'llamacpp' || selection.provider === 'omniroute') {
      throw new Error('Local models are not available on the hosted version')
    }
    writeHostedAI(s => ({ ...s, activeProvider: selection.provider, activeModel: selection.model }))
    return
  }
  const s = readJSON<Record<string, unknown>>(SETTINGS_PATH, {})
  s.activeProvider = selection.provider
  s.activeModel = selection.model
  fs.mkdirSync(GF_DIR, { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2))
}

// ── OmniRoute ───────────────────────────────────────────────────────────────

export function omniRouteBaseURL(): string {
  const raw = (process.env.OMNIROUTE_URL || 'http://localhost:20128/v1').replace(/\/+$/, '')
  return raw.endsWith('/v1') ? raw : `${raw}/v1`
}

/** OmniRoute's routing aliases — each spreads requests across its free providers */
export const OMNIROUTE_AUTO_MODELS = [
  { id: 'auto',         label: 'Auto (balanced, free)' },
  { id: 'auto/coding',  label: 'Auto · Coding (quality-first, free)' },
  { id: 'auto/fast',    label: 'Auto · Fast (lowest latency, free)' },
  { id: 'auto/cheap',   label: 'Auto · Cheap (cost-optimized)' },
  { id: 'auto/offline', label: 'Auto · Max quota headroom' },
]

// ── Live model catalogs ─────────────────────────────────────────────────────

export interface ProviderModel {
  id: string
  label: string
  free: boolean
}

export interface ProviderModelList {
  provider: ProviderId
  models: ProviderModel[]
  error?: string
}

const MODEL_CACHE_TTL = 10 * 60_000
const _modelCache = new Map<string, { ts: number; list: ProviderModelList }>()

/** Hosted mode caches each user's (key-dependent) model lists separately */
function modelCacheKey(provider: ProviderId): string {
  return isHostedMode() ? `${provider}|${currentAIUser() || '-'}` : provider
}

const NON_CHAT = /(embed|embedding|whisper|tts|audio|realtime|transcribe|dall-e|image|moderation|search|computer-use|guard|rerank|davinci|babbage)/i

async function fetchJSON<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

type OpenAIModelsResponse = { data?: Array<{ id: string; name?: string; pricing?: { prompt?: string; completion?: string } }> }

/** OmniRoute's `auto` routes always work; its full catalog may need OMNIROUTE_API_KEY */
async function listOmniRoute(): Promise<{ models: ProviderModel[]; error?: string }> {
  if (isHostedMode()) return { models: [], error: 'OmniRoute is not available on the hosted version' }
  const autos = OMNIROUTE_AUTO_MODELS.map(m => ({ ...m, free: m.id !== 'auto/cheap' }))
  try {
    const apiKey = getOmniRouteKey()
    const data = await fetchJSON<OpenAIModelsResponse>(`${omniRouteBaseURL()}/models`, {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    })
    const live = (data.data || [])
      .filter(m => m.id && !NON_CHAT.test(m.id))
      .map(m => ({ id: m.id, label: m.id, free: /free/i.test(m.id) }))
    return { models: [...autos, ...live.filter(m => !autos.some(a => a.id === m.id))] }
  } catch (e) {
    const unauthorized = /^401\b/.test(e instanceof Error ? e.message : '')
    return {
      models: autos,
      error: unauthorized
        ? 'Showing auto routes only — to list every OmniRoute model, create an API key in its dashboard and set OMNIROUTE_API_KEY'
        : `Couldn't list OmniRoute models: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

async function listPollinations(): Promise<ProviderModel[]> {
  const data = await fetchJSON<Array<{ name?: string; description?: string }>>('https://text.pollinations.ai/models')
  return (Array.isArray(data) ? data : [])
    .filter(m => m.name)
    .map(m => ({ id: m.name!, label: m.description || m.name!, free: true }))
}

async function listOpenAICompatible(provider: ProviderId, key: string): Promise<ProviderModel[]> {
  const info = PROVIDERS[provider]
  const data = await fetchJSON<OpenAIModelsResponse>(`${info.baseURL}/models`, { Authorization: `Bearer ${key}` })
  let models = (data.data || []).filter(m => m.id && !NON_CHAT.test(m.id))
  if (provider === 'openai') models = models.filter(m => /^(gpt-|o\d|chatgpt-)/.test(m.id))
  return models
    .map(m => {
      const free = provider === 'openrouter'
        ? m.pricing?.prompt === '0' && m.pricing?.completion === '0'
        : !info.paid
      return { id: m.id, label: m.name || m.id, free }
    })
    .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id))
}

async function listAnthropic(key: string): Promise<ProviderModel[]> {
  const client = new Anthropic({ apiKey: key })
  const models: ProviderModel[] = []
  for await (const m of client.models.list()) {
    models.push({ id: m.id, label: m.display_name || m.id, free: false })
  }
  return models
}

async function listGoogle(key: string): Promise<ProviderModel[]> {
  const data = await fetchJSON<{ models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> }>(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
  )
  return (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent') && !NON_CHAT.test(m.name))
    .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name, free: true }))
}

/** List a provider's models live (cached 10 min). Never throws — errors are reported in the result. */
export async function listProviderModels(provider: ProviderId, { refresh = false } = {}): Promise<ProviderModelList> {
  const cacheKey = modelCacheKey(provider)
  const cached = _modelCache.get(cacheKey)
  if (!refresh && cached && Date.now() - cached.ts < MODEL_CACHE_TTL) return cached.list

  const catalog = (FREE_CATALOG[provider] || []).map(m => ({ ...m, free: true }))
  let list: ProviderModelList
  try {
    if (provider === 'omniroute') {
      list = { provider, ...(await listOmniRoute()) }
    } else if (provider === 'pollinations') {
      list = { provider, models: await listPollinations() }
    } else {
      const key = getProviderKey(provider)
      if (!key) return { provider, models: catalog, error: 'No API key' }
      const models = provider === 'anthropic' ? await listAnthropic(key)
        : provider === 'google' ? await listGoogle(key)
        : await listOpenAICompatible(provider, key)
      list = { provider, models }
    }
  } catch (e) {
    // The curated free list still lets you pick a model when listing fails
    list = { provider, models: catalog, error: e instanceof Error ? e.message : String(e) }
  }
  // Known-free models first, flagged free even when the live API doesn't say so
  if (catalog.length && !list.error) {
    const freeIds = new Set(catalog.map(m => m.id))
    const live = list.models.map(m => (freeIds.has(m.id) ? { ...m, free: true } : m))
    const missing = provider === 'pollinations' ? catalog.filter(c => !live.some(m => m.id === c.id)) : []
    list = { ...list, models: [...missing, ...live].sort((a, b) => Number(b.free) - Number(a.free)) }
  }
  // Cache successes; retry failures on the next request after a short pause
  _modelCache.set(cacheKey, { ts: list.error ? Date.now() - MODEL_CACHE_TTL + 15_000 : Date.now(), list })
  return list
}
