// Online play smoke test. It starts the real backend and opens two Chromium
// pages in the Playwright container. The pages play a server match, and each
// must receive the same state hashes that the repo's own sim computes. That
// proves the loop end to end: REST lobby, Socket.IO room, server-authoritative
// ticks, snapshots, and the networked client.
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

test('two browsers play a server match and receive the sim hashes', { timeout: 120_000, skip }, async () => {
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
      RABBITMQ_URL: '',
      LUXCORES_ROOT: ROOT,
    },
  });
  backend.stdout.on('data', (d) => { output += d; });
  backend.stderr.on('data', (d) => { output += d; });

  /** @type {import('playwright-core').Browser | undefined} */
  let browser;
  try {
    await waitForBackend(backend, () => output);
    browser = await chromium.connect(PW_WS_ENDPOINT);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    /** @type {string[]} */ const errors = [];
    const open = async (/** @type {string} */ query) => {
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
      await page.goto(`${BROWSER_URL}/?test=1&server=&${query}`, { waitUntil: 'load', timeout: 30_000 });
      return page;
    };

    // The host opens a lobby, the guest joins it, then the host starts the match.
    const host = await open(`name=Halo&match=new&seed=${SEED}`);
    await host.waitForFunction(() => /** @type {any} */ (window).__luxTest?.matchId, null, { timeout: 30_000 });
    const matchId = await host.evaluate(() => /** @type {any} */ (window).__luxTest.matchId);
    const guest = await open(`name=Prism&match=${matchId}`);
    await guest.waitForFunction(() => /** @type {any} */ (window).__luxTest?.matchId, null, { timeout: 30_000 });

    assert.equal(await host.evaluate(() => /** @type {any} */ (window).__luxTest.viewerTeam), 0);
    assert.equal(await guest.evaluate(() => /** @type {any} */ (window).__luxTest.viewerTeam), 1);

    await host.evaluate(() => /** @type {any} */ (window).__luxTest.start());
    for (const page of [host, guest]) {
      await page.waitForFunction(() => /** @type {any} */ (window).__luxTest.hashes['40'] !== undefined, null, { timeout: 60_000 });
    }

    // A command goes to the server, which stamps and queues it.
    const ack = await host.evaluate(() => /** @type {any} */ (window).__luxTest.send({ t: 'heroMove', x: 48000, z: 80000 }));
    assert.equal(ack.accepted, true, `the server refused the command: ${ack.reason}`);

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
  } finally {
    await browser?.close();
    backend.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dbDir, { recursive: true, force: true });
  }
});
