// @ts-check
/**
 * System: entropy (pipeline step 12)
 * Buildings, creeps and heroes lose `entropyPctPerMinute` percent of max HP per
 * minute. The Core is exempt. GDD 3.7.
 *
 * HP is removed once per second. Fractional loss carries between ticks, so
 * changes to maximum HP affect only future entropy and rounding does not drift.
 */

import { TICK_HZ, idiv } from '../fixed.js';
import { KIND } from '../state.js';
import { isBuildingKind } from '../buildings.js';

const SECONDS_PER_MINUTE_X_PERCENT = 60 * 100;

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const pct = state.config.balance.economy.entropyPctPerMinute;
  for (const e of state.entities) {
    if (!isBuildingKind(e.kind) && e.kind !== KIND.CREEP && e.kind !== KIND.HERO) continue;
    const age = state.tick - e.born;
    if (age <= 0 || age % TICK_HZ !== 0) continue;
    const numerator = e.maxHp * pct + e.entropyRemainder;
    const loss = idiv(numerator, SECONDS_PER_MINUTE_X_PERCENT);
    e.entropyRemainder = numerator - loss * SECONDS_PER_MINUTE_X_PERCENT;
    e.hp = Math.max(0, e.hp - loss);
  }
}
