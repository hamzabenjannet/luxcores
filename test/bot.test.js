import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, step, hashState, KIND, buildZoneOf } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createBot } from '../src/bot/bot.js';

const { config } = loadData();

/**
 * Two bots play `ticks` ticks. Returns the final state and every command the bots issued.
 * @param {number} seed
 * @param {number} ticks
 */
function botMatch(seed, ticks) {
  const players = [
    { id: 0, team: 0, kind: /** @type {const} */ ('bot') },
    { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
  ];
  const state = createState({ seed, players, config });
  const bots = players.map((p) => createBot({ playerId: p.id, team: p.team, config, seed }));
  const views = players.map((p) => localWorldView(state, p.team));
  const issued = [];
  while (state.tick < ticks) {
    const cmds = bots.flatMap((bot, i) => bot.think(views[i]));
    issued.push(...cmds);
    step(state, cmds);
  }
  return { state, issued };
}

test('a bot match is reproducible: the same seed gives the same hash and the same commands', () => {
  const a = botMatch(99, 3000);
  const b = botMatch(99, 3000);
  assert.equal(hashState(a.state), hashState(b.state));
  assert.deepEqual(a.issued, b.issued);
});

test('different seeds give different matches', () => {
  assert.notEqual(hashState(botMatch(1, 1500).state), hashState(botMatch(2, 1500).state));
});

test('every command a bot issues is accepted by the sim', () => {
  const { state, issued } = botMatch(7, 6000);
  const builds = issued.filter((e) => e.cmd.t === 'build').length;
  const upgrades = issued.filter((e) => e.cmd.t === 'upgrade').length;
  const buildings = state.entities.filter((e) => e.kind >= KIND.SOLAR && e.kind <= KIND.TOWER);
  assert.equal(buildings.length, builds, 'a refused build leaves no building');
  const levels = buildings.reduce((sum, e) => sum + e.powerLevel + e.shellLevel, 0);
  assert.equal(levels, upgrades, 'a refused upgrade leaves no level');
});

test('a bot builds only in its own zone, off its lanes, and keeps the Core above the reserve', () => {
  const { state } = botMatch(7, 6000);
  for (const team of [0, 1]) {
    const { z0, z1 } = buildZoneOf(config, team);
    const laneTiles = new Set(state.map.lanes.filter((l) => l.team === team).flatMap((l) => l.tiles));
    for (const e of state.entities) {
      if (e.team !== team || e.kind < KIND.SOLAR || e.kind > KIND.TOWER) continue;
      const tileZ = Math.floor(e.z / 1000);
      assert.ok(tileZ >= z0 && tileZ <= z1, `team ${team} building ${e.id} at row ${tileZ}`);
      assert.ok(!laneTiles.has(tileZ * state.map.width + Math.floor(e.x / 1000)), `building ${e.id} stands on a lane`);
    }
    assert.ok(state.teams[team].coreLux >= 20_000, 'the reserve stays in the Core');
  }
});

test('the rotation builds a collector, a barracks, then a tower, and fills every tower upgrade', () => {
  const { state, issued } = botMatch(7, 6000);
  const first = issued.filter((e) => e.playerId === 0 && e.cmd.t === 'build').slice(0, 3).map((e) => e.cmd.building);
  assert.deepEqual([first[0], first[1], first[2]], ['solar', 'barracks', 'tower']);
  for (const tower of state.entities.filter((e) => e.kind === KIND.TOWER)) {
    assert.equal(tower.powerLevel, 3);
    assert.equal(tower.shellLevel, 3);
  }
});

test('a bot builds its geothermal collectors on its own vents', () => {
  const { state } = botMatch(7, 6000);
  for (const team of [0, 1]) {
    const geothermal = state.entities.filter((e) => e.team === team && e.kind === KIND.GEOTHERMAL);
    assert.ok(geothermal.length >= 1);
    for (const g of geothermal) {
      assert.ok(state.map.vents.some((v) => v.team === team && v.tileX === Math.floor(g.x / 1000) && v.tileZ === Math.floor(g.z / 1000)));
    }
  }
});
