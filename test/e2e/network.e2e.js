// Online play smoke tests. It starts the real backend and opens two Chromium
// pages in the Playwright container. The pages play a server match, and each
// must receive the same state hashes that the repo's own sim computes. That
// proves the loop end to end: REST lobby, Socket.IO room, server-authoritative
// ticks, snapshots, and the networked client. A second test checks the device
// guest: a page signs in as the same player on every visit, and a recovery code
// moves the profile to a fresh browser profile.
//
// Run: (cd backend/nodejs && npm install && npm run build)   once
//      npm run test:e2e
//
// Environment (see smoke.e2e.js for the Playwright variables):
//   BACKEND_PORT              port for the throwaway backend, default 3100
//   BACKEND_URL_FOR_BROWSER   how the container reaches the host, default http://host.docker.internal:<port>
//
// The test skips when the Playwright server is down or the backend is not built.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { loadData, ROOT } from '../helpers/load-data.js';
import { createState, step, hashState } from '../../src/sim/index.js';

const PW_WS_ENDPOINT = process.env.PW_WS_ENDPOINT ?? 'ws://localhost:42944/';
const PORT = Number(process.env.BACKEND_PORT ?? 3100);
const BROWSER_URL = process.env.BACKEND_URL_FOR_BROWSER ?? `http://host.docker.internal:${PORT}`;
const BACKEND_DIR = join(ROOT, 'backend', 'nodejs');
const SEED = 1234567;
const SHOTS = join(ROOT, 'test', 'e2e', '__screenshots__');

/** @param {string} endpoint */
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

/** Hash of a 2-human match after `ticks` ticks, as the sim computes it on its own. */
function referenceHash(ticks) {
  const players = [
    { id: 0, team: 0, kind: 'human' },
    { id: 1, team: 1, kind: 'human' },
  ];
  const state = createState({ seed: SEED, players, config: loadData().config });
  while (state.tick < ticks) step(state, []);
  return hashState(state);
}

/** A free tile in team 0's build zone, from the same map the server generated for the seed. */
function freeSpot() {
  const state = createState({ seed: SEED, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }], config: loadData().config });
  const taken = new Set(state.entities.map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`));
  for (const v of state.map.vents) taken.add(`${v.tileX},${v.tileZ}`);
  // The free tile nearest to the point (44, 90), so it shows in the first screen of the host.
  let best = null;
  for (let z = 70; z < 110; z++) {
    for (let x = 4; x < 92; x++) {
      const d = (x - 44) ** 2 + (z - 90) ** 2;
      if (!taken.has(`${x},${z}`) && (best === null || d < best.d)) best = { d, tileX: x, tileZ: z };
    }
  }
  if (!best) throw new Error('no free tile');
  return { tileX: best.tileX, tileZ: best.tileZ };
}

/** Resolves once the backend answers its health route. */
async function waitForBackend(child, log) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`the backend exited with code ${child.exitCode}:\n${log()}`);
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the backend did not start:\n${log()}`);
}

const reachable = await canConnect(PW_WS_ENDPOINT);
const built = existsSync(join(BACKEND_DIR, 'dist', 'main.js')) && existsSync(join(BACKEND_DIR, 'node_modules'));
const skip = !reachable
  ? `no Playwright server at ${PW_WS_ENDPOINT}; start the container or set PW_WS_ENDPOINT`
  : !built
    ? 'the backend is not built; run: cd backend/nodejs && npm install && npm run build'
    : false;

/**
 * Starts the backend and a browser, runs `body`, and cleans up. `open(context, query)`
 * loads the game in online mode and collects console and page errors in `errors`.
 * @param {(env: { browser: import('playwright-core').Browser, errors: string[], newContext: () => Promise<import('playwright-core').BrowserContext>, open: (context: import('playwright-core').BrowserContext, query: string) => Promise<import('playwright-core').Page> }) => Promise<void>} body
 * @param {Record<string, string>} [extraEnv]
 */
async function withBackend(body, extraEnv = {}) {
  const dbDir = mkdtempSync(join(tmpdir(), 'luxcores-net-'));
  let output = '';
  const backend = spawn(process.execPath, ['dist/main.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      HOST: '0.0.0.0', // the container reaches the host through host.docker.internal
      JSON_DB_PATH: join(dbDir, 'db.json'),
      JWT_SECRET: 'e2e-secret-with-enough-length',
      ADMIN_API_KEY: 'e2e-admin-key-with-enough-length',
      MATCH_MAX_TICKS: '600', // 30 s: software rendering in the container is slow, and the match must outlast the checks
      RATE_LIMIT_AUTH_PER_MINUTE: '1000',
      RABBITMQ_URL: '',
      LUXCORES_ROOT: ROOT,
      ...extraEnv,
    },
  });
  backend.stdout.on('data', (d) => { output += d; });
  backend.stderr.on('data', (d) => { output += d; });

  /** @type {import('playwright-core').Browser | undefined} */
  let browser;
  try {
    await waitForBackend(backend, () => output);
    browser = await chromium.connect(PW_WS_ENDPOINT);
    /** @type {string[]} */ const errors = [];
    const newContext = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const open = async (/** @type {import('playwright-core').BrowserContext} */ context, /** @type {string} */ query) => {
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
      await page.goto(`${BROWSER_URL}/?test=1&server=&${query}`, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(() => /** @type {any} */ (window).__luxTest?.matchId, null, { timeout: 30_000 });
      return page;
    };
    await body({ browser, errors, newContext, open });
  } finally {
    await browser?.close();
    backend.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dbDir, { recursive: true, force: true });
  }
}

const luxTest = (/** @type {import('playwright-core').Page} */ page, /** @type {string} */ field) =>
  page.evaluate((f) => /** @type {any} */ (window).__luxTest[f], field);

test('two browsers play a server match and receive the sim hashes', { timeout: 120_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const context = await newContext();

    // The host opens a lobby, the guest joins it, then the host starts the match.
    const host = await open(context, `name=Halo&match=new&seed=${SEED}`);
    const matchId = await luxTest(host, 'matchId');
    // A second browser profile, like a second phone: pages that share a profile are the same player.
    const guest = await open(await newContext(), `name=Prism&match=${matchId}`);

    assert.equal(await luxTest(host, 'viewerTeam'), 0);
    assert.equal(await luxTest(guest, 'viewerTeam'), 1);

    await host.evaluate(() => /** @type {any} */ (window).__luxTest.start());
    for (const page of [host, guest]) {
      await page.waitForFunction(() => /** @type {any} */ (window).__luxTest.hashes['40'] !== undefined, null, { timeout: 60_000 });
    }

    // A command goes to the server, which stamps and queues it.
    const ack = await host.evaluate(() => /** @type {any} */ (window).__luxTest.send({ t: 'heroMove', x: 48000, z: 80000 }));
    assert.equal(ack.accepted, true, `the server refused the command: ${ack.reason}`);

    // A build command reaches the sim: the host's page soon shows the new collector.
    const spot = freeSpot();
    const built = await host.evaluate((s) => /** @type {any} */ (window).__luxTest.send({ t: 'build', building: 'solar', ...s }), spot);
    assert.equal(built.accepted, true);
    await host.waitForFunction(() => /** @type {any} */ (window).__luxTest.entityKinds().includes(2), null, { timeout: 30_000 }); // KIND.SOLAR
    await guest.waitForFunction(() => /** @type {any} */ (window).__luxTest.entityKinds().includes(2), null, { timeout: 30_000 });

    for (const tick of [20, 40]) {
      const expected = referenceHash(tick);
      for (const [who, page] of [['host', host], ['guest', guest]]) {
        const actual = await page.evaluate((t) => /** @type {any} */ (window).__luxTest.hashes[t], tick);
        assert.equal(actual, expected, `P0: the ${who} page received a different hash at tick ${tick} than the sim computes`);
      }
    }

    mkdirSync(SHOTS, { recursive: true });
    await host.screenshot({ path: join(SHOTS, 'network-host.png') });
    await guest.screenshot({ path: join(SHOTS, 'network-guest.png') });
    assert.deepEqual(errors, [], 'the pages must log no console or page errors');
    console.log(`tick 20 hash ${referenceHash(20)} and tick 40 hash ${referenceHash(40)} reached both browsers; screenshots in ${SHOTS}`);
  });
});

test('a device signs in as the same player, and a recovery code moves the profile', { timeout: 120_000, skip }, async () => {
  await withBackend(async ({ errors, newContext, open }) => {
    const device = await newContext();

    // First visit creates a guest; the next visit in the same browser profile is the same player.
    const first = await open(device, 'name=Halo&match=new');
    const playerId = await luxTest(first, 'playerId');
    assert.equal(await luxTest(first, 'playerName'), 'Halo');
    const again = await open(device, 'name=SomeoneElse&match=new');
    assert.equal(await luxTest(again, 'playerId'), playerId, 'the stored device secret must sign in as the same player');
    assert.equal(await luxTest(again, 'playerName'), 'Halo', 'the name parameter applies to a new guest only');

    // A recovery code moves the profile to a fresh browser profile.
    const code = await first.evaluate(() => /** @type {any} */ (window).__luxTest.recoveryCode());
    assert.match(code, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
    const phone = await newContext();
    const moved = await open(phone, `recover=${code}&match=new`);
    assert.equal(await luxTest(moved, 'playerId'), playerId, 'the recovery code must open the same profile');
    const nextCode = await luxTest(moved, 'recoveredCode');
    assert.match(nextCode, /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
    assert.notEqual(nextCode, code);
    assert.equal(errors.length, 0, `unexpected errors: ${errors.join(' | ')}`);

    // The recovery replaced the old device secret, so the old browser profile starts over as a new guest.
    const stale = await open(device, 'name=Late&match=new');
    assert.notEqual(await luxTest(stale, 'playerId'), playerId);
    assert.equal(await luxTest(stale, 'playerName'), 'Late');
    assert.ok(errors.every((e) => e.includes('401')), `only the expected 401 may be logged: ${errors.join(' | ')}`);

    // The new browser profile keeps working across visits.
    const back = await open(phone, 'match=new');
    assert.equal(await luxTest(back, 'playerId'), playerId);
  });
});
