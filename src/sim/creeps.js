// @ts-check
/**
 * Creeps (GDD 9): barracks orders, groups, paths and the lane route. The command
 * handlers in commands.js call these functions, and the production, behavior and
 * cleanup systems share the helpers.
 *
 * A group is a record in `state.groups`. Its members are the creeps that carry its
 * id in `groupId`, in id order. A group walks `group.waypoints` and then heads for
 * the enemy Core. Without a custom path the waypoints are the lane route that
 * `laneRoute` computes when the group spawns.
 */

import { dist2, idiv, MILLI, UNITS_PER_TILE } from './fixed.js';
import { ATTACK_CODE, ownedBuilding } from './buildings.js';
import { credit, spend } from './lux.js';
import { buildBlockedGrid } from './physics/pathfinding.js';
import { KIND, spawnEntity } from './state.js';

/** Order type codes in `Order.type`. The codes are part of the hash: append only. */
export const ORDER_TYPE = Object.freeze({ creeps: 1 });

/**
 * Binary search by id in a list sorted by ascending id (entities, groups, orders).
 * @template {{ id: number }} T
 * @param {readonly T[]} list
 * @param {unknown} id
 * @returns {T | undefined}
 */
export function findById(list, id) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].id === id) return list[mid];
    if (list[mid].id < /** @type {number} */ (id)) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/**
 * The creeps of a group, in id order.
 * @param {import('./state.js').SimState} state
 * @param {number} groupId
 */
export function membersOf(state, groupId) {
  return state.entities.filter((e) => e.kind === KIND.CREEP && e.groupId === groupId);
}

/**
 * Creeps a player has alive. Held groups do not count (they are not on the map yet).
 * @param {import('./state.js').SimState} state
 * @param {number} owner
 */
export function creepCount(state, owner) {
  let n = 0;
  for (const e of state.entities) if (e.kind === KIND.CREEP && e.owner === owner) n++;
  return n;
}

/**
 * A waypoint list from a command: whole-unit [x, z] pairs inside the map, at most `maxWaypoints`.
 * @param {import('./state.js').SimState} state
 * @param {unknown} list
 * @returns {number[][] | null} a copy, or null when the list is invalid
 */
function validWaypoints(state, list) {
  if (!Array.isArray(list) || list.length > state.config.balance.creep.maxWaypoints) return null;
  /** @type {number[][]} */
  const out = [];
  for (const point of list) {
    if (!Array.isArray(point) || point.length !== 2) return null;
    const [x, z] = point;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return null;
    if (x < 0 || z < 0 || x >= state.map.width * UNITS_PER_TILE || z >= state.map.height * UNITS_PER_TILE) return null;
    out.push([x, z]);
  }
  return out;
}

/**
 * `orderCreeps` command: pays 5 lux per creep and queues a group of 1 to 5 (GDD 9).
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ barracksId?: unknown, mix?: unknown }} cmd
 * @returns {boolean}
 */
export function tryOrderCreeps(state, playerId, cmd) {
  const barracks = ownedBuilding(state, playerId, cmd.barracksId);
  if (!barracks || barracks.kind !== KIND.BARRACKS || barracks.recycle > 0) return false;
  const { groupMin, groupMax, costLux } = state.config.balance.creep;
  if (!Array.isArray(cmd.mix) || cmd.mix.length < groupMin || cmd.mix.length > groupMax) return false;
  /** @type {number[]} */
  const mix = [];
  for (const type of cmd.mix) {
    if (typeof type !== 'string' || !Object.hasOwn(ATTACK_CODE, type)) return false;
    mix.push(ATTACK_CODE[/** @type {keyof typeof ATTACK_CODE} */ (type)]);
  }
  if (!spend(state, barracks.team, mix.length * costLux)) return false;
  state.orders.push({
    id: state.nextId++,
    barracksId: barracks.id,
    owner: playerId,
    type: ORDER_TYPE.creeps,
    mix,
    ticksLeft: state.config.balance.creep.productionTicksPerGroup,
    held: 0,
  });
  return true;
}

/**
 * Lux an order cost, in milli-lux.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Order} order
 */
export function orderCost(state, order) {
  return order.mix.length * state.config.balance.creep.costLux;
}

/**
 * `cancelQueue` command: removes the order at `index` in a barracks queue (queue order, held
 * groups included) and refunds `recycleQueueRefundPct` of its cost.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ barracksId?: unknown, index?: unknown }} cmd
 * @returns {boolean}
 */
export function tryCancelQueue(state, playerId, cmd) {
  const barracks = ownedBuilding(state, playerId, cmd.barracksId);
  if (!barracks || barracks.kind !== KIND.BARRACKS || !Number.isSafeInteger(cmd.index)) return false;
  const queue = state.orders.filter((o) => o.barracksId === barracks.id);
  const order = queue[/** @type {number} */ (cmd.index)];
  if (!order || /** @type {number} */ (cmd.index) < 0) return false;
  state.orders.splice(state.orders.indexOf(order), 1);
  credit(state, barracks.team, idiv(orderCost(state, order) * state.config.balance.economy.recycleQueueRefundPct, 100));
  return true;
}

/**
 * `setBarracksPath` command: the default path of new groups. An empty list clears it.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ barracksId?: unknown, waypoints?: unknown }} cmd
 * @returns {boolean}
 */
export function trySetBarracksPath(state, playerId, cmd) {
  const barracks = ownedBuilding(state, playerId, cmd.barracksId);
  const waypoints = validWaypoints(state, cmd.waypoints);
  if (!barracks || barracks.kind !== KIND.BARRACKS || !waypoints) return false;
  barracks.waypoints = waypoints;
  return true;
}

/**
 * A group of the player, or undefined.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {unknown} groupId
 */
function ownedGroup(state, playerId, groupId) {
  const group = findById(state.groups, groupId);
  return group && group.owner === playerId ? group : undefined;
}

/**
 * `setGroupPath` command: up to 10 waypoints, replacing the old path. An empty list puts the
 * group back on the lane route.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ groupId?: unknown, waypoints?: unknown }} cmd
 * @returns {boolean}
 */
export function trySetGroupPath(state, playerId, cmd) {
  const group = ownedGroup(state, playerId, cmd.groupId);
  const waypoints = validWaypoints(state, cmd.waypoints);
  if (!group || !waypoints) return false;
  const leader = membersOf(state, group.id)[0];
  group.wpIndex = 0;
  if (waypoints.length === 0) {
    group.custom = 0;
    group.waypoints = leader ? laneRoute(state, group.team, leader.x, leader.z) : [];
  } else {
    group.custom = 1;
    group.waypoints = waypoints;
  }
  return true;
}

/**
 * `mergeGroups` command: the second group joins the first and takes its path (GDD 9.0). The
 * result may hold up to the creep cap.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ intoGroupId?: unknown, fromGroupId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryMergeGroups(state, playerId, cmd) {
  const into = ownedGroup(state, playerId, cmd.intoGroupId);
  const from = ownedGroup(state, playerId, cmd.fromGroupId);
  if (!into || !from || into.id === from.id) return false;
  const joining = membersOf(state, from.id);
  if (membersOf(state, into.id).length + joining.length > state.config.balance.creep.capPerPlayer) return false;
  for (const creep of joining) creep.groupId = into.id;
  state.groups.splice(state.groups.indexOf(from), 1);
  return true;
}

/**
 * `splitGroup` command: halves a group. With an odd count the extra creep stays in the original
 * (7 becomes 4 and 3). Both halves keep the path and its progress. A group of 1 cannot split.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ groupId?: unknown }} cmd
 * @returns {boolean}
 */
export function trySplitGroup(state, playerId, cmd) {
  const group = ownedGroup(state, playerId, cmd.groupId);
  if (!group) return false;
  const members = membersOf(state, group.id);
  if (members.length < 2) return false;
  const half = idiv(members.length, 2);
  /** @type {import('./state.js').Group} */
  const other = {
    id: state.nextId++,
    owner: group.owner,
    team: group.team,
    custom: group.custom,
    wpIndex: group.wpIndex,
    waypoints: group.waypoints.map((p) => [p[0], p[1]]),
  };
  state.groups.push(other);
  for (const creep of members.slice(members.length - half)) creep.groupId = other.id;
  return true;
}

/**
 * The route a group walks without a custom path (GDD 9.1): the own lane nearest to the start,
 * from the lane vertex nearest to the start out to the map center, then the enemy lane of the
 * same column back toward the enemy Core. The enemy Core itself is the implicit last stop.
 * Core and blocked vertices are skipped while walking, not here.
 * @param {import('./state.js').SimState} state
 * @param {number} team
 * @param {number} x start, in units
 * @param {number} z
 * @returns {number[][]} [x, z] pairs in units
 */
export function laneRoute(state, team, x, z) {
  const toUnits = (/** @type {number[]} */ p) => [p[0] * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2), p[1] * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2)];
  const { width } = state.map;

  let own;
  let ownDistance = Number.MAX_SAFE_INTEGER;
  for (const lane of state.map.lanes) {
    if (lane.team !== team) continue;
    for (const tile of lane.tiles) {
      const d = dist2(x, z, (tile % width) * UNITS_PER_TILE + 500, Math.floor(tile / width) * UNITS_PER_TILE + 500);
      if (d < ownDistance) {
        ownDistance = d;
        own = lane;
      }
    }
  }
  if (!own) return [];

  let first = 0;
  let firstDistance = Number.MAX_SAFE_INTEGER;
  own.points.forEach((p, i) => {
    const [px, pz] = toUnits(p);
    const d = dist2(x, z, px, pz);
    if (d < firstDistance) {
      firstDistance = d;
      first = i;
    }
  });
  const route = own.points.slice(first).map(toUnits);

  // The enemy lane that ends next to this lane's end is the same column seen from the other side.
  const end = own.points[own.points.length - 1];
  let enemy;
  let enemyDistance = Number.MAX_SAFE_INTEGER;
  for (const lane of state.map.lanes) {
    if (lane.team === team) continue;
    const last = lane.points[lane.points.length - 1];
    const d = (last[0] - end[0]) * (last[0] - end[0]) + (last[1] - end[1]) * (last[1] - end[1]);
    if (d < enemyDistance) {
      enemyDistance = d;
      enemy = lane;
    }
  }
  if (enemy) {
    // Reverse order, from the lane's center end toward the enemy Core, which is the lane's first vertex and the final target.
    for (let i = enemy.points.length - 1; i >= 1; i--) route.push(toUnits(enemy.points[i]));
  }
  return route;
}

/**
 * Free tiles around a barracks for a new group, nearest ring first, scanned by row then column.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} barracks
 * @param {number} count
 * @returns {{ x: number, z: number }[]} tile centers in units
 */
export function spawnSpots(state, barracks, count) {
  const blocked = buildBlockedGrid(state);
  const { width, height } = state.map;
  const bx = Math.floor(barracks.x / UNITS_PER_TILE);
  const bz = Math.floor(barracks.z / UNITS_PER_TILE);
  /** @type {{ x: number, z: number }[]} */
  const spots = [];
  for (let r = 1; r <= 4 && spots.length < count; r++) {
    for (let dz = -r; dz <= r && spots.length < count; dz++) {
      for (let dx = -r; dx <= r && spots.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const tx = bx + dx;
        const tz = bz + dz;
        if (tx < 0 || tz < 0 || tx >= width || tz >= height || blocked[tz * width + tx]) continue;
        spots.push({ x: tx * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2), z: tz * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2) });
      }
    }
  }
  // A crowded base can run out of free tiles; the rest stand on the barracks tile and the physics separates them.
  while (spots.length < count) spots.push({ x: barracks.x, z: barracks.z });
  return spots;
}

/**
 * Spawns the creeps of a finished order as one new group next to its barracks.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Order} order
 * @param {import('./state.js').Entity} barracks
 */
export function spawnGroup(state, order, barracks) {
  const spots = spawnSpots(state, barracks, order.mix.length);
  const custom = barracks.waypoints.length > 0;
  /** @type {import('./state.js').Group} */
  const group = {
    id: state.nextId++,
    owner: order.owner,
    team: barracks.team,
    custom: custom ? 1 : 0,
    wpIndex: 0,
    waypoints: custom ? barracks.waypoints.map((p) => [p[0], p[1]]) : laneRoute(state, barracks.team, spots[0].x, spots[0].z),
  };
  state.groups.push(group);
  const hp = state.config.balance.creep.hp * MILLI;
  order.mix.forEach((attack, i) => {
    spawnEntity(state, {
      kind: KIND.CREEP, team: barracks.team, owner: order.owner,
      x: spots[i].x, z: spots[i].z, hp, maxHp: hp, attack, groupId: group.id,
    });
  });
}
