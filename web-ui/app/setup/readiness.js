// Pure helpers that turn /api/bridge-status and /api/models responses into
// setup readiness rows. Only booleans, labels and provider names are kept —
// never key values, key env contents, URLs or host details.

const STATES = ['configured', 'missing', 'unreachable']

/**
 * @param {{ status?: string } | null} data  parsed /api/bridge-status body, or null when the call failed
 * @returns {{ id: string, label: string, state: 'configured'|'missing'|'unreachable', detail: string, action: string }}
 */
function bridgeReadiness(data) {
  const label = 'JARVIS bridge (:8765)'
  const status = data && typeof data.status === 'string' ? data.status : null
  if (status === 'connected') {
    return { id: 'bridge', label, state: 'configured', detail: 'The bridge is running and answering health checks.', action: 'Nothing to do.' }
  }
  if (status === 'unconfigured') {
    return {
      id: 'bridge', label, state: 'missing',
      detail: 'No bridge is running and no bridge token has been created yet.',
      action: 'Start the bridge from the JARVIS page (or run mark-l-bridge) so it can create its token.',
    }
  }
  return {
    id: 'bridge', label, state: 'unreachable',
    detail: status === 'disconnected'
      ? 'A bridge token exists but the bridge did not answer its health check.'
      : 'Could not read the bridge status.',
    action: 'Start or restart the bridge from the JARVIS page, then refresh this check.',
  }
}

/**
 * @param {{ providers?: Array<{ id: string, name: string, available: boolean, error?: string|null }>,
 *           ollama?: { running?: boolean } } | null} data  parsed /api/models body, or null when the call failed
 */
function modelReadiness(data) {
  const label = 'Model provider'
  if (!data || !Array.isArray(data.providers)) {
    return {
      id: 'models', label, state: 'unreachable',
      detail: 'Could not read the model configuration.',
      action: 'Reload the page, or check that the web server is healthy.',
      providers: [],
    }
  }
  const available = data.providers.filter(p => p && p.available)
  const ollamaRunning = Boolean(data.ollama && data.ollama.running)
  const working = available.filter(p => !p.error)
  const names = working.map(p => p.name || p.id)
  if (working.length > 0 || (available.length === 0 && ollamaRunning)) {
    if (ollamaRunning && !names.includes('Ollama')) names.push('Ollama (local)')
    return {
      id: 'models', label, state: 'configured',
      detail: `Ready: ${names.join(', ')}.`,
      action: 'Nothing to do. Pick a specific model any time in Settings → Models.',
      providers: names,
    }
  }
  if (available.length > 0) {
    return {
      id: 'models', label, state: 'unreachable',
      detail: `Configured but not responding: ${available.map(p => p.name || p.id).join(', ')}.`,
      action: 'Check your network and that the provider key is still valid in Settings → Models.',
      providers: [],
    }
  }
  return {
    id: 'models', label, state: 'missing',
    detail: 'No model provider has a key and no local model is running.',
    action: 'Add a provider key in Settings → Models, or start Ollama / OmniRoute locally.',
    providers: [],
  }
}

const HEALTH_TO_STATE = { ready: 'configured', missing: 'missing', offline: 'unreachable', error: 'unreachable' }

/**
 * Map /api/health checks (lib/health-core.mjs) to setup readiness rows, so the
 * setup checklist shows the same answer as the dashboard and the TUI doctor.
 * Returns [] when the health report is unavailable (signed out, hosted mode).
 * @param {{ checks?: Array<{ id: string, label: string, status: string, detail: string, fix?: string }> } | null} report
 */
function healthReadiness(report) {
  if (!report || !Array.isArray(report.checks)) return []
  return report.checks
    .filter(c => c && typeof c.id === 'string' && Object.hasOwn(HEALTH_TO_STATE, c.status))
    .map(c => ({
      id: `health-${c.id}`,
      label: String(c.label || c.id),
      state: HEALTH_TO_STATE[c.status],
      detail: String(c.detail || ''),
      action: c.status === 'ready' ? 'Nothing to do.' : String(c.fix || 'Re-check after fixing it.'),
    }))
}

module.exports = { STATES, bridgeReadiness, modelReadiness, healthReadiness }
