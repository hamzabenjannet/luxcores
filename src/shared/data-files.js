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
 * Browser loader. The paths are relative to `base`, the origin of the server
 * that simulates the match, so the page draws with the data that server runs.
 * An empty `base` means the page's own origin.
 * @param {string} [base]
 * @returns {Promise<import('../sim/config.js').RawData>}
 */
export async function loadDataBrowser(base = '') {
  /** @type {Record<string, any>} */
  const raw = {};
  for (const [key, path] of Object.entries(DATA_FILES)) {
    const res = await fetch(`${base.replace(/\/$/, '')}/${path}`);
    if (!res.ok) throw new Error(`failed to load ${path}: ${res.status}`);
    raw[key] = await res.json();
  }
  return /** @type {any} */ (raw);
}
