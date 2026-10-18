// @ts-check
/**
 * System: movement
 * Scope: hero path following and deterministic body collisions. TECH 6
 * Milestone: M3
 */

import { dist2, idiv, isqrt, TICK_HZ, UNITS_PER_TILE } from '../fixed.js';
import { heroSpeed } from '../heroes.js';
import { createGrid2DPhysics } from '../physics/grid2d.js';
import { buildBlockedGrid } from '../physics/pathfinding.js';
import { KIND } from '../state.js';

const IMPULSE_DURATION_TICKS = 5;

/**
 * @param {number} displacement
 * @param {number} ticksRemaining
 */
function impulseStep(displacement, ticksRemaining) {
  const elapsed = IMPULSE_DURATION_TICKS - ticksRemaining + 1;
  const cumulativeWeight = idiv(elapsed * (11 - elapsed), 2);
  const previousWeight = cumulativeWeight - (IMPULSE_DURATION_TICKS - elapsed + 1);
  return idiv(displacement * cumulativeWeight, 15) - idiv(displacement * previousWeight, 15);
}

/**
 * `heroMove` command. The next behavior step computes a route to the destination.
 * @param {import('../state.js').SimState} state
 * @param {number} playerId
 * @param {{ x?: unknown, z?: unknown }} cmd
 */
export function tryHeroMove(state, playerId, cmd) {
  if (!Number.isSafeInteger(cmd.x) || !Number.isSafeInteger(cmd.z)) return false;
  const x = /** @type {number} */ (cmd.x);
  const z = /** @type {number} */ (cmd.z);
  if (x < 0 || z < 0 || x >= state.map.width * UNITS_PER_TILE || z >= state.map.height * UNITS_PER_TILE) return false;
  const hero = state.entities.find((entity) => entity.kind === KIND.HERO && entity.owner === playerId);
  if (!hero) return false;
  const blocked = buildBlockedGrid(state);
  const tileX = Math.floor(x / UNITS_PER_TILE);
  const tileZ = Math.floor(z / UNITS_PER_TILE);
  if (blocked[tileZ * state.map.width + tileX]) return false;
  hero.moveTargetX = x;
  hero.moveTargetZ = z;
  hero.movePath = [];
  hero.movePathIndex = 0;
  hero.pathDirty = 1;
  hero.targetId = 0;
  return true;
}

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const unitRadius = state.config.balance.physics.unitRadiusMilliTiles;
  const movers = state.entities.filter((entity) => entity.kind === KIND.HERO || entity.kind === KIND.CREEP);
  if (movers.length === 0) return;

  const blocked = buildBlockedGrid(state);
  const physics = createGrid2DPhysics();
  for (const entity of state.entities) {
    if (entity.kind <= KIND.BLOCKER) {
      physics.addBody(entity.id, entity.x, entity.z, 0, 0, true, 'square');
    } else if (entity.kind === KIND.HERO || entity.kind === KIND.CREEP) {
      physics.addBody(entity.id, entity.x, entity.z, unitRadius, 1, false, 'circle');
    }
  }

  for (const entity of movers) {
    let vx = 0;
    let vz = 0;
    if (entity.pathDirty === 0 && entity.stunTicks === 0 && entity.movePath.length > 0) {
      let routeBlocked = false;
      for (let i = entity.movePathIndex; i < entity.movePath.length; i++) {
        if (blocked[entity.movePath[i]]) {
          routeBlocked = true;
          break;
        }
      }
      if (routeBlocked) {
        entity.movePath = [];
        entity.movePathIndex = 0;
        entity.pathDirty = 1;
      } else {
        while (entity.movePathIndex < entity.movePath.length - 1) {
          const tile = entity.movePath[entity.movePathIndex];
          const targetX = (tile % state.map.width) * UNITS_PER_TILE + UNITS_PER_TILE / 2;
          const targetZ = Math.floor(tile / state.map.width) * UNITS_PER_TILE + UNITS_PER_TILE / 2;
          if (dist2(entity.x, entity.z, targetX, targetZ) > unitRadius * unitRadius) break;
          entity.movePathIndex++;
        }
        const nextTile = entity.movePath[entity.movePathIndex];
        const isFinal = entity.movePathIndex >= entity.movePath.length - 1;
        const targetX = isFinal ? entity.moveTargetX : (nextTile % state.map.width) * UNITS_PER_TILE + UNITS_PER_TILE / 2;
        const targetZ = isFinal ? entity.moveTargetZ : Math.floor(nextTile / state.map.width) * UNITS_PER_TILE + UNITS_PER_TILE / 2;
        const dx = targetX - entity.x;
        const dz = targetZ - entity.z;
        const distance = isqrt(dx * dx + dz * dz);
        const speedPerSecond = entity.kind === KIND.HERO
          ? heroSpeed(state, entity)
          : state.config.balance.creep.moveMilliTilesPerSecond;
        const speed = idiv(speedPerSecond, TICK_HZ);
        if (distance > 0) {
          if (distance <= speed) {
            vx = dx;
            vz = dz;
          } else {
            vx = idiv(dx * speed, distance);
            vz = idiv(dz * speed, distance);
          }
        }
      }
    }
    physics.setDesiredVelocity(entity.id, vx, vz);
    if (entity.impulseTicks > 0) {
      physics.applyImpulse(
        entity.id,
        impulseStep(entity.impulseX, entity.impulseTicks),
        impulseStep(entity.impulseZ, entity.impulseTicks),
      );
    }
  }

  physics.step();
  for (const entity of movers) {
    const position = physics.getPosition(entity.id);
    entity.x = position.x;
    entity.z = position.z;
    if (entity.impulseTicks > 0) {
      entity.impulseTicks--;
      if (entity.impulseTicks === 0) {
        entity.impulseX = 0;
        entity.impulseZ = 0;
      }
    }
    if (entity.movePath.length === 0 || entity.pathDirty !== 0) continue;
    const reachedX = entity.x - entity.moveTargetX;
    const reachedZ = entity.z - entity.moveTargetZ;
    if (entity.movePathIndex >= entity.movePath.length - 1 && reachedX === 0 && reachedZ === 0) {
      entity.movePath = [];
      entity.movePathIndex = 0;
    }
  }
}
