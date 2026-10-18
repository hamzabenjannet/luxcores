// @ts-check
/**
 * Deterministic eight-neighbor A* over the map's tile grid.
 */

import { KIND } from '../state.js';

const DIRECTIONS = Object.freeze([
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
]);
const STRAIGHT_COST = 1000;
const DIAGONAL_COST = 1414;

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} blocked
 * @param {number} start
 * @param {number} goal
 * @returns {number[]}
 */
export function findPath(width, height, blocked, start, goal) {
  const count = width * height;
  if (start < 0 || start >= count || goal < 0 || goal >= count || blocked[goal]) return [];
  if (start === goal) return [start];

  const costs = new Int32Array(count);
  costs.fill(0x7fffffff);
  const parents = new Int32Array(count);
  parents.fill(-1);
  const closed = new Uint8Array(count);
  /** @type {{index:number, score:number}[]} */
  const heap = [];
  costs[start] = 0;
  heapPush(heap, { index: start, score: heuristic(width, start, goal) });

  while (heap.length > 0) {
    const current = heapPop(heap);
    if (closed[current.index]) continue;
    if (current.index === goal) return reconstruct(parents, start, goal);
    closed[current.index] = 1;
    const x = current.index % width;
    const z = Math.floor(current.index / width);
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const [dx, dz] = DIRECTIONS[direction];
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
      const next = nz * width + nx;
      if (blocked[next] || closed[next]) continue;
      if (direction >= 4 && (blocked[z * width + nx] || blocked[nz * width + x])) continue;
      const nextCost = costs[current.index] + (direction < 4 ? STRAIGHT_COST : DIAGONAL_COST);
      if (nextCost >= costs[next]) continue;
      costs[next] = nextCost;
      parents[next] = current.index;
      heapPush(heap, { index: next, score: nextCost + heuristic(width, next, goal) });
    }
  }
  return [];
}

/**
 * @param {import('../state.js').SimState} state
 * @returns {Uint8Array}
 */
export function buildBlockedGrid(state) {
  const { width, height } = state.map;
  const blocked = new Uint8Array(width * height);
  for (const entity of state.entities) {
    if (entity.kind > KIND.BLOCKER || entity.hp <= 0) continue;
    const x = Math.floor(entity.x / 1000);
    const z = Math.floor(entity.z / 1000);
    if (x >= 0 && x < width && z >= 0 && z < height) blocked[z * width + x] = 1;
  }
  return blocked;
}

/**
 * @param {number[]} parents
 * @param {number} start
 * @param {number} goal
 */
function reconstruct(parents, start, goal) {
  const path = [goal];
  while (path[path.length - 1] !== start) {
    const previous = parents[path[path.length - 1]];
    if (previous < 0) return [];
    path.push(previous);
  }
  path.reverse();
  return path;
}

/**
 * @param {number} width
 * @param {number} from
 * @param {number} to
 */
function heuristic(width, from, to) {
  const dx = Math.abs((from % width) - (to % width));
  const dz = Math.abs(Math.floor(from / width) - Math.floor(to / width));
  const diagonal = Math.min(dx, dz);
  return diagonal * DIAGONAL_COST + (Math.max(dx, dz) - diagonal) * STRAIGHT_COST;
}

/**
 * @param {{index:number, score:number}[]} heap
 * @param {{index:number, score:number}} value
 */
function heapPush(heap, value) {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compare(heap[parent], value) <= 0) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = value;
}

/** @param {{index:number, score:number}[]} heap */
function heapPop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length > 0 && last) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= heap.length) break;
      const child = right < heap.length && compare(heap[right], heap[left]) < 0 ? right : left;
      if (compare(heap[child], last) >= 0) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
  }
  return first;
}

/**
 * @param {{index:number, score:number}} a
 * @param {{index:number, score:number}} b
 */
function compare(a, b) {
  return a.score - b.score || a.index - b.index;
}
