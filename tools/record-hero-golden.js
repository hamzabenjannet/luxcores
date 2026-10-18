// Records the hero golden replay: two human heroes walk to the middle of the map and fight with
// attacks and all four abilities, so the replay pins picks, the rotation, the dash, damage, stuns,
// shields and deaths.
//
// Usage: node tools/record-hero-golden.js [replay-out.json]
//
// The default output is replays/golden/heroes-seed-515151.json. Re-record it on purpose, in the
// same commit as the rule change that moved its hashes.

import { writeFileSync } from 'node:fs';
import { loadData } from '../test/helpers/load-data.js';
import { createState, step, hashState, Recorder, KIND, heroOf } from '../src/sim/index.js';

const out = process.argv[2] ?? 'replays/golden/heroes-seed-515151.json';
const SEED = 515151;
const TICKS = 1800;
const players = [
  { id: 0, team: 0, kind: /** @type {const} */ ('human') },
  { id: 1, team: 1, kind: /** @type {const} */ ('human') },
];

const { config, dataHash } = loadData();
const state = createState({ seed: SEED, players, config });
const barracks = (/** @type {number} */ p) => state.entities.find((e) => e.kind === KIND.BARRACKS && e.owner === p)?.id ?? 0;
const hero = (/** @type {number} */ p) => heroOf(state, p)?.id ?? 0;

/** tick -> commands, made when the tick comes so they can read ids. */
const script = new Map([
  [0, () => [[0, { t: 'build', building: 'barracks', tileX: 40, tileZ: 90 }], [1, { t: 'build', building: 'barracks', tileX: 55, tileZ: 20 }]]],
  [5, () => [[0, { t: 'pickHero', heroId: 4, lux: 30, barracksId: barracks(0) }], [1, { t: 'pickHero', heroId: 1, lux: 30, barracksId: barracks(1) }]]],
  [120, () => [[0, { t: 'heroMove', x: 48500, z: 59500 }], [1, { t: 'heroMove', x: 48500, z: 52500 }]]],
  [800, () => [[0, { t: 'castAbility', slot: 3, targetId: hero(0) }], [1, { t: 'castAbility', slot: 1, targetId: hero(0) }]]],
  [830, () => [[0, { t: 'heroAttack', targetId: hero(1) }]]],
  [900, () => [[0, { t: 'castAbility', slot: 0 }], [1, { t: 'castAbility', slot: 2, x: 48500, z: 58500 }]]],
  [1000, () => [[1, { t: 'castAbility', slot: 3, targetId: hero(1) }], [0, { t: 'castAbility', slot: 1, targetId: hero(1) }]]],
  [1150, () => [[0, { t: 'castAbility', slot: 0 }], [1, { t: 'castAbility', slot: 1, targetId: hero(0) }]]],
]);

const rec = new Recorder({ seed: SEED, players, dataHash, mapgenVersion: config.mapgen.version });
const seq = [0, 0];
const accepted = { casts: 0, picks: 0 };
while (state.tick < TICKS && !state.outcome) {
  const cmds = (script.get(state.tick)?.() ?? []).map(([playerId, cmd]) => ({ tick: state.tick, playerId, seq: seq[playerId]++, cmd }));
  const cd = (/** @type {number} */ p) => { const h = heroOf(state, p); return h ? h.cd0 + h.cd1 + h.cd2 + h.cd3 : 0; };
  const before = [cd(0), cd(1)];
  step(state, cmds);
  for (const c of cmds) {
    if (c.cmd.t === 'castAbility' && cd(c.playerId) > before[c.playerId]) accepted.casts++;
    if (c.cmd.t === 'pickHero' && state.orders.some((o) => o.owner === c.playerId)) accepted.picks++;
  }
  rec.record(state, cmds);
}

writeFileSync(out, JSON.stringify(rec.replay, null, 2) + '\n');
console.log(`seed=${SEED} ticks=${state.tick} hash=${hashState(state)} commands=${rec.replay.commands.length}`);
console.log(`accepted picks ${accepted.picks}, accepted casts ${accepted.casts}, heroes alive ${[0, 1].filter((p) => heroOf(state, p)).length}`);
console.log(`saved ${out}`);
