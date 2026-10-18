// Runs the Godot client's own tests headless, against the same cases and the
// same backend the web client uses:
//
// 1. vone/tests/run_tests.gd checks the pure game logic (label text, tap rules,
//    tower actions) against test/fixtures/client-parity.json, which
//    test/client-parity.test.js runs through JavaScript.
// 2. vone/tests/live_match.gd drives the real main scene against a throwaway
//    backend: it plays a bot match through the UI methods, then watches two bots.
//
// Needs Godot 4.6. It looks at GODOT_BIN, then `godot` on the PATH, then the
// macOS app. Both tests skip when Godot is missing. The live test also needs
// the backend built (cd backend/nodejs && npm install && npm run build).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/load-data.js';
import { BACKEND_DIR, startBackend } from './helpers/backend.js';

const MAC_APP = '/Applications/Godot.app/Contents/MacOS/Godot';
const PROJECT = join(ROOT, 'vone');

/** @returns {string | null} */
function findGodot() {
  const candidates = [process.env.GODOT_BIN, 'godot', 'godot4', MAC_APP].filter(Boolean);
  for (const bin of /** @type {string[]} */ (candidates)) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0 && /^4\.\d/.test(probe.stdout.trim())) return bin;
  }
  return null;
}

const godot = findGodot();
const skipGodot = godot ? false : 'Godot 4 not found; set GODOT_BIN or install it';
const built = existsSync(join(BACKEND_DIR, 'dist', 'main.js')) && existsSync(join(BACKEND_DIR, 'node_modules'));
const skipLive = skipGodot || (built ? false : 'the backend is not built; run: cd backend/nodejs && npm install && npm run build');

/**
 * Runs a Godot script headless and resolves with its output and exit code.
 * @param {string} script
 * @param {string[]} [userArgs]
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function runGodot(script, userArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(/** @type {string} */ (godot), ['--headless', '--path', PROJECT, '--script', script, ...(userArgs.length ? ['--', ...userArgs] : [])]);
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

test('the Godot game logic answers every parity case like the web client', { timeout: 120_000, skip: skipGodot }, async () => {
  const { code, output } = await runGodot('res://tests/run_tests.gd');
  assert.equal(code, 0, output);
  assert.match(output, /\d+ checks, 0 failed/);
  console.log(output.trim().split('\n').pop());
});

test('the Godot client plays and watches matches against the backend', { timeout: 300_000, skip: skipLive }, async () => {
  const backend = await startBackend({ MATCH_MAX_TICKS: '2400' });
  try {
    const { code, output } = await runGodot('res://tests/live_match.gd', [`--server=${backend.url}`]);
    assert.equal(code, 0, output);
    assert.match(output, /\d+ checks, 0 failed/);
    assert.doesNotMatch(output, /SCRIPT ERROR|Parse Error/);
    console.log(output.trim().split('\n').pop());
  } finally {
    await backend.stop();
  }
});
