// @ts-check
/**
 * MVP bot (GDD 12.1). It reads the world only through WorldView and emits
 * the same CommandEnvelopes a human produces. Its commands are recorded in
 * replays, so replays never depend on this code.
 *
 * Planned behavior (M9):
 *   - every 20 ticks, spend settled lux in rotation: collector, barracks,
 *     tower, creep group of 5; buildings on the free build-zone tile nearest
 *     its Core
 *   - pick heroes in roster order at its newest barracks, allocating 50% of
 *     Core lux
 *   - the hero walks the nearest lane toward the enemy Core and attacks
 *     whatever is in range; no abilities, no items
 *
 * Any randomness the bot needs must come from its own seeded RNG (rng.js),
 * never Math.random, so bot-vs-bot soaks are reproducible.
 */

/**
 * @param {number} playerId
 */
export function createBot(playerId) {
  let seq = 0;
  return {
    playerId,
    /**
     * Called once per tick before step().
     * @param {import('../client/world-view.js').WorldView} _view
     * @returns {import('../sim/commands.js').CommandEnvelope[]}
     */
    think(_view) {
      void seq;
      return []; // TODO(M9)
    },
  };
}
