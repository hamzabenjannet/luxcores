import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, step, hashState, exportState, importState } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createBot } from '../src/bot/bot.js';

const { config } = loadData();
const SEED = 4;
const PLAYERS = [
  { id: 0, team: 0, kind: /** @type {const} */ ('bot') },
  { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
];

function bots(seed) {
  return PLAYERS.map((p) => createBot({ playerId: p.id, team: p.team, config, seed }));
}

/** Advances a match with bots to `ticks` and returns the commands issued on the way. */
function advance(state, botList, ticks) {
  const views = PLAYERS.map((p) => localWorldView(state, p.team));
  const issued = [];
  while (state.tick < ticks && !state.outcome) {
    const cmds = botList.flatMap((bot, i) => bot.think(views[i]));
    issued.push(...cmds);
    step(state, cmds);
  }
  return issued;
}

test('a checkpoint carries a match through JSON and back: the rest of the match is identical', () => {
  const straight = createState({ seed: SEED, players: PLAYERS, config });
  const straightBots = bots(SEED);
  const all = advance(straight, straightBots, 2400);

  const first = createState({ seed: SEED, players: PLAYERS, config });
  const firstBots = bots(SEED);
  advance(first, firstBots, 1200);
  // Everything a checkpoint holds goes through JSON, as it does in the log.
  const saved = JSON.parse(JSON.stringify({
    state: exportState(first),
    bots: firstBots.map((b) => b.saveState()),
    hash: hashState(first),
  }));

  const state = importState(saved.state, config);
  assert.equal(hashState(state), saved.hash, 'a restored state hashes like the saved one');
  const restoredBots = bots(SEED);
  restoredBots.forEach((b, i) => b.loadState(saved.bots[i]));
  const rest = advance(state, restoredBots, 2400);

  assert.equal(hashState(state), hashState(straight));
  assert.deepEqual(rest, all.filter((e) => e.tick >= 1200));
});

test('a checkpoint holds neither the data files nor the visibility cache', () => {
  const state = createState({ seed: SEED, players: PLAYERS, config });
  step(state, []);
  const saved = exportState(state);
  assert.equal('config' in saved, false);
  assert.equal('visibility' in saved, false);
  assert.ok(JSON.stringify(saved).length < 200_000, 'small enough to log every few hundred ticks');
});

test('a restored state runs under changed data: the new numbers apply from the restore on', () => {
  const state = createState({ seed: SEED, players: PLAYERS, config });
  const botList = bots(SEED);
  advance(state, botList, 600);
  const saved = JSON.parse(JSON.stringify(exportState(state)));
  const changed = structuredClone(config);
  changed.balance.creep.costLux += 1; // an edit to the data files
  const resumed = importState(saved, changed);
  assert.equal(resumed.config.balance.creep.costLux, config.balance.creep.costLux + 1);
  assert.doesNotThrow(() => advance(resumed, botList, 800));
});

test('a bot memory saved before heroes existed still loads, and the hero route starts at its first vertex', () => {
  const [bot] = bots(SEED);
  const old = JSON.parse(JSON.stringify(bot.saveState()));
  delete old.heroWp;
  const [again] = bots(SEED);
  assert.doesNotThrow(() => again.loadState(old));
  assert.equal(again.saveState().heroWp, 0);
});
