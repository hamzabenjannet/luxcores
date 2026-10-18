// @ts-check
/**
 * System: economy (pipeline step 2)
 * Collectors fill the pending pool, the pool settles into the Core 40 ticks
 * later, and the no-spend timer of the meltdown rule counts up. GDD 3.3, 4.
 *
 * Order inside the step: settle old entries, then produce this tick's income.
 * A collector built on tick t produces from tick t, and its first lux settles
 * on tick t + pendingSettleTicks.
 */

import { TICK_HZ, idiv } from '../fixed.js';
import { nextRange } from '../rng.js';
import { addPending, syncCore } from '../lux.js';
import { KIND } from '../state.js';

/**
 * Lux produced in one tick by a source that makes `rate` milli-lux per second.
 * The second is split with integer math so that 20 ticks add up to exactly `rate`,
 * even when `rate` is not a multiple of 20.
 * @param {number} rate milli-lux per second
 * @param {number} age ticks since the source was built
 */
export function perTick(rate, age) {
  const j = age % TICK_HZ;
  return idiv(rate * (j + 1), TICK_HZ) - idiv(rate * j, TICK_HZ);
}

/**
 * True during the day. The match starts at dawn (GDD 4).
 * @param {import('../state.js').SimState} state
 */
export function isDay(state) {
  const { dayTicks, nightTicks } = state.config.balance.dayNight;
  return state.tick % (dayTicks + nightTicks) < dayTicks;
}

/** @param {import('../state.js').SimState} state */
export function run(state) {
  // Settle. Entries are appended in settleTick order, so the due ones are at the front.
  state.teams.forEach((team, t) => {
    let due = 0;
    let amount = 0;
    while (due < team.pending.length && team.pending[due].settleTick <= state.tick) amount += team.pending[due++].amount;
    if (due === 0) return;
    team.pending.splice(0, due);
    team.pendingLux -= amount;
    team.coreLux += amount;
    syncCore(state, t);
  });

  // Produce, in id order. The wind plants draw from state.rng, so the order is part of the spec.
  const income = state.teams.map(() => 0);
  const day = isDay(state);
  const { buildings } = state.config;
  for (const e of state.entities) {
    const age = state.tick - e.born;
    switch (e.kind) {
      case KIND.SOLAR:
        income[e.team] += perTick(day ? buildings.solar.outputMilliLuxPerSecond : buildings.solar.nightOutputMilliLuxPerSecond, age);
        break;
      case KIND.WIND:
        if (age > 0 && age % buildings.wind.rerollTicks === 0) {
          e.roll = nextRange(state.rng, buildings.wind.outputMinMilliLuxPerSecond, buildings.wind.outputMaxMilliLuxPerSecond);
        }
        income[e.team] += perTick(e.roll, age);
        break;
      case KIND.GEOTHERMAL:
        income[e.team] += perTick(buildings.geothermal.outputMilliLuxPerSecond, age);
        break;
      case KIND.NUCLEAR:
        income[e.team] += perTick(buildings.nuclear.outputMilliLuxPerSecond, age);
        break;
      default:
    }
  }
  state.teams.forEach((team, t) => {
    addPending(state, t, income[t]);
    team.ticksSinceSpend++;
  });
}
