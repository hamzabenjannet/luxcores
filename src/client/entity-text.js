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
 * Label text of an entity, or null for kinds with no name (projectiles). A hero shows its roster
 * name when `heroNames` has one, and any entity under a shield shows SHIELD. A ground item shows its
 * item name and a loot bag the number of items inside; neither shows lux.
 * Examples: "Solar 20", "Tower R P2 S1 18", "Barracks 40 REC", "Lumen Core 94", "Halo 30 SHIELD", "Haste", "Loot Bag 5".
 * @param {{ kind: number, hp: number, attack?: number, powerLevel?: number, shellLevel?: number, stunTicks?: number, recycle?: number, heroType?: number, shieldHp?: number, itemId?: number, items?: readonly number[] }} e
 * @param {{ core: number, default: number }} hpFactor
 * @param {readonly string[]} [heroNames] roster names in roster order, from data/heroes.json
 * @param {readonly string[]} [itemNames] item names by item id, from data/items.json
 * @returns {string | null}
 */
export function entityText(e, hpFactor, heroNames = [], itemNames = []) {
  if (e.kind === KIND.GROUND_ITEM) return e.itemId ? (itemNames[e.itemId - 1] ?? KIND_NAMES[e.kind]) : KIND_NAMES[e.kind];
  if (e.kind === KIND.LOOT_BAG) return `${KIND_NAMES[e.kind]} ${(e.items ?? []).reduce((total, n) => total + n, 0)}`;
  const name = e.kind === KIND.HERO && e.heroType ? (heroNames[e.heroType - 1] ?? KIND_NAMES[e.kind]) : KIND_NAMES[e.kind];
  if (!name) return null;
  const parts = [name];
  if (e.kind === KIND.TOWER) {
    parts.push((ATTACK_NAMES[e.attack ?? 0] ?? '?').charAt(0));
    if (e.powerLevel) parts.push(`P${e.powerLevel}`);
    if (e.shellLevel) parts.push(`S${e.shellLevel}`);
  }
  parts.push(String(luxOf(e, hpFactor)));
  if (e.stunTicks) parts.push('STUN');
  if (e.shieldHp) parts.push('SHIELD');
  if (e.recycle) parts.push('REC');
  return parts.join(' ');
}

/**
 * One label per creep group instead of one per creep, so thirty creeps do not crowd the screen. The
 * label sits at the centroid of the group and shows how many creeps it has and their lux together.
 * Examples: "Creeps x5 50".
 * @param {readonly { id: number, kind: number, team: number, x: number, z: number, hp: number, groupId?: number }[]} entities
 * @param {{ core: number, default: number }} hpFactor
 * @returns {{ groupId: number, team: number, x: number, z: number, text: string }[]} in group id order; x and z in units
 */
export function creepGroupLabels(entities, hpFactor) {
  /** @type {Map<number, { team: number, n: number, x: number, z: number, hp: number }>} */
  const groups = new Map();
  for (const e of entities) {
    if (e.kind !== KIND.CREEP || !e.groupId) continue;
    const g = groups.get(e.groupId) ?? { team: e.team, n: 0, x: 0, z: 0, hp: 0 };
    g.n++;
    g.x += e.x;
    g.z += e.z;
    g.hp += e.hp;
    groups.set(e.groupId, g);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([groupId, g]) => ({
      groupId,
      team: g.team,
      x: Math.trunc(g.x / g.n),
      z: Math.trunc(g.z / g.n),
      text: `Creeps x${g.n} ${luxOf({ kind: KIND.CREEP, hp: g.hp }, hpFactor)}`,
    }));
}

/**
 * The entropy rate a player typed, in percent of the maximum HP per second with at most one decimal,
 * as the tenths of a percent the server takes. Anything else, or an empty field, gives -1.
 * Examples: "0.1" gives 1, "5" gives 50, "100" gives 1000, "100.1" gives -1.
 * @param {string} text
 * @returns {number}
 */
export function entropyFromText(text) {
  const m = /^(\d{1,3})(?:\.(\d))?$/.exec(text.trim());
  if (!m) return -1;
  const tenths = Number(m[1]) * 10 + Number(m[2] ?? 0);
  return tenths <= 1000 ? tenths : -1;
}

/**
 * An entropy rate as the percent per second a player reads.
 * Examples: 1 gives "0.1", 15 gives "1.5", 50 gives "5".
 * @param {number} tenths  tenths of a percent per second
 */
export function entropyText(tenths) {
  const whole = Math.trunc(tenths / 10);
  const tenth = tenths % 10;
  return tenth === 0 ? String(whole) : `${whole}.${tenth}`;
}

/** The largest tick limit the server takes: 1 000 000 ticks, about 14 hours at 20 Hz. */
export const MAX_TICK_CAP = 1_000_000;

/**
 * The tick limit a player typed for a capped match, as the whole number of ticks the server takes.
 * Anything else, zero included (the server reads 0 as unlimited), gives -1.
 * Examples: "10000" gives 10000, " 600 " gives 600, "0" gives -1, "1000001" gives -1.
 * @param {string} text
 * @returns {number}
 */
export function tickCapFromText(text) {
  if (!/^\d{1,7}$/.test(text.trim())) return -1;
  const ticks = Number(text.trim());
  return ticks >= 1 && ticks <= MAX_TICK_CAP ? ticks : -1;
}

/**
 * A match's tick limit as the lobby shows it. 0 is unlimited.
 * Examples: 0 gives "Unlimited", 10000 gives "Capped at 10000 ticks".
 * @param {number} maxTicks
 */
export function tickCapText(maxTicks) {
  return maxTicks === 0 ? 'Unlimited' : `Capped at ${maxTicks} ticks`;
}

/**
 * Whether the day half of the cycle is on (GDD 4.1). The match starts at dawn.
 * @param {number} tick
 * @param {{ dayTicks: number, nightTicks: number }} dayNight from data/balance.json
 */
export function isDay(tick, dayNight) {
  return tick % (dayNight.dayTicks + dayNight.nightTicks) < dayNight.dayTicks;
}
