// @ts-check
/**
 * Client entry point. Two modes, one renderer:
 *
 *   offline (default)  data -> local sim -> fixed-tick loop -> renderer + HUD
 *   online (?server=)  backend snapshots -> renderer + HUD; the server owns the sim
 *
 * Online URL parameters: server (backend origin, empty for this page's origin),
 * name (guest name), match ('new' or a match id), vsBot=1, seed, autostart=1.
 * No game logic here; the sim owns the rules.
 */

import { loadDataBrowser } from '../shared/data-files.js';
import { normalizeData, createState, step, hashState, HASH_INTERVAL, MILLI, TICK_HZ, SPEC_VERSION } from '../sim/index.js';
import { startLoop } from './loop.js';
import { localWorldView, networkWorldView } from './world-view.js';
import { createScene } from './render/scene.js';
import { attachPan } from './input/pan.js';
import { joinServerMatch } from './net/server-session.js';
import { createBot } from '../bot/bot.js';

const query = new URLSearchParams(location.search);
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const raw = await loadDataBrowser();

// Test hook for test/e2e. With ?test=1 the page keeps every state hash by tick
// and, online, exposes the match id, start and send; without the flag nothing is
// recorded or exposed.
/** @type {Record<number, string> | null} */
const testHashes = query.get('test') === '1' ? {} : null;
/** @type {Record<string, any>} */
const luxTest = { hashes: testHashes };
if (testHashes) /** @type {any} */ (window).__luxTest = luxTest;

const serverParam = query.has('server') ? query.get('server') || location.origin : null;
const seed = Number(query.get('seed') ?? 1234567);

/** @type {import('./world-view.js').WorldView} */
let view;
let viewerTeam = 0;
let lastHash = '';
let tickLocal = () => {};
/** @type {() => string} */
let debugLine;

if (serverParam) {
  $('hud-debug').textContent = `Connecting to ${serverParam} ...`;
  const session = await joinServerMatch({
    server: serverParam,
    name: query.get('name') ?? 'Guest',
    matchId: query.get('match') ?? 'new',
    vsBot: query.get('vsBot') === '1',
    seed: query.has('seed') ? seed : undefined,
    specVersion: SPEC_VERSION,
  });
  view = networkWorldView(session.feed);
  viewerTeam = session.viewerTeam;
  Object.assign(luxTest, { matchId: session.matchId, viewerTeam, start: session.start, send: session.sendCommand });
  session.onSnapshot((s) => {
    if (s.hash && testHashes) testHashes[s.tick] = s.hash;
  });
  if (query.get('autostart') === '1') await session.start();

  $('hud-debug').textContent = `Lobby ${session.matchId}\nShare it as ?server=${serverParam}&match=${session.matchId}`;
  await session.firstSnapshot; // the scene reads the layout once, so wait for the match to start
  debugLine = () => `online  seed ${session.feed.map.usedSeed}  tick ${session.feed.tick}  hash ${session.feed.hash ?? ''}  ${session.feed.status}`;
} else {
  const config = normalizeData(raw);
  const players = [
    { id: 0, team: 0, kind: /** @type {const} */ ('human') },
    { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
  ];
  const state = createState({ seed, players, config });
  view = localWorldView(state, viewerTeam);
  const bot = createBot(1);
  /** @type {import('../sim/commands.js').CommandEnvelope[]} */
  let pendingHumanCommands = [];
  tickLocal = () => {
    const cmds = [...pendingHumanCommands, ...bot.think(view)];
    pendingHumanCommands = [];
    step(state, cmds);
    if (state.tick % HASH_INTERVAL === 0) {
      lastHash = hashState(state);
      if (testHashes) testHashes[state.tick] = lastHash;
    }
  };
  debugLine = () => `seed ${seed}  tick ${view.tick()}  hash ${lastHash}`;
}

// The HUD shows the viewer's side in the viewer's team color.
$('hud-core').style.color = viewerTeam === 0 ? 'var(--blue)' : 'var(--red)';
$('hud-enemy').style.color = viewerTeam === 0 ? 'var(--red)' : 'var(--blue)';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const scene = createScene(canvas, raw.mapgen, view, raw.balance.hpFactor, viewerTeam);
attachPan(canvas, scene.pan, () => scene.viewTilesWide / canvas.clientWidth);

startLoop({
  tick: tickLocal,
  render() {
    scene.render(performance.now() / 1000);
    const secs = Math.floor(view.tick() / TICK_HZ);
    $('hud-clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    $('hud-core').textContent = `Core ${Math.floor(view.team(viewerTeam).coreLux / MILLI)}`;
    $('hud-enemy').textContent = `Enemy ${Math.floor(view.team(1 - viewerTeam).coreLux / MILLI)}`;
    $('hud-debug').textContent = debugLine();
  },
});
