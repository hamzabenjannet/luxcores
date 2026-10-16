// @ts-check
/**
 * Seeded PRNG (Mulberry32). Its state lives inside sim state so snapshots
 * and replays restore it exactly.
 *
 * Only 32-bit integer ops are used (Math.imul, shifts, xor), which map to
 * Rust u32 with wrapping_mul / wrapping_add.
 */

/**
 * @typedef {{ s: number }} RngState  32-bit unsigned state
 */

/**
 * @param {number} seed any integer; reduced to uint32
 * @returns {RngState}
 */
export function createRng(seed) {
  return { s: seed >>> 0 };
}

/**
 * Next uint32 in [0, 2^32).
 * @param {RngState} rng
 * @returns {number}
 */
export function nextU32(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/**
 * Uniform integer in [0, n), n >= 1 and n <= 2^32.
 * Uses rejection sampling so the result has no modulo bias.
 * @param {RngState} rng
 * @param {number} n
 */
export function nextInt(rng, n) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError('nextInt: bad bound');
  const limit = 0x100000000 - (0x100000000 % n);
  let v;
  do v = nextU32(rng);
  while (v >= limit);
  return v % n;
}

/**
 * Integer in [min, max] inclusive.
 * @param {RngState} rng
 * @param {number} min
 * @param {number} max
 */
export function nextRange(rng, min, max) {
  return min + nextInt(rng, max - min + 1);
}

/**
 * True with probability pct / 100 (integer percent).
 * @param {RngState} rng
 * @param {number} pct
 */
export function chancePct(rng, pct) {
  return nextInt(rng, 100) < pct;
}
