import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, step, hashState, Recorder, playReplay, spawnEntity, generateMap, KIND } from '../src/sim/index.js';

const players = [
  { id: 0, team: 0, kind: 'human' },
  { id: 1, team: 1, kind: 'bot' },
];

function runMatch(seed, ticks) {
  const { config, dataHash } = loadData();
  const state = createState({ seed, players, config });
  const rec = new Recorder({ seed, players, dataHash, mapgenVersion: config.mapgen.version });
  while (state.tick < ticks) {
    step(state, []);
    rec.record(state, []);
  }
  return { state, replay: rec.replay, config };
}

test('starting Core lux follows team size', () => {
  const { config } = loadData();
  const s = createState({ seed: 1, players, config });
  assert.equal(s.teams.length, 2);
  assert.equal(s.teams[0].coreLux, 100_000); // 100 lux in milli-lux
});

test('two runs with the same seed produce identical hashes', () => {
  const a = runMatch(1234567, 2000);
  const b = runMatch(1234567, 2000);
  assert.deepEqual(a.replay.hashes, b.replay.hashes);
  assert.equal(hashState(a.state), hashState(b.state));
});

test('different seeds produce different hashes', () => {
  assert.notEqual(hashState(runMatch(1, 20).state), hashState(runMatch(2, 20).state));
});

test('replay playback reproduces every recorded hash', () => {
  const { replay, config, state } = runMatch(99, 1000);
  const res = playReplay(replay, config);
  assert.equal(res.ok, true);
  assert.equal(res.finalHash, hashState(state));
});

test('replay playback detects a divergence', () => {
  const { replay, config } = runMatch(99, 200);
  replay.hashes['100'] = 'deadbeef';
  const res = playReplay(replay, config);
  assert.equal(res.ok, false);
  assert.equal(res.firstMismatchTick, 100);
});

test('hash rejects non-integer state', () => {
  const { config } = loadData();
  const s = createState({ seed: 1, players, config });
  spawnEntity(s, { kind: KIND.CREEP, team: 0, owner: 0, x: 1000.5, z: 0, hp: 500, maxHp: 500 });
  assert.throws(() => hashState(s), /non-integer/);
});

test('state survives a structuredClone round trip with the same hash', () => {
  const { state } = runMatch(7, 100);
  const { config, ...rest } = state;
  const copy = { ...structuredClone(rest), config };
  assert.equal(hashState(copy), hashState(state));
});

const MAP_SEEDS = 1000;

test('mapgen: same seed yields an identical layout', () => {
  const { config } = loadData();
  for (const seed of [1, 42, 1234567]) {
    assert.deepEqual(generateMap(seed, config.mapgen), generateMap(seed, config.mapgen));
  }
  assert.notDeepEqual(generateMap(1, config.mapgen), generateMap(2, config.mapgen));
});

test('mapgen: layout is point-symmetric through the map center', () => {
  const { config } = loadData();
  const { width: W, height: H } = config.mapgen;
  const mirror = (p) => ({ team: 1 - p.team, tileX: W - 1 - p.tileX, tileZ: H - 1 - p.tileZ });
  const byTeam = (list, team) => list.filter((p) => p.team === team);
  for (let seed = 1; seed <= 50; seed++) {
    const map = generateMap(seed, config.mapgen);
    for (const kind of ['cores', 'vents', 'blockers', 'itemSpawns']) {
      assert.deepEqual(byTeam(map[kind], 1), byTeam(map[kind], 0).map(mirror), `${kind}, seed ${seed}`);
    }
    for (const lane of map.lanes.filter((l) => l.team === 0)) {
      const twin = map.lanes.find((l) => l.team === 1 && l.lane === lane.lane);
      assert.deepEqual(twin.points, lane.points.map(([x, z]) => [W - 1 - x, H - 1 - z]));
      const mirrored = lane.tiles.map((i) => W * H - 1 - i).sort((a, b) => a - b);
      assert.deepEqual(twin.tiles, mirrored, `${lane.lane} tiles, seed ${seed}`);
    }
  }
});

const NESW = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Independent flood fill (N, E, S, W) over the grid, written without the generator's helpers. */
function laneProblems(map) {
  const { width: W, height: H } = map;
  const blocked = new Uint8Array(W * H); // blockers and Cores
  for (const b of map.blockers) blocked[b.tileZ * W + b.tileX] = 1;
  const coreIdx = map.cores.map((c) => c.tileZ * W + c.tileX);
  for (const i of coreIdx) blocked[i] = 1;

  const seen = new Uint8Array(W * H);
  const queue = [coreIdx[0]];
  seen[coreIdx[0]] = 1;
  for (let head = 0; head < queue.length; head++) {
    const x = queue[head] % W;
    const z = (queue[head] - x) / W;
    for (const [dx, dz] of NESW) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const n = nz * W + nx;
      if (!seen[n] && !blocked[n]) { seen[n] = 1; queue.push(n); }
    }
  }

  const problems = [];
  const { tileX, tileZ } = map.cores[1];
  if (!NESW.some(([dx, dz]) => seen[(tileZ + dz) * W + tileX + dx])) problems.push('Core 1 unreachable');
  for (const lane of map.lanes) {
    for (const i of lane.tiles) {
      if (!seen[i] && !coreIdx.includes(i)) problems.push(`${lane.team}/${lane.lane} tile ${i % W},${Math.floor(i / W)}`);
    }
  }
  return problems;
}

test(`mapgen: every lane connects both Cores over ${MAP_SEEDS} seeds`, () => {
  const { config } = loadData();
  const t0 = performance.now();
  for (let seed = 1; seed <= MAP_SEEDS; seed++) {
    const map = generateMap(seed, config.mapgen);
    assert.deepEqual(laneProblems(map), [], `seed ${seed} (used ${map.usedSeed})`);
  }
  assert.ok(performance.now() - t0 < 5000, 'lane connectivity over 1 000 seeds must take under 5 s');
});
