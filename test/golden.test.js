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

// While the MVP is built, SPEC_VERSION stays put (CLAUDE.md), so a rule change that alters hashes
// fails here. Re-record on purpose in the same commit:
// `node tools/run-headless.js SEED TICKS replays/golden/NAME.json`.
for (const file of files) {
  test(`golden replay ${file} plays back with every hash intact`, () => {
    const replay = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    assert.equal(replay.specVersion, SPEC_VERSION, 'the replay predates a SPEC_VERSION change; re-record it');
    const res = playReplay(replay, loadData().config);
    assert.equal(res.firstMismatchTick, null);
    assert.equal(res.ok, true);
  });
}
