/**
 * Opt-in, consented installer queue for marketplace tools.
 *
 * One queue shared by the TUI ("Install queue" in screenMarketplace) and the
 * web marketplace (/api/marketplace/queue). The rules live here so both
 * surfaces enforce the same thing:
 *
 *   - Queueing never installs anything. Each item is installed only after an
 *     explicit, per-item consent that echoes the exact command being run
 *     (no "install all"). A catalog edit that changes the command after it was
 *     queued voids the queued entry: the user has to review the new command.
 *   - Offensive suites (CLAUDE.md "Security tooling policy": HackingTool,
 *     AllHackingTools, Strix …) are review-first pointers. They can never be
 *     queued, whatever the catalog says.
 *   - Dual-use tools (`authorized_use_only`) additionally need the user to
 *     confirm they will only use them on systems they own or may test.
 *   - Items without a command for this platform are not queueable; the caller
 *     shows the manual-install hint (explainMissingCommand).
 *   - Every queue, consent, decline and result is appended to the shared audit
 *     log (~/.ghostforge/audit.log, JSONL, same shape as web-ui/lib/audit.ts).
 *   - marketplace/registry.json stays the single source of truth for install
 *     state: a successful install adds the id to registry.installed and drops
 *     it from registry.removed. The effective set is still
 *     registry.installed ∪ catalog installed:true − registry.removed
 *     (tui/lib/marketplace-state.js), computed by the readers.
 *
 * Running the command is the caller's job (the TUI inherits the terminal so
 * sudo prompts work; the web route spawns it with a timeout). Hosted mode
 * never reaches this: /api/marketplace/queue is not on the hosted allowlist.
 *
 * Dependency-free ESM, like install-commands.mjs.
 */

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveInstallCommand, explainMissingCommand } from './install-commands.mjs'
import { getEffectiveMarketplaceState } from '../tui/lib/marketplace-state.js'

/** Offensive suites: review-first pointers only, never queued or installed. */
export const REVIEW_FIRST_IDS = new Set(['hackingtool', 'allhackingtools', 'strix'])
const REVIEW_FIRST_TAGS = new Set(['review-first', 'offensive-suite'])

export class InstallQueueError extends Error {
  /** @param {string} message @param {string} code @param {number} [status] */
  constructor(message, code, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** @param {any} item */
export function isReviewFirst(item) {
  if (!item || typeof item !== 'object') return false
  const id = String(item.id || '').toLowerCase()
  const name = String(item.name || '').toLowerCase().replace(/[^a-z]/g, '')
  if (REVIEW_FIRST_IDS.has(id) || REVIEW_FIRST_IDS.has(name)) return true
  return Array.isArray(item.tags) && item.tags.some(tag => REVIEW_FIRST_TAGS.has(String(tag).toLowerCase()))
}

/** Short, stable fingerprint of a command string. */
export function commandDigest(command) {
  return createHash('sha256').update(String(command)).digest('hex').slice(0, 16)
}

/**
 * What installing `item` on `platform` would mean.
 * @returns {{ queueable: boolean, reason: string, command: string | null, source: string, url: string | null, authorizedUseOnly: boolean, reviewFirst: boolean }}
 */
export function planInstall(item, platform = process.platform) {
  const base = {
    command: null,
    source: String(item?.source || item?.url || 'GhostForge catalog'),
    url: typeof item?.url === 'string' ? item.url : null,
    authorizedUseOnly: Boolean(item?.authorized_use_only),
    reviewFirst: isReviewFirst(item),
  }
  if (!item || typeof item.id !== 'string') return { ...base, queueable: false, reason: 'Unknown item.' }
  if (base.reviewFirst) {
    return { ...base, queueable: false, reason: 'Offensive suite: review the upstream project yourself. GhostForge never installs it.' }
  }
  const command = resolveInstallCommand(item, platform)
  if (!command) return { ...base, queueable: false, reason: explainMissingCommand(item, platform) || 'No installer for this platform.' }
  return { ...base, command, queueable: true, reason: '' }
}

// ── Storage ────────────────────────────────────────────────────────────────

export function defaultQueueFile(homeDir = os.homedir()) {
  return path.join(homeDir, '.ghostforge', 'install-queue.json')
}

export function defaultAuditFile(homeDir = os.homedir()) {
  return path.join(homeDir, '.ghostforge', 'audit.log')
}

/** @returns {{ version: 1, items: any[] }} */
export function readQueue(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data && Array.isArray(data.items)) return { version: 1, items: data.items.filter(e => e && typeof e.id === 'string') }
  } catch { /* empty queue */ }
  return { version: 1, items: [] }
}

function writeJsonAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', mode ? { mode } : undefined)
  fs.renameSync(tmp, file)
}

export function writeQueue(file, queue) {
  writeJsonAtomic(file, { version: 1, items: queue.items }, 0o600)
}

/** Append one JSONL entry in the web-ui/lib/audit.ts shape. Never throws. */
export function appendAudit(auditFile, entry) {
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true })
    fs.appendFileSync(auditFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch { /* auditing must not break the flow */ }
}

// ── Queue operations ───────────────────────────────────────────────────────

/**
 * @typedef {object} QueueContext
 * @property {{ items: any[] }} catalog
 * @property {string} registryFile
 * @property {string} [queueFile]
 * @property {string} [auditFile]
 * @property {string} [platform]
 * @property {string} actor     Who acted (username, or "tui:<os user>").
 * @property {'web' | 'tui'} surface
 */

function ctxDefaults(ctx) {
  return {
    queueFile: ctx.queueFile || defaultQueueFile(),
    auditFile: ctx.auditFile || defaultAuditFile(),
    platform: ctx.platform || process.platform,
    ...ctx,
  }
}

function readRegistry(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : { installed: [], removed: [] }
  } catch {
    return { installed: [], removed: [] }
  }
}

/** Effective installed ids — the CLAUDE.md rule, via the shared helper. */
export function effectiveInstalled(catalog, registryFile) {
  return getEffectiveMarketplaceState(catalog, readRegistry(registryFile)).installedSet
}

function findItem(catalog, id) {
  return (Array.isArray(catalog?.items) ? catalog.items : []).find(item => item && item.id === id) || null
}

/**
 * Queue entries, each re-checked against the current catalog: `stale` is true
 * when the item's command changed (or it became non-queueable) since queueing.
 */
export function listQueue(ctx) {
  const c = ctxDefaults(ctx)
  return readQueue(c.queueFile).items.map(entry => {
    const plan = planInstall(findItem(c.catalog, entry.id), c.platform)
    const stale = !plan.queueable || commandDigest(plan.command) !== entry.digest
    return { ...entry, stale, reason: stale ? (plan.reason || 'The install command changed since it was queued. Review it again.') : '' }
  })
}

/** Add one item to the queue. Installs nothing. */
export function enqueue(ctx, id) {
  const c = ctxDefaults(ctx)
  const item = findItem(c.catalog, id)
  if (!item) throw new InstallQueueError('Unknown marketplace item.', 'unknown_item', 404)
  const plan = planInstall(item, c.platform)
  if (plan.reviewFirst) {
    appendAudit(c.auditFile, { level: 'security', event: 'marketplace_install_refused', tool: id, params: { surface: c.surface, actor: c.actor, reason: 'review_first' }, blocked: true })
    throw new InstallQueueError(plan.reason, 'review_first', 403)
  }
  if (!plan.queueable) throw new InstallQueueError(plan.reason, 'no_installer', 422)
  if (effectiveInstalled(c.catalog, c.registryFile).has(id)) throw new InstallQueueError('Already installed.', 'already_installed', 409)

  const queue = readQueue(c.queueFile)
  const existing = queue.items.find(entry => entry.id === id)
  const entry = {
    id,
    name: String(item.name || id),
    command: plan.command,
    digest: commandDigest(plan.command),
    source: plan.source,
    url: plan.url,
    authorizedUseOnly: plan.authorizedUseOnly,
    platform: c.platform,
    queuedAt: new Date().toISOString(),
    queuedBy: c.actor,
    queuedVia: c.surface,
  }
  queue.items = existing ? queue.items.map(e => (e.id === id ? entry : e)) : [...queue.items, entry]
  writeQueue(c.queueFile, queue)
  appendAudit(c.auditFile, { level: 'info', event: 'marketplace_install_queued', tool: id, params: { surface: c.surface, actor: c.actor, command: plan.command, source: plan.source } })
  return entry
}

/** Remove (decline) a queued item. */
export function dequeue(ctx, id, { declined = true } = {}) {
  const c = ctxDefaults(ctx)
  const queue = readQueue(c.queueFile)
  const before = queue.items.length
  queue.items = queue.items.filter(entry => entry.id !== id)
  if (queue.items.length === before) return false
  writeQueue(c.queueFile, queue)
  if (declined) appendAudit(c.auditFile, { level: 'info', event: 'marketplace_install_declined', tool: id, params: { surface: c.surface, actor: c.actor } })
  return true
}

/**
 * Check a per-item consent and record it. Returns the exact command to run.
 *
 * `consent.command` must be the command the user was shown, byte for byte;
 * `consent.authorized` must be true for dual-use tools.
 * @param {QueueContext} ctx
 * @param {string} id
 * @param {{ approved?: boolean, command?: string, authorized?: boolean }} consent
 */
export function consentToInstall(ctx, id, consent) {
  const c = ctxDefaults(ctx)
  const entry = readQueue(c.queueFile).items.find(e => e.id === id)
  if (!entry) throw new InstallQueueError('Queue the item first, then review and approve it.', 'not_queued', 409)
  const plan = planInstall(findItem(c.catalog, id), c.platform)
  if (plan.reviewFirst) throw new InstallQueueError(plan.reason, 'review_first', 403)
  if (!plan.queueable) throw new InstallQueueError(plan.reason, 'no_installer', 422)
  if (commandDigest(plan.command) !== entry.digest) {
    throw new InstallQueueError('The install command changed since it was queued. Remove it and queue it again to review the new command.', 'stale', 409)
  }
  if (!consent || consent.approved !== true) throw new InstallQueueError('Explicit approval is required for each install.', 'consent_required', 400)
  if (consent.command !== plan.command) {
    throw new InstallQueueError('The approved command does not match the command that would run.', 'command_mismatch', 409)
  }
  if (plan.authorizedUseOnly && consent.authorized !== true) {
    throw new InstallQueueError('Confirm you will only use this tool on systems you own or are authorized to test.', 'authorization_required', 400)
  }
  appendAudit(c.auditFile, {
    level: plan.authorizedUseOnly ? 'security' : 'info',
    event: 'marketplace_install_consent',
    tool: id,
    params: { surface: c.surface, actor: c.actor, command: plan.command, source: plan.source, authorizedUse: plan.authorizedUseOnly || undefined },
  })
  return plan.command
}

/**
 * Record how a consented install went. Success updates registry.json (the
 * single source of truth) and removes the entry from the queue; failure keeps
 * it queued with the error so the user can retry.
 * @returns {string[]} effective installed ids after the change
 */
export function recordInstallResult(ctx, id, { ok, detail = '' }) {
  const c = ctxDefaults(ctx)
  const queue = readQueue(c.queueFile)
  if (ok) {
    const registry = readRegistry(c.registryFile)
    const installed = new Set(Array.isArray(registry.installed) ? registry.installed : [])
    const removed = new Set(Array.isArray(registry.removed) ? registry.removed : [])
    installed.add(id)
    removed.delete(id)
    registry.installed = [...installed]
    registry.removed = [...removed]
    writeJsonAtomic(c.registryFile, registry)
    queue.items = queue.items.filter(entry => entry.id !== id)
  } else {
    queue.items = queue.items.map(entry => (entry.id === id ? { ...entry, lastError: String(detail).slice(-500), lastAttemptAt: new Date().toISOString() } : entry))
  }
  writeQueue(c.queueFile, queue)
  appendAudit(c.auditFile, {
    level: ok ? 'info' : 'warn',
    event: 'marketplace_install_result',
    tool: id,
    result: ok ? 'installed' : `failed: ${String(detail).slice(-200)}`,
    params: { surface: c.surface, actor: c.actor },
  })
  return [...effectiveInstalled(c.catalog, c.registryFile)].sort()
}
