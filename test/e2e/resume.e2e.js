// A server that dies in the middle of a match and comes back: the match must go on.
//
// The test kills the backend with SIGKILL (no shutdown code, no flush), starts it again on the
// same port and data folder, and checks three things. The match is rebuilt from its write-ahead
// log with the player's building and the bot's. The page rejoins by itself and keeps receiving
// snapshots. And the page's next command is accepted, which needs the command counter to
// continue where the log says. Uses Chromium in the Playwright container, so it skips like the others.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { PW_WS_ENDPOINT, SEED, freeSpot, skip, startBackend } from './helpers/backend.js';

const BROWSER_HOST = process.env.BACKEND_HOST_FOR_BROWSER ?? 'host.docker.internal';

test('a page keeps playing across a crash and restart of the server', { timeout: 180_000, skip }, async () => {
  const env = { MATCH_MAX_TICKS: '5000' };
  const first = await startBackend(env);
  let second;
  const browser = await chromium.connect(PW_WS_ENDPOINT);
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
    await page.goto(`http://${BROWSER_HOST}:${first.port}/?test=1&name=Halo&match=new&vsBot=1&autostart=1&seed=${SEED}`, { waitUntil: 'load' });
    await page.waitForFunction(() => (/** @type {any} */ (window).__luxTest?.entities?.().length ?? 0) > 0, null, { timeout: 30_000 });

    const spot = freeSpot(SEED, 0);
    const built = await page.evaluate((s) => /** @type {any} */ (window).__luxTest.send({ t: 'build', building: 'solar', ...s }), spot);
    assert.equal(built.accepted, true);
    await page.waitForFunction(() => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 2 && e.team === 0), null, { timeout: 30_000 });
    // Let the match run so the bot has built too and a few hashes are in the log.
    await page.waitForFunction(() => /** @type {any} */ (window).__luxTest.hashes && Object.keys(/** @type {any} */ (window).__luxTest.hashes).length >= 3, null, { timeout: 60_000 });
    const tickBefore = await page.evaluate(() => Math.max(...Object.keys(/** @type {any} */ (window).__luxTest.hashes).map(Number)));

    await first.crash(); // SIGKILL: the log keeps only what was written
    second = await startBackend(env, { port: first.port, dbDir: first.dbDir });

    // The page rejoins on its own, the match is rebuilt, and snapshots flow again.
    await page.waitForFunction((was) => {
      const hashes = /** @type {any} */ (window).__luxTest.hashes;
      return Math.max(...Object.keys(hashes).map(Number)) > was + 20;
    }, tickBefore, { timeout: 90_000 });
    const entities = await page.evaluate(() => /** @type {any} */ (window).__luxTest.entities().map((/** @type {any} */ e) => [e.kind, e.team]));
    assert.ok(entities.some(([kind, team]) => kind === 2 && team === 0), 'the human solar plant survived the crash');
    assert.ok(entities.some(([kind, team]) => team === 1 && kind >= 2 && kind <= 7), 'and so did the bot buildings');

    // The next command works, even though the page's counter was ahead or behind the log.
    let ack;
    for (let i = 0; i < 3; i++) {
      ack = await page.evaluate((s) => /** @type {any} */ (window).__luxTest.send({ t: 'build', building: 'wind', tileX: s.tileX + 2, tileZ: s.tileZ }), spot);
      if (ack.accepted) break; // the first try may carry the server's count in the rejection, which the page adopts
    }
    assert.equal(ack.accepted, true, `a command after the restart was refused: ${ack.reason}`);
    await page.waitForFunction(() => /** @type {any} */ (window).__luxTest.entities().some((/** @type {any} */ e) => e.kind === 3 && e.team === 0), null, { timeout: 30_000 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await second?.stop();
    await first.stop();
  }
});
