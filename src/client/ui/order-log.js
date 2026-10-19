// @ts-check
/**
 * The orders window keeps a log of every order a player made at a barracks: creep groups, hero picks and
 * item purchases. The log is built from what the snapshots show, so it needs no extra messages: an order
 * that appears in the player's queue becomes an entry, and an entry whose order leaves the queue is done,
 * or cancelled when the player cancelled it. These pure functions carry the decisions, and the Godot client
 * answers the same cases in `vone/scripts/game_logic.gd` (test/fixtures/client-parity.json).
 */

/** Entries the log keeps, newest last. The oldest go first. */
export const LOG_MAX = 60;

/** Initial of an attack code, as the queue text shows it: M, R or A. */
const ATTACK_INITIAL = /** @type {Record<number, string>} */ ({ 1: 'M', 2: 'R', 3: 'A' });

/** Order type codes of a hero pick and an item in `Order.type` (`ORDER_TYPE` in src/sim/creeps.js). */
export const HERO_ORDER = 2;
export const ITEM_ORDER = 3;

/**
 * Seconds as the UI writes them, rounded up to a tenth, with integer math only: 99 ticks at 20 Hz is "5.0s".
 * @param {number} ticks
 * @param {number} tickHz
 */
export function secondsText(ticks, tickHz) {
  const tenths = Math.floor((Math.max(0, ticks) * 10 + tickHz - 1) / tickHz);
  return `${Math.floor(tenths / 10)}.${tenths % 10}s`;
}

/**
 * What an order is, without its timer: "Group of 3 RRM", "Hero Prism 40 lux" or "Item Haste".
 * @param {import('../../sim/state.js').Order} o
 * @param {readonly string[]} [heroNames] roster names in roster order
 * @param {readonly string[]} [itemNames] item names by item id
 */
export function orderLabel(o, heroNames = [], itemNames = []) {
  if (o.type === HERO_ORDER) return `Hero ${heroNames[o.mix[0]] ?? '?'} ${o.mix[1]} lux`;
  if (o.type === ITEM_ORDER) return `Item ${itemNames[o.mix[0]] ?? '?'}`;
  return `Group of ${o.mix.length} ${o.mix.map((c) => ATTACK_INITIAL[c] ?? '?').join('')}`;
}

/**
 * The timer of a queued order: HELD while it waits for room (a group at the creep cap, an item with no hero),
 * else the seconds left.
 * @param {import('../../sim/state.js').Order} o
 * @param {number} tickHz
 */
export function orderWait(o, tickHz) {
  if (o.type === HERO_ORDER) return secondsText(o.ticksLeft, tickHz);
  if (o.held) return 'HELD';
  return o.type === ITEM_ORDER ? secondsText(o.ticksLeft, tickHz) : `${(Math.max(0, o.ticksLeft) / tickHz).toFixed(1)}s`;
}

/**
 * Match time as the log writes it, minutes and seconds.
 * @param {number} tick
 * @param {number} tickHz
 */
export function clockText(tick, tickHz) {
  const seconds = Math.floor(Math.max(0, tick) / tickHz);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * @typedef {{ id: number, barracksId: number, tick: number, label: string, state: 'queued' | 'done' | 'cancelled' }} LogEntry
 */

/**
 * The log after a snapshot. An order of the player that has no entry yet becomes one, queued. A queued
 * entry whose order is no longer in the queue is done, or cancelled when its id is in `cancelledIds`.
 * Entries keep their order, oldest first, and the oldest beyond LOG_MAX go.
 * @param {readonly LogEntry[]} log
 * @param {readonly import('../../sim/state.js').Order[]} orders  every order in the snapshot
 * @param {number} owner  the player whose orders are logged
 * @param {number} tick  the snapshot's tick
 * @param {readonly number[]} cancelledIds  orders the player cancelled since the last update
 * @param {readonly string[]} [heroNames]
 * @param {readonly string[]} [itemNames]
 * @returns {LogEntry[]}
 */
export function updateOrderLog(log, orders, owner, tick, cancelledIds, heroNames = [], itemNames = []) {
  const mine = orders.filter((o) => o.owner === owner);
  const live = new Set(mine.map((o) => o.id));
  /** @type {LogEntry[]} */
  const next = log.map((e) => (e.state === 'queued' && !live.has(e.id) ? { ...e, state: cancelledIds.includes(e.id) ? 'cancelled' : 'done' } : e));
  const known = new Set(next.map((e) => e.id));
  for (const o of mine) {
    if (!known.has(o.id)) next.push({ id: o.id, barracksId: o.barracksId, tick, label: orderLabel(o, heroNames, itemNames), state: 'queued' });
  }
  return next.slice(Math.max(0, next.length - LOG_MAX));
}

/**
 * The rows the window shows, newest first. A queued entry shows its live timer and can be cancelled; a finished
 * one shows `done` or `cancelled`.
 * @param {readonly LogEntry[]} log
 * @param {readonly import('../../sim/state.js').Order[]} orders
 * @param {number} tickHz
 * @returns {{ id: number, barracksId: number, time: string, text: string, state: string, canCancel: boolean }[]}
 */
export function logRows(log, orders, tickHz) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  return [...log].reverse().map((e) => {
    const o = e.state === 'queued' ? byId.get(e.id) : undefined;
    return {
      id: e.id,
      barracksId: e.barracksId,
      time: clockText(e.tick, tickHz),
      text: `${e.label} ${o ? orderWait(o, tickHz) : e.state}`,
      state: e.state,
      canCancel: e.state === 'queued',
    };
  });
}
