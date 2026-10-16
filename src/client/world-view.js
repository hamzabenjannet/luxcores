// @ts-check
/**
 * WorldView: the only way client code reads game state.
 *
 * In the MVP it wraps the local sim. After the server-authoritative netcode
 * lands (TECH_ARCHITECTURE.md section 13) a second implementation will wrap
 * the snapshot buffer instead, and nothing else in src/client changes.
 *
 * Rule: client code must not import sim internals or mutate state.
 */

/**
 * @typedef {Object} WorldView
 * @property {() => number} tick
 * @property {() => readonly import('../sim/state.js').Entity[]} entities
 * @property {() => import('../sim/state.js').StaticMap} map  generated lanes, vents and item spawns; never changes
 * @property {(team: number) => { coreLux: number, pendingLux: number }} team  milli-lux
 * @property {(entity: import('../sim/state.js').Entity) => boolean} isVisibleToViewer  always true until fog of war ships
 */

/**
 * @param {import('../sim/state.js').SimState} state
 * @param {number} _viewerTeam
 * @returns {WorldView}
 */
export function localWorldView(state, _viewerTeam) {
  return {
    tick: () => state.tick,
    entities: () => state.entities,
    map: () => state.map,
    team: (t) => ({ coreLux: state.teams[t].coreLux, pendingLux: state.teams[t].pendingLux }),
    isVisibleToViewer: () => true,
  };
}

/**
 * The same view over server snapshots (online play). `feed` is the object that
 * `joinServerMatch` fills, so this view always shows the latest snapshot.
 * @param {import('./net/server-session.js').Feed} feed
 * @returns {WorldView}
 */
export function networkWorldView(feed) {
  return {
    tick: () => feed.tick,
    entities: () => feed.entities,
    map: () => feed.map,
    team: (t) => ({ coreLux: feed.teams[t]?.coreLux ?? 0, pendingLux: feed.teams[t]?.pendingLux ?? 0 }),
    isVisibleToViewer: () => true,
  };
}

