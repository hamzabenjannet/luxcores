// Records the economy golden replay: a scripted command log that exercises
// builds, refusals, income, recycle, cancel, a day/night cycle and a meltdown.
//
// Usage: node tools/record-economy-golden.js [replay-out.json]
//
// The default output is replays/golden/economy-seed-424242.json. Re-record it on
// purpose, in the same commit as the rule change that moved its hashes.

import { writeFileSync } from 'node:fs';
import { loadData } from '../test/helpers/load-data.js';
import { createState, step, hashState, Recorder, KIND } from '../src/sim/index.js';

const out = process.argv[2] ?? 'replays/golden/economy-seed-424242.json';
const SEED = 424242;
const TICKS = 3000;
const players = [
  { id: 0, team: 0, kind: /** @type {const} */ ('human') },
  { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
];

const { config, dataHash } = loadData();
const state = createState({ seed: SEED, players, config });

/** The n-th free tile of a team's build zone, away from vents and blockers. */
function freeTile(team, n) {
  const taken = new Set(state.entities.filter((e) => e.kind <= KIND.BLOCKER).map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`));
  for (const v of state.map.vents) taken.add(`${v.tileX},${v.tileZ}`);
  const rows = team === 0 ? [64, 111] : [47, 0];
  let found = 0;
  for (let z = rows[0]; team === 0 ? z <= rows[1] : z >= rows[1]; z += team === 0 ? 1 : -1) {
    for (let x = 4; x < 92; x += 3) {
      if (!taken.has(`${x},${z}`) && found++ === n) return { tileX: x, tileZ: z };
    }
  }
  throw new Error('no free tile');
}

const vent = state.map.vents.find((v) => v.team === 0);
// Tile choices are computed before the match starts, so the script is fixed.
const A = freeTile(0, 0); const B = freeTile(0, 1); const C = freeTile(0, 2); const D = freeTile(0, 3);
const E = freeTile(1, 0);

/** tick -> commands. Entity ids follow creation order: 1 and 2 are the Cores, 3 to 14 the blockers, then buildings from 15. */
const script = new Map([
  [0, [[0, { t: 'build', building: 'solar', ...A }], [1, { t: 'build', building: 'nuclear', ...E }]]], // ids 15 and 16
  [1, [[0, { t: 'build', building: 'wind', ...B }]]], // id 17
  [2, [[0, { t: 'build', building: 'geothermal', tileX: vent.tileX, tileZ: vent.tileZ }]]], // id 18, 20 lux left
  [3, [[0, { t: 'build', building: 'nuclear', ...C }]]], // refused: it would leave the Core under 1 lux
  [4, [[0, { t: 'build', building: 'geothermal', ...D }]]], // refused: not a vent tile
  [5, [[0, { t: 'build', building: 'solar', tileX: 48, tileZ: 60 }]]], // refused: the DMZ
  [120, [[0, { t: 'build', building: 'tower', ...C, attack: 'ranged' }]]], // id 19
  [400, [[0, { t: 'recycle', buildingId: 17 }]]], // the wind plant starts its channel
  [430, [[0, { t: 'cancelRecycle', buildingId: 17 }]]],
  [900, [[0, { t: 'recycle', buildingId: 15 }]]], // the solar leaves for good
  [1500, [[0, { t: 'build', building: 'barracks', ...D }]]],
]);

const rec = new Recorder({ seed: SEED, players, dataHash, mapgenVersion: config.mapgen.version });
const seq = [0, 0];
while (state.tick < TICKS && !state.outcome) {
  const cmds = (script.get(state.tick) ?? []).map(([playerId, cmd]) => ({ tick: state.tick, playerId, seq: seq[playerId]++, cmd }));
  step(state, cmds);
  rec.record(state, cmds);
}

writeFileSync(out, JSON.stringify(rec.replay, null, 2) + '\n');
const count = (kind) => state.entities.filter((e) => e.kind === kind).length;
console.log(`seed=${SEED} ticks=${state.tick} hash=${hashState(state)} commands=${rec.replay.commands.length}`);
console.log(`team 0 bank ${state.teams[0].coreLux / 1000} lux, team 1 bank ${state.teams[1].coreLux / 1000} lux; nuclear plants left ${count(KIND.NUCLEAR)} (team 1 melted down at tick ~2409)`);
console.log(`saved ${out}`);
