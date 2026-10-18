// @ts-check
/**
 * Determinism page. The server runs the sim, so the web client no longer does.
 * This page keeps the cross-browser check alive: it plays a headless match in
 * the browser and prints the final state hash. Every engine and the Node runner
 * must print the same hash for the same seed and tick count (M10).
 *
 *   determinism.html?seed=1234567&ticks=2400            two idle players
 *   determinism.html?seed=777&ticks=4000&bots=1         two bots play
 */

import { loadDataBrowser } from '../shared/data-files.js';
import { SPEC_VERSION, createState, hashState, normalizeData, step } from '../sim/index.js';
import { localWorldView } from '../shared/world-view.js';
import { createBot } from '../bot/bot.js';

const query = new URLSearchParams(location.search);
const seed = Number(query.get('seed') ?? 1234567);
const ticks = Number(query.get('ticks') ?? 2400);
const withBots = query.get('bots') === '1';

const out = /** @type {HTMLElement} */ (document.getElementById('result'));
try {
  const config = normalizeData(await loadDataBrowser());
  const players = [
    { id: 0, team: 0, kind: /** @type {const} */ (withBots ? 'bot' : 'human') },
    { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
  ];
  const state = createState({ seed, players, config });
  const bots = withBots ? players.map((p) => createBot({ playerId: p.id, team: p.team, config, seed })) : [];
  const views = players.map((p) => localWorldView(state, p.team));
  while (state.tick < ticks && !state.outcome) step(state, bots.flatMap((bot, i) => bot.think(views[i])));
  out.textContent = JSON.stringify({ specVersion: SPEC_VERSION, seed, ticks: state.tick, bots: withBots, hash: hashState(state) });
  out.dataset.done = '1';
} catch (err) {
  out.textContent = `error: ${err instanceof Error ? err.message : String(err)}`;
  out.dataset.done = 'error';
}
