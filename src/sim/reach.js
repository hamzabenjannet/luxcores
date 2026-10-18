// @ts-check
/**
 * Spacing rules shared by combat, behavior and the clients' expectations:
 * how close a melee attacker stands, and where the members of a group stand
 * while they walk. All numbers come from `balance.physics` (GDD 7.3).
 */

import { idiv, UNITS_PER_TILE } from './fixed.js';
import { KIND } from './state.js';

/** Half the width of a building tile, in units. */
const HALF_TILE = idiv(UNITS_PER_TILE, 2);

/**
 * Center distance at which a melee attacker may hit: the two bodies keep `meleeGapMilliTiles`
 * between their edges, so the gap leaves room for weapons and animations later. A unit's edge
 * is its collider radius out from its center, a building's edge is half a tile.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} target
 */
export function meleeReach(state, target) {
  const { unitRadiusMilliTiles, meleeGapMilliTiles } = state.config.balance.physics;
  const targetEdge = target.kind === KIND.CREEP || target.kind === KIND.HERO ? unitRadiusMilliTiles : HALF_TILE;
  return unitRadiusMilliTiles + targetEdge + meleeGapMilliTiles;
}

/**
 * Where a group member stands relative to the group's goal: a grid that is as wide as it is
 * deep (rounded up), centered on the goal, with `unitSpacingMilliTiles` between the edges of
 * neighbours. Slot 0 is the center of the first row.
 * @param {import('./state.js').SimState} state
 * @param {number} slot position of the creep in its group, by id, from 0
 * @param {number} count creeps in the group
 * @returns {{ dx: number, dz: number }}
 */
export function formationOffset(state, slot, count) {
  const { unitRadiusMilliTiles, unitSpacingMilliTiles } = state.config.balance.physics;
  const pitch = 2 * unitRadiusMilliTiles + unitSpacingMilliTiles;
  let columns = 1;
  while (columns * columns < count) columns++;
  const column = slot % columns;
  const row = idiv(slot, columns);
  // Twice the offset keeps the arithmetic in whole units when the grid has an even width.
  return { dx: idiv((2 * column - (columns - 1)) * pitch, 2), dz: row * pitch };
}
