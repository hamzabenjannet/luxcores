import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, hashState, KIND, MILLI, heroOf, exportState, importState } from '../src/sim/index.js';
import { loadData } from './helpers/load-data.js';

const { config } = loadData();
const players = [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }];

function fresh(lux = 1_000_000) {
  const s = createState({ seed: 1234567, players, config });
  for (const t of [0, 1]) {
    s.teams[t].coreLux = t === 0 ? lux : 1_000_000_000;
    const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === t);
    core.hp = s.teams[t].coreLux;
    core.maxHp = Math.max(core.maxHp, core.hp);
  }
  return s;
}
let seq = 0;
const send = (s, playerId, cmd) => step(s, [{ tick: s.tick, playerId, seq: seq++, cmd }]);
const run = (s, ticks) => { for (let i = 0; i < ticks; i++) step(s, []); };
const stats = (s, t) => ({
  collected: s.teams[t].statCollected, spent: s.teams[t].statSpent, drained: s.teams[t].statDrained,
  funneled: s.teams[t].statFunneled, recycled: s.teams[t].statRecycled, entropy: s.teams[t].statEntropy,
});

test('a new match counts nothing', () => {
  const s = fresh();
  assert.deepEqual(stats(s, 0), { collected: 0, spent: 0, drained: 0, funneled: 0, recycled: 0, entropy: 0 });
});

test('lux spent adds up every payment: buildings, upgrades, creeps, a hero, an ability and an item', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 }); // 40
  send(s, 0, { t: 'build', building: 'tower', tileX: 36, tileZ: 90, attack: 'ranged' }); // 20
  const tower = s.entities.find((e) => e.kind === KIND.TOWER);
  send(s, 0, { t: 'upgrade', towerId: tower.id, track: 'power' }); // 10
  const barracks = s.entities.find((e) => e.kind === KIND.BARRACKS);
  send(s, 0, { t: 'orderCreeps', barracksId: barracks.id, mix: ['melee', 'ranged'] }); // 10
  send(s, 0, { t: 'pickHero', heroId: 0, lux: 25, barracksId: barracks.id }); // 25
  send(s, 0, { t: 'orderItem', barracksId: barracks.id, itemId: 2 }); // 20
  assert.equal(stats(s, 0).spent, (40 + 20 + 10 + 10 + 25 + 20) * MILLI);
  run(s, 200);
  const hero = heroOf(s, 0);
  assert.ok(hero);
  send(s, 0, { t: 'castAbility', slot: 3, targetId: hero.id }); // 10
  assert.equal(stats(s, 0).spent, (40 + 20 + 10 + 10 + 25 + 20 + 10) * MILLI);
  assert.equal(stats(s, 1).spent, 0, 'the other team paid nothing');
});

test('lux collected counts what the collectors produce, before the pending pool settles it', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'solar', tileX: 30, tileZ: 90 });
  const before = stats(s, 0).collected;
  run(s, 400);
  const made = stats(s, 0).collected - before;
  assert.ok(made > 0);
  const settled = s.teams[0].coreLux + s.teams[0].pendingLux - (1_000_000 - 20 * MILLI);
  assert.equal(made + before, settled, 'bank and pool grew by exactly what was collected');
});

test('lux recycled counts the refund of a recycled building', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'solar', tileX: 30, tileZ: 90 });
  const solar = s.entities.find((e) => e.kind === KIND.SOLAR);
  send(s, 0, { t: 'recycle', buildingId: solar.id });
  run(s, config.balance.economy.recycleChannelTicks + 2);
  assert.ok(Math.abs(stats(s, 0).recycled - 12 * MILLI) < 100, `60 percent of the 20 lux of a plant, a little less after entropy: ${stats(s, 0).recycled}`);
});

test('lux lost to entropy counts the lux value that entities lose, for their own team', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 });
  const barracks = s.entities.find((e) => e.kind === KIND.BARRACKS);
  const hp = barracks.hp;
  run(s, 20 * 60);
  const lost = hp - barracks.hp;
  assert.ok(lost > 0);
  assert.equal(stats(s, 0).entropy, Math.trunc(lost / config.balance.hpFactor.default));
  assert.equal(stats(s, 1).entropy, 0);
});

test('lux drained counts the lux of the HP that damage removed from an enemy, never an own unit or a blocker', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 });
  const barracks = s.entities.find((e) => e.kind === KIND.BARRACKS);
  send(s, 0, { t: 'pickHero', heroId: 0, lux: 50, barracksId: barracks.id });
  run(s, 100);
  const hero = heroOf(s, 0);
  const enemy = { ...s.entities.find((e) => e.kind === KIND.CORE), id: s.nextId++, kind: KIND.CREEP, team: 1, owner: 1, x: hero.x + 700, z: hero.z, hp: 100_000, maxHp: 100_000, born: s.tick, movePath: [], waypoints: [], items: [] };
  s.entities.push(enemy);
  send(s, 0, { t: 'heroAttack', targetId: enemy.id });
  run(s, 60);
  const lost = 100_000 - enemy.hp;
  assert.ok(lost >= 20_000);
  assert.ok(stats(s, 0).drained > 0 && stats(s, 0).drained <= Math.trunc(lost / 10), 'ten HP per lux');
  assert.equal(stats(s, 0).drained % 2000, 0, 'each hit of 20 HP drains 2 lux; the entropy of the creep is no drain');
  assert.equal(stats(s, 1).drained, 0);
});

test('lux funneled counts Energy Grab, and the counters survive a checkpoint and stay in the hash', () => {
  const s = fresh();
  send(s, 0, { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 });
  const barracks = s.entities.find((e) => e.kind === KIND.BARRACKS);
  send(s, 0, { t: 'pickHero', heroId: 0, lux: 50, barracksId: barracks.id });
  run(s, 100);
  const hero = heroOf(s, 0);
  s.players[0].items = [0, 1, 0, 0];
  const enemy = { ...s.entities.find((e) => e.kind === KIND.CORE), id: s.nextId++, kind: KIND.CREEP, team: 1, owner: 1, x: hero.x + 700, z: hero.z, hp: 10_000_000, maxHp: 10_000_000, born: s.tick, movePath: [], waypoints: [], items: [] };
  s.entities.push(enemy);
  send(s, 0, { t: 'useItem', inventorySlot: 1 });
  send(s, 0, { t: 'heroAttack', targetId: enemy.id });
  run(s, 400);
  assert.ok(stats(s, 0).funneled > 0 && stats(s, 0).funneled <= 50 * MILLI);
  assert.ok(stats(s, 0).drained >= stats(s, 0).funneled, 'what is funneled was drained first');

  const copy = importState(JSON.parse(JSON.stringify(exportState(s))), config);
  assert.equal(hashState(copy), hashState(s));
  const before = hashState(s);
  s.teams[0].statDrained += 1;
  assert.notEqual(hashState(s), before, 'the counters are hashed');

  const old = JSON.parse(JSON.stringify(exportState(fresh())));
  for (const t of old.teams) for (const k of Object.keys(t)) if (k.startsWith('stat')) delete t[k];
  assert.deepEqual(stats(importState(old, config), 0), { collected: 0, spent: 0, drained: 0, funneled: 0, recycled: 0, entropy: 0 });
});
