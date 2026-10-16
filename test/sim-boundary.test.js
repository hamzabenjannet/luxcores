// Enforces the sim purity rules from docs/TECH_ARCHITECTURE.md section 5.
// These are cheap text checks, not a parser; they catch the common mistakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { ROOT } from './helpers/load-data.js';

const SIM = join(ROOT, 'src', 'sim');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

/** Strip // and /* *\/ comments so docs that mention forbidden APIs do not trip the check. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN = [
  [/\bMath\.random\b/, 'Math.random (use the seeded RNG in rng.js)'],
  [/\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/, 'wall-clock time'],
  [/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log2|log10|log1p|pow|cbrt|hypot|sinh|cosh|tanh)\b/, 'implementation-approximated Math function (use fixed.js)'],
  [/\*\*/, 'exponent operator (implementation-approximated for non-integers; use explicit multiplication)'],
  [/\bfor\s*\([^)]*\bin\b/, 'for...in (key order rules differ across runtimes and Rust)'],
  [/\bdocument\b|\bwindow\b|\bfetch\s*\(|\brequestAnimationFrame\b/, 'DOM / browser API'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
];

// config.js normalizes data once at load time; key iteration there does not
// touch sim state order. sin-table.js is generated data.
const KEY_ITERATION = /\bObject\.(keys|values|entries)\b/;
const KEY_ITERATION_ALLOWED = new Set(['config.js', 'sin-table.js']);

test('sim files only import from src/sim', () => {
  for (const file of walk(SIM)) {
    const src = code(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      assert.ok(spec.startsWith('.'), `${relative(ROOT, file)} imports bare module "${spec}"`);
      const target = resolve(dirname(file), spec);
      assert.ok(target.startsWith(SIM), `${relative(ROOT, file)} imports outside src/sim: "${spec}"`);
    }
  }
});

test('sim files avoid non-deterministic and non-portable APIs', () => {
  for (const file of walk(SIM)) {
    const name = relative(SIM, file);
    const src = code(readFileSync(file, 'utf8'));
    for (const [re, why] of FORBIDDEN) {
      assert.ok(!re.test(src), `${name}: forbidden ${why}`);
    }
    if (!KEY_ITERATION_ALLOWED.has(name)) {
      assert.ok(!KEY_ITERATION.test(src), `${name}: Object.keys/values/entries inside the sim`);
    }
  }
});
