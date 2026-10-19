import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadData } from './helpers/load-data.js';
import { GOLDEN_FILES, runSuite } from '../src/client/determinism-suite.js';

const DIR = join(ROOT, 'replays', 'golden');

test('the determinism page lists every golden replay of the directory', () => {
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual([...GOLDEN_FILES], onDisk, 'update GOLDEN_FILES in src/client/determinism-suite.js');
});

test('the suite passes in Node and names the first tick of a replay that disagrees', async () => {
  const { config } = loadData();
  const load = async (/** @type {string} */ file) => JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const ok = await runSuite({ config, load });
  assert.equal(ok.ok, true);
  assert.equal(ok.results.length, GOLDEN_FILES.length);
  assert.ok(ok.ticksPerSecond > 0);

  // A replay whose recorded hash at tick 100 is wrong fails at exactly that tick.
  const broken = await runSuite({
    config,
    load: async (file) => {
      const replay = await load(file);
      if (file === 'bots-seed-777.json') replay.hashes['100'] = '00000000';
      return replay;
    },
  });
  assert.equal(broken.ok, false);
  const bad = broken.results.find((r) => !r.ok);
  assert.equal(bad?.file, 'bots-seed-777.json');
  assert.equal(bad?.firstMismatchTick, 100);
  assert.equal(broken.results.filter((r) => r.ok).length, GOLDEN_FILES.length - 1);

  // A missing file is a failure with its reason, not a crash.
  const missing = await runSuite({ config, load: async () => { throw new Error('404'); } });
  assert.equal(missing.ok, false);
  assert.equal(missing.results[0].error, '404');
});
