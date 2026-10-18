// @ts-check
/**
 * The end-of-match screen (GDD 13.2): the outcome, the duration and the counters of both sides. A pure
 * function, so the web page, the Godot client and the tests read the same text from the same data.
 */

import { MILLI } from '../../sim/index.js';

/** The counters in the order of the screen: the label and the field of `result.stats`. */
export const SUMMARY_STATS = /** @type {const} */ ([
  { label: 'Lux collected', field: 'collected' },
  { label: 'Lux spent', field: 'spent' },
  { label: 'Lux drained', field: 'drained' },
  { label: 'Lux funneled', field: 'funneled' },
  { label: 'Lux recycled', field: 'recycled' },
  { label: 'Lux lost to entropy', field: 'entropy' },
]);

/**
 * @typedef {{ team: number, collected: number, spent: number, drained: number, funneled: number, recycled: number, entropy: number }} TeamStats milli-lux
 */

/**
 * @param {{ winnerTeam: number | null, draw: boolean, reason: string, stats?: readonly TeamStats[] }} result
 * @param {{ viewerTeam: number, spectator: boolean, endedTick: number, tickHz: number }} view
 * @returns {{ title: string, reason: string, duration: string, columns: string[], rows: { label: string, values: number[] }[] }}
 *   values are whole lux, one per column; a spectator reads Blue (team 0) then Red, a player reads their own side then the enemy
 */
export function matchSummary(result, { viewerTeam, spectator, endedTick, tickHz }) {
  const title = result.draw || result.winnerTeam === null
    ? 'Draw'
    : spectator
      ? `${result.winnerTeam === 0 ? 'Blue' : 'Red'} wins`
      : result.winnerTeam === viewerTeam ? 'Victory' : 'Defeat';
  const seconds = Math.floor(endedTick / tickHz);
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const order = spectator ? [0, 1] : [viewerTeam, 1 - viewerTeam];
  const stats = result.stats ?? [];
  const rows = SUMMARY_STATS.map(({ label, field }) => ({
    label,
    values: order.map((team) => Math.floor((stats.find((s) => s.team === team)?.[field] ?? 0) / MILLI)),
  }));
  return { title, reason: result.reason, duration, columns: spectator ? ['Blue', 'Red'] : ['You', 'Enemy'], rows };
}
