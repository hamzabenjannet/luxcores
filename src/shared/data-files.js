// @ts-check
/**
 * The list of data files the sim needs. Loaders (browser and Node) read
 * these, parse them and hand the raw objects to normalizeData().
 */
export const DATA_FILES = Object.freeze({
  balance: 'data/balance.json',
  buildings: 'data/buildings.json',
  heroes: 'data/heroes.json',
  abilities: 'data/abilities.json',
  items: 'data/items.json',
  mapgen: 'data/mapgen.json',
});

/**
 * Browser loader. Paths are relative to the page (index.html at repo root).
 * @returns {Promise<import('../sim/config.js').RawData>}
 */
export async function loadDataBrowser() {
  /** @type {Record<string, any>} */
  const raw = {};
  for (const [key, path] of Object.entries(DATA_FILES)) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`failed to load ${path}: ${res.status}`);
    raw[key] = await res.json();
  }
  return /** @type {any} */ (raw);
}
