// @ts-check
/**
 * System: items (pipeline step 6)
 * Scope: a map spawn every `mapSpawnIntervalTicks`, the despawn of ground items and loot bags, and
 * the automatic pickup by a hero in reach. GDD 8.3
 * Milestone: M6
 */

import { dropItem, heroNear, takeBy, tileCenter } from '../items.js';
import { nextInt } from '../rng.js';
import { KIND } from '../state.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const { items } = state.config.balance;

  // One item every interval, at one of the mirrored points in the DMZ.
  if (state.tick > 0 && state.tick % items.mapSpawnIntervalTicks === 0 && state.map.itemSpawns.length > 0) {
    const spot = tileCenter(state.map.itemSpawns[nextInt(state.rng, state.map.itemSpawns.length)]);
    dropItem(state, nextInt(state.rng, state.config.items.list.length), spot.x, spot.z);
  }

  for (const thing of state.entities) {
    if (thing.kind !== KIND.GROUND_ITEM && thing.kind !== KIND.LOOT_BAG) continue;
    const lifetime = thing.kind === KIND.GROUND_ITEM ? items.groundDespawnTicks : items.lootBagDespawnTicks;
    if (state.tick - thing.born >= lifetime) {
      thing.hp = 0; // the cleanup system removes it
      continue;
    }
    const hero = heroNear(state, thing, items.pickupRadiusMilliTiles);
    if (hero) takeBy(state, thing, hero);
  }
}
