// @ts-check
/**
 * Checkpoints: a running state saved as plain data and restored later, possibly by other code.
 *
 * `exportState` drops what the next start can rebuild: the normalized data files, the visibility
 * bitsets and each entity's `visibleTo`. `importState` attaches the data the caller loaded,
 * recomputes the derived data and fills the fields that a later version added, so an older
 * checkpoint still loads. A server keeps a checkpoint every few hundred ticks, so a match can
 * resume after a restart without replaying every tick, and after a code or data change that a
 * replay from the seed could no longer reproduce.
 *
 * Save only at a tick that is a multiple of 5: the visibility cache refreshes at those ticks,
 * and a restored state recomputes it at once, so both agree.
 */

import { emptyCounts, emptyStats, entityDefaults } from './state.js';
import { run as runVisibility } from './systems/visibility.js';

/**
 * Deep copy of the gameplay state, safe to serialize as JSON.
 * @param {import('./state.js').SimState} state
 * @returns {Record<string, unknown>}
 */
export function exportState(state) {
  const { config: _config, visibility: _visibility, entities, ...rest } = state;
  return structuredClone({
    ...rest,
    entities: entities.map(({ visibleTo: _visibleTo, ...entity }) => entity),
  });
}

/**
 * Rebuilds a state from `exportState` output and the data the caller runs with.
 * @param {Record<string, unknown>} data
 * @param {import('./config.js').SimConfig} config
 * @returns {import('./state.js').SimState}
 */
export function importState(data, config) {
  const state = /** @type {import('./state.js').SimState} */ (
    /** @type {unknown} */ ({ ...structuredClone(data), config, visibility: [] })
  );
  // A checkpoint written before a milestone added a field lacks it. Give it the starting value.
  state.entities = state.entities.map((e) => ({ ...entityDefaults(), ...e }));
  state.teams = state.teams.map((t) => ({ ...emptyStats(), ...t }));
  state.players = state.players.map((p) => ({ heroLock: 0, heroCooldown: 0, funnelLux: 0, items: emptyCounts(config), ...p }));
  runVisibility(state);
  return state;
}
