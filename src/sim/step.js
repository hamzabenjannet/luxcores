// @ts-check
/**
 * One simulation tick. The pipeline order below is part of the spec
 * (docs/TECH_ARCHITECTURE.md section 4.1). Do not reorder without
 * updating the doc and bumping SPEC_VERSION.
 */

import { applyCommands } from './commands.js';
import * as economy from './systems/economy.js';
import * as production from './systems/production.js';
import * as hero from './systems/hero.js';
import * as recycle from './systems/recycle.js';
import * as items from './systems/items.js';
import * as behavior from './systems/behavior.js';
import * as movement from './systems/movement.js';
import * as combat from './systems/combat.js';
import * as effects from './systems/effects.js';
import * as entropy from './systems/entropy.js';
import * as meltdown from './systems/meltdown.js';
import * as cleanup from './systems/cleanup.js';
import * as victory from './systems/victory.js';
import * as visibility from './systems/visibility.js';

/**
 * @typedef {{ name: string, run: (s: import('./state.js').SimState) => void }} SystemEntry
 */

/** @type {readonly SystemEntry[]} pipeline steps 2 to 15 */
export const PIPELINE = Object.freeze([
  { name: 'economy', run: economy.run },        // 2  collectors, pending pool, day/night
  { name: 'production', run: production.run },  // 3  barracks queues (creeps, items, heroes)
  { name: 'hero', run: hero.run },              // 4  respawn cooldowns, rotation locks
  { name: 'recycle', run: recycle.run },        // 5  recycle channels
  { name: 'items', run: items.run },            // 6  map spawns, despawns, auto pickup
  { name: 'behavior', run: behavior.run },      // 7  orders, waypoints, targeting
  { name: 'movement', run: movement.run },      // 8  physics step, collisions
  { name: 'combat', run: combat.run },          // 9-10 attacks, projectiles, damage, procs, funnel
  { name: 'effects', run: effects.run },        // 11 timed effects, cooldowns
  { name: 'entropy', run: entropy.run },        // 12
  { name: 'meltdown', run: meltdown.run },      // 13
  { name: 'cleanup', run: cleanup.run },        // 14 deaths in id order, drops, loot bags
  { name: 'victory', run: victory.run },        // 15
]);

/**
 * Advance the state by one tick.
 * @param {import('./state.js').SimState} state
 * @param {import('./commands.js').CommandEnvelope[]} envelopes commands for this tick
 */
export function step(state, envelopes) {
  if (state.outcome) return; // match over: state is frozen
  applyCommands(state, envelopes); // 1
  for (const sys of PIPELINE) sys.run(state);
  state.tick++;
  // Derived data, outside the hash; every 5 ticks per the spec.
  if (state.tick % 5 === 0) visibility.run(state);
}
