import { webUiRequest } from './web-ui.js';
import { spawnSync } from 'child_process';
import { stripVTControlCharacters } from 'util';

const PREFERRED_LOCAL_MODELS = [
  'qwen3.5:4b',
  'qwen3.5:9b',
  'qwen2.5-coder:7b',
  'llama3.2:3b',
];

export function selectLocalModel(installedModels, selectedProvider, selectedModel) {
  if (selectedProvider === 'ollama' && installedModels.includes(selectedModel)) return selectedModel;
  return PREFERRED_LOCAL_MODELS.find(model => installedModels.includes(model)) || installedModels[0] || null;
}

// POST /api/jarvis on the web UI (GF_WEB_UI_URL, default http://localhost:3001).
// fetch follows the URL's scheme, so the HTTPS server (npm start) works too.
// Resolves null when the server is unreachable or refuses the request.
export async function requestJarvis(payload, timeoutMs, { env = process.env, fetchImpl = fetch } = {}) {
  try {
    const { ok, body } = await webUiRequest('/api/jarvis', { method: 'POST', body: payload, timeoutMs, env, fetchImpl });
    if (!ok) return null;
    if (typeof body.text === 'string' && Object.keys(body).length === 1) {
      return body.text.trim() ? { speech: body.text } : null;
    }
    return body;
  } catch {
    return null;
  }
}

function runLocalOllama(message, history, selectedProvider, selectedModel, timeoutMs) {
  const listResult = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 5000 });
  if (listResult.status !== 0) return null;

  const installedModels = (listResult.stdout || '')
    .split('\n')
    .slice(1)
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);
  const model = selectLocalModel(installedModels, selectedProvider, selectedModel);
  if (!model) return null;

  const context = history.slice(-4).map(item => `${item.role}: ${item.content || item.text}`).join('\n');
  const prompt = context ? `${context}\nuser: ${message}` : message;
  const result = spawnSync('ollama', ['run', model, prompt, '--hidethinking', '--nowordwrap'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  const speech = stripVTControlCharacters(result.stdout || '').trim();
  if (result.status !== 0 || !speech) return null;
  return { speech, usedModel: model, transport: 'ollama-local' };
}

export async function askGFAI({ message, history = [], selectedProvider, selectedModel }, options = {}) {
  const serverTimeoutMs = options.serverTimeoutMs || 3000;
  const localTimeoutMs = options.localTimeoutMs || 120000;
  const payload = {
    message,
    history: history.slice(-6),
    selectedProvider: selectedProvider || undefined,
    selectedModel: selectedModel || undefined,
  };

  const serverResponse = await requestJarvis(payload, serverTimeoutMs, options);
  if (serverResponse?.speech || serverResponse?.text) return { ...serverResponse, transport: 'jarvis-server' };

  const localResponse = runLocalOllama(message, history, selectedProvider, selectedModel, localTimeoutMs);
  if (localResponse) return localResponse;

  return {
    speech: 'G.F.A.I. could not reach the local server and no Ollama model was available. Start the Web UI or install a local model.',
    transport: 'unavailable',
  };
}
