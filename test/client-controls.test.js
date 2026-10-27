import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIND, createState } from '../src/sim/index.js';
import { ABILITY_SLOTS, ATTACK_TYPES, PALETTE, abilityStates, actionsFor, autoSpawnToggle, canAfford, heroLuxChoices, heroPickState, immediateCast, pendingLine, pickEntity, placement, resolveTap, secondsText } from '../src/client/ui/controls.js';
import { actionForKey, DEFAULT_KEY_BINDINGS, defaultKeyBindings, keyLabel, normalizeKeyBindings } from '../src/client/input/key-bindings.js';
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

/** @param {Partial<Parameters<typeof placement>[0]>} over */
const place = (over) => placement({
  tileX: 0, tileZ: 0, entities: state.entities, viewerTeam: 0, building: 'solar', attack: 'ranged',
  coreLuxMilli: 100_000, data, vents: state.map.vents, ...over,
});

test('a tap with a building picked sets the ghost on that tile and sends nothing', () => {
  const t = freeTile();
  assert.deepEqual(tap({ ground: at(t), building: 'solar' }), { ghost: { tileX: t.tileX, tileZ: t.tileZ } });
  assert.deepEqual(tap({ ground: { x: 48.5, z: 56.5 }, building: 'solar' }), { ghost: { tileX: 48, tileZ: 56 }, message: 'Build inside your own zone.' }, 'a red ghost carries its reason');
});

test('Place builds on the ghost tile, and a tower carries the chosen attack type', () => {
  const t = freeTile();
  assert.deepEqual(place({ ...t, building: 'solar' }), { command: { t: 'build', building: 'solar', tileX: t.tileX, tileZ: t.tileZ } });
  assert.deepEqual(place({ ...t, building: 'tower', attack: 'area' }), { command: { t: 'build', building: 'tower', tileX: t.tileX, tileZ: t.tileZ, attack: 'area' } });
});

test('a placement refuses outside the zone, on a taken tile, off a vent and without lux, with a reason', () => {
  const t = freeTile();
  assert.deepEqual(place({ tileX: 48, tileZ: 56 }), { message: 'Build inside your own zone.' });
  const core = state.entities.find((e) => e.kind === KIND.CORE && e.team === 0);
  assert.deepEqual(place({ tileX: Math.floor(core.x / 1000), tileZ: Math.floor(core.z / 1000) }), { message: 'That tile is taken.' });
  assert.deepEqual(place({ ...t, building: 'geothermal' }), { message: 'Geothermal needs a vent tile.' });
  assert.ok('command' in place({ tileX: vent.tileX, tileZ: vent.tileZ, building: 'geothermal' }), 'a vent accepts geothermal');
  assert.match(/** @type {any} */ (place({ ...t, building: 'nuclear', coreLuxMilli: 80_000 })).message, /^Not enough lux/);
});

test('team 1 builds in the mirrored zone and cannot reach the zone of team 0', () => {
  const t = freeTile();
  const mirrored = { tileX: 95 - t.tileX, tileZ: 111 - t.tileZ }; // the map is point-mirrored, so this tile is free too
  assert.deepEqual(place({ ...mirrored, viewerTeam: 1 }), { command: { t: 'build', building: 'solar', ...mirrored } });
  assert.deepEqual(place({ ...mirrored, viewerTeam: 0 }), { message: 'Build inside your own zone.' });
  assert.deepEqual(place({ ...t, viewerTeam: 1 }), { message: 'Build inside your own zone.' });
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
  assert.deepEqual(tap({ ground: { x: 40.5, z: 30.5 }, entities: [...state.entities, enemy, hero] }), { command: { t: 'heroAttack', targetId: 50 }, deselect: true }, 'an order from the open map clears the selection');
  assert.deepEqual(tap({ ground: { x: 20.25, z: 70.75 }, entities: [...state.entities, hero] }), { command: { t: 'heroMove', x: 20_250, z: 70_750 }, deselect: true }, 'coordinates are whole units, 1 tile = 1000');
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

test('the ability bar follows the four slots of the data, M R A S', () => {
  assert.deepEqual(ABILITY_SLOTS.map((a) => a.type), Object.keys(raw.abilities.templates));
  assert.deepEqual(ABILITY_SLOTS.map((a) => a.letter).join(''), 'MRAS');
  const states = abilityStates({ cd0: 0, cd1: 0, cd2: 0, cd3: 0 }, raw.abilities, 100_000, 1, 20);
  assert.deepEqual(states.map((s) => s.costLux), [5, 5, 5, 10]);
  assert.ok(states.every((s) => s.ready && !s.poor));
  assert.deepEqual(states.map((s) => s.aim), ['none', 'target', 'point', 'none']);
});

test('the default keyboard slots map QWER to abilities and 1234 to inventory items', () => {
  const bindings = defaultKeyBindings();
  assert.deepEqual(bindings, {
    abilities: ['KeyQ', 'KeyW', 'KeyE', 'KeyR'],
    items: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  });
  assert.deepEqual(actionForKey(bindings, 'KeyQ'), { kind: 'ability', slot: 0 });
  assert.deepEqual(actionForKey(bindings, 'KeyR'), { kind: 'ability', slot: 3 });
  assert.deepEqual(actionForKey(bindings, 'Digit1'), { kind: 'item', slot: 0 });
  assert.deepEqual(actionForKey(bindings, 'Digit4'), { kind: 'item', slot: 3 });
  assert.equal(actionForKey(bindings, 'KeyA'), null);
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit4'), '4');
  assert.equal(DEFAULT_KEY_BINDINGS.abilities[0], 'KeyQ');
});

test('saved key slots require eight unique letter or digit codes', () => {
  const custom = { abilities: ['KeyA', 'KeyS', 'KeyD', 'KeyF'], items: ['Digit5', 'Digit6', 'Digit7', 'Digit8'] };
  assert.deepEqual(normalizeKeyBindings(custom), custom);
  assert.deepEqual(normalizeKeyBindings({ ...custom, items: ['Digit5', 'Digit5', 'Digit7', 'Digit8'] }), defaultKeyBindings());
  assert.deepEqual(normalizeKeyBindings({ ...custom, abilities: ['Escape', ...custom.abilities.slice(1)] }), defaultKeyBindings());
  assert.deepEqual(normalizeKeyBindings(null), defaultKeyBindings());
});

test('a cooldown shows seconds rounded up to a tenth, and a spent cooldown shows the cost again', () => {
  assert.equal(secondsText(99, 20), '5.0s');
  assert.equal(secondsText(1, 20), '0.1s');
  assert.equal(secondsText(0, 20), '0.0s');
  const [melee] = abilityStates({ cd0: 41, cd1: 0, cd2: 0, cd3: 0 }, raw.abilities, 100_000, 1, 20);
  assert.equal(melee.text, 'M 2.1s');
  assert.equal(melee.ready, false);
});

test('melee and shield cast at once, ranged and area wait for a tap', () => {
  assert.deepEqual(immediateCast(0, { id: 9 }), { t: 'castAbility', slot: 0 });
  assert.deepEqual(immediateCast(3, { id: 9 }), { t: 'castAbility', slot: 3, targetId: 9 });
  assert.equal(immediateCast(1, { id: 9 }), null);
  assert.equal(immediateCast(2, { id: 9 }), null);
});

test('the hero pick offers the whole roster, greys out locked heroes, and waits while a hero lives, builds or cools down', () => {
  const roster = raw.heroes.roster;
  const open = heroPickState({ player: { heroLock: 0b00110, heroCooldown: 0 }, heroAlive: false, heroQueued: false, roster, tickHz: 20 });
  assert.equal(open.note, '');
  assert.deepEqual(open.options.map((o) => o.enabled), [true, false, false, true, true]);
  assert.deepEqual(open.options.map((o) => o.locked), [false, true, true, false, false]);
  for (const busy of [{ heroAlive: true }, { heroQueued: true }]) {
    const state = heroPickState({ player: { heroLock: 0, heroCooldown: 0 }, heroAlive: false, heroQueued: false, roster, tickHz: 20, ...busy });
    assert.ok(state.note.length > 0 && state.options.every((o) => !o.enabled));
  }
  assert.equal(heroPickState({ player: { heroLock: 0, heroCooldown: 100 }, heroAlive: false, heroQueued: false, roster, tickHz: 20 }).note, 'Next pick in 5.0s');
});

test('the lux a hero can take is a share of the Core, whole, and never more than the Core can spare', () => {
  assert.deepEqual(heroLuxChoices(100_000, 1).map((c) => c.lux), [25, 50, 75, 99]);
  assert.deepEqual(heroLuxChoices(2_000, 1), [{ label: '50%', lux: 1 }]);
  assert.deepEqual(heroLuxChoices(1_000, 1), []);
  for (const core of [3_000, 17_000, 123_456]) for (const c of heroLuxChoices(core, 1)) assert.ok(c.lux >= 1 && core - c.lux * 1000 >= 1000, `${c.lux} of ${core}`);
});

test('an aimed ranged ability needs an enemy or a blocker, and an aimed area ability takes any point', () => {
  const entities = [
    { id: 2, kind: KIND.HERO, team: 0, owner: 0, x: 40000, z: 60000, hp: 1, maxHp: 1 },
    { id: 3, kind: KIND.CREEP, team: 1, owner: 1, x: 42000, z: 60000, hp: 1, maxHp: 1 },
    { id: 4, kind: KIND.BARRACKS, team: 0, owner: 0, x: 44000, z: 90000, hp: 1, maxHp: 1 },
  ];
  assert.deepEqual(tap({ entities, ground: { x: 42, z: 60 }, ability: 1 }), { command: { t: 'castAbility', slot: 1, targetId: 3 } });
  assert.deepEqual(tap({ entities, ground: { x: 44, z: 90 }, ability: 1 }), { message: 'Tap an enemy to hit.' });
  assert.deepEqual(tap({ entities, ground: { x: 10.25, z: 20.75 }, ability: 2 }), { command: { t: 'castAbility', slot: 2, x: 10250, z: 20750 } });
});

test('an order just sent shows in the queue before the snapshot has it', () => {
  assert.equal(pendingLine({ t: 'orderCreeps', mix: ['ranged', 'ranged', 'melee'] }), 'Group of 3 RRM ...');
  assert.equal(pendingLine({ t: 'orderCreeps', mix: ['melee', 'ranged', 'area'] }), 'Group of 3 MRA ...');
  assert.equal(pendingLine({ t: 'pickHero', heroId: 1, lux: 40 }, ['Prism', 'Halo']), 'Hero Halo 40 lux ...');
  assert.equal(pendingLine({ t: 'orderItem', itemId: 0 }, [], ['Haste']), 'Item Haste ...');
  assert.equal(pendingLine({ t: 'recycle' }), '');
});

test('the auto spawn toggle reads the barracks field of the sim and sends the opposite state', () => {
  const barracks = { ...state.entities[0], id: 42, kind: KIND.BARRACKS, autoSpawn: 0 };
  assert.deepEqual(autoSpawnToggle(barracks), {
    label: 'Creep auto spawn', on: false, command: { t: 'setAutoSpawn', barracksId: 42, on: true },
  });
  assert.deepEqual(autoSpawnToggle({ ...barracks, autoSpawn: 1 }), {
    label: 'Creep auto spawn', on: true, command: { t: 'setAutoSpawn', barracksId: 42, on: false },
  });
});
