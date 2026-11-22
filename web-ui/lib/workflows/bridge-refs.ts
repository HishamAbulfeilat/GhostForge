/**
 * Validation for `bridge:*` step refs, mirroring `_parse_workflow_command` in
 * mark-l-bridge/server.py. The bridge stays the authority at run time; this
 * rejects unknown refs when a workflow is saved, so a stored plan never holds a
 * bridge action the bridge would refuse (in particular a production deploy,
 * which is never runnable from a workflow and must be started from the CLI).
 */

export const BRIDGE_REF_PREFIX = 'bridge:'

const PLAIN_REFS = new Set([
  'bridge:health',
  'bridge:release-status',
  'bridge:deploy',
  'bridge:deploy-azure',
  'bridge:azure-deploy',
])
const DEPLOY_ENVIRONMENTS = new Set(['staging', 'dev'])
const DEPLOY_TARGETS = new Set([
  'static', 'azure-static', 'static-web-apps', 'swa',
  'app', 'app-service', 'appservice', 'node', 'service',
  'eas', 'eas-build', 'expo', 'mobile',
])

export const PRODUCTION_DEPLOY_ERROR =
  'Production deploys cannot run from a workflow; deploy from the CLI (scripts/deploy-azure.sh --env production)'

export class WorkflowValidationError extends Error {}

/** Returns null when `ref` is acceptable, else a human-readable reason. */
export function bridgeRefError(ref: string): string | null {
  if (!ref.startsWith(BRIDGE_REF_PREFIX)) return null
  if (PLAIN_REFS.has(ref)) return null
  const parts = ref.split(':')
  if ((parts.length === 3 || parts.length === 4) && parts[1] === 'deploy') {
    const environment = parts[2].trim().toLowerCase()
    if (environment === 'production') return PRODUCTION_DEPLOY_ERROR
    if (!DEPLOY_ENVIRONMENTS.has(environment)) return 'Unsupported workflow deploy environment; allowed: staging, dev'
    const target = (parts[3] ?? 'static').trim().toLowerCase().replace(/_/g, '-')
    if (!DEPLOY_TARGETS.has(target)) return 'Unsupported deployment target; allowed: static, app-service, eas'
    return null
  }
  return `Unknown bridge step: ${ref.slice(0, 100)}`
}

/** Throws WorkflowValidationError for an unknown or disallowed `bridge:*` ref. */
export function assertBridgeRef(ref: string): void {
  const error = bridgeRefError(ref)
  if (error) throw new WorkflowValidationError(error)
}
