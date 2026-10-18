// Headless match runner: simulates N ticks with no rendering and prints
// timing plus the final state hash. Grows into the bot-vs-bot soak (M9).
//
// Usage: node tools/run-headless.js [seed] [ticks] [replay-out.json]
//
// With a third argument the run is also saved as a replay. Save to
// replays/golden/ only on purpose: the golden test fails when a later change
// alters the hashes, and a SPEC_VERSION bump is the signal to re-record.

import { writeFileSync } from 'node:fs';
import { loadData } from '../test/helpers/load-data.js';
import { createState, step, hashState, Recorder } from '../src/sim/index.js';

const seed = Number(process.argv[2] ?? 1234567);
const ticks = Number(process.argv[3] ?? 5000);

const { config, dataHash } = loadData();
const players = [
  { id: 0, team: 0, kind: /** @type {const} */ ('human') },
  { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
];
const state = createState({ seed, players, config });
const rec = new Recorder({ seed, players, dataHash, mapgenVersion: config.mapgen.version });

const t0 = performance.now();
while (state.tick < ticks && !state.outcome) {
  const cmds = [];
  step(state, cmds);
  rec.record(state, cmds);
}
const ms = performance.now() - t0;

console.log(`seed=${seed} ticks=${state.tick} time=${ms.toFixed(1)}ms hash=${hashState(state)}`);

const out = process.argv[4];
if (out) {
  writeFileSync(out, JSON.stringify(rec.replay, null, 2) + '\n');
  console.log(`replay saved to ${out}`);
}
