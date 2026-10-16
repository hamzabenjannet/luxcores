import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import {
  createState, generateMap, isConnected, normalizeData, hashState, step, KIND, NEUTRAL, MILLI,
} from '../src/sim/index.js';
import { createRng, nextU32 } from '../src/sim/rng.js';

const players = [
  { id: 0, team: 0, kind: 'human' },
  { id: 1, team: 1, kind: 'bot' },
];

const cheb = (a, b) => Math.max(Math.abs(a.tileX - b.tileX), Math.abs(a.tileZ - b.tileZ));

/** Normalize a copy of the raw data with `edit` applied to the raw mapgen first. */
function configWith(edit) {
  const { raw } = loadData();
  const copy = structuredClone(raw);
  edit(copy.mapgen);
  return normalizeData(copy);
}

test('mapgen: per-team counts follow the data', () => {
  const { config } = loadData();
  for (let seed = 1; seed <= 100; seed++) {
    const map = generateMap(seed, config.mapgen);
    for (const team of [0, 1]) {
      const vents = map.vents.filter((v) => v.team === team);
      assert.equal(vents.length, 2);
      assert.equal(new Set(vents.map((v) => Math.floor(v.tileX / 32))).size, 2, 'vents sit in 2 different columns');

      const blockers = map.blockers.filter((b) => b.team === team);
      assert.equal(blockers.length, 6);
      for (let col = 0; col < 3; col++) {
        assert.equal(blockers.filter((b) => Math.floor(b.tileX / 32) === col).length, 2, `column ${col}`);
      }
      assert.equal(map.itemSpawns.filter((s) => s.team === team).length, 2);
    }
  }
});

test('mapgen: elements respect the zones and the spacing rules', () => {
  const { config } = loadData();
  const sp = config.mapgen.spacing;
  for (let seed = 1; seed <= 300; seed++) {
    const map = generateMap(seed, config.mapgen);
    const laneTiles = map.lanes.flatMap((l) => l.tiles);
    const build = (p) => (p.team === 0 ? p.tileZ >= 64 : p.tileZ <= 47);
    const elements = [...map.vents, ...map.blockers, ...map.itemSpawns];

    for (const p of [...map.vents, ...map.blockers]) {
      assert.ok(build(p), `seed ${seed}: build zone ${JSON.stringify(p)}`);
      for (const core of map.cores) assert.ok(cheb(p, core) > sp.fromCore, `seed ${seed}: Core distance`);
    }
    for (const s of map.itemSpawns) {
      const inDmzHalf = s.team === 0 ? s.tileZ >= 56 && s.tileZ <= 63 : s.tileZ >= 48 && s.tileZ <= 55;
      assert.ok(inDmzHalf, `seed ${seed}: item spawn row ${s.tileZ}`);
      assert.ok(s.tileX < 32 || s.tileX >= 64, `seed ${seed}: item spawn in a side column`);
    }
    for (const p of elements) {
      for (const i of laneTiles) {
        const lane = { tileX: i % 96, tileZ: Math.floor(i / 96) };
        assert.ok(cheb(p, lane) > sp.fromLane, `seed ${seed}: lane distance`);
      }
    }
    for (let a = 0; a < elements.length; a++) {
      for (let b = a + 1; b < elements.length; b++) {
        assert.ok(cheb(elements[a], elements[b]) >= sp.between, `seed ${seed}: elements ${a} and ${b} too close`);
      }
    }
  }
});

test('mapgen: lane jitter stays within the data bounds and the own column', () => {
  const { raw, config } = loadData();
  const tmpl = raw.mapgen.lanes;
  for (let seed = 1; seed <= 200; seed++) {
    const map = generateMap(seed, config.mapgen);
    ['left', 'mid', 'right'].forEach((name, col) => {
      const points = map.lanes.find((l) => l.team === 0 && l.lane === name).points;
      assert.equal(points.length, tmpl[name].length);
      points.forEach(([x, z], i) => {
        const [tx, tz] = tmpl[name][i];
        assert.equal(z, tz, 'jitter is sideways only');
        assert.ok(Math.abs(x - tx) <= tmpl.jitter, `seed ${seed} ${name}[${i}]`);
        if (i === 0 || i === points.length - 1) assert.equal(x, tx, 'Core and DMZ edge do not move');
        if (z < 80) {
          assert.ok(x - 1 >= col * 32 && x + 1 <= col * 32 + 31, `seed ${seed} ${name}[${i}] leaves its column`);
        }
      });
    });
  }
});

test('mapgen: a wide jitter still keeps lanes in their column outside the Core row', () => {
  const wide = configWith((m) => { m.lanes.jitter = 20; }).mapgen;
  let clamped = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const map = generateMap(seed, wide);
    ['left', 'mid', 'right'].forEach((name, col) => {
      const points = map.lanes.find((l) => l.team === 0 && l.lane === name).points;
      for (const [x, z] of points) {
        if (z >= 80) continue;
        assert.ok(x - 1 >= col * 32 && x + 1 <= col * 32 + 31, `seed ${seed} ${name} x=${x}`);
        if (x - 1 === col * 32 || x + 1 === col * 32 + 31) clamped++;
      }
    });
  }
  assert.ok(clamped > 0, 'the clamp must have been exercised');
});

test('mapgen: lane tiles are unique, ascending and read laneWidth from data', () => {
  const { config } = loadData();
  const map = generateMap(7, config.mapgen);
  for (const lane of map.lanes) {
    assert.ok(lane.tiles.every((t, i) => i === 0 || t > lane.tiles[i - 1]), `${lane.team}/${lane.lane}`);
  }
  const mid = map.lanes.find((l) => l.team === 0 && l.lane === 'mid');
  const narrow = generateMap(7, configWith((m) => { m.lanes.laneWidth = 1; }).mapgen);
  const narrowMid = narrow.lanes.find((l) => l.team === 0 && l.lane === 'mid');
  assert.ok(narrowMid.tiles.length < mid.tiles.length, 'a width of 1 gives fewer tiles than a width of 3');
});

test('createState: Cores come first, then 12 blockers, with stable ids', () => {
  const { config } = loadData();
  const s = createState({ seed: 1234567, players, config });
  assert.deepEqual(s.entities.map((e) => e.id), Array.from({ length: 14 }, (_, i) => i + 1));
  const [c0, c1, ...blockers] = s.entities;
  assert.equal(c0.kind, KIND.CORE);
  assert.equal(c1.kind, KIND.CORE);
  assert.deepEqual([c0.team, c1.team], [0, 1]);
  assert.deepEqual([c0.x, c0.z], [48_500, 96_500]); // tile (48, 96), centered
  assert.deepEqual([c1.x, c1.z], [47_500, 15_500]); // tile (47, 15), centered
  assert.equal(c0.hp, s.teams[0].coreLux, 'Core HP is its lux');
  assert.equal(c0.hp, 100 * MILLI);
  assert.equal(blockers.length, 12);
  for (const b of blockers) {
    assert.equal(b.kind, KIND.BLOCKER);
    assert.equal(b.team, NEUTRAL);
    assert.equal(b.hp, 200 * MILLI);
    assert.equal(b.maxHp, b.hp);
  }
  assert.equal(s.map.vents.length, 4);
  assert.equal(s.map.itemSpawns.length, 4);
  assert.equal(s.map.lanes.length, 6);
});

test('createState: map generation does not shift the gameplay RNG stream', () => {
  const { config } = loadData();
  const s = createState({ seed: 1234567, players, config });
  const reference = createRng(1234567);
  for (let i = 0; i < 5; i++) assert.equal(nextU32(s.rng), nextU32(reference));
});

test('createState: the initial hash is stable per seed and differs between seeds', () => {
  const { config } = loadData();
  assert.equal(hashState(createState({ seed: 5, players, config })), hashState(createState({ seed: 5, players, config })));
  assert.notEqual(hashState(createState({ seed: 5, players, config })), hashState(createState({ seed: 6, players, config })));
});

test('createState: state.map stays unchanged across steps', () => {
  const { config } = loadData();
  const s = createState({ seed: 3, players, config });
  const before = structuredClone(s.map);
  for (let i = 0; i < 100; i++) step(s, []);
  assert.deepEqual(s.map, before);
});

test('mapgen: the connectivity check rejects a walled-in Core', () => {
  const { config } = loadData();
  const map = generateMap(11, config.mapgen);
  assert.equal(isConnected(map), true);
  const { tileX, tileZ } = map.cores[0];
  const walled = {
    ...map,
    blockers: [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dz]) => ({ team: 0, tileX: tileX + dx, tileZ: tileZ + dz })),
  };
  assert.equal(isConnected(walled), false);
});

test('mapgen: a failed attempt advances the seed and reports usedSeed', () => {
  // One try per element and no relaxation make some seeds fail placement.
  const tight = configWith((m) => {
    m.spacing.maxTriesPerElement = 1;
    m.spacing.relaxStep = 99;
    m.maxSeedAttempts = 500;
  }).mapgen;
  let advanced = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const map = generateMap(seed, tight);
    if (map.usedSeed > seed) {
      advanced++;
      assert.deepEqual(map, generateMap(map.usedSeed, tight), 'the layout equals a direct run from usedSeed');
    }
  }
  assert.ok(advanced > 0, 'at least one of 30 seeds needed a retry');
});

test('mapgen: spacing relaxes by relaxStep when the tries run out', () => {
  const wide = configWith((m) => { m.spacing.between = 30; }).mapgen;
  const map = generateMap(1234567, wide);
  assert.equal(map.usedSeed, 1234567);
  const elements = [...map.vents, ...map.blockers, ...map.itemSpawns];
  let min = Infinity;
  for (let a = 0; a < elements.length; a++) {
    for (let b = a + 1; b < elements.length; b++) min = Math.min(min, cheb(elements[a], elements[b]));
  }
  assert.ok(min >= 1 && min < 30, `closest pair is ${min} tiles apart`);
});

test('mapgen: it throws when no seed within maxSeedAttempts yields a layout', () => {
  const impossible = configWith((m) => { m.spacing.fromCore = 200; m.maxSeedAttempts = 3; }).mapgen;
  assert.throws(() => generateMap(1, impossible), /no valid layout within 3 seeds/);
});
