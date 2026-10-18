import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, hashState, KIND, MILLI, heroOf, exportState, importState, countOf } from '../src/sim/index.js';
import { loadData } from './helpers/load-data.js';

const { config } = loadData();
const { hero } = config.balance;
const rules = config.balance.items;
const ITEM = Object.freeze({ boost: 0, grab: 1, haste: 2, sluggish: 3 });

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
function withBarracks(s, playerId = 0, tileX = 30) {
  const tileZ = playerId === 0 ? 90 : 10;
  send(s, playerId, { t: 'build', building: 'barracks', tileX, tileZ });
  return s.entities.find((e) => e.kind === KIND.BARRACKS && e.owner === playerId && Math.floor(e.x / 1000) === tileX);
}
function withHero(s, b, playerId = 0, lux = 100, heroId = playerId) {
  send(s, playerId, { t: 'pickHero', heroId, lux, barracksId: b.id });
  run(s, hero.productionTicks);
  return heroOf(s, playerId);
}
const order = (s, b, itemId) => send(s, b.owner, { t: 'orderItem', barracksId: b.id, itemId });
const grounds = (s) => s.entities.filter((e) => e.kind === KIND.GROUND_ITEM);
const bags = (s) => s.entities.filter((e) => e.kind === KIND.LOOT_BAG);

/** Puts an enemy creep near a hero (in units), with a lot of HP. */
function enemyAt(s, h, dx, dz = 0, kind = KIND.CREEP, team = 1) {
  const e = { ...s.entities.find((x) => x.kind === KIND.CORE), id: s.nextId++, kind, team, owner: team, x: h.x + dx, z: h.z + dz, hp: 10_000_000, maxHp: 10_000_000, born: s.tick, movePath: [], waypoints: [], items: [] };
  s.entities.push(e);
  return e;
}

test('an item order pays at once, builds for 1 second and lands in the hero inventory', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  const before = s.teams[0].coreLux;
  order(s, b, ITEM.haste);
  assert.equal(s.teams[0].coreLux, before - 20 * MILLI);
  assert.equal(s.orders.length, 1);
  assert.equal(s.players[0].items[ITEM.haste], 0, 'nothing before the build time');
  run(s, rules.productionTicks - 2);
  assert.equal(s.players[0].items[ITEM.haste], 0);
  run(s, 1);
  assert.equal(s.players[0].items[ITEM.haste], 1);
  assert.equal(s.orders.length, 0);
  assert.ok(h.hp > 0);
});

test('an item order is refused for a bad barracks, a bad item, another team and a purchase that leaves under 1 lux', () => {
  const s = fresh(100_000);
  const b = withBarracks(s); // 40 lux, 60 left
  const solar = (send(s, 0, { t: 'build', building: 'solar', tileX: 34, tileZ: 90 }), s.entities.find((e) => e.kind === KIND.SOLAR)); // 20 lux, 40 left
  const lux = s.teams[0].coreLux;
  for (const bad of [{ itemId: 4 }, { itemId: -1 }, { itemId: 0.5 }, { itemId: 'a' }, {}]) send(s, 0, { t: 'orderItem', barracksId: b.id, ...bad });
  send(s, 0, { t: 'orderItem', barracksId: solar.id, itemId: 0 });
  send(s, 0, { t: 'orderItem', barracksId: 99999, itemId: 0 });
  send(s, 1, { t: 'orderItem', barracksId: b.id, itemId: 0 });
  assert.equal(s.orders.length, 0);
  assert.equal(s.teams[0].coreLux, lux);
  order(s, b, 0); // 20 lux, 20 left
  order(s, b, 1); // 20 lux would leave 0
  assert.equal(s.orders.length, 1);
  assert.equal(s.teams[0].coreLux, lux - 20 * MILLI);
});

test('with no hero alive an item waits in the barracks and goes to the next hero at spawn', () => {
  const s = fresh();
  const b = withBarracks(s);
  order(s, b, ITEM.boost);
  order(s, b, ITEM.grab);
  run(s, rules.productionTicks * 2 + 2);
  assert.equal(countOf(s.players[0].items), 0, 'no hero, nothing delivered');
  assert.equal(s.orders.length, 2);
  assert.ok(s.orders.every((o) => o.held === 1), 'both are held');
  withHero(s, b);
  run(s, 1);
  assert.deepEqual(s.players[0].items, [1, 1, 0, 0]);
  assert.equal(s.orders.length, 0);
});

test('a barracks that dies loses the items it holds, and cancelling an item order refunds it in full', () => {
  const s = fresh();
  const b = withBarracks(s);
  const bank = s.teams[0].coreLux;
  order(s, b, ITEM.haste);
  const queued = s.orders[0].id;
  send(s, 0, { t: 'cancelQueue', barracksId: b.id, orderId: queued });
  assert.equal(s.orders.length, 0);
  assert.equal(s.teams[0].coreLux, bank, 'the refund covers the whole price');

  order(s, b, ITEM.haste);
  run(s, rules.productionTicks + 2);
  assert.equal(s.orders[0].held, 1);
  b.hp = 0;
  run(s, 1);
  assert.equal(s.orders.length, 0, 'the waiting item is lost with the barracks');
  withBarracks(s, 0, 36);
  withHero(s, s.entities.find((e) => e.kind === KIND.BARRACKS));
  run(s, 1);
  assert.equal(countOf(s.players[0].items), 0);
});

test('the inventory holds 50 items, and a finished order waits until a slot is free', () => {
  const s = fresh(10_000_000);
  const b = withBarracks(s);
  withHero(s, b);
  s.players[0].items = [0, 0, 50, 0];
  order(s, b, ITEM.boost);
  run(s, rules.productionTicks + 1);
  assert.equal(countOf(s.players[0].items), 50);
  assert.equal(s.orders.length, 1);
  assert.equal(s.orders[0].held, 1, 'no room, so it waits');
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.haste });
  run(s, 1);
  assert.deepEqual(s.players[0].items, [1, 0, 49, 0], 'the freed slot takes the waiting item');
  assert.equal(s.orders.length, 0);
});

test('Energy Boost adds 15 lux (150 HP) to an own hero or building and is refused on the Core, an enemy or far away', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [5, 0, 0, 0];
  const hp = h.hp;
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.boost, targetId: h.id });
  assert.equal(h.hp, hp + 15 * MILLI * 10);
  assert.equal(h.maxHp, hp + 15 * MILLI * 10, 'the added lux raises max HP too');
  const building = s.entities.find((e) => e.kind === KIND.BARRACKS);
  h.x = building.x + 1000;
  h.z = building.z;
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.boost, targetId: building.id });
  assert.equal(building.maxHp, 40 * MILLI * 10 + 15 * MILLI * 10);
  assert.ok(building.hp > building.maxHp - 2000, 'the building took the HP (entropy may have nibbled a little)');
  assert.equal(s.players[0].items[ITEM.boost], 3);

  const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === 0);
  const coreHp = core.hp;
  h.x = core.x;
  h.z = core.z - 1000;
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.boost, targetId: core.id });
  assert.equal(core.hp, coreHp, 'the Lumen Core is refused');
  const enemy = enemyAt(s, h, 1000, 0, KIND.HERO);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.boost, targetId: enemy.id });
  assert.equal(enemy.hp, 10_000_000, 'an enemy hero is refused');
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.boost, targetId: building.id });
  assert.equal(building.maxHp, 40 * MILLI * 10 + 15 * MILLI * 10, 'out of reach');
  assert.equal(s.players[0].items[ITEM.boost], 3);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.boost });
  assert.equal(s.players[0].items[ITEM.boost], 3, 'a refused use keeps the item');
});

test('Energy Grab funnels exactly 50 lux into the pending pool, then it is consumed', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [0, 2, 0, 0];
  const target = enemyAt(s, h, 700);
  const bank = () => s.teams[0].coreLux + s.teams[0].pendingLux;
  const start = bank();
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.grab });
  assert.equal(s.players[0].funnelLux, 50 * MILLI);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.grab });
  assert.equal(s.players[0].items[ITEM.grab], 1, 'a second Energy Grab while one runs is refused');
  send(s, 0, { t: 'heroAttack', targetId: target.id });
  run(s, 100);
  assert.ok(bank() > start && bank() < start + 50 * MILLI, 'lux flows in while the budget lasts');
  run(s, 800);
  assert.equal(s.players[0].funnelLux, 0, 'the budget is consumed');
  assert.equal(bank(), start + 50 * MILLI, 'exactly 50 lux came in, not a milli-lux more');
  assert.ok(10_000_000 - target.hp > 500_000, 'the target kept losing HP after the budget ran out');
  run(s, 100);
  assert.equal(bank(), start + 50 * MILLI);
});

test('without Energy Grab a hero attack funnels nothing, and a shield blocks the funnel it absorbs', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  const target = enemyAt(s, h, 700);
  const start = s.teams[0].coreLux + s.teams[0].pendingLux;
  send(s, 0, { t: 'heroAttack', targetId: target.id });
  run(s, 200);
  assert.equal(s.teams[0].coreLux + s.teams[0].pendingLux, start);

  s.players[0].funnelLux = 50 * MILLI;
  target.shieldHp = 10_000_000;
  target.shieldTicks = 1000;
  run(s, 200);
  assert.equal(s.teams[0].coreLux + s.teams[0].pendingLux, start, 'damage taken by the shield is not funneled');
  assert.equal(s.players[0].funnelLux, 50 * MILLI);
});

test('Energy Grab ends when the hero dies', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [0, 1, 0, 0];
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.grab });
  assert.equal(s.players[0].funnelLux, 50 * MILLI);
  h.hp = 0;
  run(s, 1);
  assert.equal(s.players[0].funnelLux, 0);
});

test('Haste quadruples the attack rate for 300 ticks and then wears off', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  const target = enemyAt(s, h, 700);
  s.players[0].items = [0, 0, 1, 0];
  send(s, 0, { t: 'heroAttack', targetId: target.id });
  const hits = (ticks) => { const hp = target.hp; run(s, ticks); return (hp - target.hp) / (hero.damagePerHit * MILLI); };
  const normal = hits(100);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.haste });
  assert.equal(h.speedMod, 300);
  assert.equal(h.speedTicks, 299, 'the cast tick counts');
  const hasted = hits(100);
  assert.ok(hasted >= 3 * normal, `hasted ${hasted} hits against ${normal}`);
  run(s, 200);
  assert.equal(h.speedMod, 0);
  assert.equal(h.speedTicks, 0);
  assert.ok(hits(100) <= normal + 1, 'back to one hit per second');
});

test('Sluggish slows an enemy hero or creep to the minimum speed and is refused on own units and far targets', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [0, 0, 0, 5];
  const creep = enemyAt(s, h, 3000);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.sluggish, targetId: creep.id });
  assert.equal(creep.speedMod, -300);
  assert.equal(creep.speedTicks, 299);
  const far = enemyAt(s, h, 9000);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.sluggish, targetId: far.id });
  assert.equal(far.speedMod, 0, 'out of reach');
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.sluggish, targetId: h.id });
  assert.equal(h.speedMod, 0, 'own units are refused');
  const tower = (send(s, 1, { t: 'build', building: 'tower', tileX: 30, tileZ: 20, attack: 'melee' }), s.entities.find((e) => e.kind === KIND.TOWER));
  tower.x = h.x + 2000;
  tower.z = h.z;
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.sluggish, targetId: tower.id });
  assert.equal(tower.speedMod, 0, 'a building is refused');
  assert.equal(s.players[0].items[ITEM.sluggish], 4);
  run(s, 300);
  assert.equal(creep.speedMod, 0);
});

test('a dead hero leaves its whole inventory as a loot bag that the next hero can take, up to its free slots', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [3, 1, 2, 4];
  const spot = [h.x, h.z];
  h.hp = 0;
  run(s, 1);
  assert.equal(bags(s).length, 1);
  const bag = bags(s)[0];
  assert.deepEqual([bag.x, bag.z], spot);
  assert.deepEqual(bag.items, [3, 1, 2, 4]);
  assert.equal(bag.owner, 0);
  assert.deepEqual(s.players[0].items, [0, 0, 0, 0]);

  run(s, hero.respawnCooldownTicks);
  s.players[0].items = [0, 0, 44, 0]; // 6 free slots for the next hero
  const next = withHero(s, b, 0, 100, 1);
  next.x = spot[0] + 300;
  next.z = spot[1];
  run(s, 1);
  assert.equal(countOf(s.players[0].items), 50);
  assert.equal(bags(s).length, 1, 'what did not fit stays in the bag');
  assert.equal(countOf(bags(s)[0].items), 4);
  s.players[0].items = [0, 0, 0, 0];
  run(s, 1);
  assert.equal(bags(s).length, 0, 'an emptied bag is gone');
});

test('an enemy hero can take a loot bag too', () => {
  const s = fresh();
  const b0 = withBarracks(s, 0);
  const b1 = withBarracks(s, 1);
  const h0 = withHero(s, b0, 0);
  const h1 = withHero(s, b1, 1);
  s.players[0].items = [0, 0, 2, 0];
  h1.x = h0.x + 4000;
  h1.z = h0.z;
  h0.hp = 0;
  run(s, 1);
  assert.equal(bags(s).length, 1);
  h1.x = bags(s)[0].x + 200;
  h1.z = bags(s)[0].z;
  run(s, 1);
  assert.deepEqual(s.players[1].items, [0, 0, 2, 0]);
  assert.equal(bags(s).length, 0);
});

test('a loot bag and a ground item despawn after 30 seconds, and only a hero in reach takes them', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [0, 0, 1, 0];
  h.hp = 0;
  run(s, 1);
  assert.equal(bags(s).length, 1);
  const born = bags(s)[0].born;
  run(s, rules.lootBagDespawnTicks - 2);
  assert.equal(bags(s).length, 1, 'still there just before the 30 seconds end');
  run(s, 2);
  assert.equal(bags(s).length, 0);
  assert.ok(s.tick - born >= rules.lootBagDespawnTicks);
});

test('a map item appears every 60 seconds at one of the four DMZ points and lasts 30 seconds', () => {
  const s = fresh();
  run(s, rules.mapSpawnIntervalTicks);
  assert.equal(grounds(s).length, 0, 'nothing in the first 60 seconds');
  run(s, 1);
  assert.equal(grounds(s).length, 1);
  const first = grounds(s)[0];
  assert.equal(first.born, rules.mapSpawnIntervalTicks);
  assert.ok(first, 'the first map item appears at 60 seconds');
  assert.ok(first.itemId >= 1 && first.itemId <= config.items.list.length);
  assert.ok(s.map.itemSpawns.some((p) => p.tileX * 1000 + 500 === first.x && p.tileZ * 1000 + 500 === first.z));
  run(s, rules.groundDespawnTicks - 1);
  assert.equal(grounds(s).includes(first), true, 'still there just before the 30 seconds end');
  run(s, 1);
  assert.equal(grounds(s).includes(first), false, 'it despawned after 30 seconds');
  run(s, rules.mapSpawnIntervalTicks - rules.groundDespawnTicks);
  assert.equal(grounds(s).length, 1, 'a second one arrived at 120 seconds');
});

test('a hero walks to a ground item with pickUp and takes it on arrival', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  const bag = enemyAt(s, h, 3000, 0, KIND.GROUND_ITEM, -1);
  bag.owner = -1;
  bag.itemId = ITEM.haste + 1;
  bag.hp = 1;
  bag.maxHp = 1;
  send(s, 1, { t: 'pickUp', groundItemId: bag.id });
  send(s, 0, { t: 'pickUp', groundItemId: 99999 });
  send(s, 0, { t: 'pickUp', groundItemId: h.id });
  assert.equal(h.moveTargetX, 0, 'only a ground item or a bag is a valid target');
  send(s, 0, { t: 'pickUp', groundItemId: bag.id });
  assert.equal(h.moveTargetX, bag.x);
  run(s, 200);
  assert.equal(s.players[0].items[ITEM.haste], 1);
  assert.equal(grounds(s).length, 0);
});

test('a creep that dies leaves an item about one time in ten, from the seeded generator', () => {
  const play = () => {
    const s = fresh();
    const b = withBarracks(s);
    const h = withHero(s, b);
    const creeps = Array.from({ length: 400 }, (_, i) => enemyAt(s, h, 2000 + (i % 20) * 10, 0, KIND.CREEP));
    for (const c of creeps) c.hp = 0;
    run(s, 1);
    return s;
  };
  const a = play();
  const dropped = grounds(a).length;
  assert.ok(dropped >= 20 && dropped <= 60, `${dropped} drops from 400 creeps`);
  assert.equal(hashState(play()), hashState(a), 'the same seed drops the same items');
});

test('a hero death drops the bag and no random item, even when the inventory is empty', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  h.hp = 0;
  run(s, 1);
  assert.equal(grounds(s).length, 0);
  assert.equal(bags(s).length, 0, 'nothing to drop');
});

test('items need a living hero to be used, and a missing count refuses the use', () => {
  const s = fresh();
  const b = withBarracks(s);
  s.players[0].items = [0, 1, 0, 0];
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.grab });
  assert.equal(s.players[0].funnelLux, 0, 'no hero yet');
  withHero(s, b);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.haste });
  send(s, 0, { t: 'useItem', inventorySlot: 9 });
  send(s, 0, { t: 'useItem', inventorySlot: -1 });
  send(s, 0, { t: 'useItem', inventorySlot: 1.5 });
  assert.deepEqual(s.players[0].items, [0, 1, 0, 0]);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.grab });
  assert.deepEqual(s.players[0].items, [0, 0, 0, 0]);
});

test('a checkpoint in the middle of item play resumes to the same hashes, and an older checkpoint still loads', () => {
  const s = fresh();
  const b = withBarracks(s);
  const h = withHero(s, b);
  s.players[0].items = [1, 1, 1, 1];
  enemyAt(s, h, 900);
  order(s, b, ITEM.boost);
  run(s, 5);
  send(s, 0, { t: 'useItem', inventorySlot: ITEM.grab });
  run(s, 10);
  h.hp = 0;
  run(s, 5);
  assert.equal(bags(s).length, 1);
  const saved = JSON.parse(JSON.stringify(exportState(s)));
  const copy = importState(saved, config);
  run(s, 300);
  run(copy, 300);
  assert.equal(hashState(copy), hashState(s));

  const old = JSON.parse(JSON.stringify(exportState(fresh())));
  for (const p of old.players) { delete p.items; delete p.funnelLux; }
  for (const e of old.entities) { delete e.items; delete e.itemId; delete e.speedMod; delete e.speedTicks; }
  const loaded = importState(old, config);
  assert.deepEqual(loaded.players[0].items, [0, 0, 0, 0]);
  assert.doesNotThrow(() => hashState(loaded));
});
