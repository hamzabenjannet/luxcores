// M2 economy rules, driven through commands and step() only (GDD 3 to 5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, step, hashState, KIND } from '../src/sim/index.js';

const MILLI = 1000;
const PLAYERS = [
  { id: 0, team: 0, kind: 'human' },
  { id: 1, team: 1, kind: 'bot' },
];

function newMatch(seed = 1234567) {
  return createState({ seed, players: PLAYERS, config: loadData().config });
}

/** Steps `n` ticks with no commands. */
function run(state, n) {
  for (let i = 0; i < n; i++) step(state, []);
}

/** Sends one command on the current tick and steps once. Returns the new entities, if any. */
let seq = 0;
function send(state, playerId, cmd) {
  const before = state.entities.length;
  step(state, [{ tick: state.tick, playerId, seq: seq++, cmd }]);
  return state.entities.slice(before);
}

const built = (state, kind) => state.entities.filter((e) => e.kind === kind);
const core = (state, team) => state.entities.find((e) => e.kind === KIND.CORE && e.team === team);
const luxOf = (state, team) => state.teams[team].coreLux;

/** The n-th free tile of a team's build zone, away from vents and blockers. */
function freeTile(state, team, n = 0) {
  const rows = team === 0 ? [64, 111] : [0, 47];
  const taken = new Set(state.entities.filter((e) => e.kind <= KIND.BLOCKER).map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`));
  for (const v of state.map.vents) taken.add(`${v.tileX},${v.tileZ}`);
  let found = 0;
  for (let z = rows[team === 0 ? 0 : 1]; team === 0 ? z <= rows[1] : z >= rows[0]; z += team === 0 ? 1 : -1) {
    for (let x = 4; x < 92; x += 3) {
      if (taken.has(`${x},${z}`)) continue;
      if (found++ === n) return { tileX: x, tileZ: z };
    }
  }
  throw new Error('no free tile');
}

const build = (state, playerId, building, tile, extra = {}) => send(state, playerId, { t: 'build', building, ...tile, ...extra });

test('build: a solar collector costs 20 lux, takes 200 HP and belongs to its builder', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0));
  assert.equal(solar.kind, KIND.SOLAR);
  assert.equal(solar.team, 0);
  assert.equal(solar.owner, 0);
  assert.equal(solar.hp, 200 * MILLI);
  assert.equal(solar.maxHp, 200 * MILLI);
  assert.equal(luxOf(s, 0), 80 * MILLI);
  assert.equal(core(s, 0).hp, 80 * MILLI, 'Core HP is its lux');
});

test('buffer: income waits 40 ticks in the pending pool, then settles into the Core', () => {
  const s = newMatch();
  build(s, 0, 'solar', freeTile(s, 0)); // tick 0: Core 80 lux
  run(s, 39); // state.tick is 40
  assert.equal(luxOf(s, 0), 80 * MILLI, 'nothing settled yet');
  assert.equal(s.teams[0].pendingLux, 40 * 100, 'solar makes 2 lux per second, 100 milli-lux per tick, 40 ticks so far');
  run(s, 1); // the step at tick 40 settles the entry from tick 0
  assert.equal(luxOf(s, 0), 80 * MILLI + 100);
  assert.equal(s.teams[0].pendingLux, 40 * 100, 'a new entry replaces the settled one');
  assert.equal(core(s, 0).hp, luxOf(s, 0), 'the Core entity follows the bank');
});

test('Core max HP rises with income and never falls when lux is spent', () => {
  const s = newMatch();
  assert.equal(core(s, 0).maxHp, 100 * MILLI);
  build(s, 0, 'solar', freeTile(s, 0));
  assert.equal(core(s, 0).hp, 80 * MILLI);
  assert.equal(core(s, 0).maxHp, 100 * MILLI, 'spending does not lower max HP');
  // A hundred solar-seconds later the Core holds more than it started with.
  for (let i = 1; i <= 4; i++) build(s, 0, 'solar', freeTile(s, 0, i)); // 5 solars cost 100 lux: refused at the 5th
  assert.equal(built(s, KIND.SOLAR).length, 4, 'the fifth would leave 0 lux, so it is refused');
  run(s, 1200);
  assert.ok(luxOf(s, 0) > 100 * MILLI, 'income lifted the Core above its start');
  assert.equal(core(s, 0).maxHp, core(s, 0).hp, 'max HP follows the highest HP');
});

test('spend rule: a purchase that would leave the Core under 1 lux is refused', () => {
  const s = newMatch();
  build(s, 0, 'nuclear', freeTile(s, 0)); // 100 - 80 = 20
  assert.equal(luxOf(s, 0), 20 * MILLI);
  assert.equal(build(s, 0, 'solar', freeTile(s, 0, 1)).length, 0, '20 - 20 = 0 is under 1 lux');
  assert.equal(luxOf(s, 0), 20 * MILLI, 'a refused purchase costs nothing');
  assert.equal(built(s, KIND.SOLAR).length, 0);
});

test('spend rule: the Core may keep exactly 1 lux, and no less', () => {
  const s = newMatch();
  build(s, 0, 'solar', freeTile(s, 0)); // tick 0: 80 lux left; the solar settles 0.1 lux per tick from tick 40
  while (luxOf(s, 0) < 80_900) step(s, []);
  assert.equal(luxOf(s, 0), 80_900);
  assert.equal(build(s, 0, 'nuclear', freeTile(s, 0, 1)).length, 0, '80.9 - 80 leaves 0.9 lux: refused');
  assert.equal(luxOf(s, 0) >= 81_000, true, 'a tick later the bank holds 81 lux');
  assert.equal(build(s, 0, 'nuclear', freeTile(s, 0, 1)).length, 1, '81 - 80 leaves exactly 1 lux: allowed');
  assert.equal(luxOf(s, 0) < 81_300, true, 'about 1 lux is left, plus one tick of income');
});

test('placement: only on free tiles inside your own build zone', () => {
  const s = newMatch();
  const tile = freeTile(s, 0);
  const refuse = (building, t, extra) => assert.equal(build(s, 0, building, t, extra).length, 0, JSON.stringify(t));

  refuse('solar', { tileX: tile.tileX, tileZ: 60 }); // DMZ row
  refuse('solar', { tileX: tile.tileX, tileZ: 10 }); // the enemy half
  refuse('solar', { tileX: tile.tileX, tileZ: 112 }); // off the map
  refuse('solar', { tileX: -1, tileZ: 100 });
  refuse('solar', { tileX: 96, tileZ: 100 });
  refuse('solar', { tileX: 1.5, tileZ: 100 }); // not a whole tile
  refuse('solar', { tileX: '5', tileZ: 100 });
  const c = core(s, 0);
  refuse('solar', { tileX: Math.floor(c.x / 1000), tileZ: Math.floor(c.z / 1000) }); // on the Core
  const blocker = s.entities.find((e) => e.kind === KIND.BLOCKER && Math.floor(e.z / 1000) >= 64);
  refuse('solar', { tileX: Math.floor(blocker.x / 1000), tileZ: Math.floor(blocker.z / 1000) }); // on a blocker
  assert.equal(luxOf(s, 0), 100 * MILLI, 'refused builds cost nothing');

  assert.equal(build(s, 0, 'solar', tile).length, 1);
  refuse('wind', tile); // the tile is taken now
  assert.equal(built(s, KIND.SOLAR).length, 1);
});

test('placement: the bot player builds in the top half, not in yours', () => {
  const s = newMatch();
  assert.equal(build(s, 1, 'solar', freeTile(s, 0)).length, 0, 'player 1 may not build in team 0 zone');
  const [mine] = build(s, 1, 'solar', freeTile(s, 1));
  assert.equal(mine.team, 1);
  assert.equal(mine.owner, 1);
  assert.equal(build(s, 7, 'solar', freeTile(s, 0)).length, 0, 'an unknown player is dropped');
  assert.equal(luxOf(s, 0), 100 * MILLI);
});

test('placement: a geothermal collector needs one of your vent tiles', () => {
  const s = newMatch();
  const vent = s.map.vents.find((v) => v.team === 0);
  const foreign = s.map.vents.find((v) => v.team === 1);
  assert.equal(build(s, 0, 'geothermal', freeTile(s, 0)).length, 0, 'not a vent');
  assert.equal(build(s, 0, 'geothermal', { tileX: foreign.tileX, tileZ: foreign.tileZ }).length, 0, 'the other team vent');
  const [plant] = build(s, 0, 'geothermal', { tileX: vent.tileX, tileZ: vent.tileZ });
  assert.equal(plant.kind, KIND.GEOTHERMAL);
  assert.equal(plant.hp, 400 * MILLI);
  assert.equal(luxOf(s, 0), 60 * MILLI);
  assert.equal(build(s, 0, 'solar', { tileX: vent.tileX, tileZ: vent.tileZ }).length, 0, 'the vent is taken now');
});

test('placement: a tower needs an attack type, no other building takes one', () => {
  const s = newMatch();
  assert.equal(build(s, 0, 'tower', freeTile(s, 0, 0)).length, 0);
  assert.equal(build(s, 0, 'tower', freeTile(s, 0, 0), { attack: 'laser' }).length, 0);
  assert.equal(build(s, 0, 'solar', freeTile(s, 0, 0), { attack: 'melee' }).length, 0);
  const attacks = ['melee', 'ranged', 'area'].map((attack, i) => build(s, 0, 'tower', freeTile(s, 0, i), { attack })[0].attack);
  assert.deepEqual(attacks, [1, 2, 3]);
});

test('placement: barracks and the other buildings follow the same rules', () => {
  const s = newMatch();
  const [b] = build(s, 0, 'barracks', freeTile(s, 0));
  assert.equal(b.kind, KIND.BARRACKS);
  assert.equal(b.hp, 400 * MILLI);
  assert.equal(luxOf(s, 0), 60 * MILLI);
  assert.equal(build(s, 0, 'castle', freeTile(s, 0, 1)).length, 0, 'unknown building');
  assert.equal(build(s, 0, undefined, freeTile(s, 0, 1)).length, 0);
});

test('tower upgrades spend lux, add damage or HP, and enforce ownership and level caps', () => {
  const s = newMatch();
  const [tower] = build(s, 0, 'tower', freeTile(s, 0), { attack: 'melee' });
  const command = (playerId, track) => send(s, playerId, { t: 'upgrade', towerId: tower.id, track });
  const startingLux = luxOf(s, 0);

  command(1, 'power');
  command(0, 'invalid');
  assert.equal(tower.powerLevel, 0);
  assert.equal(luxOf(s, 0), startingLux);

  command(0, 'power');
  assert.equal(tower.powerLevel, 1);
  assert.equal(tower.powerLux, 10 * MILLI);
  assert.equal(luxOf(s, 0), startingLux - 10 * MILLI);
  for (const expectedLevel of [2, 3]) {
    command(0, 'power');
    assert.equal(tower.powerLevel, expectedLevel);
  }
  const afterMaxLevel = luxOf(s, 0);
  command(0, 'power');
  assert.equal(tower.powerLevel, 3);
  assert.equal(luxOf(s, 0), afterMaxLevel);
  command(0, 'shell');
  assert.equal(tower.shellLevel, 0, 'the Core must keep at least 1 lux after an upgrade');
  assert.equal(luxOf(s, 0), afterMaxLevel);

  const shellState = newMatch();
  const [shellTower] = build(shellState, 0, 'tower', freeTile(shellState, 0), { attack: 'melee' });
  const hp = shellTower.hp;
  send(shellState, 0, { t: 'upgrade', towerId: shellTower.id, track: 'shell' });
  assert.equal(shellTower.shellLevel, 1);
  assert.equal(shellTower.hp, hp + 100 * MILLI);
  assert.equal(shellTower.maxHp, hp + 100 * MILLI);
});

test('tower power upgrades count toward recycle refund', () => {
  const s = newMatch();
  const [tower] = build(s, 0, 'tower', freeTile(s, 0), { attack: 'melee' });
  send(s, 0, { t: 'upgrade', towerId: tower.id, track: 'power' });
  const bankBeforeRecycle = luxOf(s, 0);
  send(s, 0, { t: 'recycle', buildingId: tower.id });
  run(s, 60);
  assert.equal(s.entities.some((entity) => entity.id === tower.id), false);
  const hpAtCompletion = 200 * MILLI - 100;
  const refund = Math.trunc((Math.trunc(hpAtCompletion / 10) + tower.powerLux) * 60 / 100);
  assert.equal(luxOf(s, 0), bankBeforeRecycle + refund);
});

test('day and night: solar earns 2 lux per second by day and nothing at night', () => {
  const s = newMatch();
  build(s, 0, 'solar', freeTile(s, 0)); // tick 0, dawn
  const settledAt = (tick) => {
    while (s.tick < tick) step(s, []);
    return luxOf(s, 0) + s.teams[0].pendingLux;
  };
  assert.equal(settledAt(800), 80 * MILLI + 800 * 100, 'the whole day, 40 s at 2 lux per second');
  assert.equal(settledAt(1200), 80 * MILLI + 800 * 100, 'the night adds nothing');
  assert.equal(settledAt(2000), 80 * MILLI + 1600 * 100, 'the next day pays again');
});

test('wind: output rerolls every 200 ticks from the seeded RNG and stays within 0 to 3 lux per second', () => {
  const totals = (seed) => {
    const s = newMatch(seed);
    build(s, 0, 'wind', freeTile(s, 0));
    const rolls = new Set();
    for (let i = 0; i < 2000; i++) {
      step(s, []);
      rolls.add(built(s, KIND.WIND)[0].roll);
    }
    for (const r of rolls) assert.ok(r >= 0 && r <= 3000, `roll ${r}`);
    return { rolls: [...rolls], hash: hashState(s) };
  };
  const a = totals(5);
  assert.ok(a.rolls.length >= 9, `about one roll per 200 ticks, got ${a.rolls.length}`);
  assert.deepEqual(totals(5), a, 'the same seed gives the same rolls and the same hash');
  assert.notDeepEqual(totals(6).rolls, a.rolls);
});

test('wind: lux adds up exactly to the rolled output, with no rounding drift', () => {
  const s = newMatch(21);
  build(s, 0, 'wind', freeTile(s, 0));
  const roll = built(s, KIND.WIND)[0].roll;
  run(s, 199); // still the first roll: ticks 0 to 199 make 200 ticks of income
  assert.equal(s.teams[0].pendingLux + luxOf(s, 0) - 80 * MILLI, 10 * roll, '10 seconds at the rolled rate');
});

test('recycle: after a 3 s channel the Core gets 60% of the lux value and the building is gone', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0));
  const before = luxOf(s, 0);
  send(s, 0, { t: 'recycle', buildingId: solar.id }); // the channel starts on this tick
  assert.equal(solar.recycle, 59);
  run(s, 58);
  assert.ok(built(s, KIND.SOLAR).length === 1, 'still channeling');
  run(s, 1);
  assert.equal(built(s, KIND.SOLAR).length, 0, 'removed when the channel ends, 60 ticks after the command');
  // 60% of 20 lux is 12 lux. The 60 ticks of solar income that settled meanwhile come on top.
  const income = (luxOf(s, 0) - before) - 12 * MILLI;
  assert.ok(income >= 0 && income <= 60 * 100, `refund plus income, income part ${income}`);
  assert.equal(core(s, 0).hp, luxOf(s, 0));
});

test('recycle: the refund follows the current HP, not the price', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0));
  solar.hp = 100 * MILLI; // as if it had been damaged to half
  const before = luxOf(s, 0) + s.teams[0].pendingLux;
  send(s, 0, { t: 'recycle', buildingId: solar.id });
  run(s, 59);
  const gained = luxOf(s, 0) + s.teams[0].pendingLux - before;
  assert.ok(gained >= 6 * MILLI && gained < 6 * MILLI + 60 * 100 + 1, 'half the HP refunds 60% of 10 lux');
});

test('recycle: cancelling keeps the building and refunds nothing, and it can be recycled again', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0));
  send(s, 0, { t: 'recycle', buildingId: solar.id });
  run(s, 20);
  send(s, 0, { t: 'cancelRecycle', buildingId: solar.id });
  assert.equal(solar.recycle, 0);
  run(s, 100);
  assert.equal(built(s, KIND.SOLAR).length, 1, 'cancelled');
  assert.ok(luxOf(s, 0) + s.teams[0].pendingLux < 80 * MILLI + 200 * 100, 'no refund came');
  send(s, 0, { t: 'recycle', buildingId: solar.id });
  assert.equal(solar.recycle, 59, 'a fresh channel starts from 3 s');
});

test('recycle: only the owner, only buildings, and not twice at once', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0));
  const cmd = (playerId, t, buildingId) => {
    send(s, playerId, { t, buildingId });
    return built(s, KIND.SOLAR).find((e) => e.id === solar.id)?.recycle ?? -1;
  };
  assert.equal(cmd(1, 'recycle', solar.id), 0, 'the enemy cannot recycle it');
  assert.equal(cmd(0, 'recycle', core(s, 0).id), 0, 'the Core is not a building');
  const blocker = s.entities.find((e) => e.kind === KIND.BLOCKER);
  send(s, 0, { t: 'recycle', buildingId: blocker.id });
  assert.equal(blocker.recycle, 0, 'a blocker cannot be recycled');
  send(s, 0, { t: 'recycle', buildingId: 'x' });
  send(s, 0, { t: 'recycle', buildingId: 9999 });
  assert.equal(cmd(0, 'cancelRecycle', solar.id), 0, 'nothing to cancel');
  assert.equal(cmd(0, 'recycle', solar.id) > 0, true);
  const left = solar.recycle;
  send(s, 0, { t: 'recycle', buildingId: solar.id });
  assert.equal(solar.recycle, left - 1, 'a second recycle command does not restart the channel');
});

test('entropy: buildings lose 1% of max HP per minute, once a second, and the Core is exempt', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0)); // born on tick 0
  while (s.tick < 1200) step(s, []); // ticks 0 to 1199 have run: 59 whole seconds of entropy
  assert.equal(solar.hp, 200 * MILLI - 1966, 'after 59 s: floor(200 HP x 1% x 59 / 60)');
  step(s, []); // tick 1200 is the 60th second
  assert.equal(solar.hp, 200 * MILLI - 2000, '1% of 200 HP is exactly 2 HP after a minute, with no drift');
  while (s.tick < 2401) step(s, []);
  assert.equal(solar.hp, 200 * MILLI - 4000, 'and exactly 2 HP more the next minute');
  assert.equal(core(s, 0).hp, luxOf(s, 0), 'the Core takes no entropy');
});

test('entropy: it scales with max HP', () => {
  const s = newMatch();
  const [nuclear] = build(s, 0, 'nuclear', freeTile(s, 0));
  while (s.tick < 1201) step(s, []);
  assert.equal(nuclear.hp, 800 * MILLI - 8000, '1% of 800 HP is 8 HP per minute');
});

test('entropy after a shell upgrade uses the new maximum HP only for later seconds', () => {
  const s = newMatch();
  const [tower] = build(s, 0, 'tower', freeTile(s, 0), { attack: 'melee' });
  run(s, 600);
  send(s, 0, { t: 'upgrade', towerId: tower.id, track: 'shell' });
  run(s, 600);
  assert.equal(tower.maxHp, 300 * MILLI);
  assert.equal(tower.hp, 300 * MILLI - 2500);
});

test('entropy: a building with no HP left dissolves', () => {
  const s = newMatch();
  const [solar] = build(s, 0, 'solar', freeTile(s, 0));
  solar.hp = 1;
  run(s, 20);
  assert.equal(built(s, KIND.SOLAR).length, 0);
});

test('meltdown: a team that spends nothing for 2 400 ticks loses its nuclear plants', () => {
  const s = newMatch();
  build(s, 0, 'nuclear', freeTile(s, 0)); // the purchase on tick 0 is the last spend
  while (s.tick < 2399) step(s, []);
  assert.equal(built(s, KIND.NUCLEAR).length, 1, 'ticks 0 to 2398 have run: not yet');
  step(s, []); // tick 2399 is the 2400th tick without a spend
  assert.equal(s.tick, 2400);
  assert.equal(built(s, KIND.NUCLEAR).length, 0, 'destroyed at the end of the 2 400th tick');
});

test('meltdown: any spend resets the timer', () => {
  const s = newMatch();
  build(s, 0, 'nuclear', freeTile(s, 0));
  while (s.tick < 2000) step(s, []);
  assert.ok(luxOf(s, 0) > 50 * MILLI, 'the plant has paid for a purchase');
  build(s, 0, 'solar', freeTile(s, 0, 5)); // the spend on tick 2000 restarts the count
  while (s.tick < 2000 + 2399) step(s, []);
  assert.equal(built(s, KIND.NUCLEAR).length, 1, 'the new timer has not run out');
  step(s, []);
  assert.equal(built(s, KIND.NUCLEAR).length, 0);
});

test('meltdown: a team with no nuclear plant is safe, and only the idle team is hit', () => {
  const s = newMatch();
  build(s, 1, 'nuclear', freeTile(s, 1)); // team 1 builds and then idles
  run(s, 1000);
  build(s, 0, 'solar', freeTile(s, 0)); // team 0 keeps spending, but owns no plant
  run(s, 1400);
  assert.equal(built(s, KIND.NUCLEAR).length, 0, 'team 1 plant melted down at its own timer');
  assert.equal(s.outcome, null, 'nothing else was hurt');
});

test('meltdown: it hurts everything within 3 tiles, and nothing beyond', () => {
  const s = newMatch();
  const t = freeTile(s, 0, 10);
  build(s, 0, 'nuclear', t);
  while (luxOf(s, 0) < 70 * MILLI) step(s, []); // earn the price of three solars
  const near = build(s, 0, 'solar', { tileX: t.tileX + 2, tileZ: t.tileZ })[0]; // 2 tiles away
  const edge = build(s, 0, 'solar', { tileX: t.tileX + 3, tileZ: t.tileZ })[0]; // exactly 3 tiles away: inside
  const far = build(s, 0, 'solar', { tileX: t.tileX, tileZ: t.tileZ + 4 })[0]; // 4 tiles away: outside
  assert.ok(near && edge && far);
  while (built(s, KIND.NUCLEAR).length > 0) step(s, []);
  const alive = (e) => built(s, KIND.SOLAR).some((x) => x.id === e.id);
  assert.equal(alive(near), false, '400 damage kills a 200 HP solar 2 tiles away');
  assert.equal(alive(edge), false, 'and exactly 3 tiles away');
  assert.equal(alive(far), true, 'a solar 4 tiles away survives');
  assert.ok(far.hp > 190 * MILLI, 'and takes only entropy damage');
});

test('meltdown: damage to the Core comes out of its lux', () => {
  const s = newMatch();
  const c = core(s, 0);
  build(s, 0, 'nuclear', { tileX: Math.floor(c.x / 1000), tileZ: Math.floor(c.z / 1000) + 2 }); // 2 tiles from the Core
  while (s.tick < 2399) step(s, []);
  const before = luxOf(s, 0);
  step(s, []); // tick 2399: the plant melts down, dealing 50% of its 800 HP
  const drop = before - luxOf(s, 0);
  assert.ok(drop > 399 * MILLI && drop <= 400 * MILLI, `the Core lost about 400 lux, lost ${drop / MILLI}`);
  assert.equal(core(s, 0).hp, luxOf(s, 0));
  // 120 s of nuclear income (600 lux) outweighs the 400 lux of damage, so the Core survives.
  assert.equal(s.outcome, null);
});

test('victory: a team whose Core is empty loses, and the other team wins', () => {
  // No M2 rule can empty a Core by itself (a plant earns 600 lux before it deals 400), and combat comes in M3,
  // so this test empties the bank directly.
  const s = newMatch();
  s.teams[0].coreLux = 0;
  step(s, []);
  assert.deepEqual(s.outcome, { winnerTeam: 1 });
  const hash = hashState(s);
  step(s, []);
  assert.equal(hashState(s), hash, 'a finished match is frozen');
});

test('victory: both Cores empty on the same tick is a draw', () => {
  const s = newMatch();
  s.teams[0].coreLux = 0;
  s.teams[1].coreLux = 0;
  step(s, []);
  assert.deepEqual(s.outcome, { draw: true });
});

test('victory: a Core with 1 lux left is alive', () => {
  const s = newMatch();
  s.teams[0].coreLux = 1;
  step(s, []);
  assert.equal(s.outcome, null);
});

test('the same commands give the same hash, and the pending pool is part of it', () => {
  const play = (extraWait) => {
    const s = newMatch(77);
    build(s, 0, 'solar', freeTile(s, 0));
    run(s, 100 + extraWait);
    return s;
  };
  assert.equal(hashState(play(0)), hashState(play(0)));
  assert.notEqual(hashState(play(0)), hashState(play(1)));
  // Same coreLux, same pendingLux and different timing must still differ: hash a state, then shift an entry.
  const a = play(0);
  const b = play(0);
  b.teams[0].pending[0].settleTick += 1;
  assert.notEqual(hashState(a), hashState(b));
});
