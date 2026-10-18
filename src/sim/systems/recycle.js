// @ts-check
/**
 * System: recycle (pipeline step 5)
 * Counts down the recycle channel of every building that has one. When it
 * ends, the owner's Core gets the refund at once and the building is removed.
 * GDD 3.6.
 */

import { credit } from '../lux.js';
import { recycleRefund } from '../buildings.js';
import { idiv } from '../fixed.js';
import { orderCost } from '../creeps.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  for (const e of state.entities) {
    if (e.recycle === 0) continue;
    e.recycle--;
    if (e.recycle > 0) continue;
    let refund = recycleRefund(state, e);
    // Orders still in the queue come back in full (GDD 3.6). A finished group held in the barracks is lost.
    for (const order of state.orders) {
      if (order.barracksId === e.id && order.held === 0) refund += idiv(orderCost(state, order) * state.config.balance.economy.recycleQueueRefundPct, 100);
    }
    credit(state, e.team, refund);
    state.teams[e.team].statRecycled += refund;
    e.hp = 0; // the cleanup system removes it, in the same tick
  }
}
