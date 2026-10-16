import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { createState, step, hashState, Recorder, playReplay, spawnEntity, KIND } from '../src/sim/index.js';

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

test.todo('mapgen: same seed yields an identical layout (M1)');
test.todo('mapgen: layout is point-symmetric through the map center (M1)');
test.todo('mapgen: every lane connects both Cores (M1)');
