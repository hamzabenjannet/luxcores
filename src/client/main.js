// @ts-check
/**
 * Client entry point. The server owns the simulation, so this page only signs
 * in, opens or joins a match, sends commands and draws the snapshots it gets.
 * This page is served by the backend it plays on, which keeps one rule engine
 * for the web client and for the Godot client.
 *
 * URL parameters (all optional; any of match, vsBot, botVsBot or autostart
 * skips the start menu):
 *   server       backend origin; the page's own origin by default
 *   name         guest name, used for a new guest only
 *   match        'new' or a match id
 *   vsBot=1      with match=new: play against a bot
 *   botVsBot=1   with match=new: two bots play and this page watches
 *   seed         with match=new: map seed
 *   autostart=1  start the match as soon as the lobby exists
 *   recover      a recovery code that moves a profile to this device
 *   showcode=1   print a new recovery code in the debug text
 *   test=1       expose window.__luxTest for test/e2e
 * No game logic here; the sim owns the rules.
 */

import { loadDataBrowser } from '../shared/data-files.js';
import { MILLI, SPEC_VERSION, TICK_HZ } from '../sim/index.js';
import { startLoop } from './loop.js';
import { networkWorldView } from '../shared/world-view.js';
import { createScene } from './render/scene.js';
import { attachPointer } from './input/pointer.js';
import { joinServerMatch } from './net/server-session.js';
import { createControls } from './ui/controls.js';
import { showLobby } from './ui/lobby.js';
import { showMenu } from './ui/menu.js';
import { isDay } from './entity-text.js';

const query = new URLSearchParams(location.search);
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const server = (query.has('server') ? query.get('server') || location.origin : location.origin).replace(/\/$/, '');

// Test hook for test/e2e. With ?test=1 the page keeps every state hash by tick
// and exposes the match id, start and send; without the flag nothing is exposed.
/** @type {Record<number, string> | null} */
const testHashes = query.get('test') === '1' ? {} : null;
/** @type {Record<string, any>} */
const luxTest = { hashes: testHashes };
if (testHashes) /** @type {any} */ (window).__luxTest = luxTest;

/** @type {import('../sim/config.js').RawData} */
let raw;
try {
  raw = await loadDataBrowser(server);
} catch (err) {
  await showMenu($('menu'), { server, error: `No Luxcores server answers at ${server}. Start one with "npm run serve", or add ?server=<origin> to the address. (${err instanceof Error ? err.message : err})` });
  throw err;
}
const data = { buildings: /** @type {any} */ (raw).buildings, balance: /** @type {any} */ (raw).balance, mapgen: /** @type {any} */ (raw).mapgen };

/** The menu is skipped when the address says what to do. */
const direct = ['match', 'vsBot', 'botVsBot', 'autostart'].some((k) => query.has(k));
/** @type {import('./net/server-session.js').ServerSession | undefined} */
let session;
let problem = '';
while (!session) {
  /** @type {import('./ui/menu.js').MenuChoice} */
  const choice = direct && !problem
    ? {
        name: query.get('name') ?? 'Guest',
        matchId: query.get('match') ?? 'new',
        vsBot: query.get('vsBot') === '1',
        botVsBot: query.get('botVsBot') === '1',
        seed: query.has('seed') ? Number(query.get('seed')) : undefined,
      }
    : await showMenu($('menu'), { server, error: problem });
  $('hud-debug').textContent = `Connecting to ${server} ...`;
  try {
    session = await joinServerMatch({
      server,
      name: choice.name,
      matchId: choice.matchId,
      vsBot: choice.vsBot,
      botVsBot: choice.botVsBot,
      seed: choice.seed,
      specVersion: SPEC_VERSION,
      recoveryCode: query.get('recover') ?? undefined,
    });
  } catch (err) {
    if (direct) throw err; // a test or a shared link wants the failure, not a menu
    problem = err instanceof Error ? err.message : String(err);
  }
}

const view = networkWorldView(session.feed);
const viewerTeam = session.viewerTeam;
const spectator = session.role === 'spectator';
Object.assign(luxTest, {
  matchId: session.matchId,
  viewerTeam,
  role: session.role,
  playerId: session.playerId,
  playerName: session.playerName,
  recoveredCode: session.recoveryCode,
  recoveryCode: session.requestRecoveryCode,
  start: session.start,
  send: session.sendCommand,
  entityKinds: () => view.entities().map((e) => e.kind),
  entities: () => view.entities(),
});
session.onSnapshot((s) => {
  if (s.hash && testHashes) testHashes[s.tick] = s.hash;
});

const link = new URL(location.href);
link.search = new URLSearchParams({ ...(query.has('server') ? { server } : {}), match: session.matchId }).toString();
const lobby = showLobby($('menu'), session, { shareLink: link.toString() });
if (query.get('autostart') === '1' && session.isHost) await session.start();

const code = query.get('showcode') === '1' ? await session.requestRecoveryCode() : session.recoveryCode;
const codeLine = code ? `\nRecovery code (shown once): ${code}` : '';
$('hud-debug').textContent = `${session.playerName}  match ${session.matchId}${codeLine}`;
await session.firstSnapshot; // the scene reads the layout once, so wait for the match to start
lobby.hide();

// The HUD shows the viewer's side in the viewer's team color; a spectator sees Blue and Red.
const myLabel = spectator ? 'Blue' : 'Core';
const otherLabel = spectator ? 'Red' : 'Enemy';
$('hud-core').style.color = viewerTeam === 0 ? 'var(--blue)' : 'var(--red)';
$('hud-enemy').style.color = viewerTeam === 0 ? 'var(--red)' : 'var(--blue)';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const scene = createScene(canvas, raw.mapgen, view, raw.balance.hpFactor, viewerTeam);
const controls = createControls({
  root: $('controls'),
  view,
  viewerTeam,
  spectator,
  data,
  send: (cmd) => session.sendCommand(cmd),
});
Object.assign(luxTest, { screenOf: scene.screenOf });
attachPointer(canvas, { groundAt: scene.groundAt, pan: scene.pan, onTap: (ground) => controls.tap(ground) });

const banner = $('banner');
session.onChange(() => {
  const result = session.feed.result;
  if (session.feed.status !== 'finished' || !result) return;
  const text = result.draw || result.winnerTeam === null
    ? 'Draw'
    : spectator
      ? `${result.winnerTeam === 0 ? 'Blue' : 'Red'} wins`
      : result.winnerTeam === viewerTeam ? 'Victory' : 'Defeat';
  banner.textContent = `${text}  (${result.reason})`;
  banner.hidden = false;
});

startLoop((timeSec) => {
  scene.render(timeSec);
  controls.update();
  const secs = Math.floor(view.tick() / TICK_HZ);
  $('hud-clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  $('hud-phase').textContent = isDay(view.tick(), data.balance.dayNight) ? '☀' : '☾';
  $('hud-core').textContent = `${myLabel} ${Math.floor(view.team(viewerTeam).coreLux / MILLI)}`;
  $('hud-enemy').textContent = `${otherLabel} ${Math.floor(view.team(1 - viewerTeam).coreLux / MILLI)}`;
  $('hud-debug').textContent = `${session.role}  seed ${session.feed.map.usedSeed}  tick ${session.feed.tick}  hash ${session.feed.hash ?? ''}  ${session.feed.status}${codeLine}`;
});
