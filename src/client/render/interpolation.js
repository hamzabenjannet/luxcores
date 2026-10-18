// @ts-check
/**
 * Smooth motion between snapshots. The server sends a snapshot every few ticks (10 per second by
 * default), so drawing the newest one as it arrives makes units jump. The interpolator draws the world a
 * short time in the past instead, and blends the positions of the two snapshots around that moment.
 *
 * It works in ticks, not in the arrival times of the packets: the render tick advances with the clock
 * from the newest snapshot and stays `delayTicks` behind it, so a late or early packet does not make the
 * motion stutter. The positions are the only thing blended; everything else comes from the newer snapshot,
 * and an entity that the newer snapshot lacks is gone.
 */

/** @typedef {{ id: number, x: number, z: number }} Mover */

/** A snapshot this many ticks older than the newest one comes from a restarted match. */
const RESTART_TICKS = 100;

/**
 * @param {{ tickMs: number, delayTicks?: number, jumpUnits?: number }} opts
 *   `tickMs` is the length of a tick in milliseconds, `delayTicks` how far behind the newest snapshot to draw
 *   (2 by default, one snapshot at the default cadence) and `jumpUnits` the distance (in units) above which an
 *   entity is taken to have teleported, so it is not blended across the map
 */
export function createInterpolator({ tickMs, delayTicks = 2, jumpUnits = 6000 }) {
  /** @type {{ tick: number, at: number, entities: readonly Mover[] } | null} */
  let older = null;
  /** @type {{ tick: number, at: number, entities: readonly Mover[] } | null} */
  let newer = null;

  return {
    /**
     * Remembers a snapshot.
     * @param {number} tick
     * @param {readonly Mover[]} entities
     * @param {number} nowMs when it arrived
     */
    push(tick, entities, nowMs) {
      if (newer && tick <= newer.tick) {
        // A tick far in the past means the match restarted, so forget what came before. A slightly older or equal tick
        // is a late or repeated packet, for example the join ack after a snapshot: drop it.
        if (newer.tick - tick > RESTART_TICKS) { older = null; newer = null; } else return;
      }
      older = newer;
      newer = { tick, at: nowMs, entities };
    },

    /**
     * The entities as they should be drawn at `nowMs`. Returns the newest snapshot's own list when there is
     * nothing to blend, and copies only the entities that moved.
     * @template {Mover} T
     * @param {number} nowMs
     * @returns {T[]}
     */
    at(nowMs) {
      if (!newer) return /** @type {T[]} */ ([]);
      const latest = /** @type {{ entities: readonly T[], tick: number, at: number }} */ (newer);
      if (!older) return /** @type {T[]} */ (latest.entities.slice());
      const renderTick = Math.min(latest.tick, latest.tick + (nowMs - latest.at) / tickMs - delayTicks);
      const span = latest.tick - older.tick;
      const t = Math.max(0, Math.min(1, (renderTick - older.tick) / span));
      if (t >= 1) return /** @type {T[]} */ (latest.entities.slice());
      /** @type {Map<number, Mover>} */
      const before = new Map();
      for (const e of older.entities) before.set(e.id, e);
      return latest.entities.map((e) => {
        const from = before.get(e.id);
        if (!from || (from.x === e.x && from.z === e.z)) return e;
        if (Math.abs(e.x - from.x) > jumpUnits || Math.abs(e.z - from.z) > jumpUnits) return e;
        return { ...e, x: from.x + (e.x - from.x) * t, z: from.z + (e.z - from.z) * t };
      });
    },
  };
}
