// @ts-check
/**
 * System: cleanup (pipeline step 14)
 * Removes every entity whose HP is 0, in id order. A Lumen Core stays: its
 * death is the victory system's business. Drops and loot bags arrive with the
 * milestones that add them.
 */

import { KIND } from '../state.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const entities = state.entities;
  let kept = 0;
  for (const e of entities) {
    if (e.hp <= 0 && e.kind !== KIND.CORE) continue;
    entities[kept++] = e;
  }
  entities.length = kept;
}
