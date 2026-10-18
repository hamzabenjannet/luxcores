import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, hashState, KIND, MILLI, heroOf, exportState, importState } from '../src/sim/index.js';
import { loadData } from './helpers/load-data.js';

const { config } = loadData();
const hero = config.balance.hero;

/** A 1v1 state with a big bank for both teams, so no match ends by accident. */
function fresh(lux = 1_000_000) {
  const s = createState({ seed: 1234567, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }], config });
  for (const t of [0, 1]) {
    s.teams[t].coreLux = t === 0 ? lux : 1_000_000_000;
    const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === t);
    core.hp = s.teams[t].coreLux;
    core.maxHp = Math.max(core.maxHp, core.hp);
  }
  return s;
}

let seq = 0;
function send(s, playerId, cmd) {
  step(s, [{ tick: s.tick, playerId, seq: seq++, cmd }]);
}
const run = (s, ticks) => { for (let i = 0; i < ticks; i++) step(s, []); };
const barracksOf = (s, team = 0) => s.entities.filter((e) => e.kind === KIND.BARRACKS && e.team === team);
function withBarracks(s, tileX = 30, tileZ = 90) {
  send(s, 0, { t: 'build', building: 'barracks', tileX, tileZ });
  return barracksOf(s).find((b) => Math.floor(b.x / 1000) === tileX);
}
const pick = (s, b, heroId, lux = 20) => send(s, 0, { t: 'pickHero', heroId, lux, barracksId: b.id });
const heroes = (s, owner = 0) => s.entities.filter((e) => e.kind === KIND.HERO && e.owner === owner);

/** Picks a hero and waits until it stands on the map. */
function withHero(s, b, heroId = 0, lux = 20) {
  pick(s, b, heroId, lux);
  run(s, hero.productionTicks);
  return heroOf(s, 0);
}

/** Puts an enemy creep at a distance (in units) from a hero, with a lot of HP. */
function enemyAt(s, h, dx, dz = 0, kind = KIND.CREEP) {
  const e = s.entities.push({
    ...s.entities.find((x) => x.kind === KIND.CORE),
    id: s.nextId++, kind, team: 1, owner: 1, x: h.x + dx, z: h.z + dz, hp: 1_000_000, maxHp: 1_000_000, born: s.tick,
    movePath: [], waypoints: [],
  });
  return s.entities[e - 1];
}

test('a pick pays the lux at once, builds for 5 seconds and puts the hero next to the barracks with ten HP per lux', () => {
  const s = fresh();
  const b = withBarracks(s);
  const before = s.teams[0].coreLux;
  pick(s, b, 2, 30);
  assert.equal(s.teams[0].coreLux, before - 30 * MILLI);
  assert.equal(s.orders.length, 1);
  assert.deepEqual(s.orders[0].mix, [2, 30]);
  assert.equal(s.orders[0].ticksLeft, hero.productionTicks - 1, 'the pick tick already counted');
  assert.equal(heroes(s).length, 0, 'nothing stands there before the build time');
  run(s, hero.productionTicks - 2);
  assert.equal(heroes(s).length, 0);
  run(s, 1);
  const h = heroOf(s, 0);
  assert.ok(h);
  assert.equal(h.hp, 30 * 10 * MILLI);
  assert.equal(h.maxHp, h.hp);
  assert.equal(h.heroType, 3, 'roster id 2 is stored as 3, so 0 means no hero');
  assert.equal(h.attack, 3, 'Flare is an area hero');
  assert.ok(Math.abs(h.x - b.x) <= 4000 && Math.abs(h.z - b.z) <= 4000);
  assert.equal(s.orders.length, 0);
});

test('a pick is refused with no barracks, for a bad hero or amount, and when it would leave the Core under 1 lux', () => {
  const s = fresh(100_000);
  const b = withBarracks(s); // 40 lux, 60 left
  const lux = s.teams[0].coreLux;
  for (const bad of [
    { heroId: 5, lux: 10 }, { heroId: -1, lux: 10 }, { heroId: 0.5, lux: 10 }, { heroId: 0, lux: 0 },
    { heroId: 0, lux: -4 }, { heroId: 0, lux: 2.5 }, { heroId: 0, lux: 60 }, { heroId: 0, lux: 1000 }, { heroId: 'a', lux: 10 },
  ]) {
    send(s, 0, { t: 'pickHero', barracksId: b.id, ...bad });
  }
  send(s, 0, { t: 'pickHero', heroId: 0, lux: 10, barracksId: 99999 });
  send(s, 1, { t: 'pickHero', heroId: 0, lux: 10, barracksId: b.id });
  const solar = (send(s, 0, { t: 'build', building: 'solar', tileX: 34, tileZ: 90 }), s.entities.find((e) => e.kind === KIND.SOLAR));
  send(s, 0, { t: 'pickHero', heroId: 0, lux: 10, barracksId: solar.id });
  assert.equal(s.orders.length, 0);
  assert.equal(s.teams[0].coreLux, lux - 20 * MILLI, 'only the solar plant was paid');
  send(s, 0, { t: 'pickHero', heroId: 0, lux: 39, barracksId: b.id });
  assert.equal(s.orders.length, 1, '39 of the remaining 40 lux leaves exactly 1');
});

test('only one hero at a time: a second pick waits for the first order, and for the hero to die', () => {
  const s = fresh();
  const b = withBarracks(s);
  pick(s, b, 0);
  pick(s, b, 1);
  assert.equal(s.orders.length, 1, 'a hero order is queued already');
  run(s, hero.productionTicks);
  assert.ok(heroOf(s, 0));
  pick(s, b, 1);
  assert.equal(s.orders.length, 0, 'a hero is alive');
});

test('the rotation lock holds a picked hero out until the other four were picked, across six picks', () => {
  const s = fresh();
  const b = withBarracks(s);
  const kill = () => { heroOf(s, 0).hp = 0; run(s, 1 + hero.respawnCooldownTicks); };
  const picked = [];
  const tryPick = (id) => { const n = s.orders.length; pick(s, b, id, 10); const ok = s.orders.length > n; if (ok) { picked.push(id); run(s, hero.productionTicks); } return ok; };

  assert.equal(tryPick(0), true);
  kill();
  assert.equal(tryPick(0), false, 'hero 0 is locked');
  assert.equal(tryPick(1), true);
  kill();
  assert.equal(tryPick(0), false);
  assert.equal(tryPick(1), false);
  assert.equal(tryPick(2), true);
  kill();
  assert.equal(tryPick(3), true);
  kill();
  assert.equal(s.players[0].heroLock, 0b01111);
  assert.equal(tryPick(4), true, 'the last unpicked hero is open');
  assert.equal(s.players[0].heroLock, 0, 'the whole roster has had its turn, so every hero unlocks');
  kill();
  assert.equal(tryPick(0), true, 'the sixth pick may be the first hero again');
  assert.deepEqual(picked, [0, 1, 2, 3, 4, 0]);
  assert.equal(s.players[0].heroLock, 0b00001);
  assert.equal(s.players[1].heroLock, 0, 'the other player has a rotation of their own');
});

test('a hero that dies starts a 5 second wait, and the next one is on the field within 10 seconds', () => {
  const s = fresh();
  const b = withBarracks(s);
  withHero(s, b, 0);
  heroOf(s, 0).hp = 0;
  run(s, 1);
  assert.equal(heroOf(s, 0), undefined);
  assert.equal(s.players[0].heroCooldown, hero.respawnCooldownTicks);
  let waited = 0;
  while (s.players[0].heroCooldown > 0) {
    pick(s, b, 1); // each attempt is one tick
    assert.equal(s.orders.length, 0, 'refused during the cooldown');
    waited++;
  }
  assert.equal(waited, hero.respawnCooldownTicks, 'exactly 5 seconds');
  pick(s, b, 1);
  assert.equal(s.orders.length, 1);
  run(s, hero.productionTicks);
  assert.ok(heroOf(s, 0));
});

test('cancelling a hero order refunds it in full and takes nothing from the rotation', () => {
  const s = fresh();
  const b = withBarracks(s);
  const before = s.teams[0].coreLux;
  pick(s, b, 3, 25);
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, orderId: s.orders[0].id });
  assert.equal(s.orders.length, 0);
  assert.equal(s.teams[0].coreLux, before);
  assert.equal(s.players[0].heroLock, 0);
  pick(s, b, 3, 25);
  assert.equal(s.orders.length, 1, 'the same hero can be picked again');
});

test('recycling the barracks refunds a hero order, and a barracks that dies takes the order and its lux with it', () => {
  const s = fresh();
  const b = withBarracks(s);
  pick(s, b, 0, 25);
  const mid = s.teams[0].coreLux;
  b.hp = 0;
  run(s, 1);
  assert.equal(s.orders.length, 0);
  assert.equal(s.teams[0].coreLux, mid, 'no refund when an enemy destroys it');
  assert.equal(heroes(s).length, 0);
  assert.equal(s.players[0].heroLock, 0, 'a lost pick does not count in the rotation');

  const t = fresh();
  const c = withBarracks(t);
  pick(t, c, 0, 25);
  const paid = t.teams[0].coreLux;
  send(t, 0, { t: 'recycle', buildingId: c.id });
  run(t, config.balance.economy.recycleChannelTicks);
  assert.ok(t.teams[0].coreLux >= paid + 25 * MILLI, 'the 25 lux come back with the barracks refund');
});

test('a hero moves at its own speed: Aurora is faster than Halo', () => {
  const dist = (id) => {
    const s = fresh();
    const b = withBarracks(s);
    const h = withHero(s, b, id);
    const x0 = h.x;
    send(s, 0, { t: 'heroMove', x: h.x + 10_000, z: h.z });
    run(s, 40);
    return Math.abs(h.x - x0);
  };
  assert.ok(dist(3) > dist(0) + 1000, 'Aurora (4 tiles per second) outruns Halo (3)');
});

test('melee ability: 60 damage and a guaranteed stun on the current target in contact, 5 lux, then a 5 second cooldown', () => {
  const s = fresh();
  const h = withHero(s, withBarracks(s), 0);
  const target = enemyAt(s, h, 700);
  h.attackCooldown = 1000; // keep the basic attack out of the numbers
  send(s, 0, { t: 'castAbility', slot: 0 });
  assert.equal(target.hp, 1_000_000, 'no target chosen: nothing happens');
  send(s, 0, { t: 'heroAttack', targetId: target.id });
  const lux = s.teams[0].coreLux;
  send(s, 0, { t: 'castAbility', slot: 0 });
  assert.equal(target.hp, 1_000_000 - 60 * MILLI);
  assert.ok(target.stunTicks > 0, 'stunned');
  assert.equal(s.teams[0].coreLux, lux - 5 * MILLI);
  assert.equal(h.cd0, 99, 'the cooldown counts the tick of the cast');
  send(s, 0, { t: 'castAbility', slot: 0 });
  assert.equal(s.teams[0].coreLux, lux - 5 * MILLI, 'refused during the cooldown, and free');
  run(s, 98);
  assert.equal(h.cd0, 0);
  send(s, 0, { t: 'castAbility', slot: 0 });
  assert.equal(s.teams[0].coreLux, lux - 10 * MILLI, 'ready again after 5 seconds');
});

test('melee ability needs contact; Corona dashes up to 3 tiles to get there', () => {
  const s = fresh();
  const h = withHero(s, withBarracks(s), 0);
  const far = enemyAt(s, h, 2500);
  send(s, 0, { t: 'heroAttack', targetId: far.id });
  const lux = s.teams[0].coreLux;
  send(s, 0, { t: 'castAbility', slot: 0 });
  assert.equal(s.teams[0].coreLux, lux, 'Halo has no dash: out of reach, no cost');

  const t = fresh();
  const c = withHero(t, withBarracks(t), 4);
  const away = enemyAt(t, c, 2500);
  send(t, 0, { t: 'heroAttack', targetId: away.id });
  const before = Math.hypot(c.x - away.x, c.z - away.z);
  send(t, 0, { t: 'castAbility', slot: 0 });
  const after = Math.hypot(c.x - away.x, c.z - away.z);
  assert.ok(before > 2000 && after < 1100, `Corona closed the gap (${Math.round(before)} to ${Math.round(after)})`);
  assert.ok(away.hp <= 1_000_000 - 60 * MILLI);

  const u = fresh();
  const d = withHero(u, withBarracks(u), 4);
  const out = enemyAt(u, d, 4500);
  send(u, 0, { t: 'heroAttack', targetId: out.id });
  const l2 = u.teams[0].coreLux;
  send(u, 0, { t: 'castAbility', slot: 0 });
  assert.equal(u.teams[0].coreLux, l2, 'beyond the dash');
});

test('ranged ability: 60 damage to one target within 6 tiles, 8 for Prism', () => {
  const s = fresh();
  const h = withHero(s, withBarracks(s), 0);
  const near = enemyAt(s, h, 5500);
  const far = enemyAt(s, h, 7500, 100);
  const lux = s.teams[0].coreLux;
  send(s, 0, { t: 'castAbility', slot: 1, targetId: far.id });
  assert.equal(s.teams[0].coreLux, lux, 'beyond 6 tiles');
  send(s, 0, { t: 'castAbility', slot: 1, targetId: near.id });
  assert.ok(near.hp <= 1_000_000 - 60 * MILLI);
  assert.equal(s.teams[0].coreLux, lux - 5 * MILLI);

  const t = fresh();
  const p = withHero(t, withBarracks(t), 1);
  const e = enemyAt(t, p, 7500);
  send(t, 0, { t: 'castAbility', slot: 1, targetId: e.id });
  assert.ok(e.hp <= 1_000_000 - 60 * MILLI, 'Prism reaches 8 tiles');
  send(t, 0, { t: 'castAbility', slot: 1, targetId: 99999 });
});

test('area ability: 40 damage to every enemy within 1.5 tiles of a point within 5 tiles, and nobody else', () => {
  const s = fresh();
  const h = withHero(s, withBarracks(s), 0);
  const a = enemyAt(s, h, 3000);
  const b = enemyAt(s, h, 3000, 1200);
  const out = enemyAt(s, h, 3000, 1800);
  const friend = s.entities.find((e) => e.kind === KIND.BARRACKS);
  const friendHp = friend.hp;
  send(s, 0, { t: 'castAbility', slot: 2, x: h.x + 3000, z: h.z });
  assert.ok(a.hp <= 1_000_000 - 40 * MILLI);
  assert.ok(b.hp <= 1_000_000 - 40 * MILLI);
  assert.equal(out.hp, 1_000_000, 'outside the radius');
  assert.equal(friend.hp, friendHp, 'own buildings are safe');
  const lux = s.teams[0].coreLux;
  run(s, 100);
  send(s, 0, { t: 'castAbility', slot: 2, x: h.x + 6000, z: h.z });
  assert.equal(s.teams[0].coreLux, lux, 'a point beyond 5 tiles is refused');
});

test('shield ability: absorbs 150 damage for 5 seconds on an own building, creep or hero, never the Core or an enemy', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b, 0);
  const lux = s.teams[0].coreLux;
  send(s, 0, { t: 'castAbility', slot: 3, targetId: h.id });
  assert.equal(h.shieldHp, 250 * MILLI, 'Halo has the stronger shield');
  assert.equal(h.shieldTicks, 99, 'the shield lasts 100 ticks, the cast tick included');
  assert.equal(s.teams[0].coreLux, lux - 10 * MILLI);
  run(s, 99);
  assert.equal(h.shieldHp, 0, 'it runs out');
  const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === 0);
  const enemy = enemyAt(s, h, 800);
  const l2 = s.teams[0].coreLux;
  send(s, 0, { t: 'castAbility', slot: 3, targetId: core.id });
  send(s, 0, { t: 'castAbility', slot: 3, targetId: enemy.id });
  assert.equal(s.teams[0].coreLux, l2, 'the Core and an enemy take no shield, and a refused cast is free');
  send(s, 0, { t: 'castAbility', slot: 3, targetId: b.id });
  assert.equal(b.shieldHp, 250 * MILLI);
});

test('a shield absorbs damage before HP, and a break leaves the rest of the blow to the target', () => {
  const t = fresh();
  const mine = withHero(t, withBarracks(t), 0, 30);
  const attacker = withHeroFor(t, 1);
  send(t, 0, { t: 'castAbility', slot: 3, targetId: mine.id });
  const shield = mine.shieldHp;
  attacker.x = mine.x + 500;
  attacker.z = mine.z;
  attacker.attackCooldown = 1000;
  send(t, 1, { t: 'castAbility', slot: 1, targetId: mine.id });
  assert.equal(mine.hp, mine.maxHp, 'the whole 60 went into the shield');
  assert.equal(mine.shieldHp, shield - 60 * MILLI);
  run(t, 100); // the attacker's cooldown; the first shield runs out meanwhile
  mine.shieldHp = 20 * MILLI;
  mine.shieldTicks = 50;
  const before = mine.hp; // entropy took a little meanwhile
  send(t, 1, { t: 'castAbility', slot: 1, targetId: mine.id });
  assert.equal(mine.shieldHp, 0);
  assert.equal(mine.hp, before - 40 * MILLI, 'the 40 that the shield could not take reach the hero');
});

/** A hero for player 1 at a barracks of team 1. */
function withHeroFor(s, owner) {
  const base = s.entities.find((e) => e.kind === KIND.CORE && e.team === 1);
  s.entities.push({ ...s.entities.find((e) => e.kind === KIND.CORE), id: s.nextId++, kind: KIND.BARRACKS, team: 1, owner: 1, x: base.x, z: base.z + 3000, hp: 400_000, maxHp: 400_000, born: s.tick, movePath: [], waypoints: [] });
  const barracks = s.entities[s.entities.length - 1];
  s.orders.push({ id: s.nextId++, barracksId: barracks.id, owner, type: 2, mix: [0, 30], ticksLeft: 1, held: 0 });
  run(s, 1);
  return heroOf(s, owner);
}

test('abilities are refused for a stunned hero, with no hero, for a bad slot and for a poor Core', () => {
  const s = fresh();
  send(s, 0, { t: 'castAbility', slot: 3, targetId: 1 });
  const h = withHero(s, withBarracks(s), 0);
  for (const slot of [-1, 4, 1.5, 'a', undefined]) send(s, 0, { t: 'castAbility', slot, targetId: h.id });
  assert.equal(h.shieldHp, 0);
  h.stunTicks = 5;
  send(s, 0, { t: 'castAbility', slot: 3, targetId: h.id });
  assert.equal(h.shieldHp, 0, 'stunned');
  h.stunTicks = 0;
  s.teams[0].coreLux = 10 * MILLI;
  send(s, 0, { t: 'castAbility', slot: 3, targetId: h.id });
  assert.equal(h.shieldHp, 0, 'a shield costs 10 lux and would leave the Core under 1');
});

test('a hero ability on an enemy hero makes the enemy towers in reach turn on the caster', () => {
  const s = fresh();
  const h = withHero(s, withBarracks(s), 0);
  const enemyHero = withHeroFor(s, 1);
  enemyHero.x = h.x + 1000;
  enemyHero.z = h.z;
  s.entities.push({ ...s.entities.find((e) => e.kind === KIND.CORE), id: s.nextId++, kind: KIND.TOWER, team: 0, owner: 0, attack: 2, x: h.x + 1500, z: h.z, hp: 200_000, maxHp: 200_000, born: s.tick, movePath: [], waypoints: [] });
  const tower = s.entities[s.entities.length - 1];
  send(s, 1, { t: 'castAbility', slot: 1, targetId: h.id });
  assert.equal(tower.overrideTargetId, enemyHero.id);
});

test('heroes are deterministic: the same commands give the same hash, and a checkpoint carries a match with heroes through JSON', () => {
  const play = () => {
    const s = fresh();
    const b = withBarracks(s);
    const h = withHero(s, b, 4);
    const e = enemyAt(s, h, 900);
    send(s, 0, { t: 'heroAttack', targetId: e.id });
    send(s, 0, { t: 'castAbility', slot: 0 });
    send(s, 0, { t: 'castAbility', slot: 3, targetId: h.id });
    run(s, 140);
    return s;
  };
  seq = 0;
  const a = play();
  seq = 0;
  const b = play();
  assert.equal(hashState(a), hashState(b));
  const saved = JSON.parse(JSON.stringify(exportState(a)));
  const restored = importState(saved, config);
  assert.equal(hashState(restored), hashState(a));
  run(a, 60);
  run(restored, 60);
  assert.equal(hashState(restored), hashState(a));
});

test('a checkpoint from before heroes existed still loads, with the new fields at their starting values', () => {
  const s = fresh();
  withBarracks(s);
  const old = JSON.parse(JSON.stringify(exportState(s)));
  for (const e of old.entities) for (const f of ['heroType', 'shieldHp', 'shieldTicks', 'cd0', 'cd1', 'cd2', 'cd3']) delete e[f];
  for (const p of old.players) { delete p.heroLock; delete p.heroCooldown; }
  const loaded = importState(old, config);
  assert.equal(hashState(loaded), hashState(s));
});

test('a hero ordered to attack a far target walks into reach, hits it and stops when it dies', () => {
  const s = fresh();
  const h = withHero(s, withBarracks(s), 1, 30); // Prism, ranged: 4 tiles
  const target = enemyAt(s, h, 9000);
  target.hp = 60 * MILLI;
  send(s, 0, { t: 'heroAttack', targetId: target.id });
  const x0 = h.x;
  run(s, 60);
  assert.ok(Math.abs(h.x - x0) > 2000, 'it walked toward the target');
  assert.ok(Math.hypot(h.x - target.x, h.z - target.z) <= 4000 + 1, 'and stopped inside its reach');
  assert.ok(target.hp < 60 * MILLI, 'and hit it');
  run(s, 100);
  assert.equal(s.entities.includes(target), false, 'the target died');
  assert.equal(h.targetId, 0, 'the order is over');
  const stand = [h.x, h.z];
  run(s, 20);
  assert.deepEqual([h.x, h.z], stand, 'the hero stays where it is');
});
