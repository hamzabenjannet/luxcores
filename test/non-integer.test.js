import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstNonInteger } from '../tools/non-integer.js';

test('the soak check finds a fractional or non-finite value anywhere in a state', () => {
  assert.equal(firstNonInteger({ tick: 5, teams: [{ coreLux: 100000 }], entities: [{ x: 1, z: -3 }] }), null);
  assert.equal(firstNonInteger({ entities: [{ x: 1, z: 2.5 }] }), 'state.entities[0].z = 2.5');
  assert.equal(firstNonInteger({ teams: [{ a: { b: NaN } }] }), 'state.teams[0].a.b = NaN');
  assert.equal(firstNonInteger({ x: Infinity }), 'state.x = Infinity');
  assert.equal(firstNonInteger({ x: 2 ** 60 }), 'state.x = 1152921504606847000');
});
