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

test('Chromium replays every golden replay hash for hash, as a phone will (determinism.html?suite=1)', { timeout: 180_000, skip }, async () => {
  await withBackend(async ({ plain, errors }) => {
    const page = await plain('/determinism.html?suite=1');
    const run = await determinism(page);
    assert.equal(run.ok, true, `P0: a golden replay disagrees in Chromium: ${JSON.stringify(run.results.filter((/** @type {any} */ r) => !r.ok))}`);
    assert.equal(run.results.length, 7);
    assert.match(await page.textContent('#verdict') ?? '', /^PASS: all 7 replays match Node$/);
    assert.deepEqual(errors, []);
    console.log(`Chromium plays ${run.results.length} golden replays at ${run.ticksPerSecond} ticks per second (the game needs 20)`);
  });
});

test('the test hub lists ready-made links and builds a link from the parameters', { timeout: 120_000, skip }, async () => {
  await withBackend(async ({ plain, errors }) => {
    const page = await plain('/tests');
    const url = new URL(page.url()).origin; // the address the browser reached the server at
    await page.waitForSelector('#hub[data-ready="1"]', { timeout: 30_000 });
    // Ready-made links open the right pages on this server.
    const suite = await page.getAttribute('.card:has-text("Determinism suite (for phones)") a.open', 'href');
    assert.equal(suite, `${url}/determinism.html?suite=1`);
    const bot = await page.getAttribute('.card:has-text("Play against the bot") a.open >> nth=0', 'href');
    assert.equal(bot, `${url}/?name=Tester&match=new&vsBot=1&maxTicks=0&autostart=1`);
    assert.ok((await page.locator('.card:has-text("bots-seed-777.json") a').count()) >= 1, 'the golden replays are listed');

    // The form for the game page builds a link from what is set.
    await page.click('summary:has-text("The game")');
    await page.fill('details:has(summary:has-text("The game")) input[placeholder="Tester"]', 'Hala');
    await page.check('details:has(summary:has-text("The game")) label:has-text("Frame meter") input');
    await page.check('details:has(summary:has-text("The game")) label:has-text("Play against a bot") input');
    await page.fill('details:has(summary:has-text("The game")) label:has-text("Map seed") input', '777');
    assert.equal(await page.textContent('details:has(summary:has-text("The game")) code.url'), `${url}/?name=Hala&vsBot=1&seed=777&perf=1`);

    // Choosing another address rewrites every link; the first entry is the address of the request.
    const options = await page.$$eval('select option', (o) => o.map((x) => x.getAttribute('value')));
    assert.equal(options[0], url);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'test-hub.png'), fullPage: false });
    assert.deepEqual(errors, []);
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
