import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, KIND } from '../src/sim/index.js';
import { loadData } from './helpers/load-data.js';

const { config } = loadData();
const fresh = () => createState({ seed: 1234567, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }], config });
let seq = 0;
const build = (s, playerId, building, tileX, tileZ, extra = {}) => ({ tick: s.tick, playerId, seq: seq++, cmd: { t: 'build', building, tileX, tileZ, ...extra } });
const buildings = (s) => s.entities.filter((e) => e.kind >= KIND.SOLAR && e.kind <= KIND.TOWER);
const atTile = (s, x, z) => s.entities.filter((e) => Math.floor(e.x / 1000) === x && Math.floor(e.z / 1000) === z);

test('two buildings never share a tile: not in one tick, not in a later one, not for any kind', () => {
  const s = fresh();
  step(s, [build(s, 0, 'solar', 20, 100), build(s, 0, 'wind', 20, 100)]);
  assert.equal(buildings(s).length, 1, 'only the first command of a tick takes the tile');
  step(s, [build(s, 0, 'barracks', 20, 100)]);
  step(s, [build(s, 0, 'tower', 20, 100, { attack: 'melee' })]);
  assert.equal(buildings(s).length, 1);
  assert.equal(atTile(s, 20, 100).length, 1);
  assert.equal(s.teams[0].coreLux, 80_000, 'a refused build costs nothing');
});

test('neighbouring tiles are free, so a row of buildings fits', () => {
  const s = fresh();
  for (let x = 20; x < 24; x++) step(s, [build(s, 0, 'wind', x, 100)]); // 4 x 20 lux, the Core keeps its last lux
  assert.equal(buildings(s).length, 4);
  assert.deepEqual(buildings(s).map((e) => Math.floor(e.x / 1000)), [20, 21, 22, 23]);
});

test('a tile stays taken while its building is recycling, and is free again after', () => {
  const s = fresh();
  step(s, [build(s, 0, 'solar', 20, 100)]);
  const solar = buildings(s)[0];
  step(s, [{ tick: s.tick, playerId: 0, seq: seq++, cmd: { t: 'recycle', buildingId: solar.id } }]);
  step(s, [build(s, 0, 'wind', 20, 100)]);
  assert.equal(buildings(s).length, 1, 'the channel still holds the tile');
  for (let i = 0; i < 61; i++) step(s, []);
  assert.equal(buildings(s).length, 0);
  step(s, [build(s, 0, 'wind', 20, 100)]);
  assert.equal(buildings(s).length, 1);
});

test('the Lumen Core, a blocker and a vent that already holds a collector are all taken', () => {
  const s = fresh();
  const core = s.entities.find((e) => e.kind === KIND.CORE && e.team === 0);
  const blocker = s.entities.find((e) => e.kind === KIND.BLOCKER && Math.floor(e.z / 1000) >= 64);
  const vent = s.map.vents.find((v) => v.team === 0);
  step(s, [
    build(s, 0, 'wind', Math.floor(core.x / 1000), Math.floor(core.z / 1000)),
    build(s, 0, 'wind', Math.floor(blocker.x / 1000), Math.floor(blocker.z / 1000)),
    build(s, 0, 'geothermal', vent.tileX, vent.tileZ),
    build(s, 0, 'geothermal', vent.tileX, vent.tileZ),
  ]);
  assert.equal(buildings(s).length, 1, 'only the first geothermal plant on the vent');
  assert.equal(buildings(s)[0].kind, KIND.GEOTHERMAL);
});

test('the other team cannot build on a tile either, and each team still builds in its own zone', () => {
  const s = fresh();
  step(s, [build(s, 0, 'solar', 20, 100), build(s, 1, 'solar', 20, 100)]);
  assert.equal(buildings(s).length, 1);
  step(s, [build(s, 1, 'solar', 75, 11)]);
  assert.equal(buildings(s).length, 2);
});
