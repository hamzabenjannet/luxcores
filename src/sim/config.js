// @ts-check
/**
 * Turns raw data/*.json into the integer units the sim uses.
 *
 * Naming convention in data files (all values are integers):
 *   *Lux    whole lux        -> multiplied by 1000 (milli-lux)
 *   *Tiles  whole tiles      -> multiplied by 1000 (units)
 *   *Ticks  sim ticks (20 per second), used as is
 *   *Pct    integer percent, used as is
 *   anything else is used as is
 *
 * The sim never reads the JSON files itself: the caller loads them
 * (fetch in the browser, fs in Node) and passes the parsed objects here.
 * That keeps src/sim free of I/O.
 */

import { MILLI, UNITS_PER_TILE } from './fixed.js';

/** The highest entropy rate a match may set, in tenths of a percent of the maximum HP per second (1000 is 100 percent). */
export const ENTROPY_MAX_PERMILLE = 1000;

/** The highest creep cap a match may set, in creeps alive per player (GDD 9). */
export const CREEP_CAP_MAX = 1000;

/**
 * Settings a match may change at its start, on top of the data files. Each one is optional.
 * @typedef {Object} MatchOptions
 * @property {number} [entropyPermillePerSecond] tenths of a percent of maximum HP that buildings, creeps and heroes lose per second (GDD 3.7); 0 turns entropy off
 * @property {number} [creepCapPerPlayer] creeps a player may have alive at once (GDD 9), 1 to `CREEP_CAP_MAX`
 */

/**
 * Whether the options are valid: a whole entropy rate, in tenths of a percent per second, from 0 to
 * `ENTROPY_MAX_PERMILLE`, and a whole creep cap from 1 to `CREEP_CAP_MAX`.
 * @param {unknown} options
 * @returns {options is MatchOptions}
 */
export function validOptions(options) {
  if (options === null || typeof options !== 'object') return false;
  const { entropyPermillePerSecond, creepCapPerPlayer } = /** @type {MatchOptions} */ (options);
  const entropyOk = entropyPermillePerSecond === undefined
    || (Number.isSafeInteger(entropyPermillePerSecond) && entropyPermillePerSecond >= 0 && entropyPermillePerSecond <= ENTROPY_MAX_PERMILLE);
  const capOk = creepCapPerPlayer === undefined
    || (Number.isSafeInteger(creepCapPerPlayer) && creepCapPerPlayer >= 1 && creepCapPerPlayer <= CREEP_CAP_MAX);
  return entropyOk && capOk;
}

/**
 * @typedef {Object} RawData
 * @property {any} balance
 * @property {any} buildings
 * @property {any} heroes
 * @property {any} abilities
 * @property {any} items
 * @property {any} mapgen
 */

/** @typedef {RawData & { specVersion: string }} SimConfig */

export const SPEC_VERSION = '0.10.0';

/**
 * Recursively convert suffixed keys. Throws on non-integer numbers.
 * @param {any} value
 * @param {string} path
 * @returns {any}
 */
function convert(value, path) {
  if (Array.isArray(value)) return value.map((v, i) => convert(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    // Object.keys order is insertion order for string keys; config is
    // only read by key, never iterated inside the sim, so order is moot.
    for (const k of Object.keys(value)) {
      const v = value[k];
      const p = `${path}.${k}`;
      if (typeof v === 'number') {
        if (!Number.isSafeInteger(v)) throw new TypeError(`data value must be an integer: ${p} = ${v}`);
        if (k.includes('MilliLux') || k.includes('MilliTiles')) out[k] = v;
        else if (k.endsWith('Lux')) out[k] = v * MILLI;
        else if (k.endsWith('Tiles')) out[k] = v * UNITS_PER_TILE;
        else out[k] = v;
      } else {
        out[k] = convert(v, p);
      }
    }
    return out;
  }
  return value;
}

/**
 * @param {RawData} raw
 * @param {MatchOptions} [options] settings of one match; they replace the matching data values
 * @returns {SimConfig}
 */
export function normalizeData(raw, options = {}) {
  if (!validOptions(options)) throw new RangeError('normalizeData: invalid match options');
  let balance = raw.balance;
  if (options.entropyPermillePerSecond !== undefined) {
    balance = { ...balance, economy: { ...balance.economy, entropyPermillePerSecond: options.entropyPermillePerSecond } };
  }
  if (options.creepCapPerPlayer !== undefined) {
    balance = { ...balance, creep: { ...balance.creep, capPerPlayer: options.creepCapPerPlayer } };
  }
  const out = {
    balance: convert(balance, 'balance'),
    buildings: convert(raw.buildings, 'buildings'),
    heroes: convert(raw.heroes, 'heroes'),
    abilities: convert(raw.abilities, 'abilities'),
    items: convert(raw.items, 'items'),
    mapgen: convert(raw.mapgen, 'mapgen'),
    specVersion: SPEC_VERSION,
  };
  return deepFreeze(out);
}

/** @template T @param {T} o @returns {T} */
function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
