// @ts-check
/**
 * Applying damage. Every source goes through here, so a shield absorbs all of them alike
 * (GDD 7.5): basic attacks, projectiles, splash and ability hits. Entropy and the meltdown
 * remove HP directly and ignore shields, because they are not attacks.
 */

import { damageCore } from './lux.js';
import { KIND } from './state.js';

/**
 * Takes `damage` milli-HP from the target. The Lumen Core pays from its lux and has no shield.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} target
 * @param {number} damage milli-HP
 */
export function dealDamage(state, target, damage) {
  if (damage <= 0) return;
  if (target.kind === KIND.CORE) {
    damageCore(state, target.team, damage);
    return;
  }
  let rest = damage;
  if (target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, rest);
    target.shieldHp -= absorbed;
    rest -= absorbed;
    if (target.shieldHp === 0) target.shieldTicks = 0;
  }
  target.hp = Math.max(0, target.hp - rest);
}
