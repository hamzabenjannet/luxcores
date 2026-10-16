// @ts-check
/**
 * System: recycle (pipeline step 5)
 * Counts down the recycle channel of every building that has one. When it
 * ends, the owner's Core gets the refund at once and the building is removed.
 * GDD 3.6.
 */

import { credit } from '../lux.js';
import { recycleRefund } from '../buildings.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  for (const e of state.entities) {
    if (e.recycle === 0) continue;
    e.recycle--;
    if (e.recycle > 0) continue;
    credit(state, e.team, recycleRefund(state, e));
    e.hp = 0; // the cleanup system removes it, in the same tick
  }
}
