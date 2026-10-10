import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Locate the repository's marketplace directory (catalog.json + sources.json).
 * The web app is served from web-ui/, so walk up toward the repo root; fall back
 * to ~/GhostForge/marketplace for installed deployments.
 */
export function marketplaceDir(start = process.cwd()): string {
  let probe = start
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(probe, 'marketplace')
    if (fs.existsSync(path.join(candidate, 'catalog.json')) || fs.existsSync(path.join(candidate, 'sources.json'))) {
      return candidate
    }
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return path.join(os.homedir(), 'GhostForge', 'marketplace')
}

// registry.json sits beside catalog.json — the same file the TUI reads
// (ROOT/marketplace/registry.json), so both surfaces share install state (ADR-004).
export const MARKETPLACE_DIR = marketplaceDir()
export const CATALOG_PATH = path.join(MARKETPLACE_DIR, 'catalog.json')
export const SOURCES_PATH = path.join(MARKETPLACE_DIR, 'sources.json')
export const REGISTRY_PATH = path.join(MARKETPLACE_DIR, 'registry.json')
export const INSTALL_QUEUE_MODULE = path.join(MARKETPLACE_DIR, 'install-queue.mjs')
