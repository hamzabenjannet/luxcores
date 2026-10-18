// Bot-vs-bot runner. Two bots play a full match headless and the run prints the
// final state hash, the buildings each side owns and the outcome.
//
// Usage: node tools/run-bots.js [seed] [ticks] [replay-out.json]
//        node tools/run-bots.js --soak [seeds] [ticks]
//
// With a third argument the match is saved as a replay (golden replays in
// replays/golden/ only on purpose, see tools/run-headless.js). The soak mode
// plays seeds 1 to N twice each. It fails on a crash, a non-integer value or
// two runs that disagree, and it is the bot-vs-bot soak of milestone M9.

import { writeFileSync } from 'node:fs';
import { loadData } from '../test/helpers/load-data.js';
import { createState, step, hashState, Recorder, KIND } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createBot } from '../src/bot/bot.js';

const { config, dataHash } = loadData();

/**
 * @param {number} seed
 * @param {number} ticks
 * @param {boolean} [record]
 */
function play(seed, ticks, record = false) {
  const players = [
    { id: 0, team: 0, kind: /** @type {const} */ ('bot') },
    { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
  ];
  const state = createState({ seed, players, config });
  const rec = record ? new Recorder({ seed, players, dataHash, mapgenVersion: config.mapgen.version }) : null;
  const bots = players.map((p) => createBot({ playerId: p.id, team: p.team, config, seed }));
  const views = players.map((p) => localWorldView(state, p.team));
  while (state.tick < ticks && !state.outcome) {
    const cmds = bots.flatMap((bot, i) => bot.think(views[i]));
    step(state, cmds);
    rec?.record(state, cmds);
  }
  return { state, hash: hashState(state), replay: rec?.replay };
}

/** @param {import('../src/sim/state.js').SimState} state @param {number} team */
function owned(state, team) {
  const names = { [KIND.SOLAR]: 'solar', [KIND.WIND]: 'wind', [KIND.GEOTHERMAL]: 'geothermal', [KIND.BARRACKS]: 'barracks', [KIND.TOWER]: 'tower' };
  /** @type {Record<string, number>} */
  const out = {};
  for (const e of state.entities) if (e.team === team && names[e.kind]) out[names[e.kind]] = (out[names[e.kind]] ?? 0) + 1;
  return JSON.stringify(out);
}

if (process.argv[2] === '--soak') {
  const seeds = Number(process.argv[3] ?? 100);
  const ticks = Number(process.argv[4] ?? 6000);
  const t0 = performance.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const a = play(seed, ticks);
    const b = play(seed, ticks);
    if (a.hash !== b.hash) throw new Error(`seed ${seed}: two runs disagree (${a.hash} and ${b.hash})`);
  }
  console.log(`soak ok: ${seeds} seeds x ${ticks} ticks, twice each, ${((performance.now() - t0) / 1000).toFixed(1)}s`);
} else {
  const seed = Number(process.argv[2] ?? 1234567);
  const ticks = Number(process.argv[3] ?? 6000);
  const out = process.argv[4];
  const { state, hash, replay } = play(seed, ticks, Boolean(out));
  console.log(`seed=${seed} ticks=${state.tick} hash=${hash} outcome=${JSON.stringify(state.outcome)}`);
  for (const team of [0, 1]) console.log(`team ${team}: lux ${Math.floor(state.teams[team].coreLux / 1000)} ${owned(state, team)}`);
  if (out && replay) {
    writeFileSync(out, JSON.stringify(replay, null, 2) + '\n');
    console.log(`replay saved to ${out}`);
  }
}
