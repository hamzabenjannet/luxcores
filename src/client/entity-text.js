// @ts-check
/**
 * The text the client shows for an entity: its name and lux count (GDD 13.1),
 * plus a short tail for tower types, upgrade levels, stuns and recycling. Pure
 * functions, so the web labels, the selection panel and the tests share them.
 */

import { KIND, MILLI } from '../sim/index.js';

/** Display names by KIND code. */
export const KIND_NAMES = /** @type {Record<number, string>} */ ({
  [KIND.CORE]: 'Lumen Core',
  [KIND.SOLAR]: 'Solar',
  [KIND.WIND]: 'Wind',
  [KIND.GEOTHERMAL]: 'Geothermal',
  [KIND.NUCLEAR]: 'Nuclear',
  [KIND.BARRACKS]: 'Barracks',
  [KIND.TOWER]: 'Tower',
  [KIND.BLOCKER]: 'Blocker',
  [KIND.CREEP]: 'Creep',
  [KIND.HERO]: 'Hero',
  [KIND.GROUND_ITEM]: 'Item',
  [KIND.LOOT_BAG]: 'Loot Bag',
});

/** Tower attack type by code (`ATTACK_CODE` in src/sim/buildings.js) and its one-letter tag. */
export const ATTACK_NAMES = /** @type {Record<number, string>} */ ({ 1: 'Melee', 2: 'Ranged', 3: 'Area' });

/**
 * Lux of an entity, rounded to the nearest whole lux: HP divided by its HP factor, milli units to lux.
 * @param {{ kind: number, hp: number }} e
 * @param {{ core: number, default: number }} hpFactor from data/balance.json
 */
export function luxOf(e, hpFactor) {
  const factor = e.kind === KIND.CORE ? hpFactor.core : hpFactor.default;
  return Math.round(e.hp / factor / MILLI);
}

/**
 * Label text of an entity, or null for kinds with no name (projectiles).
 * Examples: "Solar 20", "Tower R P2 S1 18", "Barracks 40 REC", "Lumen Core 94".
 * @param {{ kind: number, hp: number, attack?: number, powerLevel?: number, shellLevel?: number, stunTicks?: number, recycle?: number }} e
 * @param {{ core: number, default: number }} hpFactor
 * @returns {string | null}
 */
export function entityText(e, hpFactor) {
  const name = KIND_NAMES[e.kind];
  if (!name) return null;
  const parts = [name];
  if (e.kind === KIND.TOWER) {
    parts.push((ATTACK_NAMES[e.attack ?? 0] ?? '?').charAt(0));
    if (e.powerLevel) parts.push(`P${e.powerLevel}`);
    if (e.shellLevel) parts.push(`S${e.shellLevel}`);
  }
  parts.push(String(luxOf(e, hpFactor)));
  if (e.stunTicks) parts.push('STUN');
  if (e.recycle) parts.push('REC');
  return parts.join(' ');
}

/**
 * Whether the day half of the cycle is on (GDD 4.1). The match starts at dawn.
 * @param {number} tick
 * @param {{ dayTicks: number, nightTicks: number }} dayNight from data/balance.json
 */
export function isDay(tick, dayNight) {
  return tick % (dayNight.dayTicks + dayNight.nightTicks) < dayNight.dayTicks;
}
