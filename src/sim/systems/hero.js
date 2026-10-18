// @ts-check
/**
 * System: hero (pipeline step 4)
 * Runs down the wait before a player may pick another hero after the last one died. The
 * cooldown starts in the cleanup system, in the tick the hero is removed. GDD 7.1
 */

/** @param {import('../state.js').SimState} state */
export function run(state) {
  for (const player of state.players) if (player.heroCooldown > 0) player.heroCooldown--;
}
