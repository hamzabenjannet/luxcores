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
 *   maxTicks     with match=new: tick limit of the match, 0 for unlimited (the server's own limit applies without it)
 *   entropy      with match=new: entropy rate in percent of the maximum HP per second (0 to 100, one decimal, such as 0.5)
 *   autostart=1  start the match as soon as the lobby exists
 *   recover      a recovery code that moves a profile to this device
 *   showcode=1   print a new recovery code in the debug text
 *   perf=1       show the frame meter (fps, frame times, draw calls, entities)
 *   test=1       expose window.__luxTest for test/e2e
 * No game logic here; the sim owns the rules.
 */

import { loadDataBrowser } from '../shared/data-files.js';
import { MILLI, SPEC_VERSION, TICK_HZ } from '../sim/index.js';
import { startLoop } from './loop.js';
import { networkWorldView } from '../shared/world-view.js';
import { createScene } from './render/scene.js';
import { createInterpolator } from './render/interpolation.js';
import { attachPointer } from './input/pointer.js';
import { joinServerMatch } from './net/server-session.js';
import { createControls } from './ui/controls.js';
import { showLobby } from './ui/lobby.js';
import { showMenu } from './ui/menu.js';
import { entropyFromText, isDay, tickCapFromText } from './entity-text.js';
import { matchSummary } from './ui/summary.js';
import { lockPortrait } from './orientation.js';
import { createPerfMeter } from './perf.js';
import { leaveNeedsConfirm } from './ui/leave.js';

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
const data = {
  buildings: /** @type {any} */ (raw).buildings,
  balance: /** @type {any} */ (raw).balance,
  mapgen: /** @type {any} */ (raw).mapgen,
  heroes: /** @type {any} */ (raw).heroes,
  abilities: /** @type {any} */ (raw).abilities,
  items: /** @type {any} */ (raw).items,
};

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
        maxTicks: query.has('maxTicks') && (query.get('maxTicks') === '0' || tickCapFromText(query.get('maxTicks') ?? '') >= 0) ? Number(query.get('maxTicks')) : undefined,
        entropy: query.has('entropy') && entropyFromText(query.get('entropy') ?? '') >= 0 ? entropyFromText(query.get('entropy') ?? '') : undefined,
      }
    : await showMenu($('menu'), { server, error: problem, entropyDefault: data.balance.economy.entropyPermillePerSecond, capDefault: data.balance.match.stalemateTicks });
  $('hud-debug').textContent = `Connecting to ${server} ...`;
  try {
    session = await joinServerMatch({
      server,
      name: choice.name,
      matchId: choice.matchId,
      vsBot: choice.vsBot,
      botVsBot: choice.botVsBot,
      seed: choice.seed,
      entropyPermillePerSecond: choice.entropy,
      maxTicks: choice.maxTicks,
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
  groups: () => view.groups(),
  orders: () => view.orders(),
  players: () => view.players(),
});
session.onSnapshot((s) => {
  if (s.hash && testHashes) testHashes[s.tick] = s.hash;
});

const link = new URL(location.href);
link.search = new URLSearchParams({ ...(query.has('server') ? { server } : {}), match: session.matchId }).toString();
/**
 * Leaves the match and returns to the start menu. The server frees a lobby seat, stops a match against a bot
 * and gives a match for two humans to the other player, so nothing is left running (GDD 11.6).
 */
async function leaveMatch() {
  await session.leave();
  const back = new URL(location.href);
  back.search = query.has('server') ? new URLSearchParams({ server }).toString() : '';
  location.assign(back.toString());
}
const lobby = showLobby($('menu'), session, { shareLink: link.toString(), entropyDefault: data.balance.economy.entropyPermillePerSecond, onLeave: leaveMatch });

// The Leave button of the HUD. In a running match for two humans it asks for a second tap, because leaving forfeits.
const leaveButton = $('leave');
leaveButton.hidden = false;
let armedUntil = 0;
leaveButton.addEventListener('click', () => {
  const humans = session.getMatch().players.filter((/** @type {{ kind: string }} */ p) => p.kind === 'human').length;
  if (leaveNeedsConfirm({ status: session.feed.status, role: session.role, humans }) && Date.now() > armedUntil) {
    armedUntil = Date.now() + 3000;
    leaveButton.textContent = 'Forfeit? Tap again';
    leaveButton.classList.add('armed');
    setTimeout(() => {
      leaveButton.textContent = 'Leave';
      leaveButton.classList.remove('armed');
    }, 3000);
    return;
  }
  void leaveMatch();
});
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

lockPortrait();
// Landscape is allowed: a wide phone or a tablet plays fine that way, so the prompt can be set aside.
$('rotate-dismiss').addEventListener('click', () => $('rotate').classList.add('dismissed'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const scene = createScene(canvas, raw.mapgen, view, raw.balance.hpFactor, viewerTeam, data.heroes.roster.map((/** @type {{ name: string }} */ r) => r.name), data.items.list.map((/** @type {{ name: string }} */ i) => i.name));
const controls = createControls({
  root: $('controls'),
  view,
  viewerTeam,
  spectator,
  tickHz: TICK_HZ,
  data,
  send: (cmd) => session.sendCommand(cmd),
  camera: { isFollowing: scene.isFollowing, setFollow: scene.setFollow },
  groundAt: scene.groundAt,
});
// Units are drawn two ticks behind the newest snapshot and blended between the two around that moment.
const interpolator = createInterpolator({ tickMs: 1000 / TICK_HZ });
interpolator.push(view.tick(), view.entities(), performance.now());
session.onSnapshot((s) => interpolator.push(s.tick, s.entities, performance.now()));
Object.assign(luxTest, { drawn: scene.stats, following: scene.isFollowing, pan: scene.pan, zoom: scene.getZoom, setZoom: scene.setZoom, ghost: controls.ghost, interpolated: () => interpolator.at(performance.now()), screenOf: scene.screenOf, selectGroup: controls.selectGroup, tap: (x, z) => controls.tap({ x, z }) });
attachPointer(canvas, { groundAt: scene.groundAt, pan: scene.pan, onTap: (ground) => controls.tap(ground), getZoom: scene.getZoom, setZoom: scene.setZoom });

const banner = $('banner');
const summaryCard = $('summary');
session.onChange(() => {
  const result = session.feed.result;
  if (session.feed.status !== 'finished' || !result) return;
  const summary = matchSummary(result, { viewerTeam, spectator, endedTick: session.feed.endedTick, tickHz: TICK_HZ });
  banner.textContent = `${summary.title}  (${summary.reason})`;
  banner.hidden = false;
  summaryCard.replaceChildren();
  const table = document.createElement('table');
  const head = table.insertRow();
  head.append(cell('th', `Duration ${summary.duration}`), ...summary.columns.map((c, i) => cell('th', c, i === 0 ? 'mine' : 'theirs')));
  for (const row of summary.rows) table.insertRow().append(cell('td', row.label), ...row.values.map((v) => cell('td', String(v), 'number')));
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.addEventListener('click', () => { summaryCard.hidden = true; });
  summaryCard.append(table, close);
  summaryCard.hidden = false;
});

/** @param {'th' | 'td'} tag @param {string} text @param {string} [className] */
function cell(tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

// ?perf=1 shows the frame meter of M10 in a corner.
const perf = query.get('perf') === '1'
  ? createPerfMeter($('perf'), () => `entities ${view.entities().length}  dpr ${window.devicePixelRatio}  canvas ${canvas.width}x${canvas.height}`)
  : null;
Object.assign(luxTest, { perf: () => perf?.read() ?? null });

startLoop((timeSec) => {
  const jsStart = performance.now();
  scene.render(timeSec, interpolator.at(performance.now()));
  controls.update();
  scene.setPaths(controls.overlay());
  scene.setGhost(controls.ghost());
  scene.setAim(controls.aim());
  perf?.frame(timeSec * 1000, performance.now() - jsStart, scene.renderInfo());
  const secs = Math.floor(view.tick() / TICK_HZ);
  $('hud-clock').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  $('hud-phase').textContent = isDay(view.tick(), data.balance.dayNight) ? '☀' : '☾';
  $('hud-core').textContent = `${myLabel} ${Math.floor(view.team(viewerTeam).coreLux / MILLI)}`;
  $('hud-enemy').textContent = `${otherLabel} ${Math.floor(view.team(1 - viewerTeam).coreLux / MILLI)}`;
  $('hud-debug').textContent = `${session.role}  seed ${session.feed.map.usedSeed}  tick ${session.feed.tick}  hash ${session.feed.hash ?? ''}  ${session.feed.connected ? session.feed.status : 'RECONNECTING'}${codeLine}`;
});
