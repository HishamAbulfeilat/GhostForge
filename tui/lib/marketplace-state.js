// Marketplace install state, shared in meaning with the web UI
// (web-ui/lib/marketplace-state.ts mirrors this file; a parity test in
// web-ui/test/marketplace-state-parity.test.js runs both on one fixture).
//
// registry.json fields:
//   installed[]  string ids whose install command actually ran (TUI) — plus,
//                for older files, ids the web UI wrote before `marked` existed
//   marked[]     string ids someone marked as installed by hand (web UI
//                "Mark installed", TUI "Mark as installed?"). Nothing ran, so
//                the TUI keeps offering a real install for these.
//   removed[]    ids explicitly removed; also hides catalog-seeded installs
//   generated[]  objects for items created by the TUI "Generate" screen
//
// Older registry files may hold generated objects inside installed[]; they
// are moved to generated[] on read (normalizeRegistry) so installed[] stays
// string-only and no surface counts or drops them by accident.

const uniqueStrings = list => [...new Set((Array.isArray(list) ? list : []).filter(id => typeof id === 'string' && id))];

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function normalizeRegistry(registryData) {
  const raw = isRecord(registryData) ? registryData : {};
  const rawInstalled = Array.isArray(raw.installed) ? raw.installed : [];
  const generated = Array.isArray(raw.generated) ? raw.generated.filter(isRecord) : [];
  const seen = new Set(generated.map(entry => `${entry.id}\u0000${entry.file}`));
  for (const entry of rawInstalled) {
    if (!isRecord(entry)) continue;
    const key = `${entry.id}\u0000${entry.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    generated.push(entry);
  }
  return {
    ...raw,
    installed: uniqueStrings(rawInstalled),
    marked: uniqueStrings(raw.marked),
    removed: uniqueStrings(raw.removed),
    generated,
  };
}

export function getEffectiveMarketplaceState(catalogData = { items: [] }, registryData = { installed: [], removed: [] }) {
  const catalogItems = Array.isArray(catalogData?.items) ? catalogData.items : [];
  const registry = normalizeRegistry(registryData);
  const removedSet = new Set(registry.removed);
  const installedSet = new Set(registry.installed.filter(id => !removedSet.has(id)));

  for (const item of catalogItems) {
    if (!item || typeof item.id !== 'string') continue;
    if (item.installed && !removedSet.has(item.id)) installedSet.add(item.id);
  }

  const markedSet = new Set(registry.marked.filter(id => !removedSet.has(id) && !installedSet.has(id)));

  return {
    registry,
    installedSet,
    markedSet,
    items: catalogItems.map(item => {
      const id = item && typeof item.id === 'string' ? item.id : null;
      return {
        ...item,
        installed: Boolean(id && installedSet.has(id)),
        marked: Boolean(id && markedSet.has(id)),
      };
    }),
  };
}

export function computeEffectiveMarketplaceIds(catalogData, registryData) {
  return [...getEffectiveMarketplaceState(catalogData, registryData).installedSet].sort();
}

export function computeMarkedMarketplaceIds(catalogData, registryData) {
  return [...getEffectiveMarketplaceState(catalogData, registryData).markedSet].sort();
}

export function applyEffectiveMarketplaceState(catalogData = { items: [] }, registryData = { installed: [], removed: [] }) {
  const state = getEffectiveMarketplaceState(catalogData, registryData);
  return {
    ...state,
    catalog: { ...(catalogData ?? {}), items: state.items },
  };
}

/** Record a verified install (its command ran and exited 0). */
export function recordInstalled(registryData, id) {
  const registry = normalizeRegistry(registryData);
  return {
    ...registry,
    installed: uniqueStrings([...registry.installed, id]),
    marked: registry.marked.filter(m => m !== id),
    removed: registry.removed.filter(r => r !== id),
  };
}

/** Record a hand-made "installed" mark: nothing ran, so installed[] is left alone. */
export function recordMarked(registryData, id) {
  const registry = normalizeRegistry(registryData);
  return {
    ...registry,
    marked: uniqueStrings([...registry.marked, id]),
    removed: registry.removed.filter(r => r !== id),
  };
}

/**
 * Clear an item's installed and marked state. Catalog-seeded items are not in
 * installed[], so they get an explicit removed[] entry to stay hidden.
 */
export function recordRemoved(registryData, id, seededByCatalog = false) {
  const registry = normalizeRegistry(registryData);
  return {
    ...registry,
    installed: registry.installed.filter(i => i !== id),
    marked: registry.marked.filter(m => m !== id),
    removed: seededByCatalog ? uniqueStrings([...registry.removed, id]) : registry.removed,
  };
}

/** Record an item created by the Generate screen without touching installed[]. */
export function recordGenerated(registryData, entry) {
  const registry = normalizeRegistry(registryData);
  return { ...registry, generated: [...registry.generated, entry] };
}
