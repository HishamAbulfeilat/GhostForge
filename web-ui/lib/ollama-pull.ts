/**
 * Starting `ollama pull` for the model routes (/api/llmfit, /api/models/install).
 *
 * Only models from the app's own catalogs may be pulled by regular users, and
 * a failure to start ollama (not installed, not on PATH) is reported to the
 * caller instead of answering "pulling" and crashing later on an unhandled
 * 'error' event.
 */
import { spawn, type SpawnOptions } from 'child_process'
import { MODEL_DATABASE } from './llmfit-models'
import { LOCAL_MODELS } from './local-models'

/** Ollama model names the app knows (llmfit catalog + local-model picker). */
export function catalogOllamaModels(): Set<string> {
  return new Set([
    ...MODEL_DATABASE.map(m => m.id),
    ...LOCAL_MODELS.filter(m => m.runner === 'ollama').map(m => m.name),
  ])
}

/** A model reference ollama can take as one argument (never an option flag). */
export const SAFE_MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,119}$/

export function isCatalogOllamaModel(name: string): boolean {
  return catalogOllamaModels().has(name)
}

export type StartResult = { ok: true } | { ok: false; error: string }

/**
 * Spawn a detached background process and resolve once it has really started
 * (the 'spawn' event) or failed to (the 'error' event, e.g. ENOENT).
 */
export function startDetached(command: string, args: string[], options: SpawnOptions = {}): Promise<StartResult> {
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { ...options, detached: true, stdio: 'ignore' })
    } catch (err) {
      resolve({ ok: false, error: `Could not start ${command}: ${String((err as Error).message || err).slice(0, 120)}` })
      return
    }
    // Keep a listener for the whole life of the child: an 'error' with no
    // listener is an uncaught exception in the server process.
    child.on('error', err => {
      const code = (err as NodeJS.ErrnoException).code
      resolve({ ok: false, error: code === 'ENOENT' ? `${command} is not installed or not on PATH` : `Could not start ${command}: ${err.message.slice(0, 120)}` })
    })
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

/** PATH used for ollama (Homebrew locations first on macOS). */
export function ollamaEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:${process.env.PATH || ''}` }
}

export function startOllamaPull(model: string): Promise<StartResult> {
  if (!SAFE_MODEL_NAME.test(model)) return Promise.resolve({ ok: false, error: 'Invalid model name format' })
  return startDetached('ollama', ['pull', model], { env: ollamaEnv() })
}
