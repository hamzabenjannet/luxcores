// @ts-check
/**
 * Seeded procedural map generation. GDD section 10.
 *
 * Contract:
 *   generateMap(seed, mapgenConfig) -> MapLayout
 *   - pure: same seed + config => identical layout on every runtime
 *   - uses its own RNG derived from the match seed, so map generation never
 *     shifts the gameplay RNG stream (state.rng)
 *   - generates the player half (team 0, bottom), then point-mirrors through
 *     the map center onto team 1: tile (x, z) -> (W - 1 - x, H - 1 - z)
 *   - when a flood fill finds a lane that does not connect the two Cores,
 *     or an element cannot be placed, it reruns with seed + 1, + 2, ...
 *     (at most `maxSeedAttempts` times) and reports the seed that passed
 *
 * Grid (tiles): 96 wide x 112 tall, rows top to bottom 32 / 16 / 16 / 16 / 32.
 * Team 1 (enemy, red by default) is the top half, team 0 the bottom half.
 *
 * Fixed orders (part of the spec, they decide the RNG draw sequence):
 *   1. lane jitter: left, mid, right; inner control points in path order
 *   2. vents, then blockers (left, mid, right column, 2 each), then item spawns
 *   3. every placement try draws x first, then z
 *
 * Distances ("within N tiles") are Chebyshev: max(|dx|, |dz|) <= N.
 */

import { createRng, nextInt, nextRange } from './rng.js';
import { idiv, assertInt } from './fixed.js';

/** Lane names in fixed order. A lane's index is also its column index. */
const LANES = /** @type {const} */ (['left', 'mid', 'right']);

/** XORed into the match seed so the map stream differs from state.rng. */
const MAP_SEED_SALT = 0x9e3779b9;

/**
 * @typedef {'left'|'mid'|'right'} LaneName
 * @typedef {{ team: number, tileX: number, tileZ: number }} TilePos
 */

/**
 * @typedef {Object} MapLayout
 * @property {number} width   tiles
 * @property {number} height  tiles
 * @property {number} usedSeed  the seed that passed the connectivity check
 * @property {TilePos[]} cores  index = team
 * @property {{ team: number, lane: LaneName, points: number[][], tiles: number[] }[]} lanes
 *   team 0 left, mid, right, then team 1 left, mid, right. `points` are
 *   control points in tiles, Core first. `tiles` are tile indices
 *   (z * width + x), unique and ascending.
 * @property {TilePos[]} vents  team 0 in placement order, then team 1 mirrored
 * @property {TilePos[]} blockers  same order rule as vents
 * @property {TilePos[]} itemSpawns  same order rule as vents
 */

/**
 * Integer Bresenham line, both end points included.
 * @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1
 * @param {(x: number, z: number) => void} plot
 */
function line(x0, z0, x1, z1, plot) {
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  for (;;) {
    plot(x0, z0);
    if (x0 === x1 && z0 === z1) return;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
}

/**
 * Tiles of a polyline widened to `width`, as ascending unique tile indices.
 * @param {number[][]} points
 * @param {number} width lane width in tiles
 * @param {number} W @param {number} H
 * @param {Uint8Array} scratch W * H zeros on entry, zeros again on exit
 * @returns {number[]}
 */
function rasterize(points, width, W, H, scratch) {
  const lo = -idiv(width - 1, 2);
  const hi = lo + width - 1;
  /** @type {number[]} */
  const touched = [];
  const stamp = (/** @type {number} */ px, /** @type {number} */ pz) => {
    for (let dz = lo; dz <= hi; dz++) {
      for (let dx = lo; dx <= hi; dx++) {
        const x = px + dx;
        const z = pz + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const i = z * W + x;
        if (scratch[i] === 0) { scratch[i] = 1; touched.push(i); }
      }
    }
  };
  for (let i = 0; i + 1 < points.length; i++) {
    line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], stamp);
  }
  touched.sort((a, b) => a - b);
  for (const i of touched) scratch[i] = 0;
  return touched;
}

/**
 * Inclusive z range of the rows that satisfy `pick`, in tiles.
 * @param {{ name: string, team: number, height: number }[]} rows top to bottom
 * @param {(row: { name: string, team: number }) => boolean} pick
 * @returns {{ z0: number, z1: number }}
 */
function rowSpan(rows, pick) {
  let z = 0;
  let z0 = -1;
  let z1 = -1;
  for (const row of rows) {
    if (pick(row)) {
      if (z0 < 0) z0 = z;
      z1 = z + row.height - 1;
    }
    z += row.height;
  }
  if (z0 < 0) throw new Error('mapgen: no row matches');
  return { z0, z1 };
}

/**
 * Jittered control points of one team 0 lane.
 * @param {import('./rng.js').RngState} rng
 * @param {any} mapgen
 * @param {number} laneIndex
 * @returns {number[][]}
 */
function jitterLane(rng, mapgen, laneIndex) {
  const { lanes, columnWidth, rows } = mapgen;
  const template = lanes[LANES[laneIndex]];
  const coreRowZ = rowSpan(rows, (r) => r.name === 'core' && r.team === 0).z0;
  // Keep the whole stamped width inside the column.
  const lo = -idiv(lanes.laneWidth - 1, 2);
  const hi = lo + lanes.laneWidth - 1;
  const minX = laneIndex * columnWidth - lo;
  const maxX = laneIndex * columnWidth + columnWidth - 1 - hi;
  return template.map((/** @type {number[]} */ p, /** @type {number} */ i) => {
    if (i === 0 || i === template.length - 1) return [p[0], p[1]]; // Core and DMZ edge stay put
    let x = p[0] + nextRange(rng, -lanes.jitter, lanes.jitter);
    if (p[1] < coreRowZ) x = Math.min(maxX, Math.max(minX, x)); // own column outside the Core row
    return [x, p[1]];
  });
}

/**
 * Everything one placement try is checked against.
 * @typedef {Object} PlaceCtx
 * @property {number} W @property {number} H
 * @property {Uint8Array} laneMask  lane tiles of both teams
 * @property {number} fromLane @property {number} fromCore
 * @property {number} between @property {number} relaxStep @property {number} maxTries
 * @property {number[]} core  [x, z] of team 0
 * @property {number[][]} placed  tiles placed so far for team 0
 */

/**
 * @param {PlaceCtx} c
 * @param {number} x @param {number} z
 * @param {number} between
 */
function isFree(c, x, z, between) {
  const mx = c.W - 1 - x; // the mirror image of the candidate
  const mz = c.H - 1 - z;
  if (Math.max(Math.abs(x - c.core[0]), Math.abs(z - c.core[1])) <= c.fromCore) return false;
  if (Math.max(Math.abs(mx - c.core[0]), Math.abs(mz - c.core[1])) <= c.fromCore) return false;
  const f = c.fromLane;
  for (let dz = -f; dz <= f; dz++) {
    for (let dx = -f; dx <= f; dx++) {
      const px = x + dx;
      const pz = z + dz;
      if (px >= 0 && pz >= 0 && px < c.W && pz < c.H && c.laneMask[pz * c.W + px] === 1) return false;
    }
  }
  for (const p of c.placed) {
    if (Math.max(Math.abs(x - p[0]), Math.abs(z - p[1])) < between) return false;
    if (Math.max(Math.abs(mx - p[0]), Math.abs(mz - p[1])) < between) return false;
  }
  return true;
}

/**
 * Draw tiles until one passes. After `maxTries` failures the `between`
 * spacing shrinks by `relaxStep` (never below 1) and the tries restart.
 * @param {import('./rng.js').RngState} rng
 * @param {PlaceCtx} c
 * @param {{ x0: number, x1: number, z0: number, z1: number }} rect inclusive
 * @returns {number[] | null}
 */
function place(rng, c, rect) {
  for (let between = c.between; between >= 1; between -= c.relaxStep) {
    for (let t = 0; t < c.maxTries; t++) {
      const x = rect.x0 + nextInt(rng, rect.x1 - rect.x0 + 1);
      const z = rect.z0 + nextInt(rng, rect.z1 - rect.z0 + 1);
      if (isFree(c, x, z, between)) {
        const tile = [x, z];
        c.placed.push(tile);
        return tile;
      }
    }
  }
  return null;
}

/**
 * One generation attempt from one seed. Returns null if an element cannot
 * be placed.
 * @param {number} seed
 * @param {any} mapgen
 * @returns {MapLayout | null}
 */
function attempt(seed, mapgen) {
  const W = mapgen.width;
  const H = mapgen.height;
  const cw = mapgen.columnWidth;
  const rng = createRng((seed ^ MAP_SEED_SALT) >>> 0);
  const scratch = new Uint8Array(W * H);
  const mirrorIndex = (/** @type {number} */ i) => W * H - 1 - i;
  const mirrorPoint = (/** @type {number[]} */ p) => [W - 1 - p[0], H - 1 - p[1]];

  // 1. Lanes: team 0, then the point mirror.
  const laneMask = new Uint8Array(W * H);
  /** @type {MapLayout['lanes']} */
  const lanes = [];
  for (let l = 0; l < LANES.length; l++) {
    const points = jitterLane(rng, mapgen, l);
    const tiles = rasterize(points, mapgen.lanes.laneWidth, W, H, scratch);
    lanes.push({ team: 0, lane: LANES[l], points, tiles });
    for (const i of tiles) { laneMask[i] = 1; laneMask[mirrorIndex(i)] = 1; }
  }
  for (let l = 0; l < LANES.length; l++) {
    const src = lanes[l];
    // Reversing the mirrored indices keeps them ascending.
    lanes.push({
      team: 1,
      lane: src.lane,
      points: src.points.map(mirrorPoint),
      tiles: src.tiles.map(mirrorIndex).reverse(),
    });
  }

  // 2. Elements on team 0's half.
  const core0 = mapgen.cores[0];
  const sp = mapgen.spacing;
  /** @type {PlaceCtx} */
  const ctx = {
    W, H, laneMask,
    fromLane: sp.fromLane, fromCore: sp.fromCore,
    between: sp.between, relaxStep: sp.relaxStep, maxTries: sp.maxTriesPerElement,
    core: [core0.tileX, core0.tileZ],
    placed: [],
  };
  const build = rowSpan(mapgen.rows, (r) => r.team === 0);
  const dmz = rowSpan(mapgen.rows, (r) => r.name === mapgen.itemSpawnRow);
  const columnRect = (/** @type {number} */ col, /** @type {number} */ z0, /** @type {number} */ z1) =>
    ({ x0: col * cw, x1: col * cw + cw - 1, z0, z1 });

  /** @type {number[][]} */ const vents = [];
  /** @type {number[][]} */ const blockers = [];
  /** @type {number[][]} */ const itemSpawns = [];

  const freeColumns = [0, 1, 2];
  if (mapgen.counts.ventsPerTeam > freeColumns.length) throw new RangeError('mapgen: more vents than columns');
  for (let v = 0; v < mapgen.counts.ventsPerTeam; v++) {
    const col = freeColumns.splice(nextInt(rng, freeColumns.length), 1)[0];
    const tile = place(rng, ctx, columnRect(col, build.z0, build.z1));
    if (!tile) return null;
    vents.push(tile);
  }
  for (let col = 0; col < LANES.length; col++) {
    for (let b = 0; b < mapgen.counts.blockersPerColumnPerTeam; b++) {
      const tile = place(rng, ctx, columnRect(col, build.z0, build.z1));
      if (!tile) return null;
      blockers.push(tile);
    }
  }
  if (mapgen.counts.itemSpawnsPerTeam !== mapgen.itemSpawnColumns.length) {
    throw new RangeError('mapgen: itemSpawnsPerTeam must equal the number of itemSpawnColumns');
  }
  // The DMZ is shared, so team 0 only uses its own half of the rows.
  const half = idiv(H, 2);
  for (const name of mapgen.itemSpawnColumns) {
    const tile = place(rng, ctx, columnRect(LANES.indexOf(name), Math.max(dmz.z0, half), dmz.z1));
    if (!tile) return null;
    itemSpawns.push(tile);
  }

  // 3. Mirror onto team 1.
  const both = (/** @type {number[][]} */ list) => [
    ...list.map((p) => ({ team: 0, tileX: p[0], tileZ: p[1] })),
    ...list.map((p) => ({ team: 1, tileX: W - 1 - p[0], tileZ: H - 1 - p[1] })),
  ];
  return {
    width: W,
    height: H,
    usedSeed: seed,
    cores: [
      { team: 0, tileX: core0.tileX, tileZ: core0.tileZ },
      { team: 1, tileX: W - 1 - core0.tileX, tileZ: H - 1 - core0.tileZ },
    ],
    lanes,
    vents: both(vents),
    blockers: both(blockers),
    itemSpawns: both(itemSpawns),
  };
}

/**
 * Flood fill from Core 0 over walkable tiles, neighbors in the fixed order
 * N, E, S, W. A tile is walkable if it is on the grid and holds no blocker
 * and no Core. The layout passes when Core 1 touches a reached tile and
 * every lane tile is reached. Both Core tiles are exempt.
 * @param {MapLayout} layout
 * @returns {boolean}
 */
export function isConnected(layout) {
  const W = layout.width;
  const H = layout.height;
  const blocked = new Uint8Array(W * H);
  const exempt = new Uint8Array(W * H);
  for (const b of layout.blockers) blocked[b.tileZ * W + b.tileX] = 1;
  for (const c of layout.cores) { blocked[c.tileZ * W + c.tileX] = 1; exempt[c.tileZ * W + c.tileX] = 1; }

  const DX = [0, 1, 0, -1]; // N, E, S, W
  const DZ = [-1, 0, 1, 0];
  const seen = new Uint8Array(W * H);
  const start = layout.cores[0].tileZ * W + layout.cores[0].tileX;
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % W;
    const z = idiv(i, W);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const n = nz * W + nx;
      if (seen[n] === 0 && blocked[n] === 0) { seen[n] = 1; queue.push(n); }
    }
  }

  const c1 = layout.cores[1];
  let coreTouched = false;
  for (let d = 0; d < 4; d++) {
    const nx = c1.tileX + DX[d];
    const nz = c1.tileZ + DZ[d];
    if (nx >= 0 && nz >= 0 && nx < W && nz < H && seen[nz * W + nx] === 1) coreTouched = true;
  }
  if (!coreTouched) return false;
  for (const lane of layout.lanes) {
    for (const i of lane.tiles) if (seen[i] === 0 && exempt[i] === 0) return false;
  }
  return true;
}

/**
 * @param {number} seed integer match seed
 * @param {any} mapgen normalized data/mapgen.json
 * @returns {MapLayout}
 */
export function generateMap(seed, mapgen) {
  assertInt(seed, 'generateMap seed');
  if (mapgen.spacing.relaxStep < 1 || mapgen.spacing.between < 1) {
    throw new RangeError('mapgen: spacing.between and spacing.relaxStep must be at least 1');
  }
  for (let i = 0; i < mapgen.maxSeedAttempts; i++) {
    const layout = attempt(seed + i, mapgen);
    if (layout && isConnected(layout)) return layout;
  }
  throw new Error(`mapgen: no valid layout within ${mapgen.maxSeedAttempts} seeds from ${seed}`);
}
