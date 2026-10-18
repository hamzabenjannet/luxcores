// @ts-check
/**
 * Integer ground-plane physics with a two-tile spatial grid.
 */

import { dist2, idiv, isqrt } from '../fixed.js';

const CELL_SIZE = 2000;
const HALF_TILE = 500;
const OVERLAP_PASSES = 4;

/**
 * @typedef {Object} Body
 * @property {number} id
 * @property {number} x
 * @property {number} z
 * @property {number} radius
 * @property {number} mass
 * @property {boolean} isStatic
 * @property {'circle'|'square'} shape
 * @property {number} vx
 * @property {number} vz
 * @property {number} ix
 * @property {number} iz
 */

/** @returns {import('./physics-world.js').PhysicsWorld} */
export function createGrid2DPhysics() {
  /** @type {Body[]} */
  const bodies = [];
  return {
    addBody(id, x, z, radius, mass, isStatic, shape = 'circle') {
      const existing = bodyIndex(bodies, id);
      const body = { id, x, z, radius, mass, isStatic, shape, vx: 0, vz: 0, ix: 0, iz: 0 };
      if (existing >= 0) bodies[existing] = body;
      else {
        let index = 0;
        while (index < bodies.length && bodies[index].id < id) index++;
        bodies.splice(index, 0, body);
      }
    },
    removeBody(id) {
      const index = bodyIndex(bodies, id);
      if (index >= 0) bodies.splice(index, 1);
    },
    setDesiredVelocity(id, vx, vz) {
      const body = getBody(bodies, id);
      body.vx = vx;
      body.vz = vz;
    },
    applyImpulse(id, ix, iz) {
      const body = getBody(bodies, id);
      body.ix += ix;
      body.iz += iz;
    },
    step() {
      for (const body of bodies) {
        if (body.isStatic) continue;
        body.x += body.vx + body.ix;
        body.z += body.vz + body.iz;
      }
      for (let pass = 0; pass < OVERLAP_PASSES; pass++) resolveOverlaps(bodies);
    },
    getPosition(id) {
      const body = getBody(bodies, id);
      return { x: body.x, z: body.z };
    },
    queryRadius(x, z, radius) {
      const result = [];
      for (const body of bodies) {
        const bound = body.shape === 'square' ? body.radius + HALF_TILE : body.radius;
        if (dist2(x, z, body.x, body.z) <= (radius + bound) * (radius + bound)) result.push(body.id);
      }
      return result;
    },
  };
}

/** @param {Body[]} bodies */
function resolveOverlaps(bodies) {
  if (bodies.length === 0) return;
  let minX = bodies[0].x;
  let minZ = bodies[0].z;
  let maxX = bodies[0].x;
  let maxZ = bodies[0].z;
  for (const body of bodies) {
    minX = Math.min(minX, body.x);
    minZ = Math.min(minZ, body.z);
    maxX = Math.max(maxX, body.x);
    maxZ = Math.max(maxZ, body.z);
  }
  minX -= CELL_SIZE;
  minZ -= CELL_SIZE;
  const cellsWide = Math.max(1, Math.ceil((maxX - minX + CELL_SIZE) / CELL_SIZE));
  const cellsHigh = Math.max(1, Math.ceil((maxZ - minZ + CELL_SIZE) / CELL_SIZE));
  /** @type {number[][]} */
  const cells = Array.from({ length: cellsWide * cellsHigh }, () => []);
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const cx = Math.floor((body.x - minX) / CELL_SIZE);
    const cz = Math.floor((body.z - minZ) / CELL_SIZE);
    cells[cz * cellsWide + cx].push(i);
  }

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    if (body.isStatic) continue;
    const cx = Math.floor((body.x - minX) / CELL_SIZE);
    const cz = Math.floor((body.z - minZ) / CELL_SIZE);
    for (let z = Math.max(0, cz - 1); z <= Math.min(cellsHigh - 1, cz + 1); z++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(cellsWide - 1, cx + 1); x++) {
        for (const j of cells[z * cellsWide + x]) {
          if (j <= i) continue;
          resolvePair(body, bodies[j]);
        }
      }
    }
  }
}

/**
 * @param {Body} a
 * @param {Body} b
 */
function resolvePair(a, b) {
  if (a.isStatic && b.isStatic) return;
  if (a.shape === 'square' && b.shape === 'square') return;
  if (a.shape === 'square') {
    resolveCircleSquare(b, a);
    return;
  }
  if (b.shape === 'square') {
    resolveCircleSquare(a, b);
    return;
  }

  let dx = b.x - a.x;
  let dz = b.z - a.z;
  let distance2 = dx * dx + dz * dz;
  const combinedRadius = a.radius + b.radius;
  if (distance2 >= combinedRadius * combinedRadius) return;
  const coincident = distance2 === 0;
  if (coincident) {
    dx = a.id < b.id ? 1 : -1;
    dz = 0;
    distance2 = 1;
  }
  const distance = coincident ? 0 : isqrt(distance2);
  const divisor = coincident ? 1 : distance;
  const overlap = combinedRadius - distance;
  const moveA = a.isStatic ? 0 : b.isStatic ? overlap : idiv(overlap * b.mass, a.mass + b.mass);
  const moveB = b.isStatic ? 0 : overlap - moveA;
  if (moveA > 0) {
    a.x -= idiv(dx * moveA, divisor);
    a.z -= idiv(dz * moveA, divisor);
  }
  if (moveB > 0) {
    b.x += idiv(dx * moveB, divisor);
    b.z += idiv(dz * moveB, divisor);
  }
}

/**
 * @param {Body} circle
 * @param {Body} square
 */
function resolveCircleSquare(circle, square) {
  const minX = square.x - HALF_TILE;
  const maxX = square.x + HALF_TILE;
  const minZ = square.z - HALF_TILE;
  const maxZ = square.z + HALF_TILE;
  const closestX = Math.max(minX, Math.min(maxX, circle.x));
  const closestZ = Math.max(minZ, Math.min(maxZ, circle.z));
  let dx = circle.x - closestX;
  let dz = circle.z - closestZ;
  let distance2 = dx * dx + dz * dz;
  let overlap;

  if (distance2 === 0) {
    const left = circle.x - minX;
    const right = maxX - circle.x;
    const top = circle.z - minZ;
    const bottom = maxZ - circle.z;
    const nearest = Math.min(left, right, top, bottom);
    if (nearest === left) { dx = -1; dz = 0; }
    else if (nearest === right) { dx = 1; dz = 0; }
    else if (nearest === top) { dx = 0; dz = -1; }
    else { dx = 0; dz = 1; }
    overlap = circle.radius + nearest;
    circle.x += dx * overlap;
    circle.z += dz * overlap;
    return;
  }
  if (distance2 >= circle.radius * circle.radius) return;
  const distance = isqrt(distance2);
  overlap = circle.radius - distance;
  circle.x += idiv(dx * overlap, distance);
  circle.z += idiv(dz * overlap, distance);
}

/**
 * @param {Body[]} bodies
 * @param {number} id
 */
function bodyIndex(bodies, id) {
  let low = 0;
  let high = bodies.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (bodies[mid].id === id) return mid;
    if (bodies[mid].id < id) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/**
 * @param {Body[]} bodies
 * @param {number} id
 */
function getBody(bodies, id) {
  const index = bodyIndex(bodies, id);
  if (index < 0) throw new RangeError(`unknown physics body ${id}`);
  return bodies[index];
}
