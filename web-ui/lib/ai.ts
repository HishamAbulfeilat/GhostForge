import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type CoreMessage } from 'ai'

export const GHOSTFORGE_SYSTEM = `You are GhostForge AI — an operator-grade developer assistant built by Hisham Abulfeilat.
You help with React, Next.js, TypeScript, Tailwind CSS, Git, CI/CD, Carbon tracking, and all GhostForge toolkit features.
You are concise, technical, and direct. You speak like a senior developer.
Available GhostForge commands the user can run on their Mac: ghostforge carbon status, ghostforge carbon track <cmd>, ghostforge ai-review staged, ghostforge standup today, ghostforge dep-health check, ghostforge health-score score, ghostforge bundle track, ghostforge lighthouse run <url>, and many more.
When user asks to run a command, prefix with [RUN]: ghostforge <command> — the UI will offer to execute it.`

export async function generateGhostforgeReply(messages: CoreMessage[]) {
  const openrouterKey = process.env.OPENROUTER_API_KEY
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  // Gemini first (Google AI Plus = high quota + 2.5 Pro access)
  if (geminiKey) {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({ apiKey: geminiKey })
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
    try {
      const response = await generateText({
        model: google(model),
        system: GHOSTFORGE_SYSTEM,
        messages,
      })
      return response.text
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('quota') || msg.includes('exceeded')) {
        // Fall through to OpenRouter fallback
        console.warn('Gemini quota exceeded, falling back to OpenRouter')
      } else if (msg.includes('no longer available') || msg.includes('not found')) {
        throw new Error('⚠️ Gemini model unavailable. Set GEMINI_MODEL=gemini-2.5-flash in .env.local')
      } else {
        throw new Error(`Gemini error: ${msg}`)
      }
    }
  }

  // OpenRouter fallback
  if (openrouterKey) {
    const openrouter = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: openrouterKey,
    })
    const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free'
    const response = await generateText({
      model: openrouter(model),
      system: GHOSTFORGE_SYSTEM,
      messages,
    })
    return response.text
  }

  return '⚠️ No AI API key configured. Add GOOGLE_GENERATIVE_AI_API_KEY or OPENROUTER_API_KEY in .env.local'
}
