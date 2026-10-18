import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInterpolator } from '../src/client/render/interpolation.js';

const TICK_MS = 50;
const snap = (tick, ...entities) => ({ tick, entities });

test('with one snapshot, the interpolator shows it as it is', () => {
  const i = createInterpolator({ tickMs: TICK_MS });
  assert.deepEqual(i.at(0), []);
  i.push(10, [{ id: 1, x: 100, z: 0 }], 1000);
  assert.deepEqual(i.at(1000), [{ id: 1, x: 100, z: 0 }]);
});

test('between two snapshots a unit moves in a straight line, two ticks behind the newest', () => {
  const i = createInterpolator({ tickMs: TICK_MS, delayTicks: 2 });
  i.push(10, [{ id: 1, x: 0, z: 0 }], 1000);
  i.push(12, [{ id: 1, x: 2000, z: 1000 }], 1100);
  // At the arrival of the newer snapshot the render tick is 12 - 2 = 10, so the unit still stands at the old place.
  assert.deepEqual(i.at(1100), [{ id: 1, x: 0, z: 0 }]);
  // 50 ms later the render tick is 11: halfway.
  assert.deepEqual(i.at(1150), [{ id: 1, x: 1000, z: 500 }]);
  // 100 ms later it has arrived, and it stays there when no newer snapshot comes.
  assert.deepEqual(i.at(1200), [{ id: 1, x: 2000, z: 1000 }]);
  assert.deepEqual(i.at(5000), [{ id: 1, x: 2000, z: 1000 }]);
});

test('an entity that is new, gone or unmoved is not blended', () => {
  const i = createInterpolator({ tickMs: TICK_MS });
  i.push(10, [{ id: 1, x: 0, z: 0 }, { id: 2, x: 500, z: 500 }, { id: 3, x: 9, z: 9 }], 1000);
  const staying = { id: 3, x: 9, z: 9 };
  const born = { id: 4, x: 7000, z: 0 };
  i.push(12, [{ id: 1, x: 1000, z: 0 }, staying, born], 1100);
  const out = i.at(1150);
  assert.deepEqual(out.map((e) => e.id), [1, 3, 4], 'the entity that left is gone at once');
  assert.equal(out[1], staying, 'an unmoved entity is passed on without a copy');
  assert.equal(out[2], born, 'a new entity appears where it is');
  assert.equal(out[0].x, 500);
});

test('a jump across the map is a teleport and is not drawn as a glide', () => {
  const i = createInterpolator({ tickMs: TICK_MS, jumpUnits: 6000 });
  i.push(10, [{ id: 1, x: 0, z: 0 }], 1000);
  i.push(12, [{ id: 1, x: 50_000, z: 0 }], 1100);
  assert.equal(i.at(1150)[0].x, 50_000);
});

test('a late packet does not make a unit run backwards, and an old tick is ignored', () => {
  const i = createInterpolator({ tickMs: TICK_MS });
  i.push(10, [{ id: 1, x: 0, z: 0 }], 1000);
  i.push(12, [{ id: 1, x: 2000, z: 0 }], 1100);
  const x = i.at(1180)[0].x;
  i.push(11, [{ id: 1, x: 99_999, z: 0 }], 1190); // out of order: dropped
  i.push(12, [{ id: 1, x: 1, z: 0 }], 1190); // the same tick again: dropped
  assert.equal(i.at(1180)[0].x, x);
  i.push(14, [{ id: 1, x: 4000, z: 0 }], 1300);
  assert.ok(i.at(1300)[0].x >= x - 1e-9, 'it continues from where it was');
});

test('a restart of the match clears the past', () => {
  const i = createInterpolator({ tickMs: TICK_MS });
  i.push(500, [{ id: 1, x: 0, z: 0 }], 1000);
  i.push(502, [{ id: 1, x: 1000, z: 0 }], 1100);
  i.push(2, [{ id: 1, x: 7, z: 7 }], 2000);
  assert.deepEqual(i.at(2000), [{ id: 1, x: 7, z: 7 }]);
});
