/**
 * Marketplace install state for the web UI.
 *
 * Mirrors tui/lib/marketplace-state.js line for line in meaning; the parity
 * test (test/marketplace-state-parity.test.js) runs both on one fixture so
 * the web UI and the TUI always compute the same effective sets.
 *
 * registry.json fields:
 *   installed[]  string ids whose install command actually ran (TUI); older
 *                files may also hold ids the web wrote before marked[] existed
 *   marked[]     string ids marked installed by hand (web "Mark installed");
 *                nothing ran, so the TUI keeps offering a real install
 *   removed[]    ids explicitly removed; also hides catalog-seeded installs
 *   generated[]  objects for items the TUI "Generate" screen created
 * Generated objects found inside installed[] (older files) move to generated[].
 */

export interface MarketplaceRegistry {
  installed: string[]
  marked: string[]
  removed: string[]
  generated: Record<string, unknown>[]
  [key: string]: unknown
}

export interface CatalogLike {
  items?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function uniqueStrings(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export function normalizeRegistry(registryData: unknown): MarketplaceRegistry {
  const raw = isRecord(registryData) ? registryData : {}
  const rawInstalled = Array.isArray(raw.installed) ? raw.installed : []
  const generated = Array.isArray(raw.generated) ? raw.generated.filter(isRecord) : []
  const seen = new Set(generated.map(entry => `${entry.id}\u0000${entry.file}`))
  for (const entry of rawInstalled) {
    if (!isRecord(entry)) continue
    const key = `${entry.id}\u0000${entry.file}`
    if (seen.has(key)) continue
    seen.add(key)
    generated.push(entry)
  }
  return {
    ...raw,
    installed: uniqueStrings(rawInstalled),
    marked: uniqueStrings(raw.marked),
    removed: uniqueStrings(raw.removed),
    generated,
  }
}

export function getEffectiveMarketplaceState(catalogData: unknown, registryData: unknown) {
  const catalogItems: unknown[] = isRecord(catalogData) && Array.isArray(catalogData.items) ? catalogData.items : []
  const registry = normalizeRegistry(registryData)
  const removedSet = new Set(registry.removed)
  const installedSet = new Set(registry.installed.filter(id => !removedSet.has(id)))

  for (const item of catalogItems) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    if (item.installed && !removedSet.has(item.id)) installedSet.add(item.id)
  }

  const markedSet = new Set(registry.marked.filter(id => !removedSet.has(id) && !installedSet.has(id)))
  return { registry, installedSet, markedSet }
}

export function computeEffectiveMarketplaceIds(catalogData: unknown, registryData: unknown): string[] {
  return [...getEffectiveMarketplaceState(catalogData, registryData).installedSet].sort()
}

export function computeMarkedMarketplaceIds(catalogData: unknown, registryData: unknown): string[] {
  return [...getEffectiveMarketplaceState(catalogData, registryData).markedSet].sort()
}

/** Record a hand-made "installed" mark: nothing ran, so installed[] is left alone. */
export function recordMarked(registryData: unknown, id: string): MarketplaceRegistry {
  const registry = normalizeRegistry(registryData)
  return {
    ...registry,
    marked: uniqueStrings([...registry.marked, id]),
    removed: registry.removed.filter(r => r !== id),
  }
}

/**
 * Clear an item's installed and marked state. Catalog-seeded items are not in
 * installed[], so they get an explicit removed[] entry to stay hidden.
 */
export function recordRemoved(registryData: unknown, id: string, seededByCatalog = false): MarketplaceRegistry {
  const registry = normalizeRegistry(registryData)
  return {
    ...registry,
    installed: registry.installed.filter(i => i !== id),
    marked: registry.marked.filter(m => m !== id),
    removed: seededByCatalog ? uniqueStrings([...registry.removed, id]) : registry.removed,
  }
}
