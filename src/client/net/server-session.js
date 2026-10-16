// @ts-check
/**
 * Online play. Signs in to the Luxcores backend as a guest, opens or joins a
 * match, and keeps the latest server snapshot in a `feed` that
 * `networkWorldView` (world-view.js) reads. The server owns the simulation:
 * this client only sends commands and renders what it receives
 * (docs/TECH_ARCHITECTURE.md section 13.1).
 *
 * Socket.IO loads on demand, so offline play never fetches it.
 */

/**
 * Latest server state. Filled by socket events.
 * @typedef {Object} Feed
 * @property {number} tick
 * @property {import('../../sim/state.js').Entity[]} entities
 * @property {{ coreLux: number, pendingLux: number }[]} teams  milli-lux
 * @property {import('../../sim/state.js').StaticMap} map
 * @property {'lobby' | 'running' | 'finished'} status
 * @property {string | undefined} hash  state hash of the latest tick that carried one
 * @property {{ winnerTeam: number | null, draw: boolean, reason: string } | null} result
 */

/**
 * @typedef {Object} ServerSession
 * @property {Feed} feed
 * @property {number} viewerTeam  team of the signed-in player
 * @property {string} matchId
 * @property {() => Promise<void>} start  host only; asks the server to start the match
 * @property {(cmd: { t: string, [field: string]: unknown }) => Promise<{ accepted: boolean, tick?: number, reason?: string }>} sendCommand
 * @property {(listener: (snapshot: any) => void) => void} onSnapshot
 * @property {(listener: () => void) => void} onChange  called on every status change
 * @property {Promise<void>} firstSnapshot  settles once the first snapshot has arrived
 * @property {() => void} close
 */

/**
 * @param {{
 *   server: string,          // backend origin, for example http://localhost:3000
 *   name: string,            // guest display name
 *   matchId: string,         // an existing match id, or 'new' to open a lobby
 *   vsBot?: boolean,         // with 'new': fill the second slot with a bot
 *   seed?: number,           // with 'new': map and RNG seed
 *   specVersion: string,     // SPEC_VERSION of this client's sim
 * }} opts
 * @returns {Promise<ServerSession>}
 */
export async function joinServerMatch({ server, name, matchId, vsBot = false, seed, specVersion }) {
  const base = server.replace(/\/$/, '');
  const spec = await request(`${base}/api/game/spec`);
  if (spec.specVersion !== specVersion) {
    throw new Error(`This server simulates spec ${spec.specVersion} and this client spec ${specVersion}`);
  }

  const auth = await request(`${base}/api/auth/guest`, { body: { name } });
  const token = auth.accessToken;
  let match =
    matchId === 'new'
      ? await request(`${base}/api/matches`, { token, body: { name: `${name}'s match`, vsBot, ...(seed === undefined ? {} : { seed }) } })
      : await request(`${base}/api/matches/${matchId}/join`, { token, method: 'POST' });
  const map = await request(`${base}/api/game/maps/${match.seed}`);

  /** @type {Feed} */
  const feed = { tick: 0, entities: [], teams: [], map, status: 'lobby', hash: undefined, result: null };
  /** @type {((snapshot: any) => void)[]} */
  const snapshotListeners = [];
  /** @type {(() => void)[]} */
  const changeListeners = [];
  /** @type {() => void} */
  let gotFirst = () => {};
  const firstSnapshot = new Promise((resolve) => (gotFirst = () => resolve(undefined)));

  const { io } = await import('socket.io-client');
  const socket = io(`${base}/game`, { auth: { token }, transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', (/** @type {Error} */ err) => reject(new Error(`Socket refused: ${err.message}`)));
  });

  /** @param {any} snapshot */
  const apply = (snapshot) => {
    feed.tick = snapshot.tick;
    feed.entities = snapshot.entities;
    feed.teams = snapshot.teams;
    if (snapshot.hash) feed.hash = snapshot.hash;
    feed.status = 'running';
    gotFirst();
    for (const l of snapshotListeners) l(snapshot);
  };
  const changed = () => changeListeners.forEach((l) => l());

  socket.on('match:snapshot', apply);
  socket.on('match:started', (/** @type {any} */ info) => { apply(info.snapshot); changed(); });
  socket.on('match:updated', (/** @type {any} */ m) => { match = m; changed(); });
  socket.on('match:ended', (/** @type {any} */ e) => { feed.status = 'finished'; feed.result = e.result; changed(); });

  const joined = await socket.timeout(5000).emitWithAck('match:join', { matchId: match.id });
  if (!joined.ok) throw new Error(`Cannot join the match room: ${joined.error}`);
  if (joined.snapshot) apply(joined.snapshot);

  let seq = 0;
  return {
    feed,
    viewerTeam: match.players.find((/** @type {any} */ p) => p.playerId === auth.player.id)?.team ?? 0,
    matchId: match.id,
    start: async () => { await request(`${base}/api/matches/${match.id}/start`, { token, method: 'POST' }); },
    sendCommand: (cmd) => socket.timeout(5000).emitWithAck('match:command', { matchId: match.id, seq: seq++, cmd }),
    onSnapshot: (l) => { snapshotListeners.push(l); },
    onChange: (l) => { changeListeners.push(l); },
    firstSnapshot,
    close: () => { socket.close(); },
  };
}

/**
 * JSON request. A body makes it a POST unless `method` says otherwise.
 * @param {string} url
 * @param {{ token?: string, body?: unknown, method?: string }} [opts]
 * @returns {Promise<any>}
 */
async function request(url, { token, body, method } = {}) {
  const res = await fetch(url, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method ?? (body === undefined ? 'GET' : 'POST')} ${url}: ${[json?.message].flat().join(', ') || res.status}`);
  return json;
}
