// @ts-check
/**
 * System: cleanup (pipeline step 14)
 * Removes every entity whose HP is 0, in id order. A Lumen Core stays: its
 * death is the victory system's business. Then it drops what depended on the
 * dead: the queued and held orders of a vanished barracks (no refund, GDD 9) and
 * creep groups without creeps. A hero that dies starts its owner's pick cooldown and leaves its inventory
 * as a loot bag; a creep that dies may leave a random item (GDD 8). The new entities join after the
 * dead are gone, in id order of the dead, so the random draws are fixed.
 */

import { findById, membersOf } from '../creeps.js';
import { dropInventory, rollCreepDrop } from '../items.js';
import { KIND } from '../state.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const entities = state.entities;
  let kept = 0;
  /** @type {import('../state.js').Entity[]} */
  const dead = [];
  for (const e of entities) {
    if (e.hp <= 0 && e.kind !== KIND.CORE) {
      if (e.kind === KIND.HERO) {
        const owner = state.players.find((p) => p.id === e.owner);
        if (owner) owner.heroCooldown = state.config.balance.hero.respawnCooldownTicks; // GDD 7.1
      }
      if (e.kind === KIND.HERO || e.kind === KIND.CREEP) dead.push(e);
      continue;
    }
    entities[kept++] = e;
  }
  entities.length = kept;
  for (const e of dead) {
    if (e.kind === KIND.HERO) dropInventory(state, e);
    else rollCreepDrop(state, e);
  }

  state.orders = state.orders.filter((o) => findById(entities, o.barracksId) !== undefined);
  if (state.groups.length > 0) state.groups = state.groups.filter((g) => membersOf(state, g.id).length > 0);
}
