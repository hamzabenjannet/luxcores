import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadData } from './helpers/load-data.js';
import { playReplay, SPEC_VERSION } from '../src/sim/index.js';

const DIR = join(ROOT, 'replays', 'golden');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

test('at least one golden replay exists', () => {
  assert.ok(files.length > 0, 'replays/golden/ holds no .json replay');
});

// A hash change here without a SPEC_VERSION bump is a bug (CLAUDE.md).
// After an intended bump, re-record with `node tools/run-headless.js SEED TICKS replays/golden/NAME.json`.
for (const file of files) {
  test(`golden replay ${file} plays back with every hash intact`, () => {
    const replay = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    assert.equal(replay.specVersion, SPEC_VERSION, 're-record this replay after a SPEC_VERSION bump');
    const res = playReplay(replay, loadData().config);
    assert.equal(res.firstMismatchTick, null);
    assert.equal(res.ok, true);
  });
}
