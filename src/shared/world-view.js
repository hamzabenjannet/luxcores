// @ts-check
/**
 * WorldView: the only way client and bot code read game state.
 *
 * Two implementations: `localWorldView` wraps a sim state (the server's match
 * runner and bots use it), and `networkWorldView` wraps the snapshot feed of a
 * browser that plays through the server. Nothing else changes between them.
 *
 * Rule: client and bot code must not import sim internals or mutate state.
 */

/**
 * @typedef {Object} WorldView
 * @property {() => number} tick
 * @property {() => readonly import('../sim/state.js').Entity[]} entities
 * @property {() => import('../sim/state.js').StaticMap} map  generated lanes, vents and item spawns; never changes
 * @property {() => readonly import('../sim/state.js').Group[]} groups  creep groups with their paths
 * @property {() => readonly import('../sim/state.js').Order[]} orders  barracks queues, held groups and hero picks included
 * @property {() => readonly import('../sim/state.js').Player[]} players  every player with the rotation lock and the pick cooldown of their hero
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
    groups: () => state.groups,
    orders: () => state.orders,
    players: () => state.players,
    team: (t) => ({ coreLux: state.teams[t].coreLux, pendingLux: state.teams[t].pendingLux }),
    isVisibleToViewer: () => true,
  };
}

/**
 * The same view over server snapshots (online play). `feed` is the object that
 * `joinServerMatch` fills, so this view always shows the latest snapshot.
 * @param {import('../client/net/server-session.js').Feed} feed
 * @returns {WorldView}
 */
export function networkWorldView(feed) {
  return {
    tick: () => feed.tick,
    entities: () => feed.entities,
    map: () => feed.map,
    groups: () => feed.groups,
    orders: () => feed.orders,
    players: () => feed.players,
    team: (t) => ({ coreLux: feed.teams[t]?.coreLux ?? 0, pendingLux: feed.teams[t]?.pendingLux ?? 0 }),
    isVisibleToViewer: () => true,
  };
}

