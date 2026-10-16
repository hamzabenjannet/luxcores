// @ts-check
/**
 * Integer math helpers for the deterministic simulation.
 *
 * Every value in the sim is an integer held in a JS number. Integers are
 * exact in IEEE 754 doubles up to 2^53, so the domain of every helper here
 * is |x| < 2^53 (Number.MAX_SAFE_INTEGER).
 *
 * Port note (Rust): these map to i64 arithmetic. `idiv` truncates toward
 * zero, same as Rust's `/` on signed integers.
 */

import { SIN_TABLE, SIN_SCALE } from './sin-table.js';

/** Units per tile. Positions and distances are stored in units. */
export const UNITS_PER_TILE = 1000;
/** Milli-lux per lux. All lux amounts in the sim are milli-lux. */
export const MILLI = 1000;
/** Angle units per full turn. */
export const ANGLE_TURN = 4096;
/** Sim ticks per second. */
export const TICK_HZ = 20;

/**
 * Integer division truncated toward zero.
 * `Math.trunc(a / b)` alone can be off by one when the float quotient
 * rounds across an integer boundary for large operands, so the result is
 * corrected from the exact remainder.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function idiv(a, b) {
  if (b === 0) throw new RangeError('idiv: division by zero');
  let q = Math.trunc(a / b);
  const r = a - q * b;
  // Remainder must have the sign of `a` (or be 0) and |r| < |b|.
  if (r !== 0 && Math.sign(r) !== Math.sign(a)) q += Math.sign(a) * Math.sign(b) * -1;
  else if (Math.abs(r) >= Math.abs(b)) q += Math.sign(a) * Math.sign(b);
  return q === 0 ? 0 : q; // normalise -0
}

/**
 * Remainder matching `idiv` (sign of the dividend), like Rust `%`.
 * @param {number} a
 * @param {number} b
 */
export function imod(a, b) {
  const r = a - idiv(a, b) * b;
  return r === 0 ? 0 : r;
}

/**
 * Floor of the square root of a non-negative integer.
 * @param {number} n
 * @returns {number}
 */
export function isqrt(n) {
  if (n < 0) throw new RangeError('isqrt: negative input');
  if (n < 2) return n;
  // Float guess, then exact integer correction (r*r stays below 2^53).
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/**
 * Wrap an angle into [0, ANGLE_TURN).
 * @param {number} a
 */
export function wrapAngle(a) {
  const m = imod(a, ANGLE_TURN);
  return m < 0 ? m + ANGLE_TURN : m;
}

/**
 * Sine of an integer angle, scaled by SIN_SCALE (65536).
 * @param {number} angle angle units, any integer
 */
export function isin(angle) {
  return SIN_TABLE[wrapAngle(angle)];
}

/**
 * Cosine of an integer angle, scaled by SIN_SCALE.
 * @param {number} angle
 */
export function icos(angle) {
  return SIN_TABLE[wrapAngle(angle + ANGLE_TURN / 4)];
}

export { SIN_SCALE };

/**
 * Squared distance between two points in units.
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz
 */
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/**
 * Integer percentage of a value, truncated toward zero.
 * @param {number} value
 * @param {number} pct integer percent
 */
export function pctOf(value, pct) {
  return idiv(value * pct, 100);
}

/**
 * Throws if a value is not a safe integer. Used by the hash in debug builds
 * and by tests to catch floats leaking into sim state.
 * @param {unknown} v
 * @param {string} where
 */
export function assertInt(v, where) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new TypeError(`non-integer value in sim state at ${where}: ${String(v)}`);
  }
}
