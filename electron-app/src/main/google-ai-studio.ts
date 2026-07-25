import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CREDENTIALS_DIR = join(homedir(), '.ghostforge', 'credentials');
const AI_STUDIO_CONFIG_FILE = join(CREDENTIALS_DIR, 'ai-studio.json');

// ── Types ────────────────────────────────────────────────────────────────────

export interface AIStudioConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface TunedModel {
  name: string;
  displayName: string;
  description: string;
  baseModel: string;
  state: string;
  createTime: string;
  updateTime: string;
  tuningTask?: {
    trainingData: { gcsUri?: string };
    hyperparameters: Record<string, unknown>;
  };
  modelType?: string;
}

export interface GenerateContentRequest {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  safetySettings?: Array<{ category: string; threshold: string }>;
}

export interface GenerateContentResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
    safetyRatings: Array<{ category: string; probability: string }>;
  }>;
  promptFeedback?: { safetyRatings: Array<{ category: string; probability: string }> };
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  supportedGenerationMethods: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
  inputTokenLimit: number;
  outputTokenLimit: number;
}

export interface ComparisonResult {
  modelA: { model: string; response: string; latencyMs: number; tokenCount?: number };
  modelB: { model: string; response: string; latencyMs: number; tokenCount?: number };
}

// ── Config Storage ───────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
}

function loadConfig(): AIStudioConfig {
  ensureConfigDir();
  if (!existsSync(AI_STUDIO_CONFIG_FILE)) {
    return { apiKey: process.env.GOOGLE_AI_STUDIO_KEY || process.env.GEMINI_API_KEY || '' };
  }
  try {
    const raw = readFileSync(AI_STUDIO_CONFIG_FILE, 'utf8');
    const config = JSON.parse(raw) as AIStudioConfig;
    if (!config.apiKey) config.apiKey = process.env.GOOGLE_AI_STUDIO_KEY || process.env.GEMINI_API_KEY || '';
    return config;
  } catch {
    return { apiKey: process.env.GOOGLE_AI_STUDIO_KEY || process.env.GEMINI_API_KEY || '' };
  }
}

function saveConfig(config: AIStudioConfig): void {
  ensureConfigDir();
  writeFileSync(AI_STUDIO_CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ── API Helpers ──────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const config = loadConfig();
  return config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
}

async function aiStudioRequest(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<unknown> {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error('Google AI Studio API key not configured. Set GOOGLE_AI_STUDIO_KEY or configure in Settings.');
  }

  const baseUrl = getBaseUrl();
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set('key', config.apiKey);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      url.searchParams.set(k, v);
    }
  }

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60000),
  };
  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(url.toString(), fetchOptions);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI Studio API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ── Configuration ────────────────────────────────────────────────────────────

export function setApiKey(apiKey: string): { success: boolean } {
  const config = loadConfig();
  config.apiKey = apiKey;
  saveConfig(config);
  return { success: true };
}

export function getApiKeyStatus(): { configured: boolean; keyPreview: string } {
  const config = loadConfig();
  return {
    configured: !!config.apiKey,
    keyPreview: config.apiKey ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}` : '',
  };
}

// ── Tuned Models (AI Studio Apps) ───────────────────────────────────────────

export async function listTunedModels(): Promise<TunedModel[]> {
  const data = await aiStudioRequest('/tunedModels') as {
    tunedModels?: TunedModel[];
  };
  return data.tunedModels || [];
}

export async function getTunedModel(modelId: string): Promise<TunedModel> {
  const data = await aiStudioRequest(`/tunedModels/${modelId}`) as TunedModel;
  return data;
}

export async function generateContent(
  model: string,
  prompt: string,
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  },
): Promise<GenerateContentResponse> {
  const contents: GenerateContentRequest['contents'] = [];

  if (options?.systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: options.systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] });
  }

  contents.push({ role: 'user', parts: [{ text: prompt }] });

  const body: GenerateContentRequest = {
    contents,
    generationConfig: {
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
      topP: options?.topP,
      topK: options?.topK,
    },
  };

  // Strip undefined values
  if (body.generationConfig) {
    for (const key of Object.keys(body.generationConfig) as Array<keyof NonNullable<GenerateContentRequest['generationConfig']>>) {
      if (body.generationConfig[key] === undefined) {
        delete body.generationConfig[key];
      }
    }
  }

  const data = await aiStudioRequest(`/models/${model}:generateContent`, {
    method: 'POST',
    body,
  }) as GenerateContentResponse;

  return data;
}

export async function updateTunedModel(
  modelId: string,
  updates: {
    displayName?: string;
    description?: string;
  },
): Promise<TunedModel> {
  const updateMask = Object.keys(updates).join(',');
  const data = await aiStudioRequest(`/tunedModels/${modelId}?updateMask=${updateMask}`, {
    method: 'PATCH',
    body: updates,
  }) as TunedModel;
  return data;
}

// ── Base Models ──────────────────────────────────────────────────────────────

export async function listModels(): Promise<ModelInfo[]> {
  const data = await aiStudioRequest('/models') as {
    models?: ModelInfo[];
  };
  return (data.models || []).filter(m =>
    m.supportedGenerationMethods?.includes('generateContent'),
  );
}

export async function getModelInfo(modelName: string): Promise<ModelInfo> {
  const data = await aiStudioRequest(`/models/${modelName}`) as ModelInfo;
  return data;
}

// ── A/B Testing & Comparison ────────────────────────────────────────────────

export async function compareModels(
  prompt: string,
  modelA: string,
  modelB: string,
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
  },
): Promise<ComparisonResult> {
  const startA = Date.now();
  const resultA = await generateContent(modelA, prompt, options);
  const latencyA = Date.now() - startA;

  const startB = Date.now();
  const resultB = await generateContent(modelB, prompt, options);
  const latencyB = Date.now() - startB;

  return {
    modelA: {
      model: modelA,
      response: resultA.candidates?.[0]?.content?.parts?.[0]?.text || '(no response)',
      latencyMs: latencyA,
      tokenCount: resultA.usageMetadata?.totalTokenCount,
    },
    modelB: {
      model: modelB,
      response: resultB.candidates?.[0]?.content?.parts?.[0]?.text || '(no response)',
      latencyMs: latencyB,
      tokenCount: resultB.usageMetadata?.totalTokenCount,
    },
  };
}

// ── Export/Import Config ─────────────────────────────────────────────────────

export async function exportModelConfig(modelId: string): Promise<{
  model: TunedModel;
  exportedAt: string;
  version: string;
}> {
  const model = await getTunedModel(modelId);
  return {
    model,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };
}

export async function importModelConfig(config: {
  model?: Partial<TunedModel>;
  displayName?: string;
  description?: string;
}): Promise<{ success: boolean; message: string }> {
  if (!config.model?.name) {
    return { success: false, message: 'Model configuration must include a model name' };
  }
  return {
    success: true,
    message: `Model config imported for ${config.model.name}. Use AI Studio to fine-tune with the provided configuration.`,
  };
}

// ── Test Prompt ──────────────────────────────────────────────────────────────

export async function testPrompt(
  model: string,
  prompt: string,
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
  },
): Promise<{
  response: string;
  tokenCount?: number;
  latencyMs: number;
  model: string;
}> {
  const start = Date.now();
  const result = await generateContent(model, prompt, options);
  const latencyMs = Date.now() - start;

  return {
    response: result.candidates?.[0]?.content?.parts?.[0]?.text || '(no response)',
    tokenCount: result.usageMetadata?.totalTokenCount,
    latencyMs,
    model,
  };
}
