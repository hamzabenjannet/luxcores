import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND, createState } from '../src/sim/index.js';
import { ATTACK_TYPES, PALETTE, actionsFor, canAfford, pickEntity, resolveTap } from '../src/client/ui/controls.js';
import { loadData } from './helpers/load-data.js';

const { raw, config } = loadData();
const data = { buildings: raw.buildings, balance: raw.balance, mapgen: raw.mapgen };
const state = createState({ seed: 1234567, players: [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'bot' }], config });
const vent = state.map.vents.find((v) => v.team === 0);

/** A tile in team 0's build zone that nothing stands on, and that is not a vent. */
function freeTile() {
  const taken = new Set(state.entities.map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`));
  for (const v of state.map.vents) taken.add(`${v.tileX},${v.tileZ}`);
  for (let z = 100; z < 110; z++) for (let x = 4; x < 90; x++) if (!taken.has(`${x},${z}`)) return { tileX: x, tileZ: z };
  throw new Error('no free tile');
}
const at = (/** @type {{ tileX: number, tileZ: number }} */ t) => ({ x: t.tileX + 0.5, z: t.tileZ + 0.5 });

/** @param {Partial<Parameters<typeof resolveTap>[0]>} over */
const tap = (over) => resolveTap({
  ground: { x: 0, z: 0 }, entities: state.entities, viewerTeam: 0, building: null, attack: 'ranged',
  coreLuxMilli: 100_000, data, vents: state.map.vents, ...over,
});

test('the palette lists the six buildings of the data, in order', () => {
  assert.deepEqual(PALETTE.map((p) => p.key), ['solar', 'wind', 'geothermal', 'nuclear', 'barracks', 'tower']);
  for (const p of PALETTE) assert.ok(data.buildings[p.key].costLux > 0);
  assert.deepEqual([...ATTACK_TYPES], ['melee', 'ranged', 'area']);
});

test('affordability keeps the minimum the Core must hold after a spend', () => {
  assert.equal(canAfford(100_000, 20, 1), true);
  assert.equal(canAfford(21_000, 20, 1), true, 'exactly the minimum is left');
  assert.equal(canAfford(20_999, 20, 1), false);
});

test('a tap with a building picked builds on that tile, and a tower carries the chosen attack type', () => {
  const t = freeTile();
  assert.deepEqual(tap({ ground: at(t), building: 'solar' }), { command: { t: 'build', building: 'solar', tileX: t.tileX, tileZ: t.tileZ } });
  assert.deepEqual(tap({ ground: at(t), building: 'tower', attack: 'area' }), { command: { t: 'build', building: 'tower', tileX: t.tileX, tileZ: t.tileZ, attack: 'area' } });
});

test('a build tap refuses outside the zone, on a taken tile, off a vent and without lux, with a reason', () => {
  const t = freeTile();
  assert.deepEqual(tap({ ground: { x: 48.5, z: 56.5 }, building: 'solar' }), { message: 'Build inside your own zone.' });
  const core = state.entities.find((e) => e.kind === KIND.CORE && e.team === 0);
  assert.deepEqual(tap({ ground: { x: core.x / 1000, z: core.z / 1000 }, building: 'solar' }), { message: 'That tile is taken.' });
  assert.deepEqual(tap({ ground: at(t), building: 'geothermal' }), { message: 'Geothermal needs a vent tile.' });
  assert.ok('command' in tap({ ground: { x: vent.tileX + 0.5, z: vent.tileZ + 0.5 }, building: 'geothermal' }), 'a vent accepts geothermal');
  assert.match(/** @type {any} */ (tap({ ground: at(t), building: 'nuclear', coreLuxMilli: 80_000 })).message, /^Not enough lux/);
});

test('team 1 builds in the mirrored zone and cannot reach the zone of team 0', () => {
  const t = freeTile();
  const mirrored = { tileX: 95 - t.tileX, tileZ: 111 - t.tileZ }; // the map is point-mirrored, so this tile is free too
  assert.deepEqual(tap({ ground: at(mirrored), building: 'solar', viewerTeam: 1 }), { command: { t: 'build', building: 'solar', ...mirrored } });
  assert.deepEqual(tap({ ground: at(mirrored), building: 'solar', viewerTeam: 0 }), { message: 'Build inside your own zone.' });
  assert.deepEqual(tap({ ground: at(t), building: 'solar', viewerTeam: 1 }), { message: 'Build inside your own zone.' });
});

test('a tap on an own building selects it, and a tap on empty ground clears the selection', () => {
  const t = freeTile();
  const own = { ...state.entities[0], id: 99, kind: KIND.SOLAR, team: 0, owner: 0, x: t.tileX * 1000 + 500, z: t.tileZ * 1000 + 500 };
  assert.deepEqual(tap({ ground: at(t), entities: [...state.entities, own] }), { select: 99 });
  assert.deepEqual(tap({ ground: at(t) }), { select: null });
});

test('without a hero, tapping an enemy does nothing; with a hero, a tap on the ground moves it and a tap on an enemy attacks', () => {
  const t = freeTile();
  const enemy = { ...state.entities[0], id: 50, kind: KIND.TOWER, team: 1, owner: 1, x: 40_500, z: 30_500 };
  const hero = { ...state.entities[0], id: 51, kind: KIND.HERO, team: 0, owner: 0, x: 48_500, z: 90_500 };
  assert.deepEqual(tap({ ground: { x: 40.5, z: 30.5 }, entities: [...state.entities, enemy] }), { select: null });
  assert.deepEqual(tap({ ground: { x: 40.5, z: 30.5 }, entities: [...state.entities, enemy, hero] }), { command: { t: 'heroAttack', targetId: 50 } });
  assert.deepEqual(tap({ ground: { x: 20.25, z: 70.75 }, entities: [...state.entities, hero] }), { command: { t: 'heroMove', x: 20_250, z: 70_750 } }, 'coordinates are whole units, 1 tile = 1000');
  assert.deepEqual(tap({ ground: at(t), entities: [...state.entities, hero] }).command.t, 'heroMove');
});

test('a hero tap lands on the nearest entity, and ties go to the lowest id', () => {
  const near = { ...state.entities[0], id: 70, kind: KIND.CREEP, team: 1, x: 10_000, z: 10_000 };
  const far = { ...state.entities[0], id: 71, kind: KIND.CREEP, team: 1, x: 10_900, z: 10_000 };
  assert.equal(pickEntity([far, near], { x: 10.1, z: 10 })?.id, 70);
  assert.equal(pickEntity([{ ...near, kind: KIND.PROJECTILE }], { x: 10, z: 10 }), undefined, 'projectiles cannot be picked');
  assert.equal(pickEntity([near], { x: 20, z: 20 }), undefined);
});

test('the panel offers the upgrades a tower still has, and recycle or cancel by state', () => {
  const tower = { ...state.entities[0], id: 80, kind: KIND.TOWER, team: 0, owner: 0, recycle: 0, powerLevel: 0, shellLevel: 3, attack: 2 };
  assert.deepEqual(actionsFor(tower, data.buildings.tower).map((a) => [a.id, a.label, a.costLux]), [
    ['power', 'Power 1/3', 10],
    ['recycle', 'Recycle', undefined],
  ], 'a full shell track offers nothing');
  assert.deepEqual(actionsFor({ ...tower, recycle: 30 }, data.buildings.tower).map((a) => a.id), ['cancel'], 'a recycling tower takes no upgrade');
  assert.deepEqual(actionsFor({ ...state.entities[0], kind: KIND.SOLAR, recycle: 0 }, data.buildings.tower).map((a) => a.command.t), ['recycle']);
  assert.deepEqual(actionsFor(tower, data.buildings.tower)[0].command, { t: 'upgrade', towerId: 80, track: 'power' });
});
