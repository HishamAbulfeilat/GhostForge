import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** A single step in the setup wizard */
export interface SetupStep {
  id: string;
  title: string;
  description: string;
  required: boolean;
  completed: boolean;
  config: Record<string, unknown> | null;
}

/** Overall setup status */
export interface SetupStatus {
  isFirstRun: boolean;
  totalSteps: number;
  completedSteps: number;
  allRequiredComplete: boolean;
}

/** Map of step ID to its saved configuration */
export type SetupConfigMap = Record<string, Record<string, unknown>>;

const STORE_PATH = join(homedir(), '.ghostforge', 'setup-state.json');

/** The ordered list of setup steps */
const SETUP_STEPS: Array<Omit<SetupStep, 'completed' | 'config'>> = [
  {
    id: 'api-key',
    title: 'API Key',
    description: 'Configure your Ollama or OpenAI API key for LLM access.',
    required: true,
  },
  {
    id: 'voice-model',
    title: 'Voice Model',
    description: 'Choose your preferred voice engine and voice model.',
    required: false,
  },
  {
    id: 'language',
    title: 'Language',
    description: 'Select your preferred language and region.',
    required: true,
  },
  {
    id: 'assistant-name',
    title: 'Assistant Name',
    description: 'Give your JARVIS assistant a name.',
    required: false,
  },
  {
    id: 'auto-start',
    title: 'Auto-Start',
    description: 'Choose whether JARVIS starts automatically on boot.',
    required: false,
  },
  {
    id: 'first-run',
    title: 'Welcome',
    description: 'Complete the setup to start using GhostForge JARVIS.',
    required: true,
  },
];

// ── State persistence ───────────────────────────────────────────────────────

interface SetupState {
  completedSteps: string[];
  configs: SetupConfigMap;
}

function ensureDir(): void {
  const dir = join(homedir(), '.ghostforge');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadState(): SetupState {
  ensureDir();

  if (!existsSync(STORE_PATH)) {
    return { completedSteps: [], configs: {} };
  }

  try {
    const raw = readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      completedSteps: Array.isArray(parsed.completedSteps) ? parsed.completedSteps : [],
      configs: typeof parsed.configs === 'object' && parsed.configs !== null ? parsed.configs : {},
    };
  } catch {
    return { completedSteps: [], configs: {} };
  }
}

function saveState(state: SetupState): void {
  ensureDir();
  writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the overall setup status.
 */
export function getSetupStatus(): SetupStatus {
  const state = loadState();
  const requiredIds = SETUP_STEPS.filter(s => s.required).map(s => s.id);

  return {
    isFirstRun: state.completedSteps.length === 0,
    totalSteps: SETUP_STEPS.length,
    completedSteps: state.completedSteps.length,
    allRequiredComplete: requiredIds.every(id => state.completedSteps.includes(id)),
  };
}

/**
 * Get the ordered list of setup steps, each annotated with its completion status
 * and any previously saved config.
 */
export function getSetupSteps(): SetupStep[] {
  const state = loadState();

  return SETUP_STEPS.map(step => ({
    ...step,
    completed: state.completedSteps.includes(step.id),
    config: state.configs[step.id] || null,
  }));
}

/**
 * Mark a setup step as completed and save its configuration.
 */
export function completeStep(stepId: string, config: Record<string, unknown> = {}): SetupStep | null {
  const step = SETUP_STEPS.find(s => s.id === stepId);
  if (!step) return null;

  const state = loadState();

  if (!state.completedSteps.includes(stepId)) {
    state.completedSteps.push(stepId);
  }

  state.configs[stepId] = config;
  saveState(state);

  return {
    ...step,
    completed: true,
    config,
  };
}

/**
 * Check whether this is the first time the app has been launched.
 * Returns `true` if no setup steps have been completed.
 */
export function isFirstRun(): boolean {
  const state = loadState();
  return state.completedSteps.length === 0;
}

/**
 * Reset all setup state — useful for re-running the wizard.
 */
export function resetSetup(): void {
  saveState({ completedSteps: [], configs: {} });
}

/**
 * Retrieve the saved config for a specific step.
 */
export function getStepConfig(stepId: string): Record<string, unknown> | null {
  const state = loadState();
  return state.configs[stepId] || null;
}

/**
 * Check if a specific step is completed.
 */
export function isStepCompleted(stepId: string): boolean {
  const state = loadState();
  return state.completedSteps.includes(stepId);
}
