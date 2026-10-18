import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, hashState, KIND, normalizeData, validOptions, Recorder, playReplay, ENTROPY_MAX_PCT } from '../src/sim/index.js';
import { loadData } from './helpers/load-data.js';

const { raw, config, dataHash } = loadData();
const players = [{ id: 0, team: 0, kind: 'human' }, { id: 1, team: 1, kind: 'human' }];

/** A match with one barracks, and its barracks HP after `ticks` ticks. */
function barracksHp(cfg, ticks) {
  const s = createState({ seed: 1234567, players, config: cfg });
  step(s, [{ tick: 0, playerId: 0, seq: 0, cmd: { t: 'build', building: 'barracks', tileX: 30, tileZ: 90 } }]);
  for (let i = 1; i < ticks; i++) step(s, []);
  return s.entities.find((e) => e.kind === KIND.BARRACKS).hp;
}

test('the entropy rate is a match option: 0 keeps every HP, more drains faster, the default is unchanged', () => {
  const full = 40 * 10 * 1000;
  assert.equal(barracksHp(normalizeData(raw, { entropyPctPerMinute: 0 }), 1300), full, 'no entropy, no loss');
  const normal = barracksHp(config, 1300);
  const fast = barracksHp(normalizeData(raw, { entropyPctPerMinute: 10 }), 1300);
  assert.ok(normal < full && normal > full - full * 2 / 100, `1 percent a minute took ${full - normal} of ${full}`);
  assert.ok(full - fast > 5 * (full - normal), `10 percent took ${full - fast}`);
  assert.equal(hashState(createState({ seed: 5, players, config: normalizeData(raw, {}) })), hashState(createState({ seed: 5, players, config })), 'no option, the same rules');
});

test('the options are validated: whole percent from 0 to the maximum', () => {
  for (const ok of [{}, { entropyPctPerMinute: 0 }, { entropyPctPerMinute: 1 }, { entropyPctPerMinute: ENTROPY_MAX_PCT }]) assert.equal(validOptions(ok), true, JSON.stringify(ok));
  for (const bad of [{ entropyPctPerMinute: -1 }, { entropyPctPerMinute: 1.5 }, { entropyPctPerMinute: ENTROPY_MAX_PCT + 1 }, { entropyPctPerMinute: '5' }, null, 'x']) assert.equal(validOptions(bad), false, JSON.stringify(bad));
  assert.throws(() => normalizeData(raw, { entropyPctPerMinute: -3 }), /invalid match options/);
});

test('a replay keeps its options, and plays back to the same hashes under them', () => {
  const options = { entropyPctPerMinute: 7 };
  const cfg = normalizeData(raw, options);
  const s = createState({ seed: 99, players, config: cfg });
  const rec = new Recorder({ seed: 99, players, dataHash, mapgenVersion: cfg.mapgen.version, options });
  for (let i = 0; i < 400; i++) {
    const cmds = i === 0 ? [{ tick: 0, playerId: 0, seq: 0, cmd: { t: 'build', building: 'solar', tileX: 30, tileZ: 90 } }] : [];
    step(s, cmds);
    rec.record(s, cmds);
  }
  assert.deepEqual(rec.replay.options, options);
  assert.equal(playReplay(rec.replay, cfg).ok, true);
  assert.equal(playReplay(rec.replay, config).ok, false, 'the default rules do not reproduce a 7 percent match');
  assert.equal(new Recorder({ seed: 1, players, dataHash, mapgenVersion: 1 }).replay.options, undefined, 'a default match has no options');
});
