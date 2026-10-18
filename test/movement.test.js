import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, step, spawnEntity, KIND } from '../src/sim/index.js';
import { createGrid2DPhysics } from '../src/sim/physics/grid2d.js';
import { buildBlockedGrid, findPath } from '../src/sim/physics/pathfinding.js';

const PLAYERS = [
  { id: 0, team: 0, kind: 'human' },
  { id: 1, team: 1, kind: 'bot' },
];

function newMatch(players = PLAYERS) {
  return createState({ seed: 8321, players, config: loadData().config });
}

function openHorizontalRoute(state, length = 4) {
  const blocked = buildBlockedGrid(state);
  for (let z = 2; z < state.map.height - 2; z++) {
    for (let x = 2; x <= state.map.width - length - 2; x++) {
      let open = true;
      for (let offset = 0; offset < length; offset++) {
        if (blocked[z * state.map.width + x + offset]) open = false;
      }
      if (open) return { x, z };
    }
  }
  throw new Error('no open horizontal route');
}

function openHeroTiles(state, count) {
  const blocked = buildBlockedGrid(state);
  const result = [];
  for (let z = 3; z < state.map.height - 3; z += 2) {
    for (let x = 3; x < state.map.width - 3; x += 2) {
      if (!blocked[z * state.map.width + x]) result.push({ x, z });
      if (result.length === count) return result;
    }
  }
  throw new Error('not enough open hero tiles');
}

function makeHero(state, owner, tileX, tileZ) {
  return spawnEntity(state, {
    kind: KIND.HERO,
    team: state.players.find((player) => player.id === owner).team,
    owner,
    x: tileX * 1000 + 500,
    z: tileZ * 1000 + 500,
    hp: 50_000,
    maxHp: 50_000,
    attack: 2,
  });
}

test('A* returns a repeatable route and avoids blocked tiles and diagonal corner cuts', () => {
  const blocked = new Uint8Array(25);
  blocked[2 * 5 + 1] = 1;
  blocked[1 * 5 + 2] = 1;
  const first = findPath(5, 5, blocked, 0, 12);
  assert.deepEqual(findPath(5, 5, blocked, 0, 12), first);
  assert.ok(first.length > 0);
  assert.equal(first.at(-1), 12);
  assert.equal(first.includes(7), false);
  assert.equal(first.includes(11), false);
});

test('heroMove plans a route and moves the owned hero to its destination', () => {
  const state = newMatch();
  const route = openHorizontalRoute(state);
  const hero = makeHero(state, 0, route.x, route.z);
  const targetX = (route.x + 3) * 1000 + 500;
  const targetZ = route.z * 1000 + 500;
  step(state, [{ tick: 0, playerId: 0, seq: 0, cmd: { t: 'heroMove', x: targetX, z: targetZ } }]);
  assert.ok(hero.movePath.length > 1);
  assert.ok(hero.x > route.x * 1000 + 500);
  for (let i = 0; i < 40 && hero.movePath.length > 0; i++) step(state, []);
  assert.equal(hero.movePath.length, 0);
  assert.ok(Math.abs(hero.x - targetX) <= 1);
  assert.ok(Math.abs(hero.z - targetZ) <= 1);
});

test('heroMove refuses another player, blocked destinations, and out-of-map coordinates', () => {
  const state = newMatch();
  const route = openHorizontalRoute(state);
  const hero = makeHero(state, 0, route.x, route.z);
  const blocked = state.entities.find((entity) => entity.kind === KIND.BLOCKER);
  const blockedX = Math.floor(blocked.x / 1000) * 1000 + 500;
  const blockedZ = Math.floor(blocked.z / 1000) * 1000 + 500;
  for (const [playerId, x, z] of [
    [1, (route.x + 2) * 1000 + 500, route.z * 1000 + 500],
    [0, blockedX, blockedZ],
    [0, state.map.width * 1000, 500],
  ]) {
    step(state, [{ tick: state.tick, playerId, seq: state.tick, cmd: { t: 'heroMove', x, z } }]);
    assert.equal(hero.pathDirty, 0);
    assert.deepEqual(hero.movePath, []);
  }
});

test('behavior plans no more than eight dirty paths per tick', () => {
  const players = Array.from({ length: 9 }, (_, id) => ({ id, team: 0, kind: 'human' }));
  const state = newMatch(players);
  const route = openHorizontalRoute(state, 5);
  const positions = openHeroTiles(state, players.length);
  const targetX = (route.x + 4) * 1000 + 500;
  const targetZ = route.z * 1000 + 500;
  const commands = [];
  for (let id = 0; id < players.length; id++) {
    const hero = makeHero(state, id, positions[id].x, positions[id].z);
    commands.push({
      tick: 0,
      playerId: id,
      seq: 0,
      cmd: { t: 'heroMove', x: targetX, z: targetZ },
    });
    assert.equal(hero.pathDirty, 0);
  }
  step(state, commands);
  assert.equal(state.entities.filter((entity) => entity.kind === KIND.HERO && entity.pathDirty === 1).length, 1);
  step(state, []);
  assert.equal(state.entities.filter((entity) => entity.kind === KIND.HERO && entity.pathDirty === 1).length, 0);
});

test('grid physics resolves circle collisions against units and static square buildings', () => {
  const unitPhysics = createGrid2DPhysics();
  unitPhysics.addBody(2, 1000, 1000, 250, 1, false);
  unitPhysics.addBody(1, 1000, 1000, 250, 1, false);
  unitPhysics.step();
  const first = unitPhysics.getPosition(1);
  const second = unitPhysics.getPosition(2);
  assert.ok(Math.abs(first.x - second.x) >= 500);
  assert.deepEqual(unitPhysics.queryRadius(1000, 1000, 10), [1, 2], 'a query with a little reach finds both bodies; the separation keeps one extra unit of slack');

  const buildingPhysics = createGrid2DPhysics();
  buildingPhysics.addBody(2, 1000, 1000, 250, 1, false);
  buildingPhysics.addBody(3, 2000, 1000, 0, 0, true, 'square');
  buildingPhysics.setDesiredVelocity(2, 700, 0);
  buildingPhysics.step();
  assert.ok(buildingPhysics.getPosition(2).x <= 1250);
});

test('knockback distributes its exact displacement over five linearly weighted ticks', () => {
  const state = newMatch();
  const [{ x, z }] = openHeroTiles(state, 1);
  const hero = makeHero(state, 0, x, z);
  const startingX = hero.x;
  hero.impulseX = 500;
  hero.impulseTicks = 5;
  for (let i = 0; i < 5; i++) step(state, []);
  assert.equal(hero.x, startingX + 500);
  assert.equal(hero.impulseTicks, 0);
});
