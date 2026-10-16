// Enforces the Writing Rules from CLAUDE.md through tools/check_style.py.
// `deny` hits (filler phrases, clichés) fail the suite. `ask` hits are
// reported by `npm run lint:prose:all` and judged by the author.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers/load-data.js';

const CHECKER = join(ROOT, 'tools', 'check_style.py');
const python = spawnSync('python3', ['--version']);
const skip = python.error ? 'python3 is not installed' : false;

function check(args, input) {
  return spawnSync('python3', [CHECKER, ...args], { encoding: 'utf8', input });
}

function tempFile(name, text) {
  const file = join(mkdtempSync(join(tmpdir(), 'luxcores-prose-')), name);
  writeFileSync(file, text);
  return file;
}

test('repo docs and code comments have no deny hits', { skip }, () => {
  const res = check(['--all']);
  assert.equal(res.status, 0, `fix every deny hit:\n${res.stdout}${res.stderr}`);
});

test('a deny hit exits 1 and an ask hit exits 0 unless --strict', { skip }, () => {
  const deny = check([], 'We refactored this in order to help.\n');
  assert.equal(deny.status, 1);
  assert.match(deny.stdout, /RULE-04\s+deny/);
  const ask = check([], "It doesn't help.\n");
  assert.equal(ask.status, 0);
  assert.match(ask.stdout, /RULE-I\s+ask/);
  assert.equal(check(['--strict'], "It doesn't help.\n").status, 1);
});

test('the informal register allows contractions and lower-case headings', { skip }, () => {
  const text = "# a lower case heading\n\nIt doesn't matter.\n";
  assert.equal(check(['--strict'], text).status, 1);
  assert.equal(check(['--strict', '--register', 'informal'], text).status, 0);
});

test('a phrase quoted as a mention is not a hit', { skip }, () => {
  assert.equal(check([], 'Cut "in order to" from every draft.\n').status, 0);
});

test('JavaScript files are checked through their comments only', { skip }, () => {
  const clean = tempFile('clean.js', 'const phrase = "in order to"; // fine here\nconst don_t = 1;\n');
  assert.equal(check([clean]).status, 0, 'strings and identifiers are code');
  const dirty = tempFile('dirty.js', '/**\n * Sorts the list in order to help.\n * @param {number} a due to the fact that it is big\n */\nexport function f(a) { return a; }\n');
  const res = check([dirty]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /L2:/, 'the hit names the comment line');
  assert.match(res.stdout, /L3:|RULE-04\s+deny\s+filler phrase\s+2/, 'JSDoc descriptions count');
});
