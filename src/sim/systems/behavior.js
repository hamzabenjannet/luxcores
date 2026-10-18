// @ts-check
/**
 * System: behavior
 * Scope: tower target acquisition and hero-aggression override (GDD 5.0), creep targeting and
 * steering along group paths (GDD 9.1, 9.2), and route computation for heroes and creeps.
 * Milestone: M3, M4 (creeps)
 */

import { dist2, idiv, UNITS_PER_TILE } from '../fixed.js';
import { findEntity, KIND } from '../state.js';
import { findById, membersOf } from '../creeps.js';
import { buildBlockedGrid, findPath } from '../physics/pathfinding.js';

/** Routes computed per tick, shared by heroes and creeps. The rest wait a tick, in id order. */
const REPATH_BUDGET = 8;
/** A group moves on to its next waypoint when its leader is this close, in units. */
const WAYPOINT_REACH = 1500;
/** A melee attack reaches this far between centers (CONTACT_RANGE in combat.js). */
const CONTACT_RANGE = UNITS_PER_TILE;
const TYPE_NAMES = ['', 'melee', 'ranged', 'area'];

/**
 * @param {import('../state.js').Entity} tower
 * @param {import('../state.js').Entity} target
 * @param {number} range
 */
export function towerCanTarget(tower, target, range) {
  return target.id !== tower.id
    && target.team >= 0
    && target.team !== tower.team
    && (target.kind === KIND.CORE || (target.kind >= KIND.SOLAR && target.kind <= KIND.HERO))
    && dist2(tower.x, tower.z, target.x, target.z) <= range * range;
}

/**
 * Whether a creep may attack the entity: an enemy Core, building, creep or hero. Blockers are not targets.
 * @param {import('../state.js').Entity} creep
 * @param {import('../state.js').Entity} e
 */
export function creepCanTarget(creep, e) {
  return e.hp > 0 && e.team >= 0 && e.team !== creep.team
    && (e.kind === KIND.CORE || (e.kind >= KIND.SOLAR && e.kind <= KIND.HERO));
}

/**
 * The free tile nearest to a tile, by center distance, searching up to 3 rings out. Ties go to the first tile in row, column order.
 * @param {Uint8Array} blocked
 * @param {number} width
 * @param {number} height
 * @param {number} tx
 * @param {number} tz
 * @param {number} fromX position to measure from, in units
 * @param {number} fromZ
 * @returns {{ x: number, z: number } | null} tile coordinates
 */
function nearestFree(blocked, width, height, tx, tz, fromX, fromZ) {
  if (tx >= 0 && tz >= 0 && tx < width && tz < height && !blocked[tz * width + tx]) return { x: tx, z: tz };
  let best = null;
  let bestD = Number.MAX_SAFE_INTEGER;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (x < 0 || z < 0 || x >= width || z >= height || blocked[z * width + x]) continue;
      const d = dist2(fromX, fromZ, x * UNITS_PER_TILE + 500, z * UNITS_PER_TILE + 500) + (dx * dx + dz * dz) * 1_000_000_000;
      if (d < bestD) {
        bestD = d;
        best = { x, z };
      }
    }
  }
  return best;
}

/**
 * Steers every creep: keep or pick a target, stand and fight inside reach, or walk the group's
 * path. Setting `pathDirty` hands the route to the shared A* pass below.
 * @param {import('../state.js').SimState} state
 * @param {() => Uint8Array} getBlocked
 */
function steerCreeps(state, getBlocked) {
  const { creep: stats, attackTypes } = state.config.balance;
  const sight2 = stats.sightTiles * stats.sightTiles;
  const { width, height } = state.map;

  // Groups advance when their leader (the lowest id) is near the current waypoint.
  for (const group of state.groups) {
    const leader = membersOf(state, group.id)[0];
    if (!leader) continue;
    for (let n = 0; n < 4 && group.wpIndex < group.waypoints.length; n++) {
      const [wx, wz] = group.waypoints[group.wpIndex];
      if (dist2(leader.x, leader.z, wx, wz) > WAYPOINT_REACH * WAYPOINT_REACH) break;
      group.wpIndex++;
    }
  }

  for (const creep of state.entities) {
    if (creep.kind !== KIND.CREEP) continue;

    // Keep the target while it lives and stays in sight; otherwise take the nearest enemy in sight.
    let target = findEntity(state, creep.targetId);
    if (!target || !creepCanTarget(creep, target) || dist2(creep.x, creep.z, target.x, target.z) > sight2) {
      target = undefined;
      let bestD = sight2 + 1;
      for (const e of state.entities) {
        if (!creepCanTarget(creep, e)) continue;
        const d = dist2(creep.x, creep.z, e.x, e.z);
        if (d < bestD) {
          bestD = d;
          target = e;
        }
      }
    }
    creep.targetId = target ? target.id : 0;

    // Inside reach: stand still and let the combat system swing.
    const rules = attackTypes[TYPE_NAMES[creep.attack] || 'melee'];
    if (target) {
      const reach = rules.reachTiles > 0 ? rules.reachTiles : CONTACT_RANGE;
      if (dist2(creep.x, creep.z, target.x, target.z) <= reach * reach) {
        creep.movePath = [];
        creep.movePathIndex = 0;
        creep.pathDirty = 0;
        creep.moveTargetX = creep.x;
        creep.moveTargetZ = creep.z;
        continue;
      }
    }

    // Where to go: the target, else the group's waypoint, else the enemy Core.
    /** @type {{ x: number, z: number } | null} */
    let goalUnits = null;
    let toBuilding = false;
    if (target) {
      goalUnits = { x: target.x, z: target.z };
      toBuilding = target.kind <= KIND.TOWER;
    } else {
      const group = findById(state.groups, creep.groupId);
      if (group && group.wpIndex < group.waypoints.length) {
        goalUnits = { x: group.waypoints[group.wpIndex][0], z: group.waypoints[group.wpIndex][1] };
      } else {
        const core = state.entities.find((e) => e.kind === KIND.CORE && e.team !== creep.team);
        if (core) {
          goalUnits = { x: core.x, z: core.z };
          toBuilding = true;
        }
      }
    }
    if (!goalUnits) continue;

    // A building cannot be entered: melee stands on the free tile beside it (center distance exactly 1 tile).
    const blocked = getBlocked();
    let tx = Math.floor(goalUnits.x / UNITS_PER_TILE);
    let tz = Math.floor(goalUnits.z / UNITS_PER_TILE);
    let gx = goalUnits.x;
    let gz = goalUnits.z;
    if (toBuilding) {
      let side = null;
      let sideD = Number.MAX_SAFE_INTEGER;
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = tx + dx;
        const z = tz + dz;
        if (x < 0 || z < 0 || x >= width || z >= height || blocked[z * width + x]) continue;
        const d = dist2(creep.x, creep.z, x * UNITS_PER_TILE + 500, z * UNITS_PER_TILE + 500);
        if (d < sideD) {
          sideD = d;
          side = { x, z };
        }
      }
      if (!side) continue;
      tx = side.x;
      tz = side.z;
      gx = tx * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2);
      gz = tz * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2);
    } else if (blocked[tz * width + tx]) {
      const free = nearestFree(blocked, width, height, tx, tz, creep.x, creep.z);
      if (!free) continue;
      gx = free.x * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2);
      gz = free.z * UNITS_PER_TILE + idiv(UNITS_PER_TILE, 2);
    }

    const sameGoal = creep.moveTargetX === gx && creep.moveTargetZ === gz;
    const idle = creep.movePath.length === 0 && creep.pathDirty === 0;
    const away = dist2(creep.x, creep.z, gx, gz) > 500 * 500;
    if (!sameGoal || (idle && away)) {
      creep.moveTargetX = gx;
      creep.moveTargetZ = gz;
      creep.movePath = [];
      creep.movePathIndex = 0;
      creep.pathDirty = 1;
    }
  }
}

/** @param {import('../state.js').SimState} state */
export function run(state) {
  let repaths = 0;
  let blocked;
  steerCreeps(state, () => (blocked ??= buildBlockedGrid(state)));
  for (const entity of state.entities) {
    if ((entity.kind !== KIND.HERO && entity.kind !== KIND.CREEP) || entity.pathDirty === 0 || repaths >= REPATH_BUDGET) continue;
    blocked ??= buildBlockedGrid(state);
    const startX = Math.floor(entity.x / 1000);
    const startZ = Math.floor(entity.z / 1000);
    const goalX = Math.floor(entity.moveTargetX / 1000);
    const goalZ = Math.floor(entity.moveTargetZ / 1000);
    const start = startZ * state.map.width + startX;
    const goal = goalZ * state.map.width + goalX;
    entity.movePath = findPath(state.map.width, state.map.height, blocked, start, goal);
    entity.movePathIndex = entity.movePath.length > 1 ? 1 : 0;
    entity.pathDirty = 0;
    repaths++;
  }

  const range = state.config.buildings.tower.rangeTiles;
  for (const tower of state.entities) {
    if (tower.kind !== KIND.TOWER) continue;

    const overrideTargetId = tower.overrideTargetId;
    if (tower.overrideTicks > 0) tower.overrideTicks--;
    const override = findEntity(state, overrideTargetId);
    if (tower.overrideTicks > 0 && override && override.kind === KIND.HERO && towerCanTarget(tower, override, range)) {
      tower.targetId = override.id;
      continue;
    }
    if (tower.overrideTicks === 0 && tower.targetId === overrideTargetId) tower.targetId = 0;
    tower.overrideTargetId = 0;

    const current = findEntity(state, tower.targetId);
    if (current && towerCanTarget(tower, current, range)) continue;

    let closest;
    let closestDistance = Number.MAX_SAFE_INTEGER;
    for (const candidate of state.entities) {
      if (!towerCanTarget(tower, candidate, range)) continue;
      const distance = dist2(tower.x, tower.z, candidate.x, candidate.z);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }
    tower.targetId = closest?.id ?? 0;
  }
}
