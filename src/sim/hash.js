// @ts-check
/**
 * State hash: FNV-1a 32-bit over a canonical byte layout.
 *
 * Canonical layout (this is part of the spec; the Rust port must match):
 *   1. tick                      i64 LE
 *   2. rng.s                     i64 LE
 *   3. nextId                    i64 LE
 *   4. team count                i64 LE
 *      per team, in team index order: TEAM_HASH_FIELDS, each i64 LE
 *   5. entity count              i64 LE
 *      per entity, in ascending id order: ENTITY_HASH_FIELDS, each i64 LE
 *
 * Every hashed value must be a safe integer; anything else throws, which
 * catches floats leaking into sim state.
 *
 * Derived data (visibility bitsets, caches) is never hashed.
 */

import { assertInt } from './fixed.js';
import { ENTITY_HASH_FIELDS, TEAM_HASH_FIELDS } from './state.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class Hasher {
  constructor() {
    this.h = FNV_OFFSET;
    this.buf = new DataView(new ArrayBuffer(8));
  }

  /** @param {number} v safe integer, written as signed 64-bit little-endian */
  i64(v) {
    this.buf.setBigInt64(0, BigInt(v), true);
    for (let i = 0; i < 8; i++) {
      this.h ^= this.buf.getUint8(i);
      this.h = Math.imul(this.h, FNV_PRIME) >>> 0;
    }
  }

  /** @returns {string} 8 hex chars */
  digest() {
    return this.h.toString(16).padStart(8, '0');
  }
}

/**
 * @param {import('./state.js').SimState} state
 * @returns {string}
 */
export function hashState(state) {
  const h = new Hasher();
  const put = (/** @type {unknown} */ v, /** @type {string} */ where) => {
    assertInt(v, where);
    h.i64(/** @type {number} */ (v));
  };

  put(state.tick, 'tick');
  put(state.rng.s, 'rng.s');
  put(state.nextId, 'nextId');

  put(state.teams.length, 'teams.length');
  state.teams.forEach((team, i) => {
    for (const f of TEAM_HASH_FIELDS) put(/** @type {any} */ (team)[f], `teams[${i}].${f}`);
  });

  put(state.entities.length, 'entities.length');
  let prevId = -1;
  for (const e of state.entities) {
    if (e.id <= prevId) throw new Error(`entities not sorted by id at ${e.id}`);
    prevId = e.id;
    for (const f of ENTITY_HASH_FIELDS) put(/** @type {any} */ (e)[f], `entity ${e.id}.${f}`);
  }

  return h.digest();
}
