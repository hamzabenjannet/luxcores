// @ts-check
/**
 * Applying damage. Every source goes through here, so a shield absorbs all of them alike
 * (GDD 7.5): basic attacks, projectiles, splash and ability hits. Entropy and the meltdown
 * remove HP directly and ignore shields, because they are not attacks.
 */

import { idiv } from './fixed.js';
import { addStat, damageCore } from './lux.js';
import { KIND } from './state.js';

/**
 * Takes `damage` milli-HP from the target. The Lumen Core pays from its lux and has no shield.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} target
 * @param {number} damage milli-HP
 * @returns {number} the milli-HP the target lost, after its shield and at most what it had
 */
export function dealDamage(state, target, damage) {
  if (damage <= 0) return 0;
  if (target.kind === KIND.CORE) {
    const before = state.teams[target.team].coreLux;
    damageCore(state, target.team, damage);
    return before - state.teams[target.team].coreLux;
  }
  const hpBefore = target.hp;
  let rest = damage;
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, rest);
    target.shieldHp -= absorbed;
    rest -= absorbed;
    if (target.shieldHp === 0) target.shieldTicks = 0;
  }
  target.hp = Math.max(0, target.hp - rest);
  return hpBefore - target.hp;
}

/**
 * Counts HP that damage of `sourceTeam` removed from an enemy as drained lux (GDD 13.2). Neutral
 * blockers and the team's own units never count.
 * @param {import('./state.js').SimState} state
 * @param {number} sourceTeam
 * @param {import('./state.js').Entity} target
 * @param {number} removed milli-HP
 */
export function creditDrain(state, sourceTeam, target, removed) {
  if (removed <= 0 || target.team < 0 || target.team === sourceTeam) return;
  const { hpFactor } = state.config.balance;
  addStat(state.teams[sourceTeam], 'statDrained', 'statDrainedTenths', idiv(removed * 10, target.kind === KIND.CORE ? hpFactor.core : hpFactor.default));
}
