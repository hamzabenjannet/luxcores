// @ts-check
/**
 * Command schema, ordering and dispatch.
 *
 * Every input source (touch UI, bot, hot seat, later the network) produces
 * CommandEnvelopes. The sim validates each one and silently drops the
 * invalid ones. A UI may call `validate` for instant feedback, but the
 * sim result is the authority.
 */

import { tryBuild, tryCancelRecycle, tryRecycle, tryUpgradeTower } from './buildings.js';
import { tryCancelQueue, tryMergeGroups, tryOrderCreeps, trySetBarracksPath, trySetGroupPath, trySplitGroup } from './creeps.js';
import { tryCastAbility, tryPickHero } from './heroes.js';
import { tryHeroAttack } from './systems/combat.js';
import { tryHeroMove } from './systems/movement.js';

/**
 * @typedef {Object} CommandEnvelope
 * @property {number} tick      execution tick
 * @property {number} playerId
 * @property {number} seq       per-player counter, strictly increasing
 * @property {Command} cmd
 */

/**
 * Coordinates are in units (1 tile = 1000). Waypoints are [x, z] pairs.
 * @typedef {
 *  | {t:'build', building:string, tileX:number, tileZ:number, attack?:string}
 *  | {t:'upgrade', towerId:number, track:'power'|'shell'}
 *  | {t:'recycle', buildingId:number}
 *  | {t:'cancelRecycle', buildingId:number}
 *  | {t:'orderCreeps', barracksId:number, mix:('melee'|'ranged'|'area')[]}
 *  | {t:'orderItem', barracksId:number, itemId:number}
 *  | {t:'cancelQueue', barracksId:number, orderId?:number, index?:number}
 *  | {t:'setBarracksPath', barracksId:number, waypoints:number[][]}
 *  | {t:'setGroupPath', groupId:number, waypoints:number[][]}
 *  | {t:'mergeGroups', intoGroupId:number, fromGroupId:number}
 *  | {t:'splitGroup', groupId:number}
 *  | {t:'pickHero', heroId:number, lux:number, barracksId:number}
 *  | {t:'heroMove', x:number, z:number}
 *  | {t:'heroAttack', targetId:number}
 *  | {t:'castAbility', slot:0|1|2|3, x?:number, z?:number, targetId?:number}
 *  | {t:'useItem', inventorySlot:number, targetId?:number}
 *  | {t:'pickUp', groundItemId:number}
 * } Command
 */

/**
 * Handlers by command type. Each returns true if the command was valid and
 * applied. M2 fills in build, recycle and cancelRecycle; milestones M3 to M6
 * add the rest, and a command with no handler is dropped as invalid.
 * @type {Record<string, (s: import('./state.js').SimState, playerId: number, cmd: any) => boolean>}
 */
export const HANDLERS = {
  build: tryBuild,
  upgrade: tryUpgradeTower,
  recycle: tryRecycle,
  cancelRecycle: tryCancelRecycle,
  orderCreeps: tryOrderCreeps,
  cancelQueue: tryCancelQueue,
  setBarracksPath: trySetBarracksPath,
  setGroupPath: trySetGroupPath,
  mergeGroups: tryMergeGroups,
  splitGroup: trySplitGroup,
  pickHero: tryPickHero,
  castAbility: tryCastAbility,
  heroAttack: tryHeroAttack,
  heroMove: tryHeroMove,
};

/**
 * Canonical command order: (playerId, seq) ascending.
 * @param {CommandEnvelope} a
 * @param {CommandEnvelope} b
 */
export function compareEnvelopes(a, b) {
  return a.playerId - b.playerId || a.seq - b.seq;
}

/**
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {Command} cmd
 * @returns {boolean}
 */
export function validateAndApply(state, playerId, cmd) {
  if (!state.players.some((p) => p.id === playerId)) return false;
  const h = HANDLERS[cmd.t];
  if (!h) return false;
  return h(state, playerId, cmd);
}

/**
 * Pipeline step 1.
 * @param {import('./state.js').SimState} state
 * @param {CommandEnvelope[]} envelopes
 */
export function applyCommands(state, envelopes) {
  if (envelopes.length === 0) return;
  const sorted = envelopes.slice().sort(compareEnvelopes);
  for (const env of sorted) {
    if (env.tick !== state.tick) continue; // wrong tick: dropped
    validateAndApply(state, env.playerId, env.cmd);
  }
}
