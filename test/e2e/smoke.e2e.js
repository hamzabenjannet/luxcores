// Browser smoke tests, against a throwaway backend (see helpers/backend.js).
//
// 1. Determinism: determinism.html plays the sim inside Chromium, and its final
//    state hash must equal the hash Node computes. A mismatch means the sim, or
//    the bot, diverged between engines (P0). Golden replay bots-seed-777 pins
//    the bot run.
// 2. The game page loads from the backend, shows the start menu, and logs no
//    console or page error.
//
// Run: (cd backend/nodejs && npm install && npm run build)   once
//      npm run test:e2e

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/load-data.js';
import { SEED, SHOTS, referenceHash, skip, withBackend } from './helpers/backend.js';

/** Reads the JSON the determinism page prints. */
async function determinism(/** @type {import('playwright-core').Page} */ page) {
  await page.waitForFunction(() => document.getElementById('result')?.dataset.done, null, { timeout: 90_000 });
  const text = await page.evaluate(() => document.getElementById('result')?.textContent ?? '');
  assert.ok(text.startsWith('{'), `the determinism page failed: ${text}`);
  return JSON.parse(text);
}

test('Chromium and Node agree on the sim hash, with idle players and with two bots', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ plain, errors }) => {
    const idle = await determinism(await plain(`/determinism.html?seed=${SEED}&ticks=120`));
    assert.equal(idle.hash, referenceHash(120), 'P0: the idle sim diverged between Node and Chromium');

    // Two bots build and upgrade for 4 000 ticks. The golden replay holds the hash the Node bot reached.
    const golden = JSON.parse(readFileSync(join(ROOT, 'replays', 'golden', 'bots-seed-777.json'), 'utf8'));
    const bots = await determinism(await plain(`/determinism.html?seed=${golden.seed}&ticks=${golden.ticks}&bots=1`));
    assert.equal(bots.ticks, golden.ticks);
    assert.equal(bots.hash, golden.hashes[String(golden.ticks)], 'P0: the bots diverged between Node and Chromium');
    assert.deepEqual(errors, []);
    console.log(`Chromium matches Node: idle ${idle.hash} at tick 120, bots ${bots.hash} at tick ${bots.ticks}`);
  });
});

test('the game page loads from the backend and offers the start menu', { timeout: 120_000, skip }, async () => {
  await withBackend(async ({ plain, errors }) => {
    const page = await plain('/');
    await page.waitForSelector('#menu .card button', { timeout: 30_000 });
    const buttons = await page.$$eval('#menu .card button', (b) => b.map((x) => x.textContent));
    assert.deepEqual(buttons, ['Play Against Bot', 'Watch Bot Against Bot', 'Host a Match for Two', 'Join Match']);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'menu.png') });
    assert.deepEqual(errors, [], 'the page must log no console or page errors');
  });
});
