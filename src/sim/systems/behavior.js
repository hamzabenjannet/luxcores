// @ts-check
/**
 * System: behavior
 * Scope: tower target acquisition and hero-aggression override. GDD 5.0
 * Milestone: M3
 */

import { dist2 } from '../fixed.js';
import { findEntity, KIND } from '../state.js';
import { buildBlockedGrid, findPath } from '../physics/pathfinding.js';

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

/** @param {import('../state.js').SimState} state */
export function run(state) {
  let repaths = 0;
  let blocked;
  for (const entity of state.entities) {
    if (entity.kind !== KIND.HERO || entity.pathDirty === 0 || repaths >= 8) continue;
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
