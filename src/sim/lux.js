// @ts-check
/**
 * The team's lux bank. The Lumen Core's HP is its lux (GDD 3.1), so every
 * change to `coreLux` goes through here and keeps the Core entity in step:
 * `hp` equals `coreLux`, and `maxHp` is the highest HP the Core has held.
 */

import { KIND } from './state.js';

/**
 * @param {import('./state.js').SimState} state
 * @param {number} team
 * @returns {import('./state.js').Entity | undefined}
 */
export function coreOf(state, team) {
  for (const e of state.entities) if (e.kind === KIND.CORE && e.team === team) return e;
  return undefined;
}

/**
 * Copies `coreLux` into the Core entity. Call after any change to `coreLux`.
 * @param {import('./state.js').SimState} state
 * @param {number} team
 */
export function syncCore(state, team) {
  const core = coreOf(state, team);
  if (!core) return;
  core.hp = state.teams[team].coreLux;
  if (core.hp > core.maxHp) core.maxHp = core.hp;
}

/**
 * Adds lux to the Core at once (a recycle refund). Collector income does not use
 * this: it waits in the pending pool first (economy system).
 * @param {import('./state.js').SimState} state
 * @param {number} team
 * @param {number} amount milli-lux
 */
export function credit(state, team, amount) {
  state.teams[team].coreLux += amount;
  syncCore(state, team);
}

/**
 * Pays from the Core. Refused when it would leave less than `core.minLeftAfterSpendLux`
 * (1 lux, GDD 3.4). A payment resets the no-spend timer of the meltdown rule.
 * @param {import('./state.js').SimState} state
 * @param {number} team
 * @param {number} amount milli-lux
 * @returns {boolean} true when the payment went through
 */
export function spend(state, team, amount) {
  const t = state.teams[team];
  const keep = state.config.balance.core.minLeftAfterSpendLux;
  if (t.coreLux - amount < keep) return false;
  t.coreLux -= amount;
  t.ticksSinceSpend = 0;
  syncCore(state, team);
  return true;
}

/**
 * Damages the Core: its HP is its lux, so the damage comes out of the bank.
 * @param {import('./state.js').SimState} state
 * @param {number} team
 * @param {number} damage HP, which equals milli-lux for the Core
 */
export function damageCore(state, team, damage) {
  const t = state.teams[team];
  t.coreLux = Math.max(0, t.coreLux - damage);
  syncCore(state, team);
}
