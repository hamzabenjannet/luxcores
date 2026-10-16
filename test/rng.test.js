import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, nextU32, nextInt, chancePct } from '../src/sim/rng.js';

// Reference sequence for seed 1234567. If this test breaks, the RNG changed
// and every golden replay is invalid: bump SPEC_VERSION deliberately.
const SEED = 1234567;

test('same seed gives the same stream', () => {
  const a = createRng(SEED);
  const b = createRng(SEED);
  for (let i = 0; i < 10000; i++) assert.equal(nextU32(a), nextU32(b));
});

test('values are uint32 and the state stays uint32', () => {
  const r = createRng(SEED);
  for (let i = 0; i < 10000; i++) {
    const v = nextU32(r);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 2 ** 32);
    assert.ok(Number.isInteger(r.s) && r.s >= 0 && r.s < 2 ** 32);
  }
});

test('matches the canonical Mulberry32 reference implementation', () => {
  // Reference: the widely published float version, scaled back to uint32.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0);
    };
  }
  const ref = mulberry32(SEED);
  const r = createRng(SEED);
  for (let i = 0; i < 1000; i++) assert.equal(nextU32(r), ref());
});

test('nextInt stays in range and covers it', () => {
  const r = createRng(42);
  const seen = new Array(7).fill(0);
  for (let i = 0; i < 7000; i++) seen[nextInt(r, 7)]++;
  for (const c of seen) assert.ok(c > 800 && c < 1200, `bucket count ${c}`);
});

test('chancePct edges', () => {
  const r = createRng(1);
  for (let i = 0; i < 200; i++) {
    assert.equal(chancePct(r, 0), false);
    assert.equal(chancePct(r, 100), true);
  }
});
