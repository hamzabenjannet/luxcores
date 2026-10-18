// @ts-check
/**
 * System: effects (pipeline step 11)
 * Timed effects: a shield runs out after its duration and drops what it still holds, an item's
 * attack speed change ends, and a hero's ability cooldowns count down. Stuns have their own timers
 * in the combat system. GDD 7.5, 8.2
 * Milestone: M5 (shields and cooldowns), M6 (item effects)
 */

/** @param {import('../state.js').SimState} state */
export function run(state) {
  for (const e of state.entities) {
    if (e.shieldTicks > 0) {
      e.shieldTicks--;
      if (e.shieldTicks === 0) e.shieldHp = 0;
    }
    if (e.speedTicks > 0) {
      e.speedTicks--;
      if (e.speedTicks === 0) e.speedMod = 0;
    }
    if (e.cd0 > 0) e.cd0--;
    if (e.cd1 > 0) e.cd1--;
    if (e.cd2 > 0) e.cd2--;
    if (e.cd3 > 0) e.cd3--;
  }
}
