// @ts-check
/**
 * Grid2DPhysics: the MVP implementation of PhysicsWorld.
 *
 * Planned behavior (TECH_ARCHITECTURE.md section 6):
 *   - circle colliders for heroes and creeps, 1x1 tile squares for buildings and blockers
 *   - uniform spatial hash, cell size 2 tiles (2000 units)
 *   - per step: integrate desired velocity, add impulses with linear decay,
 *     resolve overlaps with 4 fixed iterations; static bodies never move
 *   - every query returns ids in ascending order
 *
 * Milestone M3.
 */

/** @returns {import('./physics-world.js').PhysicsWorld} */
export function createGrid2DPhysics() {
  throw new Error('createGrid2DPhysics: not implemented yet (milestone M3)');
}
