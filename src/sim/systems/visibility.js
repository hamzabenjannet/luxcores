// @ts-check
/**
 * System: visibility
 * Scope: per-team tile bitsets every 5 ticks. Derived data, excluded from the hash. TECH 6.2
 * Milestone: M3 (see docs/HANDOVER.md)
 */

import { dist2, UNITS_PER_TILE } from '../fixed.js';
import { KIND } from '../state.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const { width, height } = state.map;
  const tileCount = width * height;
  const teamBits = state.teams.map(() => new Uint8Array(Math.ceil(tileCount / 8)));
  const sight = (entity) => entity.kind === KIND.HERO
    ? state.config.balance.hero.sightTiles
    : entity.kind === KIND.CREEP
      ? state.config.balance.creep.sightTiles
      : 0;

  for (const entity of state.entities) {
    const radius = sight(entity);
    if (radius === 0 || entity.team < 0 || entity.hp <= 0) continue;
    const radiusUnits = radius;
    const minX = Math.max(0, Math.floor((entity.x - radiusUnits) / UNITS_PER_TILE));
    const maxX = Math.min(width - 1, Math.floor((entity.x + radiusUnits) / UNITS_PER_TILE));
    const minZ = Math.max(0, Math.floor((entity.z - radiusUnits) / UNITS_PER_TILE));
    const maxZ = Math.min(height - 1, Math.floor((entity.z + radiusUnits) / UNITS_PER_TILE));
    const reach2 = radiusUnits * radiusUnits;
    const bits = teamBits[entity.team];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const index = z * width + x;
        if (dist2(entity.x, entity.z, x * UNITS_PER_TILE + 500, z * UNITS_PER_TILE + 500) <= reach2) {
          bits[index >> 3] |= 1 << (index & 7);
        }
      }
    }
  }

  state.visibility = teamBits;
  for (const entity of state.entities) {
    const x = Math.floor(entity.x / UNITS_PER_TILE);
    const z = Math.floor(entity.z / UNITS_PER_TILE);
    const index = z * width + x;
    entity.visibleTo = teamBits.map((bits) => index >= 0 && index < tileCount && (bits[index >> 3] & (1 << (index & 7))) !== 0);
  }
}
