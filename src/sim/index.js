// @ts-check
/**
 * Public API of the simulation. Code outside src/sim imports from here only.
 */

export { createState, spawnEntity, KIND, NEUTRAL } from './state.js';
export { step, PIPELINE } from './step.js';
export { normalizeData, SPEC_VERSION } from './config.js';
export { hashState } from './hash.js';
export { exportState, importState } from './checkpoint.js';
export { Recorder, playReplay, HASH_INTERVAL } from './replay.js';
export { compareEnvelopes } from './commands.js';
export { generateMap, isConnected } from './mapgen.js';
export { buildZoneOf, ATTACK_CODE } from './buildings.js';
export { createRng, nextInt } from './rng.js';
export { TICK_HZ, UNITS_PER_TILE, MILLI } from './fixed.js';
export { heroOf, canPickHero, abilityOf, SLOT_TYPES } from './heroes.js';
export { ORDER_TYPE } from './creeps.js';
export { laneRoute } from './creeps.js';
