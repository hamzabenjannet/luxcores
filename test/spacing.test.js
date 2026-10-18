import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, KIND } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createBot } from '../src/bot/bot.js';
import { formationOffset, meleeReach } from '../src/sim/reach.js';
import { loadData } from './helpers/load-data.js';

const { config } = loadData();
const R = config.balance.physics.unitRadiusMilliTiles;
const SPACING = config.balance.physics.unitSpacingMilliTiles;
const GAP = config.balance.physics.meleeGapMilliTiles;

function fresh() {
  const s = createState({ seed: 1234567, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }], config });
  s.teams[0].coreLux = 1_000_000;
  s.teams[1].coreLux = 1_000_000_000;
  const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === 1);
  core.hp = core.maxHp = 1_000_000_000;
  return s;
}
let seq = 0;
const send = (s, playerId, cmd) => step(s, [{ tick: s.tick, playerId, seq: seq++, cmd }]);
const run = (s, n) => { for (let i = 0; i < n; i++) step(s, []); };
const creeps = (s, team) => s.entities.filter((e) => e.kind === KIND.CREEP && e.team === team);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const minPair = (list) => {
  let m = Infinity;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) m = Math.min(m, dist(list[i], list[j]));
  return m;
};

test('the formation grid keeps the spacing from the data between neighbours and stays centered', () => {
  const s = fresh();
  const pitch = 2 * R + SPACING;
  const slots = Array.from({ length: 5 }, (_, i) => formationOffset(s, i, 5));
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    assert.ok(Math.hypot(slots[i].dx - slots[j].dx, slots[i].dz - slots[j].dz) >= pitch - 1, `slots ${i} and ${j} are one pitch apart or more`);
  }
  assert.deepEqual(formationOffset(s, 0, 1), { dx: 0, dz: 0 }, 'a single creep stands on the goal');
  assert.ok(slots.every((p) => Math.abs(p.dx) <= pitch), 'five creeps fit a lane 3 tiles wide');
});

test('a group walks spread out: about a tile between neighbours on the straight, never closer than three quarters of a tile', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 });
  const barracks = s.entities.find((e) => e.kind === KIND.BARRACKS);
  send(s, 0, { t: 'orderCreeps', barracksId: barracks.id, mix: ['melee', 'melee', 'melee', 'melee', 'melee'] });
  run(s, config.balance.creep.productionTicksPerGroup);
  assert.ok(minPair(creeps(s, 0)) >= 2 * R, 'a fresh group does not overlap');
  send(s, 0, { t: 'setGroupPath', groupId: s.groups[0].id, waypoints: [[40000, 80000], [40000, 72000], [44000, 64000]] });
  let closest = Infinity;
  let straight = Infinity;
  for (let i = 0; i < 380; i++) {
    step(s, []);
    const d = minPair(creeps(s, 0));
    closest = Math.min(closest, d);
    if (i < 100) straight = Math.min(straight, d); // before the first corner
  }
  assert.equal(s.groups[0].wpIndex, 3, 'the group walked the whole path');
  assert.ok(straight >= 2 * R + SPACING - 100, `on the straight neighbours keep about one tile (${straight})`);
  assert.ok(closest >= 2 * R + SPACING / 2 - 10, `even at the corners they keep three quarters of a tile (${closest}); touching is ${2 * R}`);
});

test('no unit overlaps another unit or walks into a building in a bot match', () => {
  const seed = 4;
  const players = [{ id: 0, team: 0, kind: 'bot' }, { id: 1, team: 1, kind: 'bot' }];
  const s = createState({ seed, players, config });
  const bots = players.map((p) => createBot({ playerId: p.id, team: p.team, config, seed }));
  const views = players.map((p) => localWorldView(s, p.team));
  let worstPair = Infinity;
  let worstWall = Infinity;
  for (let t = 0; t < 3000 && !s.outcome; t++) {
    step(s, bots.flatMap((b, i) => b.think(views[i])));
    const units = s.entities.filter((e) => e.kind === KIND.CREEP || e.kind === KIND.HERO);
    worstPair = Math.min(worstPair, minPair(units));
    for (const u of units) {
      for (const b of s.entities) {
        if (b.kind > KIND.BLOCKER) continue;
        const dx = Math.max(Math.abs(u.x - b.x) - 500, 0);
        const dz = Math.max(Math.abs(u.z - b.z) - 500, 0);
        worstWall = Math.min(worstWall, Math.hypot(dx, dz));
      }
    }
  }
  assert.ok(s.entities.filter((e) => e.kind === KIND.CREEP).length > 10, 'the match had crowds');
  assert.ok(worstPair >= 2 * R - 3, `closest two units: ${worstPair} (touching is ${2 * R})`);
  assert.ok(worstWall >= R - 3, `closest a unit center got to a building: ${worstWall} (touching is ${R})`);
});

test('units walk around older buildings too: the collision does not depend on which id is lower', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'tower', tileX: 30, tileZ: 88, attack: 'melee' }); // lower id than the creep
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 91 });
  const tower = s.entities.find((e) => e.kind === KIND.TOWER);
  const barracks = s.entities.find((e) => e.kind === KIND.BARRACKS);
  send(s, 0, { t: 'orderCreeps', barracksId: barracks.id, mix: ['melee'] });
  run(s, config.balance.creep.productionTicksPerGroup);
  const creep = creeps(s, 0)[0];
  // Aim straight through the tower; the creep must end up outside its square.
  send(s, 0, { t: 'setGroupPath', groupId: s.groups[0].id, waypoints: [[30500, 86000]] });
  let deepest = Infinity;
  for (let i = 0; i < 300; i++) {
    step(s, []);
    deepest = Math.min(deepest, Math.hypot(Math.max(Math.abs(creep.x - tower.x) - 500, 0), Math.max(Math.abs(creep.z - tower.z) - 500, 0)));
  }
  assert.ok(deepest >= R - 3, `the creep stayed out of the tower (${deepest})`);
});

test('a melee attacker keeps the gap from the data: edge to edge for a unit, a tile for a building', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 });
  send(s, 1, { t: 'build', building: 'barracks', tileX: 65, tileZ: 20 });
  const [mine, theirs] = [0, 1].map((team) => s.entities.find((e) => e.kind === KIND.BARRACKS && e.team === team));
  send(s, 0, { t: 'orderCreeps', barracksId: mine.id, mix: ['melee'] });
  send(s, 1, { t: 'orderCreeps', barracksId: theirs.id, mix: ['melee'] });
  run(s, config.balance.creep.productionTicksPerGroup);
  const [a] = creeps(s, 0);
  const [b] = creeps(s, 1);
  assert.equal(meleeReach(s, b), 2 * R + GAP, 'unit against unit: both radii plus the gap');
  assert.equal(meleeReach(s, theirs), R + 500 + GAP, 'unit against a building: its radius, half a tile and the gap');
  // Put the two creeps 3 tiles apart in open ground and let them meet.
  a.x = 50000; a.z = 60000; b.x = 53000; b.z = 60000;
  for (let i = 0; i < 80; i++) step(s, []);
  const d = dist(a, b);
  assert.ok(d >= 2 * R + GAP - 60 && d <= 2 * R + GAP + 120, `they stand ${d} apart: touching is ${2 * R}, the gap makes it ${2 * R + GAP}`);
  assert.ok(a.hp < a.maxHp || b.hp < b.maxHp, 'and they hit each other from there');
});
