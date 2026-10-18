import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelRatioFor, TOUCH_PIXEL_RATIO_CAP } from '../src/client/render/pixel-ratio.js';

test('a desktop screen renders at its full pixel ratio', () => {
  for (const ratio of [1, 1.25, 1.5, 2, 3]) assert.equal(pixelRatioFor(ratio, false), ratio);
});

test('a touch device is capped, and a lower ratio is kept', () => {
  assert.equal(TOUCH_PIXEL_RATIO_CAP, 2);
  assert.equal(pixelRatioFor(3, true), 2);
  assert.equal(pixelRatioFor(2, true), 2);
  assert.equal(pixelRatioFor(1.5, true), 1.5);
});

test('a missing or broken ratio falls back to 1', () => {
  for (const bad of [0, -2, NaN, Infinity, 0.5]) assert.equal(pixelRatioFor(bad, false), 1, String(bad));
});
