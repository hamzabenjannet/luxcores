// @ts-check
/**
 * System: cleanup (pipeline step 14)
 * Removes every entity whose HP is 0, in id order. A Lumen Core stays: its
 * death is the victory system's business. Then it drops what depended on the
 * dead: the queued and held orders of a vanished barracks (no refund, GDD 9) and
 * creep groups without creeps. Drops and loot bags arrive with the milestones that add them.
 */

import { findById, membersOf } from '../creeps.js';
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

  state.orders = state.orders.filter((o) => findById(entities, o.barracksId) !== undefined);
  if (state.groups.length > 0) state.groups = state.groups.filter((g) => membersOf(state, g.id).length > 0);
}
