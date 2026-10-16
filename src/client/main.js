// @ts-check
/**
 * Client entry point. Wires: data -> sim -> fixed-tick loop -> renderer + HUD.
 * No game logic here; the sim owns the rules.
 */

import { loadDataBrowser } from '../shared/data-files.js';
import { normalizeData, createState, step, hashState, HASH_INTERVAL, MILLI, TICK_HZ } from '../sim/index.js';
import { startLoop } from './loop.js';
import { localWorldView } from './world-view.js';
import { createScene } from './render/scene.js';
import { attachPan } from './input/pan.js';
import { createBot } from '../bot/bot.js';

const VIEWER_TEAM = 0;

const raw = await loadDataBrowser();
const config = normalizeData(raw);
const query = new URLSearchParams(location.search);
const seed = Number(query.get('seed') ?? 1234567);
const players = [
  { id: 0, team: 0, kind: /** @type {const} */ ('human') },
  { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
];
const state = createState({ seed, players, config });
const view = localWorldView(state, VIEWER_TEAM);
const bot = createBot(1);

/** @type {import('../sim/commands.js').CommandEnvelope[]} */
let pendingHumanCommands = [];

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const scene = createScene(canvas, raw.mapgen, view, raw.balance.hpFactor);
attachPan(canvas, scene.pan, () => scene.viewTilesWide / canvas.clientWidth);

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
let lastHash = '';

// Test hook for test/e2e/smoke.e2e.js. With ?test=1 the page keeps every
// state hash by tick; without the flag nothing is recorded or exposed.
/** @type {Record<number, string> | null} */
const testHashes = query.get('test') === '1' ? {} : null;
if (testHashes) /** @type {any} */ (window).__luxTest = { hashes: testHashes };

startLoop({
  tick() {
    const cmds = [...pendingHumanCommands, ...bot.think(view)];
    pendingHumanCommands = [];
    step(state, cmds);
    if (state.tick % HASH_INTERVAL === 0) {
      lastHash = hashState(state);
      if (testHashes) testHashes[state.tick] = lastHash;
    }
  },
  render() {
    scene.render(performance.now() / 1000);
    const secs = Math.floor(view.tick() / TICK_HZ);
    $('hud-clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    $('hud-core').textContent = `Core ${Math.floor(view.team(VIEWER_TEAM).coreLux / MILLI)}`;
    $('hud-enemy').textContent = `Enemy ${Math.floor(view.team(1 - VIEWER_TEAM).coreLux / MILLI)}`;
    $('hud-debug').textContent = `seed ${seed}  tick ${view.tick()}  hash ${lastHash}`;
  },
});
