import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, hashState, KIND, MILLI } from '../src/sim/index.js';
import { loadData } from './helpers/load-data.js';

const { config } = loadData();

/** A 1v1 state. Team 1 gets a huge bank so no match ends by accident, and team 0 enough lux to order freely. */
function fresh(lux = 1_000_000) {
  const s = createState({ seed: 1234567, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }], config });
  s.teams[0].coreLux = lux;
  s.teams[1].coreLux = 1_000_000_000;
  s.entities.find((e) => e.kind === KIND.CORE && e.team === 1).hp = 1_000_000_000;
  s.entities.find((e) => e.kind === KIND.CORE && e.team === 1).maxHp = 1_000_000_000;
  return s;
}

let seq = 0;
/** Sends one command now and steps one tick. Returns nothing: the tests read the state. */
function send(s, playerId, cmd) {
  step(s, [{ tick: s.tick, playerId, seq: seq++, cmd }]);
}
const run = (s, ticks) => { for (let i = 0; i < ticks; i++) step(s, []); };
const creeps = (s, team = 0) => s.entities.filter((e) => e.kind === KIND.CREEP && e.team === team);
const barracksOf = (s, team = 0) => s.entities.filter((e) => e.kind === KIND.BARRACKS && e.team === team);

/** Builds a barracks for team 0 and returns it. */
function withBarracks(s, tileX = 30, tileZ = 90) {
  send(s, 0, { t: 'build', building: 'barracks', tileX, tileZ });
  return barracksOf(s).find((b) => Math.floor(b.x / 1000) === tileX);
}
const order = (s, b, mix) => send(s, 0, { t: 'orderCreeps', barracksId: b.id, mix });
const build = config.balance.creep.productionTicksPerGroup;

test('an order pays 5 lux per creep and a group appears after the build time, next to the barracks', () => {
  const s = fresh();
  const b = withBarracks(s);
  const before = s.teams[0].coreLux;
  order(s, b, ['melee', 'melee', 'ranged']);
  assert.equal(s.teams[0].coreLux, before - 15 * MILLI);
  assert.equal(s.orders.length, 1);
  assert.equal(creeps(s).length, 0, 'nothing spawns before the build time');
  run(s, build - 2);
  assert.equal(creeps(s).length, 0);
  run(s, 1);
  assert.equal(creeps(s).length, 3);
  assert.equal(s.orders.length, 0);
  assert.equal(s.groups.length, 1);
  const group = s.groups[0];
  for (const c of creeps(s)) {
    assert.equal(c.groupId, group.id);
    assert.equal(c.hp, 50 * MILLI);
    assert.equal(c.owner, 0);
    assert.ok(Math.abs(c.x - b.x) <= 4000 && Math.abs(c.z - b.z) <= 4000, 'spawns beside its barracks');
  }
  assert.deepEqual(creeps(s).map((c) => c.attack), [1, 1, 2], 'the mix sets the attack type of each creep: melee, melee, ranged');
});

test('an order is refused for a bad mix, a foreign or non-barracks building, a recycling barracks and a poor Core', () => {
  const s = fresh(150_000);
  const b = withBarracks(s); // 40 lux
  const solar = (send(s, 0, { t: 'build', building: 'solar', tileX: 34, tileZ: 90 }), s.entities.find((e) => e.kind === KIND.SOLAR));
  const lux = s.teams[0].coreLux;
  for (const bad of [[], ['melee', 'melee', 'melee', 'melee', 'melee', 'melee'], ['laser'], [3], 'melee', undefined]) {
    order(s, b, bad);
  }
  send(s, 0, { t: 'orderCreeps', barracksId: solar.id, mix: ['melee'] });
  send(s, 1, { t: 'orderCreeps', barracksId: b.id, mix: ['melee'] });
  send(s, 0, { t: 'orderCreeps', barracksId: 99999, mix: ['melee'] });
  assert.equal(s.orders.length, 0);
  assert.equal(s.teams[0].coreLux, lux, 'refused orders cost nothing');
  // 150 - 40 (barracks) - 20 (solar) = 90 lux, so three groups of 5 fit and the fourth would leave less than 1 lux.
  for (let i = 0; i < 4; i++) order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']);
  assert.equal(s.orders.length, 3);
  send(s, 0, { t: 'recycle', buildingId: b.id });
  order(s, b, ['melee']);
  assert.equal(s.orders.length, 3, 'a recycling barracks takes no order');
});

test('a barracks builds one group at a time and two barracks build side by side', () => {
  const s = fresh();
  const a = withBarracks(s, 30, 90);
  const c = withBarracks(s, 60, 90);
  order(s, a, ['melee']);
  order(s, a, ['melee']);
  order(s, c, ['ranged']);
  run(s, build);
  assert.equal(creeps(s).length, 2, 'one group from each barracks after one build time');
  run(s, build);
  assert.equal(creeps(s).length, 3, 'the second order of the first barracks follows');
});

test('the creep cap holds a finished group, and a later order skips ahead of it', () => {
  const s = fresh();
  const b = withBarracks(s);
  for (let i = 0; i < 5; i++) order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']); // 25
  order(s, b, ['melee']); // 26
  run(s, build * 6);
  assert.equal(creeps(s).length, 26);

  order(s, b, ['ranged', 'ranged', 'ranged', 'ranged', 'ranged']); // would make 31: held
  order(s, b, ['area', 'area', 'area']); // 29: fits
  run(s, build);
  assert.equal(creeps(s).length, 26, 'the 5-group finishes and is held');
  assert.equal(s.orders.length, 2);
  assert.equal(s.orders[0].held, 1);
  run(s, build);
  assert.equal(creeps(s).length, 29, 'the later 3-group skipped ahead of the held one');
  assert.equal(s.orders.length, 1);
  assert.equal(s.orders[0].held, 1);
  assert.deepEqual(s.orders[0].mix, [2, 2, 2, 2, 2]);

  // Four creeps die: 25 alive, so the held 5-group fits exactly.
  for (const c of creeps(s).slice(0, 4)) c.hp = 0;
  run(s, 2); // the deaths clear at the end of the first tick, and production sees the room in the second
  assert.equal(creeps(s).length, 30, 'the held group spawns as soon as the cap has room');
  assert.equal(s.orders.length, 0);
});

test('cancelling an order refunds it in full and counts held groups in the queue index', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee', 'melee']);
  order(s, b, ['ranged']);
  const lux = s.teams[0].coreLux;
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, index: 5 });
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, index: -1 });
  send(s, 1, { t: 'cancelQueue', barracksId: b.id, index: 0 });
  assert.equal(s.orders.length, 2, 'a bad index or a foreign player cancels nothing');
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, index: 1 });
  assert.equal(s.orders.length, 1);
  assert.equal(s.teams[0].coreLux, lux + 5 * MILLI, 'the 1-creep order comes back in full');
  assert.deepEqual(s.orders[0].mix, [1, 1]);
});

test('cancelling by order id hits that order even after the queue shifted', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee']);
  order(s, b, ['ranged', 'ranged']);
  order(s, b, ['area', 'area', 'area']);
  const [first, second, third] = s.orders.map((o) => o.id);
  run(s, build); // the first group finishes and leaves the queue, so every index moves up by one
  assert.deepEqual(s.orders.map((o) => o.id), [second, third]);
  const lux = s.teams[0].coreLux;
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, orderId: first }); // already built: nothing to cancel
  assert.equal(s.orders.length, 2);
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, orderId: third });
  assert.deepEqual(s.orders.map((o) => o.id), [second], 'the named order went, not the one at its old index');
  assert.equal(s.teams[0].coreLux, lux + 15 * MILLI);
  send(s, 1, { t: 'cancelQueue', barracksId: b.id, orderId: second });
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, orderId: 'x' });
  send(s, 0, { t: 'cancelQueue', barracksId: b.id });
  assert.equal(s.orders.length, 1, 'a foreign player, a bad id and no id cancel nothing');
});

test('recycling a barracks refunds the queued orders, and a destroyed one loses them with no refund', () => {
  /** Core lux gained by recycling a barracks that holds the given orders. */
  const gain = (orders) => {
    const s = fresh();
    const b = withBarracks(s);
    // Pad to two commands with refused ones, so every case recycles at the same tick and entropy matches.
    for (const mix of [...orders, ['laser'], ['laser']].slice(0, 2)) order(s, b, mix);
    const before = s.teams[0].coreLux;
    send(s, 0, { t: 'recycle', buildingId: b.id });
    run(s, config.balance.economy.recycleChannelTicks);
    assert.equal(s.orders.length, 0, 'the queue went with the barracks');
    return s.teams[0].coreLux - before;
  };
  const empty = gain([]);
  assert.ok(empty > 20_000, 'the barracks itself refunds about 60% of 40 lux');
  assert.equal(gain([['melee', 'melee', 'melee'], ['melee', 'melee']]) - empty, 25 * MILLI, 'plus 100% of the 5 queued creeps');

  const t = fresh();
  const doomed = withBarracks(t);
  order(t, doomed, ['melee', 'melee']);
  const lux = t.teams[0].coreLux;
  doomed.hp = 0; // an enemy destroyed it
  run(t, 1);
  assert.equal(t.orders.length, 0, 'the order is lost');
  assert.equal(t.teams[0].coreLux, lux, 'no refund');
});

test('the odd creep of a split stays: 7 becomes 4 and 3, a group of 1 cannot split, and both halves keep the path', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']);
  order(s, b, ['ranged', 'ranged']);
  run(s, build * 2);
  const [one, two] = s.groups;
  send(s, 0, { t: 'mergeGroups', intoGroupId: one.id, fromGroupId: two.id });
  assert.equal(s.groups.length, 1);
  assert.equal(creeps(s).filter((c) => c.groupId === one.id).length, 7);

  send(s, 0, { t: 'setGroupPath', groupId: one.id, waypoints: [[20000, 80000], [30000, 70000]] });
  send(s, 0, { t: 'splitGroup', groupId: one.id });
  assert.equal(s.groups.length, 2);
  const sizes = s.groups.map((g) => creeps(s).filter((c) => c.groupId === g.id).length);
  assert.deepEqual(sizes, [4, 3], 'the original keeps the extra creep');
  assert.deepEqual(s.groups[0].waypoints, s.groups[1].waypoints);
  assert.equal(s.groups[1].custom, 1);

  // The new group holds the highest ids, so the original keeps the lowest.
  const original = creeps(s).filter((c) => c.groupId === s.groups[0].id).map((c) => c.id);
  const split = creeps(s).filter((c) => c.groupId === s.groups[1].id).map((c) => c.id);
  assert.ok(Math.max(...original) < Math.min(...split));

  send(s, 0, { t: 'splitGroup', groupId: s.groups[1].id }); // 3 -> 2 + 1
  assert.deepEqual(s.groups.map((g) => creeps(s).filter((c) => c.groupId === g.id).length), [4, 2, 1]);
  const single = s.groups[2];
  const count = s.groups.length;
  send(s, 0, { t: 'splitGroup', groupId: single.id });
  assert.equal(s.groups.length, count, 'a group of 1 does not split');
});

test('a merge joins B to A with the path of A, and the cap and ownership are enforced', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee', 'melee', 'melee']);
  order(s, b, ['ranged', 'ranged']);
  run(s, build * 2);
  const [a, c] = s.groups;
  send(s, 0, { t: 'setGroupPath', groupId: a.id, waypoints: [[10000, 90000]] });
  send(s, 1, { t: 'mergeGroups', intoGroupId: a.id, fromGroupId: c.id });
  send(s, 0, { t: 'mergeGroups', intoGroupId: a.id, fromGroupId: a.id });
  send(s, 0, { t: 'mergeGroups', intoGroupId: a.id, fromGroupId: 424242 });
  assert.equal(s.groups.length, 2, 'a foreign player, the same group and an unknown group all fail');
  send(s, 0, { t: 'mergeGroups', intoGroupId: a.id, fromGroupId: c.id });
  assert.equal(s.groups.length, 1);
  assert.deepEqual(s.groups[0].waypoints, [[10000, 90000]], 'B took the path of A');
  assert.equal(creeps(s).every((x) => x.groupId === a.id), true);
});

test('one merged group can hold all 30 creeps of a player', () => {
  const s = fresh();
  const b = withBarracks(s);
  for (let i = 0; i < 6; i++) order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']);
  run(s, build * 6);
  assert.equal(creeps(s).length, 30);
  assert.equal(s.groups.length, 6);
  for (const g of s.groups.slice(1)) send(s, 0, { t: 'mergeGroups', intoGroupId: s.groups[0].id, fromGroupId: g.id });
  assert.equal(s.groups.length, 1);
  assert.equal(creeps(s).every((c) => c.groupId === s.groups[0].id), true);
});

test('group paths: up to 10 whole-unit waypoints inside the map; anything else is refused', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee']);
  run(s, build);
  const g = s.groups[0];
  const tenPoints = Array.from({ length: 10 }, (_, i) => [10000 + i * 1000, 80000]);
  send(s, 0, { t: 'setGroupPath', groupId: g.id, waypoints: [...tenPoints, [1000, 1000]] });
  assert.equal(g.custom, 0, 'eleven waypoints are refused');
  for (const bad of [[[1.5, 2000]], [[-1, 5]], [[96000, 5]], [[5, 112000]], [[1, 2, 3]], 'x', [['a', 1]], null]) {
    send(s, 0, { t: 'setGroupPath', groupId: g.id, waypoints: bad });
    assert.equal(g.custom, 0, JSON.stringify(bad));
  }
  send(s, 1, { t: 'setGroupPath', groupId: g.id, waypoints: tenPoints });
  assert.equal(g.custom, 0, 'only the owner sets a path');
  send(s, 0, { t: 'setGroupPath', groupId: g.id, waypoints: tenPoints });
  assert.equal(g.custom, 1);
  assert.equal(g.waypoints.length, 10);
  assert.equal(g.wpIndex, 0);
  send(s, 0, { t: 'setGroupPath', groupId: g.id, waypoints: [] });
  assert.equal(g.custom, 0, 'an empty path puts the group back on the lane route');
  assert.ok(g.waypoints.length >= 8 && g.waypoints[g.waypoints.length - 1][1] < 30000, 'the lane route runs on to the enemy half');
});

test('a group walks its waypoints in order, then heads for the enemy Core', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee', 'melee']);
  run(s, build);
  const g = s.groups[0];
  const spots = [[40000, 80000], [60000, 75000]];
  send(s, 0, { t: 'setGroupPath', groupId: g.id, waypoints: spots });
  const near = (c, [x, z]) => Math.hypot(c.x - x, c.z - z) < 2500;
  let visited = 0;
  for (let i = 0; i < 900 && visited < 2; i++) {
    step(s, []);
    if (near(creeps(s)[0], spots[visited])) visited++;
  }
  assert.equal(visited, 2, 'the leader reached both waypoints, in order');
  run(s, 60);
  assert.equal(g.wpIndex, 2);
  const enemy = s.entities.find((e) => e.kind === KIND.CORE && e.team === 1);
  const d0 = Math.hypot(creeps(s)[0].x - enemy.x, creeps(s)[0].z - enemy.z);
  run(s, 200);
  assert.ok(Math.hypot(creeps(s)[0].x - enemy.x, creeps(s)[0].z - enemy.z) < d0, 'after the last waypoint it closes on the enemy Core');
});

test('a barracks default path is inherited by new groups only, and the lane route is the default', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee']);
  run(s, build);
  const before = s.groups[0];
  assert.equal(before.custom, 0);
  assert.ok(before.waypoints.length >= 8, 'the lane route runs along own lane, across the center and down the enemy lane');
  const last = before.waypoints[before.waypoints.length - 1];
  assert.ok(last[1] < 30000, 'it ends in the enemy half');

  send(s, 0, { t: 'setBarracksPath', barracksId: b.id, waypoints: [[20000, 70000]] });
  order(s, b, ['melee']);
  run(s, build);
  const after = s.groups[1];
  assert.equal(after.custom, 1);
  assert.deepEqual(after.waypoints, [[20000, 70000]]);
  assert.equal(before.custom, 0, 'an existing group keeps its path');
  after.waypoints[0][0] = 1;
  assert.deepEqual(b.waypoints, [[20000, 70000]], 'groups copy the default path');

  send(s, 0, { t: 'setBarracksPath', barracksId: b.id, waypoints: [] });
  assert.deepEqual(b.waypoints, []);
  send(s, 1, { t: 'setBarracksPath', barracksId: b.id, waypoints: [[1000, 1000]] });
  assert.deepEqual(b.waypoints, [], 'only the owner sets it');
});

test('creeps walk the lane across the map and destroy an undefended Lumen Core', () => {
  const s = fresh();
  s.teams[1].coreLux = 100_000; // 100 lux
  s.entities.find((e) => e.kind === KIND.CORE && e.team === 1).hp = 100_000;
  const b = withBarracks(s);
  order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']);
  for (let i = 0; i < 2400 && !s.outcome; i++) step(s, []);
  assert.deepEqual(s.outcome, { winnerTeam: 0 }, 'five creeps down a lane end an empty base');
  assert.ok(s.tick > 800 && s.tick < 2000, `the walk takes about 40 s plus the fight (tick ${s.tick})`);
});

test('creeps destroy an enemy building they meet on their way', () => {
  const s = fresh();
  const b = withBarracks(s);
  // An enemy collector in team 1's zone, a few tiles from the lane the creeps take.
  send(s, 1, { t: 'build', building: 'solar', tileX: 13, tileZ: 47 });
  const target = s.entities.find((e) => e.kind === KIND.SOLAR && e.team === 1);
  assert.ok(target, 'the collector was built');
  order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']);
  let damagedAt = 0;
  for (let i = 0; i < 1800 && s.entities.includes(target); i++) {
    step(s, []);
    if (!damagedAt && target.hp < target.maxHp - 1000) damagedAt = s.tick;
  }
  assert.ok(damagedAt > 0, 'the collector took damage first');
  assert.equal(s.entities.includes(target), false, 'five melee creeps destroy a 20-lux collector');
  assert.equal(creeps(s).length > 0, true, 'and they survive an undefended target');
});

/** One creep of the given attack type and an enemy collector `tiles` away; true when the collector lost HP within 3 ticks. */
function hitsFrom(type, tiles) {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, [type]);
  run(s, build);
  const creep = creeps(s)[0];
  send(s, 1, { t: 'build', building: 'solar', tileX: 5, tileZ: 5 });
  const dummy = s.entities.find((e) => e.kind === KIND.SOLAR && e.team === 1);
  dummy.x = creep.x + Math.round(tiles * 1000);
  dummy.z = creep.z;
  const before = dummy.hp;
  run(s, 3);
  return dummy.hp < before;
}

test('attack types reach as far as the GDD says: melee touches, area reaches 3 tiles, ranged 4', () => {
  assert.equal(hitsFrom('ranged', 3.9), true);
  assert.equal(hitsFrom('ranged', 4.5), false);
  assert.equal(hitsFrom('area', 2.9), true);
  assert.equal(hitsFrom('area', 3.5), false);
  assert.equal(hitsFrom('melee', 0.9), true);
  assert.equal(hitsFrom('melee', 3.5), false);
});

test('an enemy tower shoots creeps, and a stunned creep stops walking', () => {
  const s = fresh();
  const b = withBarracks(s);
  send(s, 1, { t: 'build', building: 'tower', tileX: 16, tileZ: 40, attack: 'ranged' });
  assert.ok(s.entities.some((e) => e.kind === KIND.TOWER), 'the tower was built');
  order(s, b, ['melee', 'melee', 'melee', 'melee', 'melee']);
  const group = () => creeps(s);
  let hurt = false;
  for (let i = 0; i < 1100 && !hurt; i++) {
    step(s, []);
    hurt = group().some((c) => c.hp < c.maxHp - 1000);
  }
  assert.ok(hurt, 'the tower damages creeps that come into its range');

  const c = group()[0];
  const before = { x: c.x, z: c.z };
  c.stunTicks = 20;
  c.targetId = 0;
  run(s, 3);
  assert.ok(Math.hypot(c.x - before.x, c.z - before.z) < 300, 'a stunned creep does not walk');
});

test('dead creeps leave their group, an empty group disappears, and creeps lose 0.1% of their HP per second', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ['melee', 'melee']);
  run(s, build);
  const [a, c] = creeps(s);
  a.hp = 0;
  run(s, 1);
  assert.equal(creeps(s).length, 1);
  assert.equal(s.groups.length, 1, 'the group lives with one creep');
  c.hp = 0;
  run(s, 1);
  assert.equal(s.groups.length, 0, 'an empty group disappears');
  const t = fresh();
  const d = withBarracks(t);
  order(t, d, ['melee']);
  run(t, build);
  const creep = creeps(t)[0];
  const born = creep.born;
  while (t.tick <= born + 1200) step(t, []);
  assert.equal(creep.hp, creep.maxHp - creep.maxHp * 6 / 100, 'one minute removed exactly 6% of its max HP');
});

test('the hash covers orders, groups and paths, and a replay of the commands reproduces it', () => {
  const play = (mix, path) => {
    const s = fresh();
    const b = withBarracks(s);
    order(s, b, mix);
    run(s, build);
    if (path) send(s, 0, { t: 'setGroupPath', groupId: s.groups[0].id, waypoints: path });
    run(s, 30);
    return hashState(s);
  };
  const base = play(['melee', 'melee'], [[10000, 80000]]);
  assert.equal(play(['melee', 'melee'], [[10000, 80000]]), base, 'same commands, same hash');
  assert.notEqual(play(['melee', 'ranged'], [[10000, 80000]]), base, 'the mix is part of the state');
  assert.notEqual(play(['melee', 'melee'], [[11000, 80000]]), base, 'the path is part of the state');
  assert.notEqual(play(['melee', 'melee'], null), base);
});

test('auto spawn repeats the last creep order of a barracks after every group it spawns', () => {
  const s = fresh();
  const b = withBarracks(s);
  send(s, 0, { t: 'setAutoSpawn', barracksId: b.id, on: true });
  assert.equal(b.autoSpawn, 1);
  const mix = ['melee', 'ranged', 'area', 'melee', 'ranged'];
  const before = s.teams[0].coreLux;
  order(s, b, mix);
  assert.equal(s.teams[0].coreLux, before - 25 * MILLI, 'the first order pays 5 lux per creep');
  run(s, build - 1);
  assert.equal(creeps(s).length, 5, 'the first wave spawned');
  assert.equal(s.orders.length, 1, 'the same wave is queued again');
  assert.deepEqual(s.orders[0].mix, [1, 2, 3, 1, 2], 'the repeat keeps the mix of the order it followed');
  assert.equal(s.orders[0].ticksLeft, build, 'the repeat starts its build time over');
  assert.equal(s.teams[0].coreLux, before - 50 * MILLI, 'the repeat pays the full price');
  run(s, build);
  assert.equal(creeps(s).length, 10, 'the second wave spawned');
  assert.equal(s.orders.length, 1, 'and queued a third');
});

test('auto spawn stops when it is turned off, and the lux runs the chain', () => {
  const s = fresh();
  const b = withBarracks(s);
  send(s, 0, { t: 'setAutoSpawn', barracksId: b.id, on: true });
  order(s, b, ['melee']);
  run(s, build - 1);
  assert.equal(s.orders.length, 1, 'the repeat is queued');
  send(s, 0, { t: 'setAutoSpawn', barracksId: b.id, on: false });
  assert.equal(b.autoSpawn, 0);
  run(s, build);
  assert.equal(creeps(s).length, 2, 'the queued repeat still spawns');
  assert.equal(s.orders.length, 0, 'and nothing follows it');

  // A team that cannot pay the repeat ends the chain, and the toggle stays on.
  const t = fresh();
  const c = withBarracks(t, 31, 90);
  send(t, 0, { t: 'setAutoSpawn', barracksId: c.id, on: true });
  order(t, c, ['melee']);
  t.teams[0].coreLux = config.balance.core.minLeftAfterSpendLux + 4 * MILLI;
  run(t, build - 1);
  assert.equal(creeps(t).length, 1, 'the paid wave spawned');
  assert.equal(t.orders.length, 0, 'the repeat went unpaid, so no order followed');
  assert.equal(c.autoSpawn, 1, 'the toggle stays on');
});

test('setAutoSpawn takes the owner of the barracks, a barracks kind and a boolean', () => {
  const s = fresh();
  const b = withBarracks(s);
  const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === 0);
  send(s, 1, { t: 'setAutoSpawn', barracksId: b.id, on: true });
  assert.equal(b.autoSpawn, 0, 'the other player cannot toggle it');
  send(s, 0, { t: 'setAutoSpawn', barracksId: core.id, on: true });
  assert.equal(core.autoSpawn, 0, 'a Core is no barracks');
  send(s, 0, { t: 'setAutoSpawn', barracksId: b.id, on: 1 });
  assert.equal(b.autoSpawn, 0, 'a non-boolean is dropped');
  send(s, 0, { t: 'recycle', buildingId: b.id });
  send(s, 0, { t: 'setAutoSpawn', barracksId: b.id, on: true });
  assert.equal(b.autoSpawn, 0, 'a barracks in its recycle channel takes no toggle');
});
