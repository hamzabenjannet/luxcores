// @ts-check
// Shared set-up for the browser tests: a throwaway backend on the host, a
// Chromium in the Playwright container, and `open()` to load the game page
// from the backend. Every test skips when the container is down or the backend
// is not built.
//
// Environment:
//   PW_WS_ENDPOINT            Playwright server, default ws://localhost:42944/
//   BACKEND_PORT              port for the throwaway backend; a free port by default, so test files can run side by side
//   BACKEND_HOST_FOR_BROWSER  how the container reaches the host, default host.docker.internal

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT, loadData } from '../../helpers/load-data.js';
import { createState, hashState, step } from '../../../src/sim/index.js';

export const PW_WS_ENDPOINT = process.env.PW_WS_ENDPOINT ?? 'ws://localhost:42944/';
const BROWSER_HOST = process.env.BACKEND_HOST_FOR_BROWSER ?? 'host.docker.internal';
export const BACKEND_DIR = join(ROOT, 'backend', 'nodejs');
export const SHOTS = join(ROOT, 'test', 'e2e', '__screenshots__');
export const SEED = 1234567;

/** @param {string} endpoint */
export function canConnect(endpoint) {
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

/** Hash of a 2-human match after `ticks` ticks with no commands, as the sim computes it on its own. */
export function referenceHash(ticks, seed = SEED) {
  const players = [
    { id: 0, team: 0, kind: /** @type {const} */ ('human') },
    { id: 1, team: 1, kind: /** @type {const} */ ('human') },
  ];
  const state = createState({ seed, players, config: loadData().config });
  while (state.tick < ticks) step(state, []);
  return hashState(state);
}

/**
 * The `n`-th free tile (0 is the nearest) to the point (44, 90) in team 0's build zone, from the same map the server generated for the seed.
 * @param {number} [seed]
 * @param {number} [n]
 */
export function freeSpot(seed = SEED, n = 0) {
  const state = createState({ seed, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }], config: loadData().config });
  const taken = new Set(state.entities.map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`));
  for (const v of state.map.vents) taken.add(`${v.tileX},${v.tileZ}`);
  // Near (44, 90), so the tiles show in the first screen of the host. Every second column, so neighbours do not touch.
  const free = [];
  for (let z = 70; z < 110; z++) {
    for (let x = 4; x < 92; x += 2) {
      if (!taken.has(`${x},${z}`)) free.push({ d: (x - 44) ** 2 + (z - 90) ** 2, tileX: x, tileZ: z });
    }
  }
  free.sort((a, b) => a.d - b.d || a.tileZ - b.tileZ || a.tileX - b.tileX);
  const best = free[n];
  if (!best) throw new Error('no free tile');
  return { tileX: best.tileX, tileZ: best.tileZ };
}

/** A port nobody listens on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const { port } = /** @type {net.AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });
}

/** Resolves once the backend answers its health route. */
async function waitForBackend(child, port, log) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`the backend exited with code ${child.exitCode}:\n${log()}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the backend did not start:\n${log()}`);
}

const reachable = await canConnect(PW_WS_ENDPOINT);
const built = existsSync(join(BACKEND_DIR, 'dist', 'main.js')) && existsSync(join(BACKEND_DIR, 'node_modules'));

/** A reason to skip, or false when the browser tests can run. */
export const skip = !reachable
  ? `no Playwright server at ${PW_WS_ENDPOINT}; start the container or set PW_WS_ENDPOINT`
  : !built
    ? 'the backend is not built; run: cd backend/nodejs && npm install && npm run build'
    : false;

/**
 * Starts the backend on a free port with a throwaway JSON database and waits until it answers.
 * With `again`, it starts on the port and in the data folder of an earlier run, as a restarted server would.
 * @param {Record<string, string>} [extraEnv]
 * @param {{ port: number, dbDir: string }} [again]
 * @returns {Promise<{ port: number, url: string, dbDir: string, stop: () => Promise<void>, crash: () => Promise<void> }>}
 */
export async function startBackend(extraEnv = {}, again) {
  const dbDir = again?.dbDir ?? mkdtempSync(join(tmpdir(), 'luxcores-net-'));
  const port = again?.port ?? (process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : /** @type {number} */ (await freePort()));
  let output = '';
  const backend = spawn(process.execPath, ['dist/main.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
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
  /** Kills the process the hard way, with no shutdown code and no flush, like a crash. The data folder stays. */
  const crash = async () => {
    backend.kill('SIGKILL');
    await new Promise((r) => backend.once('exit', r));
  };
  const stop = async () => {
    if (backend.exitCode === null) {
      backend.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!again) rmSync(dbDir, { recursive: true, force: true });
  };
  try {
    await waitForBackend(backend, port, () => output);
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, url: `http://127.0.0.1:${port}`, dbDir, stop, crash };
}

/**
 * @typedef {Object} Env
 * @property {import('playwright-core').Browser} browser
 * @property {string[]} errors  console and page errors of every page opened with `open`
 * @property {() => Promise<import('playwright-core').BrowserContext>} newContext  a fresh browser profile, like a second phone
 * @property {(context: import('playwright-core').BrowserContext, query: string) => Promise<import('playwright-core').Page>} open  loads the game with ?test=1 and waits for the match to exist
 * @property {(path: string) => Promise<import('playwright-core').Page>} plain  loads a page of the backend with no waiting and no test hook
 */

/**
 * Starts the backend and a browser, runs `body`, and cleans up.
 * @param {(env: Env) => Promise<void>} body
 * @param {Record<string, string>} [extraEnv]
 */
export async function withBackend(body, extraEnv = {}) {
  const backend = await startBackend(extraEnv);
  const browserUrl = `http://${BROWSER_HOST}:${backend.port}`;
  /** @type {import('playwright-core').Browser | undefined} */
  let browser;
  try {
    browser = await chromium.connect(PW_WS_ENDPOINT);
    const live = browser;
    /** @type {string[]} */ const errors = [];
    const newContext = () => live.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const watch = async (/** @type {import('playwright-core').BrowserContext} */ context) => {
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
      return page;
    };
    const open = async (/** @type {import('playwright-core').BrowserContext} */ context, /** @type {string} */ query) => {
      const page = await watch(context);
      await page.goto(`${browserUrl}/?test=1&${query}`, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForFunction(() => /** @type {any} */ (window).__luxTest?.matchId, null, { timeout: 30_000 });
      return page;
    };
    const plain = async (/** @type {string} */ path) => {
      const page = await watch(await newContext());
      await page.goto(`${browserUrl}${path}`, { waitUntil: 'load', timeout: 30_000 });
      return page;
    };
    await body({ browser, errors, newContext, open, plain });
  } finally {
    await browser?.close();
    await backend.stop();
  }
}

/** Reads a field of the page's test hook. */
export const luxTest = (/** @type {import('playwright-core').Page} */ page, /** @type {string} */ field) =>
  page.evaluate((f) => /** @type {any} */ (window).__luxTest[f], field);
