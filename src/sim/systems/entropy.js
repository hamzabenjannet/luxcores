// @ts-check
/**
 * System: entropy (pipeline step 12)
 * Buildings, creeps and heroes lose `entropyPermillePerSecond` thousandths of max HP
 * per second. The Core is exempt. GDD 3.7.
 *
 * HP is removed once per second. Fractional loss carries between ticks, so
 * changes to maximum HP affect only future entropy and rounding does not drift.
 */

import { TICK_HZ, idiv } from '../fixed.js';
import { KIND } from '../state.js';
import { isBuildingKind } from '../buildings.js';
import { addStat } from '../lux.js';

const PERMILLE = 1000;

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const pct = state.config.balance.economy.entropyPermillePerSecond;
  for (const e of state.entities) {
    if (!isBuildingKind(e.kind) && e.kind !== KIND.CREEP && e.kind !== KIND.HERO) continue;
    const age = state.tick - e.born;
    if (age <= 0 || age % TICK_HZ !== 0) continue;
    const numerator = e.maxHp * pct + e.entropyRemainder;
    const loss = idiv(numerator, PERMILLE);
    e.entropyRemainder = numerator - loss * PERMILLE;
    const lost = Math.min(e.hp, loss);
    e.hp -= lost;
    addStat(state.teams[e.team], 'statEntropy', 'statEntropyTenths', idiv(lost * 10, state.config.balance.hpFactor.default));
  }
}
