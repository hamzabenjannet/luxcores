import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, normalizeData, step, spawnEntity, KIND } from '../src/sim/index.js';

const PLAYERS = [
  { id: 0, team: 0, kind: 'human' },
  { id: 1, team: 1, kind: 'bot' },
];

function newMatch() {
  return createState({ seed: 321, players: PLAYERS, config: loadData().config });
}

function newGuaranteedProcMatch(type = 'melee') {
  const { raw } = loadData();
  const configData = structuredClone(raw);
  configData.balance.attackTypes[type].procPct = 100;
  return createState({ seed: 321, players: PLAYERS, config: normalizeData(configData) });
}

test('attack distances already expressed in milli-tiles are not scaled twice', () => {
  const { config } = loadData();
  assert.equal(config.balance.attackTypes.area.splashMilliTiles, 1200);
  assert.equal(config.balance.attackTypes.ranged.knockbackMilliTiles, 500);
});

function send(state, playerId, cmd) {
  step(state, [{ tick: state.tick, playerId, seq: state.tick, cmd }]);
}

function freeTile(state, team = 0) {
  const rows = team === 0 ? [64, 112] : [0, 48];
  const taken = new Set(state.entities.filter((e) => e.kind <= KIND.BLOCKER).map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`));
  for (let z = rows[0]; z < rows[1]; z++) {
    for (let x = 4; x < 92; x++) {
      if (!taken.has(`${x},${z}`)) return { tileX: x, tileZ: z };
    }
  }
  throw new Error('no free tile');
}

function buildTower(state, attack = 'melee') {
  const tile = freeTile(state);
  send(state, 0, { t: 'build', building: 'tower', ...tile, attack });
  return state.entities.find((e) => e.kind === KIND.TOWER);
}

function unit(state, { kind = KIND.HERO, team, owner, x, z, hp = 50_000, attack = 2, targetId = 0 }) {
  return spawnEntity(state, { kind, team, owner, x, z, hp, maxHp: hp, attack, targetId });
}

test('tower attack type changes damage but preserves the 5-tile tower range', () => {
  for (const [attack, damage] of [['melee', 20_000], ['ranged', 12_000], ['area', 7_000]]) {
    const state = newMatch();
    const tower = buildTower(state, attack);
    const target = unit(state, {
      kind: KIND.SOLAR,
      team: 1,
      owner: 1,
      x: tower.x + 5000,
      z: tower.z,
      hp: 100_000,
    });
    const outOfRange = unit(state, {
      kind: KIND.SOLAR,
      team: 1,
      owner: 1,
      x: tower.x + 7000,
      z: tower.z,
      hp: 100_000,
    });
    step(state, []);
    if (attack === 'ranged') {
      assert.equal(target.hp, 100_000, 'ranged tower damage waits for projectile arrival');
      assert.equal(state.entities.filter((entity) => entity.kind === KIND.PROJECTILE).length, 1);
      step(state, []);
    }
    assert.equal(target.hp, 100_000 - damage, `${attack} damage`);
    assert.equal(outOfRange.hp, 100_000, 'targets beyond 5 tiles are out of range');
    assert.equal(tower.targetId, target.id);
  }
});

test('tower power levels increase damage by 25 percent each', () => {
  for (const [level, expectedDamage] of [[1, 25_000], [2, 30_000], [3, 35_000]]) {
    const state = newMatch();
    const tower = buildTower(state, 'melee');
    for (let i = 0; i < level; i++) {
      send(state, 0, { t: 'upgrade', towerId: tower.id, track: 'power' });
    }
    const target = unit(state, {
      kind: KIND.SOLAR,
      team: 1,
      owner: 1,
      x: tower.x + 1000,
      z: tower.z,
      hp: 100_000,
    });
    step(state, []);
    assert.equal(target.hp, 100_000 - expectedDamage);
  }
});

test('ranged hero attacks deal damage when their projectile arrives one tick later', () => {
  const state = newMatch();
  const hero = unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000, attack: 2 });
  const target = unit(state, { team: 1, owner: 1, x: 43_000, z: 70_000, hp: 100_000 });
  send(state, 0, { t: 'heroAttack', targetId: target.id });
  assert.equal(target.hp, 100_000);
  const projectile = state.entities.find((entity) => entity.kind === KIND.PROJECTILE);
  assert.ok(projectile);
  assert.equal(projectile.targetId, target.id);
  assert.equal(projectile.arrivalTick, state.tick);
  assert.equal(projectile.x, hero.x);
  step(state, []);
  assert.equal(target.hp, 88_000);
  assert.equal(state.entities.some((entity) => entity.id === projectile.id), false);
});

test('a ranged projectile applies knockback on impact over the full half-tile distance', () => {
  const state = newGuaranteedProcMatch('ranged');
  const attacker = unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000, attack: 2 });
  const target = unit(state, { team: 1, owner: 1, x: 43_000, z: 70_000 });
  send(state, 0, { t: 'heroAttack', targetId: target.id });
  step(state, []);
  assert.equal(target.impulseTicks, 5);
  const startingX = target.x;
  for (let i = 0; i < 5; i++) step(state, []);
  assert.equal(target.x, startingX + 500);
  assert.equal(attacker.x, 40_000);
});

test('a ranged projectile expires without damage when its target dies in flight', () => {
  const state = newMatch();
  const target = unit(state, { kind: KIND.SOLAR, team: 1, owner: 1, x: 43_000, z: 70_000 });
  unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000, attack: 2 });
  send(state, 0, { t: 'heroAttack', targetId: target.id });
  const projectileId = state.entities.find((entity) => entity.kind === KIND.PROJECTILE).id;
  target.hp = 0;
  step(state, []);
  assert.equal(state.entities.some((entity) => entity.id === projectileId), false);
});

test('ranged projectiles resolve simultaneous lethal hits on the same tick', () => {
  const state = newMatch();
  const blue = unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000, hp: 10_000, attack: 2 });
  const red = unit(state, { team: 1, owner: 1, x: 43_000, z: 70_000, hp: 10_000, attack: 2 });
  step(state, [
    { tick: 0, playerId: 0, seq: 0, cmd: { t: 'heroAttack', targetId: red.id } },
    { tick: 0, playerId: 1, seq: 0, cmd: { t: 'heroAttack', targetId: blue.id } },
  ]);
  assert.equal(state.entities.filter((entity) => entity.kind === KIND.PROJECTILE).length, 2);
  step(state, []);
  assert.equal(state.entities.some((entity) => entity.id === blue.id || entity.id === red.id), false);
});

test('area towers splash their reduced damage within 1.2 tiles of the primary target', () => {
  const state = newMatch();
  const tower = buildTower(state, 'area');
  const target = unit(state, { kind: KIND.SOLAR, team: 1, owner: 1, x: tower.x + 1000, z: tower.z, hp: 100_000 });
  const splashed = unit(state, { kind: KIND.SOLAR, team: 1, owner: 1, x: tower.x + 2000, z: tower.z, hp: 100_000 });
  const outsideSplash = unit(state, { kind: KIND.SOLAR, team: 1, owner: 1, x: tower.x + 2201, z: tower.z, hp: 100_000 });
  step(state, []);
  assert.equal(target.hp, 93_000);
  assert.equal(splashed.hp, 93_000);
  assert.equal(outsideSplash.hp, 100_000);
});

test('heroes can issue attack commands and simultaneous lethal hits kill both units', () => {
  const state = newMatch();
  const blue = unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000, hp: 10_000, attack: 1 });
  const red = unit(state, { team: 1, owner: 1, x: 40_000, z: 70_000, hp: 10_000, attack: 1 });
  step(state, [
    { tick: 0, playerId: 0, seq: 0, cmd: { t: 'heroAttack', targetId: red.id } },
    { tick: 0, playerId: 1, seq: 0, cmd: { t: 'heroAttack', targetId: blue.id } },
  ]);
  assert.equal(state.entities.some((e) => e.id === blue.id || e.id === red.id), false);
});

test('melee attack procs stun a building for ten ticks and the timer expires', () => {
  const state = newGuaranteedProcMatch();
  const hero = unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000, attack: 1 });
  const building = unit(state, {
    kind: KIND.SOLAR,
    team: 1,
    owner: 1,
    x: 41_000,
    z: 70_000,
    hp: 100_000,
  });
  send(state, 0, { t: 'heroAttack', targetId: building.id });
  assert.equal(building.stunTicks, 10);
  for (let i = 0; i < 10; i++) step(state, []);
  assert.equal(building.stunTicks, 0);
  assert.ok(hero.attackCooldown > 0);
});

test('an invalid hero attack does not cancel a pending move order', () => {
  const state = newMatch();
  const hero = unit(state, { team: 0, owner: 0, x: 40_000, z: 70_000 });
  const friendlyCore = state.entities.find((entity) => entity.kind === KIND.CORE && entity.team === 0);
  send(state, 0, { t: 'heroMove', x: 42_000, z: 70_000 });
  assert.ok(hero.movePath.length > 0);
  const moveTargetX = hero.moveTargetX;
  send(state, 0, { t: 'heroAttack', targetId: friendlyCore.id });
  assert.equal(hero.moveTargetX, moveTargetX);
  assert.ok(hero.movePath.length > 0);
});

test('a tower overrides its normal target when an enemy hero attacks a friendly hero', () => {
  const state = newMatch();
  const tower = buildTower(state, 'ranged');
  const ordinaryTarget = unit(state, {
    kind: KIND.SOLAR,
    team: 1,
    owner: 1,
    x: tower.x + 1000,
    z: tower.z,
  });
  const friendlyHero = unit(state, {
    team: 0,
    owner: 0,
    x: tower.x + 2000,
    z: tower.z,
  });
  const enemyHero = unit(state, {
    team: 1,
    owner: 1,
    x: tower.x + 2500,
    z: tower.z,
    attack: 2,
  });
  send(state, 1, { t: 'heroAttack', targetId: friendlyHero.id });
  assert.equal(tower.targetId, enemyHero.id);
  assert.equal(tower.overrideTicks, state.config.balance.tower.targetOverrideTicks);
  assert.notEqual(tower.targetId, ordinaryTarget.id);
});

test('the tower override expires 3 seconds after the last enemy-hero attack', () => {
  const state = newMatch();
  const tower = buildTower(state, 'ranged');
  const ordinaryTarget = unit(state, {
    kind: KIND.SOLAR,
    team: 1,
    owner: 1,
    x: tower.x + 1000,
    z: tower.z,
  });
  const friendlyHero = unit(state, { team: 0, owner: 0, x: tower.x + 2000, z: tower.z });
  const enemyHero = unit(state, { team: 1, owner: 1, x: tower.x + 2500, z: tower.z, attack: 2 });
  send(state, 1, { t: 'heroAttack', targetId: friendlyHero.id });
  enemyHero.targetId = 0;
  for (let i = 0; i < 59; i++) step(state, []);
  assert.equal(tower.targetId, enemyHero.id, 'the override remains active through its 60th tick');
  step(state, []);
  assert.equal(tower.targetId, ordinaryTarget.id, 'the tower resumes normal targeting after 60 ticks');
});

test('visibility updates team bitsets and per-entity visibility every five ticks', () => {
  const state = newMatch();
  const friendlyHero = unit(state, { team: 0, owner: 0, x: 20_500, z: 70_500 });
  const enemyHero = unit(state, { team: 1, owner: 1, x: 70_500, z: 20_500 });
  const index = 70 * state.map.width + 20;
  for (let i = 0; i < 5; i++) step(state, []);
  assert.notEqual(state.visibility[0][index >> 3] & (1 << (index & 7)), 0);
  assert.deepEqual(friendlyHero.visibleTo, [true, false]);
  assert.deepEqual(enemyHero.visibleTo, [false, true]);
});
