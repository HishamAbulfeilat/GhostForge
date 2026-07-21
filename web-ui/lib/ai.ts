import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type CoreMessage, type LanguageModel } from 'ai'

export const GHOSTFORGE_SYSTEM = `You are GhostForge AI — an operator-grade developer assistant built by Hisham Abulfeilat.
You help with React, Next.js, TypeScript, Tailwind CSS, Git, CI/CD, Carbon tracking, and all GhostForge toolkit features.
You are concise, technical, and direct. You speak like a senior developer.
Available GhostForge commands the user can run on their Mac: ghostforge carbon status, ghostforge carbon track <cmd>, ghostforge ai-review staged, ghostforge standup today, ghostforge dep-health check, ghostforge health-score score, ghostforge bundle track, ghostforge lighthouse run <url>, and many more.
When user asks to run a command, prefix with [RUN]: ghostforge <command> — the UI will offer to execute it.`

interface ModelOverride {
  activeModel?: string
  activeProvider?: string
}

interface ModelSelection {
  model: LanguageModel
  fallbackModel?: LanguageModel
}

/** Build an OmniRoute LanguageModel — no API key required, runs locally */
function makeOmniRouteModel(modelId = 'auto/coding'): LanguageModel {
  const baseURL = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'
  const omni = createOpenAI({ baseURL, apiKey: 'omniroute' }) // key value ignored by OmniRoute
  return omni(modelId)
}

/** Returns the selected AI model without calling it — used for streaming */
export async function selectAIModel(opts?: ModelOverride): Promise<ModelSelection> {
  const openrouterKey = process.env.OPENROUTER_API_KEY
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  const omniUrl = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1'
  const activeProvider = opts?.activeProvider
  const activeModel = opts?.activeModel

  // Explicit OmniRoute selection
  if (activeProvider === 'omniroute') {
    const modelId = activeModel || process.env.OMNIROUTE_MODEL || 'auto/coding'
    return { model: makeOmniRouteModel(modelId) }
  }

  // Explicit OpenRouter selection
  if (activeProvider === 'openrouter' && openrouterKey && activeModel) {
    const openrouter = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openrouterKey })
    return { model: openrouter(activeModel) }
  }

  // Gemini first (Google AI Plus = high quota)
  if (geminiKey) {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({ apiKey: geminiKey })
    const modelId = (activeProvider === 'google' && activeModel)
      ? activeModel
      : (process.env.GEMINI_MODEL || 'gemini-2.5-flash')

    // Fallback: OpenRouter free model → OmniRoute (local)
    const fallbackModel = openrouterKey
      ? createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openrouterKey })(
          process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free'
        )
      : makeOmniRouteModel()

    return { model: google(modelId), fallbackModel }
  }

  // OpenRouter with OmniRoute as fallback
  if (openrouterKey) {
    const openrouter = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: openrouterKey })
    const modelId = (activeProvider === 'openrouter' && activeModel)
      ? activeModel
      : (process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free')
    return { model: openrouter(modelId), fallbackModel: makeOmniRouteModel() }
  }

  // OmniRoute — free, no key needed (must be running locally)
  if (omniUrl) {
    const modelId = process.env.OMNIROUTE_MODEL || 'auto/coding'
    return { model: makeOmniRouteModel(modelId) }
  }

  throw new Error('⚠️ No AI configured. Add GOOGLE_GENERATIVE_AI_API_KEY, OPENROUTER_API_KEY, or start OmniRoute locally (npx omniroute).')
}

/** Legacy non-streaming helper — kept for scripts/non-chat uses */
export async function generateGhostforgeReply(
  messages: CoreMessage[],
  modelOverride?: ModelOverride
) {
  const { model, fallbackModel } = await selectAIModel(modelOverride)
  const shouldFallback = (msg: string) =>
    msg.includes('quota') || msg.includes('exceeded') || msg.includes('429') ||
    msg.includes('rate') || msg.includes('no longer available') ||
    msg.includes('not found') || msg.includes('deprecated') || msg.includes('unavailable')
  try {
    const response = await generateText({ model, system: GHOSTFORGE_SYSTEM, messages })
    return response.text
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (shouldFallback(msg) && fallbackModel) {
      console.warn('[GhostForge AI] Primary model unavailable, falling back:', msg.slice(0, 80))
      const response = await generateText({ model: fallbackModel, system: GHOSTFORGE_SYSTEM, messages })
      return response.text
    }
    throw new Error(`AI error: ${msg}`)
  }
}
