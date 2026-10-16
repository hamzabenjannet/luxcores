import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idiv, imod, isqrt, isin, icos, SIN_SCALE, ANGLE_TURN, wrapAngle, pctOf } from '../src/sim/fixed.js';

test('idiv truncates toward zero like Rust i64 division', () => {
  const cases = [
    [7, 2, 3], [-7, 2, -3], [7, -2, -3], [-7, -2, 3],
    [0, 5, 0], [1, 3, 0], [-1, 3, 0], [6, 3, 2],
    [Number.MAX_SAFE_INTEGER, 3, 3002399751580330],
    [-Number.MAX_SAFE_INTEGER, 7, -1286742750677284],
  ];
  for (const [a, b, q] of cases) assert.equal(idiv(a, b), q, `${a} / ${b}`);
  assert.ok(!Object.is(idiv(-1, 3), -0), 'no negative zero');
  assert.throws(() => idiv(1, 0));
});

test('idiv agrees with BigInt division on large operands', () => {
  let x = 123456789;
  for (let i = 0; i < 2000; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const a = (x * 4194301) % Number.MAX_SAFE_INTEGER * (i % 2 ? 1 : -1);
    const b = (x % 99991) + 1;
    assert.equal(idiv(a, b), Number(BigInt(a) / BigInt(b)), `${a} / ${b}`);
    assert.equal(imod(a, b), Number(BigInt(a) % BigInt(b)), `${a} % ${b}`);
  }
});

test('isqrt is the exact floor square root', () => {
  for (let n = 0; n < 5000; n++) {
    const r = isqrt(n);
    assert.ok(r * r <= n && (r + 1) * (r + 1) > n, `isqrt(${n}) = ${r}`);
  }
  const big = 2 ** 52 + 12345;
  const r = isqrt(big);
  assert.ok(r * r <= big && (r + 1) * (r + 1) > big);
});

test('trig table: exact quarter turns, wrap and cos phase', () => {
  assert.equal(isin(0), 0);
  assert.equal(isin(ANGLE_TURN / 4), SIN_SCALE);
  assert.equal(isin(ANGLE_TURN / 2), 0);
  assert.equal(isin((3 * ANGLE_TURN) / 4), -SIN_SCALE);
  assert.equal(icos(0), SIN_SCALE);
  assert.equal(isin(-1), isin(ANGLE_TURN - 1));
  assert.equal(wrapAngle(-ANGLE_TURN - 5), ANGLE_TURN - 5);
  for (let a = 0; a < ANGLE_TURN; a += 37) {
    assert.ok(Number.isInteger(isin(a)));
    assert.ok(Math.abs(isin(a)) <= SIN_SCALE);
  }
});

test('pctOf truncates', () => {
  assert.equal(pctOf(15999, 60), 9599);
  assert.equal(pctOf(-15999, 60), -9599);
});
