// @ts-check
// Node loader for data/*.json, used by tests and the headless runner.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DATA_FILES } from '../../src/shared/data-files.js';
import { normalizeData } from '../../src/sim/index.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @returns {{ raw: any, config: import('../../src/sim/config.js').SimConfig, dataHash: string }} */
export function loadData() {
  /** @type {Record<string, any>} */
  const raw = {};
  const sha = createHash('sha256');
  for (const [key, rel] of Object.entries(DATA_FILES)) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    sha.update(rel).update('\0').update(text).update('\0');
    raw[key] = JSON.parse(text);
  }
  return { raw, config: normalizeData(/** @type {any} */ (raw)), dataHash: sha.digest('hex') };
}
