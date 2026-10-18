// @ts-check
/**
 * System: production (pipeline step 3)
 * Barracks queues. Each barracks works on the first order of its queue that is not held, and
 * finishes it after `productionTicksPerGroup` ticks. A finished creep group that would push its
 * owner over the creep cap is held in the barracks and spawns when the cap has room. A held
 * group never blocks the queue, so later orders skip ahead (GDD 9). Items (M6) and heroes (M5)
 * share this queue; a finished hero order puts the hero next to the barracks (GDD 7.1). A barracks in its recycle channel stops producing.
 */

import { creepCount, findById, ORDER_TYPE, spawnGroup } from '../creeps.js';
import { spawnHero } from '../heroes.js';

/** @param {import('../state.js').SimState} state */
export function run(state) {
  if (state.orders.length === 0) return;
  const cap = state.config.balance.creep.capPerPlayer;

  // Held groups first, in queue order, so the oldest waits least.
  for (const order of state.orders.slice()) {
    if (order.held === 0 || order.type !== ORDER_TYPE.creeps) continue;
    const barracks = findById(state.entities, order.barracksId);
    if (!barracks || creepCount(state, order.owner) + order.mix.length > cap) continue;
    spawnGroup(state, order, barracks);
    state.orders.splice(state.orders.indexOf(order), 1);
  }

  /** @type {number[]} */
  const busy = []; // barracks that already advanced an order this tick
  for (const order of state.orders.slice()) {
    if (order.held === 1 || busy.includes(order.barracksId)) continue;
    const barracks = findById(state.entities, order.barracksId);
    if (!barracks || barracks.recycle > 0) continue;
    busy.push(order.barracksId);
    order.ticksLeft--;
    if (order.ticksLeft > 0) continue;
    if (order.type === ORDER_TYPE.creeps) {
      if (creepCount(state, order.owner) + order.mix.length <= cap) {
        spawnGroup(state, order, barracks);
        state.orders.splice(state.orders.indexOf(order), 1);
      } else {
        order.ticksLeft = 0;
        order.held = 1;
      }
    } else if (order.type === ORDER_TYPE.hero) {
      spawnHero(state, order, barracks);
      state.orders.splice(state.orders.indexOf(order), 1);
    }
  }
}
