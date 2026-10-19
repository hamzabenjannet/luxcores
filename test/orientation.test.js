import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockPortrait } from '../src/client/orientation.js';

test('the portrait lock takes where the browser allows it and stays quiet where it does not', async () => {
  const calls = [];
  assert.equal(await lockPortrait({ orientation: { lock: async (type) => { calls.push(type); } } }), true);
  assert.deepEqual(calls, ['portrait']);
  assert.equal(await lockPortrait({ orientation: { lock: async () => { throw new DOMException('refused', 'NotSupportedError'); } } }), false);
  assert.equal(await lockPortrait({}), false);
  assert.equal(await lockPortrait({ orientation: {} }), false);
});
