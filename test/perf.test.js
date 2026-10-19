import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW, createPerfMeter, summarize } from '../src/client/perf.js';

test('the frame summary gives fps, the average, the 95th percentile, the worst frame and the page time', () => {
  assert.deepEqual(summarize([], []), { fps: 0, avgMs: 0, p95Ms: 0, maxMs: 0, jsAvgMs: 0 });
  const even = summarize([16, 16, 16, 16], [2, 4, 2, 4]);
  assert.equal(Math.round(even.fps), 63);
  assert.equal(even.avgMs, 16);
  assert.equal(even.jsAvgMs, 3);
  // 19 smooth frames and one 100 ms hitch: the average hides it, the worst frame and the percentile show it.
  const hitch = summarize([...Array(19).fill(16), 100], Array(20).fill(5));
  assert.equal(hitch.maxMs, 100);
  assert.equal(hitch.p95Ms, 100);
  assert.ok(hitch.avgMs < 21);
});

test('the meter ignores its first frame, keeps the last window and writes its numbers twice a second', () => {
  const box = /** @type {any} */ ({ hidden: true, textContent: '' });
  const meter = createPerfMeter(box, () => 'entities 7');
  assert.equal(box.hidden, false);
  let t = 1000;
  for (let i = 0; i < WINDOW + 30; i++) {
    meter.frame(t, 3, { calls: 12, triangles: 3400 });
    t += 20;
  }
  const read = meter.read();
  assert.equal(Math.round(read.fps), 50);
  assert.equal(read.calls, 12);
  assert.match(box.textContent, /^50 fps {2}frame 20\.0 ms \(p95 20\.0, max 20\.0\) {2}js 3\.0 ms\ndraws 12 {2}triangles 3400 {2}entities 7$/);
});
