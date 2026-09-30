export function getEffectiveMarketplaceState(catalogData = { items: [] }, registryData = { installed: [], removed: [] }) {
  const catalogItems = Array.isArray(catalogData?.items) ? catalogData.items : [];
  const registryInstalled = Array.isArray(registryData?.installed) ? registryData.installed : [];
  const registryRemoved = Array.isArray(registryData?.removed) ? registryData.removed : [];
  const removedSet = new Set(registryRemoved.filter(Boolean));
  const installedSet = new Set(
    registryInstalled.filter(id => typeof id === 'string' && !removedSet.has(id))
  );

  for (const item of catalogItems) {
    if (!item || typeof item.id !== 'string') continue;
    if (item.installed && !removedSet.has(item.id)) installedSet.add(item.id);
  }

  return {
    installedSet,
    items: catalogItems.map(item => ({ ...item, installed: Boolean(item && typeof item.id === 'string' && installedSet.has(item.id)) })),
  };
}

export function computeEffectiveMarketplaceIds(catalogData, registryData) {
  return [...getEffectiveMarketplaceState(catalogData, registryData).installedSet].sort();
}

export function applyEffectiveMarketplaceState(catalogData = { items: [] }, registryData = { installed: [], removed: [] }) {
  const state = getEffectiveMarketplaceState(catalogData, registryData);
  return {
    ...state,
    catalog: { ...(catalogData ?? {}), items: state.items },
  };
}
