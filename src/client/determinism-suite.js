// @ts-check
/**
 * The cross-engine check of M10. Every golden replay in `replays/golden/` is played again in this engine
 * and compared with the hashes Node recorded. A replay passes when every recorded hash matches, so a
 * browser that computes one different number anywhere in a match fails with the first tick it differs.
 * The list below is checked against the directory by `test/determinism-suite.test.js`.
 */

import { playReplay } from '../sim/index.js';

/** The files of `replays/golden/`, served at `/replays/golden/<name>`. */
export const GOLDEN_FILES = Object.freeze([
  'bots-seed-4-stalemate.json',
  'bots-seed-7-victory.json',
  'bots-seed-777.json',
  'economy-seed-424242.json',
  'heroes-seed-515151.json',
  'items-seed-616161.json',
  'seed-1234567.json',
]);

/**
 * @typedef {{ file: string, ok: boolean, firstMismatchTick: number | null, finalHash: string, ticks: number, ms: number, error?: string }} SuiteResult
 */

/**
 * Plays every golden replay.
 * @param {{
 *   config: import('../sim/config.js').SimConfig,
 *   load: (file: string) => Promise<import('../sim/replay.js').Replay>,
 *   now?: () => number,
 *   onResult?: (result: SuiteResult) => void,
 * }} opts `load` fetches one replay; `now` is the clock (milliseconds), replaceable for tests
 * @returns {Promise<{ ok: boolean, results: SuiteResult[], ticksPerSecond: number }>}
 */
export async function runSuite({ config, load, now = () => performance.now(), onResult }) {
  /** @type {SuiteResult[]} */
  const results = [];
  let totalTicks = 0;
  let totalMs = 0;
  for (const file of GOLDEN_FILES) {
    /** @type {SuiteResult} */
    let result;
    try {
      const replay = await load(file);
      const start = now();
      const played = playReplay(replay, config);
      const ms = now() - start;
      totalTicks += replay.ticks;
      totalMs += ms;
      result = { file, ok: played.ok, firstMismatchTick: played.firstMismatchTick, finalHash: played.finalHash, ticks: replay.ticks, ms: Math.round(ms) };
    } catch (err) {
      result = { file, ok: false, firstMismatchTick: null, finalHash: '', ticks: 0, ms: 0, error: err instanceof Error ? err.message : String(err) };
    }
    results.push(result);
    onResult?.(result);
  }
  return { ok: results.every((r) => r.ok), results, ticksPerSecond: totalMs > 0 ? Math.round((totalTicks * 1000) / totalMs) : 0 };
}
