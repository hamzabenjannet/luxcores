// Records the item golden replay: both players buy items, one hero hastes, funnels lux with Energy
// Grab and kills the other, whose loot bag the winner then picks up. The replay pins the barracks
// shop, delivery to the inventory, the four item effects, the loot bag, the pickup and a map spawn.
//
// Usage: node tools/record-item-golden.js [replay-out.json]
//
// The default output is replays/golden/items-seed-616161.json. Re-record it on purpose, in the
// same commit as the rule change that moved its hashes.

import { writeFileSync } from 'node:fs';
import { loadData } from '../test/helpers/load-data.js';
import { createState, step, hashState, Recorder, KIND, heroOf, countOf } from '../src/sim/index.js';

const out = process.argv[2] ?? 'replays/golden/items-seed-616161.json';
const SEED = 616161;
const TICKS = 1800;
const players = [
  { id: 0, team: 0, kind: /** @type {const} */ ('human') },
  { id: 1, team: 1, kind: /** @type {const} */ ('human') },
];

const { config, dataHash } = loadData();
const state = createState({ seed: SEED, players, config });
const barracks = (/** @type {number} */ p) => state.entities.find((e) => e.kind === KIND.BARRACKS && e.owner === p)?.id ?? 0;
const hero = (/** @type {number} */ p) => heroOf(state, p)?.id ?? 0;
const lootable = () => state.entities.find((e) => e.kind === KIND.LOOT_BAG || e.kind === KIND.GROUND_ITEM)?.id ?? 0;

/** tick -> commands, made when the tick comes so they can read ids. */
const script = new Map([
  [0, () => [[0, { t: 'build', building: 'barracks', tileX: 40, tileZ: 90 }], [1, { t: 'build', building: 'barracks', tileX: 55, tileZ: 20 }]]],
  [5, () => [
    [0, { t: 'pickHero', heroId: 0, lux: 10, barracksId: barracks(0) }], [1, { t: 'pickHero', heroId: 1, lux: 10, barracksId: barracks(1) }],
    [0, { t: 'orderItem', barracksId: barracks(0), itemId: 2 }], [0, { t: 'orderItem', barracksId: barracks(0), itemId: 1 }],
    [1, { t: 'orderItem', barracksId: barracks(1), itemId: 3 }], [1, { t: 'orderItem', barracksId: barracks(1), itemId: 0 }],
  ]],
  [200, () => [[0, { t: 'heroMove', x: 48500, z: 59500 }], [1, { t: 'heroMove', x: 48500, z: 54500 }]]],
  [600, () => [
    [0, { t: 'useItem', inventorySlot: 2 }], [0, { t: 'useItem', inventorySlot: 1 }],
    [0, { t: 'heroAttack', targetId: hero(1) }],
    [1, { t: 'useItem', inventorySlot: 3, targetId: hero(0) }],
  ]],
  [1220, () => [[0, { t: 'pickUp', groundItemId: lootable() }]]],
  [1500, () => [[0, { t: 'pickUp', groundItemId: lootable() }]]],
]);

const rec = new Recorder({ seed: SEED, players, dataHash, mapgenVersion: config.mapgen.version });
const seq = [0, 0];
const seen = { bags: 0, grounds: 0, items: 0 };
while (state.tick < TICKS && !state.outcome) {
  const cmds = (script.get(state.tick)?.() ?? []).map(([playerId, cmd]) => ({ tick: state.tick, playerId, seq: seq[playerId]++, cmd }));
  const itemsBefore = state.players.map((p) => countOf(p.items));
  step(state, cmds);
  seen.bags = Math.max(seen.bags, state.entities.filter((e) => e.kind === KIND.LOOT_BAG).length);
  seen.grounds = Math.max(seen.grounds, state.entities.filter((e) => e.kind === KIND.GROUND_ITEM).length);
  seen.items += state.players.reduce((n, p, i) => n + Math.max(0, countOf(p.items) - itemsBefore[i]), 0);
  rec.record(state, cmds);
}

writeFileSync(out, JSON.stringify(rec.replay, null, 2) + '\n');
console.log(`seed=${SEED} ticks=${state.tick} hash=${hashState(state)} commands=${rec.replay.commands.length}`);
console.log(`items delivered ${seen.items}, loot bags ${seen.bags}, ground items ${seen.grounds}, Energy Grab budget left ${state.players[0].funnelLux}`);
console.log(`inventories ${state.players.map((p) => JSON.stringify(p.items)).join(' ')}, heroes alive ${[0, 1].filter((p) => heroOf(state, p)).length}`);
console.log(`saved ${out}`);
