// @ts-check
/**
 * Items (GDD 8): buying one at a barracks, the inventory, using it, the loot bag a dead hero leaves
 * and the items that lie on the ground. The command handlers in commands.js call these functions,
 * and the production, items, cleanup and combat systems share the helpers.
 *
 * An inventory is a list of counts, one per item id (`Player.items`), with at most
 * `balance.hero.inventorySlots` items in all. A loot bag carries the same list in `Entity.items`.
 * An order for an item joins the barracks queue as type `item` with `mix: [itemId]`. A finished
 * order waits (`held`) until its owner has a hero and a free slot, and then lands in the inventory.
 */

import { dist2, idiv, UNITS_PER_TILE } from './fixed.js';
import { isBuildingKind, ownedBuilding } from './buildings.js';
import { ORDER_TYPE } from './creeps.js';
import { heroOf } from './heroes.js';
import { spend } from './lux.js';
import { tryHeroMove } from './systems/movement.js';
import { chancePct, nextInt } from './rng.js';
import { KIND, NEUTRAL, findEntity, spawnEntity } from './state.js';

/**
 * The item with this id, or undefined.
 * @param {import('./state.js').SimState} state
 * @param {unknown} id
 */
export function itemOf(state, id) {
  return Number.isSafeInteger(id) ? state.config.items.list[/** @type {number} */ (id)] : undefined;
}

/** @param {readonly number[]} counts */
export function countOf(counts) {
  let total = 0;
  for (const n of counts) total += n;
  return total;
}

/**
 * Free inventory slots of a player.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Player} player
 */
export function roomOf(state, player) {
  return state.config.balance.hero.inventorySlots - countOf(player.items);
}

/**
 * `orderItem` command: pays the item's cost at once and queues it at a barracks the player owns.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ barracksId?: unknown, itemId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryOrderItem(state, playerId, cmd) {
  const barracks = ownedBuilding(state, playerId, cmd.barracksId);
  if (!barracks || barracks.kind !== KIND.BARRACKS || barracks.recycle > 0) return false;
  const item = itemOf(state, cmd.itemId);
  if (!item || !spend(state, barracks.team, item.costLux)) return false;
  state.orders.push({
    id: state.nextId++,
    barracksId: barracks.id,
    owner: playerId,
    type: ORDER_TYPE.item,
    mix: [item.id],
    ticksLeft: state.config.balance.items.productionTicks,
    held: 0,
  });
  return true;
}

/**
 * Moves the finished item orders of a player into the inventory, oldest first, while the player
 * has a hero and a free slot. The rest stay held in their barracks.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 */
export function deliverHeldItems(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !heroOf(state, playerId)) return;
  for (const order of state.orders.slice()) {
    if (order.owner !== playerId || order.type !== ORDER_TYPE.item || order.held === 0) continue;
    if (roomOf(state, player) < 1) return;
    player.items[order.mix[0]]++;
    state.orders.splice(state.orders.indexOf(order), 1);
  }
}

/**
 * The target an item names, or undefined when the command gave none that fits.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} hero
 * @param {number} playerId
 * @param {string} kind the item's `target` in data/items.json
 * @param {unknown} targetId
 */
function targetFor(state, hero, playerId, kind, targetId) {
  if (kind === 'self') return hero;
  const target = Number.isSafeInteger(targetId) ? findEntity(state, /** @type {number} */ (targetId)) : undefined;
  if (!target || target.hp <= 0) return undefined;
  const range = state.config.balance.items.useRangeTiles;
  if (dist2(hero.x, hero.z, target.x, target.z) > range * range) return undefined;
  if (kind === 'ownHeroOrBuilding') {
    return target.owner === playerId && (target.kind === KIND.HERO || isBuildingKind(target.kind)) ? target : undefined;
  }
  if (kind === 'enemyUnit') {
    return target.team >= 0 && target.team !== hero.team && (target.kind === KIND.HERO || target.kind === KIND.CREEP) ? target : undefined;
  }
  return undefined;
}

/**
 * `useItem` command. `inventorySlot` is the item id, because the inventory keeps a count per id.
 * A refused use keeps the item.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ inventorySlot?: unknown, targetId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryUseItem(state, playerId, cmd) {
  const player = state.players.find((p) => p.id === playerId);
  const item = itemOf(state, cmd.inventorySlot);
  const hero = heroOf(state, playerId);
  if (!player || !item || !hero || player.items[item.id] < 1) return false;
  const target = targetFor(state, hero, playerId, item.target, cmd.targetId);
  if (!target) return false;
  const effect = item.effect;
  if (effect.kind === 'addLux') {
    const gain = effect.amountLux * state.config.balance.hpFactor.default;
    target.hp += gain;
    target.maxHp += gain;
  } else if (effect.kind === 'funnelMode') {
    if (player.funnelLux > 0) return false;
    player.funnelLux = effect.budgetLux;
  } else if (effect.kind === 'attackSpeed') {
    target.speedMod = effect.amount;
    target.speedTicks = effect.durationTicks;
  } else {
    return false;
  }
  player.items[item.id]--;
  return true;
}

/**
 * `pickUp` command: the hero walks to a ground item or a loot bag, and the items system takes it
 * when the hero is close enough.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ groundItemId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryPickUp(state, playerId, cmd) {
  const target = Number.isSafeInteger(cmd.groundItemId) ? findEntity(state, /** @type {number} */ (cmd.groundItemId)) : undefined;
  if (!target || target.hp <= 0 || (target.kind !== KIND.GROUND_ITEM && target.kind !== KIND.LOOT_BAG)) return false;
  return tryHeroMove(state, playerId, { x: target.x, z: target.z });
}

/**
 * A hero died: its inventory falls as a loot bag where it stood, and its Energy Grab ends.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} hero
 */
export function dropInventory(state, hero) {
  const player = state.players.find((p) => p.id === hero.owner);
  if (!player) return;
  player.funnelLux = 0;
  if (countOf(player.items) === 0) return;
  spawnEntity(state, {
    kind: KIND.LOOT_BAG, team: NEUTRAL, owner: hero.owner,
    x: hero.x, z: hero.z, hp: 1, maxHp: 1,
    items: player.items.slice(),
  });
  player.items = player.items.map(() => 0);
}

/**
 * Puts one item on the ground.
 * @param {import('./state.js').SimState} state
 * @param {number} itemId
 * @param {number} x
 * @param {number} z
 */
export function dropItem(state, itemId, x, z) {
  spawnEntity(state, { kind: KIND.GROUND_ITEM, team: NEUTRAL, owner: -1, x, z, hp: 1, maxHp: 1, itemId: itemId + 1 });
}

/**
 * A creep died: with `creepDropPct` chance it leaves a random starter item (GDD 8.3).
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} creep
 */
export function rollCreepDrop(state, creep) {
  if (!chancePct(state.rng, state.config.balance.items.creepDropPct)) return;
  dropItem(state, nextInt(state.rng, state.config.items.list.length), creep.x, creep.z);
}

/**
 * Lets the hero take what lies within reach: a ground item adds one item, a loot bag as many as the
 * free slots hold. Returns true when the pickup took something.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} thing a ground item or a loot bag
 * @param {import('./state.js').Entity} hero
 */
export function takeBy(state, thing, hero) {
  const player = state.players.find((p) => p.id === hero.owner);
  if (!player) return false;
  let room = roomOf(state, player);
  if (room < 1) return false;
  if (thing.kind === KIND.GROUND_ITEM) {
    player.items[thing.itemId - 1]++;
    thing.hp = 0;
    return true;
  }
  let took = false;
  for (let id = 0; id < thing.items.length && room > 0; id++) {
    const n = Math.min(thing.items[id], room);
    thing.items[id] -= n;
    player.items[id] += n;
    room -= n;
    if (n > 0) took = true;
  }
  if (countOf(thing.items) === 0) thing.hp = 0;
  return took;
}

/**
 * The hero closest to a point within `radius`, with a free slot. Ties go to the lowest id.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} thing
 * @param {number} radius
 */
export function heroNear(state, thing, radius) {
  let best;
  let bestDistance = radius * radius + 1;
  for (const e of state.entities) {
    if (e.kind !== KIND.HERO || e.hp <= 0) continue;
    const d = dist2(e.x, e.z, thing.x, thing.z);
    if (d >= bestDistance) continue;
    const player = state.players.find((p) => p.id === e.owner);
    if (!player || roomOf(state, player) < 1) continue;
    best = e;
    bestDistance = d;
  }
  return best;
}

/**
 * Where a map spawn appears: the center of its tile, in units.
 * @param {{ tileX: number, tileZ: number }} tile
 */
export function tileCenter(tile) {
  return { x: tile.tileX * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2), z: tile.tileZ * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2) };
}
