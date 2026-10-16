// Browser smoke test. It drives Chromium inside the Playwright container
// (see CLAUDE.md and docs/HANDOVER.md) and loads the game with ?test=1. The
// sim state hash at tick 120 must equal the hash Node computes. A mismatch
// means the sim diverged between Node and Chromium (P0).
//
// Run: npm run serve   (in one terminal)
//      npm run test:e2e
//
// Environment:
//   PW_WS_ENDPOINT  Playwright server, default ws://localhost:42944/
//   APP_URL         the game as the container sees it, default http://host.docker.internal:5173/
//
// The test skips (exit code 0) when nothing listens at PW_WS_ENDPOINT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { loadData, ROOT } from '../helpers/load-data.js';
import { createState, step, hashState } from '../../src/sim/index.js';

const PW_WS_ENDPOINT = process.env.PW_WS_ENDPOINT ?? 'ws://localhost:42944/';
const APP_URL = process.env.APP_URL ?? 'http://host.docker.internal:5173/';
const SEED = 1234567;
const TICK = 120;
const SCREENSHOT = join(ROOT, 'test', 'e2e', '__screenshots__', 'smoke.png');

/** @param {string} endpoint ws:// or wss:// URL */
function canConnect(endpoint) {
  const url = new URL(endpoint);
  const port = Number(url.port || (url.protocol === 'wss:' ? 443 : 80));
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port });
    const done = (/** @type {boolean} */ ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(2000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Hash the same match the page runs: seed, two players, no commands. */
function nodeHashAt(tick) {
  const { config } = loadData();
  const players = [
    { id: 0, team: 0, kind: 'human' },
    { id: 1, team: 1, kind: 'bot' },
  ];
  const state = createState({ seed: SEED, players, config });
  while (state.tick < tick) step(state, []);
  return hashState(state);
}

const reachable = await canConnect(PW_WS_ENDPOINT);

test(`browser sim hash at tick ${TICK} matches Node`, {
  timeout: 120_000,
  skip: reachable ? false : `no Playwright server at ${PW_WS_ENDPOINT}; start the container or set PW_WS_ENDPOINT`,
}, async () => {
  const expected = nodeHashAt(TICK);
  const browser = await chromium.connect(PW_WS_ENDPOINT);
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    /** @type {string[]} */ const errors = [];
    /** @type {string[]} */ const warnings = [];
    /** @type {(e: Error) => void} */ let abort = () => {};
    const aborted = new Promise((_, reject) => { abort = reject; });
    aborted.catch(() => {}); // the race below reports it; this keeps it from being unhandled
    const fail = (/** @type {string} */ msg) => { errors.push(msg); abort(new Error(msg)); };

    page.on('console', (msg) => {
      if (msg.type() === 'error') fail(`console error: ${msg.text()}`);
      else if (msg.type() === 'warning') warnings.push(msg.text());
    });
    page.on('pageerror', (err) => fail(`page error: ${err.message}`));

    const url = `${APP_URL}?test=1&seed=${SEED}`;
    try {
      await Promise.race([page.goto(url, { waitUntil: 'load', timeout: 30_000 }), aborted]);
    } catch (err) {
      if (!errors.length) {
        throw new Error(`${err.message}\nThe container could not load ${url}. If host.docker.internal does not resolve, ` +
          'add extra_hosts: ["hostmachine:host-gateway"] to the compose service and set APP_URL=http://hostmachine:5173/. ' +
          'Three.js comes from cdn.jsdelivr.net, so the container also needs outbound internet.');
      }
      throw err;
    }

    await Promise.race([
      page.waitForFunction((tick) => /** @type {any} */ (window).__luxTest?.hashes?.[tick] !== undefined, TICK, { timeout: 60_000 }),
      aborted,
    ]);
    const actual = await page.evaluate((tick) => /** @type {any} */ (window).__luxTest.hashes[tick], TICK);

    mkdirSync(join(ROOT, 'test', 'e2e', '__screenshots__'), { recursive: true });
    await page.screenshot({ path: SCREENSHOT });

    if (warnings.length) console.log(`${warnings.length} console warning(s), ignored: ${warnings.map((w) => w.slice(0, 120)).join(' | ')}`);
    assert.deepEqual(errors, [], 'the page must log no console or page errors');
    assert.equal(actual, expected, `P0: sim diverged between Node and Chromium at tick ${TICK}`);
    console.log(`tick ${TICK} hash ${actual} (Node and Chromium agree); screenshot ${SCREENSHOT}`);
  } finally {
    await browser.close();
  }
});
