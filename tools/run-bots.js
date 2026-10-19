// Bot-vs-bot runner. Two bots play a full match headless and the run prints the
// final state hash, the buildings each side owns and the outcome.
//
// Usage: node tools/run-bots.js [seed] [ticks] [replay-out.json]
//        node tools/run-bots.js --soak [seeds] [ticks] [workers]
//
// A match that nobody has won ends at `ticks`, which defaults to 5000 here (250 seconds), so a soak
// stays short. The game's own limit, match.stalemateTicks in data/balance.json, stays 10000. Set the
// MATCH_MAX_TICKS environment variable, as for the server, or pass the tick count to run longer.
//
// With a third argument the match is saved as a replay (golden replays in
// replays/golden/ only on purpose, see tools/run-headless.js). The soak mode
// plays seeds 1 to N twice each, spread over worker threads (all cores but one by default). It fails
// on a crash, a non-integer value anywhere in the final state or two runs that disagree, and it is
// the bot-vs-bot soak of milestone M9. It also reports how the matches ended.

import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadData } from '../test/helpers/load-data.js';
import { createState, step, hashState, Recorder, KIND } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createBot } from '../src/bot/bot.js';
import { firstNonInteger } from './non-integer.js';

const { config, dataHash } = loadData();
/** The tick limit of a tool run, shorter than the game's own limit so the soak and the bot tests stay quick. */
const TEST_TICKS = 5000;
const LIMIT = Number(process.env.MATCH_MAX_TICKS ?? Math.min(TEST_TICKS, config.balance.match.stalemateTicks));

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
  const names = { [KIND.SOLAR]: 'solar', [KIND.WIND]: 'wind', [KIND.GEOTHERMAL]: 'geothermal', [KIND.BARRACKS]: 'barracks', [KIND.TOWER]: 'tower', [KIND.CREEP]: 'creeps' };
  /** @type {Record<string, number>} */
  const out = {};
  for (const e of state.entities) if (e.team === team && names[e.kind]) out[names[e.kind]] = (out[names[e.kind]] ?? 0) + 1;
  return JSON.stringify(out);
}

/**
 * Plays one seed twice and checks it. Returns what the soak reports.
 * @param {number} seed
 * @param {number} ticks
 */
function soakSeed(seed, ticks) {
  const a = play(seed, ticks);
  const b = play(seed, ticks);
  const bad = firstNonInteger(a.state);
  return {
    seed,
    agree: a.hash === b.hash,
    hash: a.hash,
    bad,
    endTick: a.state.tick,
    outcome: a.state.outcome ?? null,
  };
}

if (!isMainThread && workerData?.soak) {
  // A worker plays its share of the seeds and reports each one.
  for (const seed of workerData.seeds) {
    try {
      parentPort?.postMessage(soakSeed(seed, workerData.ticks));
    } catch (err) {
      parentPort?.postMessage({ seed, crash: err instanceof Error ? err.stack : String(err) });
    }
  }
} else if (process.argv[2] === '--soak') {
  const seeds = Number(process.argv[3] ?? 100);
  const ticks = Number(process.argv[4] ?? LIMIT);
  const workers = Math.max(1, Math.min(seeds, Number(process.argv[5] ?? Math.max(1, availableParallelism() - 1))));
  const t0 = performance.now();
  /** @type {any[]} */
  const results = [];
  await Promise.all(Array.from({ length: workers }, (_, w) => new Promise((resolve, reject) => {
    // Seeds 1 to N dealt out round-robin, so every worker gets a mix of short and long matches.
    const mine = [];
    for (let seed = 1 + w; seed <= seeds; seed += workers) mine.push(seed);
    const worker = new Worker(new URL(import.meta.url), { workerData: { soak: true, seeds: mine, ticks } });
    worker.on('message', (r) => {
      results.push(r);
      if (results.length % 50 === 0) console.log(`  ${results.length}/${seeds} seeds, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
    });
    worker.on('error', reject);
    worker.on('exit', resolve);
  })));
  results.sort((x, y) => x.seed - y.seed);
  const crashed = results.filter((r) => r.crash);
  const disagreed = results.filter((r) => r.agree === false);
  const fractional = results.filter((r) => r.bad);
  const done = results.filter((r) => !r.crash);
  const won = done.filter((r) => r.outcome?.winnerTeam !== undefined);
  const wonBy = [0, 1].map((t) => won.filter((r) => r.outcome.winnerTeam === t).length);
  const limited = done.filter((r) => !r.outcome);
  const ends = won.map((r) => r.endTick).sort((x, y) => x - y);
  for (const r of crashed) console.error(`seed ${r.seed}: crash\n${r.crash}`);
  for (const r of disagreed) console.error(`seed ${r.seed}: two runs disagree`);
  for (const r of fractional) console.error(`seed ${r.seed}: non-integer value at ${r.bad}`);
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`soak: ${seeds} seeds x ${ticks} ticks, twice each, ${workers} workers, ${seconds}s`);
  console.log(`  outcomes: ${won.length} victories (team 0: ${wonBy[0]}, team 1: ${wonBy[1]}, earliest tick ${ends[0] ?? '-'}, median ${ends[Math.floor(ends.length / 2)] ?? '-'}, latest ${ends.at(-1) ?? '-'}), ${limited.length} undecided at the limit`);
  console.log(`  crashes ${crashed.length}, disagreeing runs ${disagreed.length}, non-integer states ${fractional.length}`);
  if (results.length !== seeds || crashed.length || disagreed.length || fractional.length) {
    console.error(`soak FAILED (${results.length} of ${seeds} seeds reported)`);
    process.exitCode = 1;
  } else {
    console.log('soak ok');
  }
} else {
  const seed = Number(process.argv[2] ?? 1234567);
  const ticks = Number(process.argv[3] ?? LIMIT);
  const out = process.argv[4];
  const { state, hash, replay } = play(seed, ticks, Boolean(out));
  console.log(`seed=${seed} ticks=${state.tick} hash=${hash} outcome=${JSON.stringify(state.outcome)}`);
  for (const team of [0, 1]) console.log(`team ${team}: lux ${Math.floor(state.teams[team].coreLux / 1000)} ${owned(state, team)}`);
  if (out && replay) {
    writeFileSync(out, JSON.stringify(replay, null, 2) + '\n');
    console.log(`replay saved to ${out}`);
  }
}
