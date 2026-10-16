// @ts-check
/**
 * Seeded procedural map generation. GDD section 10.
 *
 * Contract:
 *   generateMap(seed, mapgenConfig) -> MapLayout
 *   - pure: same seed + config => identical layout on every runtime
 *   - uses its own RNG seeded from the match seed, so map generation never
 *     shifts the gameplay RNG stream
 *   - generates the player half (team 0, bottom), then point-mirrors through
 *     the map center onto team 1: (x, z) -> (W - 1 - x, H - 1 - z) in tiles
 *   - rejects and regenerates (seed + 1, + 2, ...) if a flood fill finds a
 *     lane that does not connect the two Cores
 *
 * Grid (tiles): 96 wide x 112 tall, rows top to bottom 32 / 16 / 16 / 16 / 32.
 * Team 1 (enemy, red by default) is the top half, team 0 the bottom half.
 *
 * Milestone M1 deliverable. See docs/HANDOVER.md for acceptance criteria.
 */

/**
 * @typedef {Object} MapLayout
 * @property {number} width   tiles
 * @property {number} height  tiles
 * @property {{ team: number, tileX: number, tileZ: number }[]} cores
 * @property {{ team: number, lane: 'left'|'mid'|'right', points: number[][] }[]} lanes  control points in tiles
 * @property {{ team: number, tileX: number, tileZ: number }[]} vents
 * @property {{ team: number, tileX: number, tileZ: number }[]} blockers
 * @property {{ tileX: number, tileZ: number }[]} itemSpawns
 * @property {number} usedSeed  the seed that passed the connectivity check
 */

/**
 * @param {number} _seed
 * @param {any} _mapgen normalized data/mapgen.json
 * @returns {MapLayout}
 */
export function generateMap(_seed, _mapgen) {
  throw new Error('generateMap: not implemented yet (milestone M1)');
}
