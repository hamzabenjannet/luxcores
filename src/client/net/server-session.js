// @ts-check
/**
 * Online play. Signs in to the Luxcores backend as a guest, opens or joins a
 * match, and keeps the latest server snapshot in a `feed` that
 * `networkWorldView` (world-view.js) reads. The server owns the simulation:
 * this client only sends commands and renders what it receives
 * (docs/TECH_ARCHITECTURE.md section 13.1).
 *
 * Sign-in is a device guest. The first visit creates a guest profile and keeps
 * its device secret in localStorage, so later visits sign in as the same player.
 * A recovery code (`requestRecoveryCode`) moves the profile to another device.
 *
 * Socket.IO loads on demand from the import map in index.html.
 */

/**
 * Latest server state. Filled by socket events.
 * @typedef {Object} Feed
 * @property {number} tick
 * @property {import('../../sim/state.js').Entity[]} entities
 * @property {import('../../sim/state.js').Group[]} groups  creep groups with their paths
 * @property {import('../../sim/state.js').Order[]} orders  barracks queues, held groups and hero picks included
 * @property {import('../../sim/state.js').Player[]} players  hero rotation lock and pick cooldown per player
 * @property {{ coreLux: number, pendingLux: number }[]} teams  milli-lux
 * @property {import('../../sim/state.js').StaticMap} map
 * @property {'lobby' | 'running' | 'finished'} status
 * @property {string | undefined} hash  state hash of the latest tick that carried one
 * @property {{ winnerTeam: number | null, draw: boolean, reason: string } | null} result
 * @property {boolean} connected  false while the socket is down and the page is trying to rejoin the match
 */

/**
 * @typedef {Object} ServerSession
 * @property {Feed} feed
 * @property {number} viewerTeam  team of the signed-in player
 * @property {string} playerId
 * @property {string} playerName
 * @property {'player' | 'spectator'} role  a spectator watches a bot match and cannot send commands
 * @property {boolean} isHost  true for the player who opened the lobby, who also starts the match
 * @property {() => any} getMatch  the latest lobby or match record (`MatchDto`), kept current by the server
 * @property {string | undefined} recoveryCode  set when this session came from a recovery: the replacement code, shown once
 * @property {() => Promise<string>} requestRecoveryCode  makes a new recovery code; the old one stops working
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
 *   botVsBot?: boolean,      // with 'new': two bots play and this client only watches
 *   seed?: number,           // with 'new': map and RNG seed
 *   specVersion: string,     // SPEC_VERSION of this client's sim
 *   recoveryCode?: string,   // move a profile to this device instead of signing in
 * }} opts
 * @returns {Promise<ServerSession>}
 */
export async function joinServerMatch({ server, name, matchId, vsBot = false, botVsBot = false, seed, specVersion, recoveryCode }) {
  const base = server.replace(/\/$/, '');
  const spec = await request(`${base}/api/game/spec`);
  if (spec.specVersion !== specVersion) {
    throw new Error(`This server simulates spec ${spec.specVersion} and this client spec ${specVersion}`);
  }

  const auth = await signIn(base, name, recoveryCode);
  const token = auth.accessToken;
  // An existing bot match has no slot to take, so the page watches it instead of joining.
  const existing = matchId === 'new' ? null : await request(`${base}/api/matches/${matchId}`, { token });
  let match =
    matchId === 'new'
      ? await request(`${base}/api/matches`, { token, body: { name: `${name}'s match`, vsBot, botVsBot, ...(seed === undefined ? {} : { seed }) } })
      : existing.botVsBot
        ? existing
        : await request(`${base}/api/matches/${matchId}/join`, { token, method: 'POST' });
  const map = await request(`${base}/api/game/maps/${match.seed}`);

  /** @type {Feed} */
  const feed = { tick: 0, entities: [], groups: [], orders: [], players: [], teams: [], map, status: 'lobby', hash: undefined, result: null, connected: true };
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
    feed.groups = snapshot.groups ?? [];
    feed.orders = snapshot.orders ?? [];
    feed.players = snapshot.players ?? [];
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

  // The server numbers commands per player and tells us where we stand, so a page that rejoins a match
  // (after a reload, a dropped connection or a server restart) continues the count instead of starting at 0.
  let seq = joined.nextSeq ?? 0;

  // The handler is set up after the first connect, so it runs on reconnects only.
  // After a drop, Socket.IO reconnects by itself but the room is gone. Rejoin, and keep trying while a
  // restarted server is still rebuilding the match from its log (the ack then holds no snapshot yet).
  socket.on('disconnect', () => { feed.connected = false; });
  socket.on('connect', async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const again = await socket.timeout(5000).emitWithAck('match:join', { matchId: match.id });
        if (again.ok) {
          seq = again.nextSeq ?? seq;
          if (again.snapshot) { apply(again.snapshot); feed.connected = true; return; }
          if (again.status !== 'running') { feed.connected = true; return; }
        }
      } catch {
        // the server is not answering yet
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });
  return {
    feed,
    viewerTeam: match.players.find((/** @type {any} */ p) => p.playerId === auth.player.id)?.team ?? 0,
    playerId: auth.player.id,
    playerName: auth.player.name,
    role: joined.role,
    isHost: match.hostId === auth.player.id,
    getMatch: () => match,
    recoveryCode: recoveryCode ? auth.recoveryCode : undefined,
    requestRecoveryCode: async () => (await request(`${base}/api/auth/recovery-code`, { token, method: 'POST' })).recoveryCode,
    matchId: match.id,
    start: async () => { await request(`${base}/api/matches/${match.id}/start`, { token, method: 'POST' }); },
    sendCommand: async (cmd) => {
      const ack = await socket.timeout(5000).emitWithAck('match:command', { matchId: match.id, seq: seq++, cmd });
      if (!ack.accepted && typeof ack.nextSeq === 'number') seq = ack.nextSeq; // the server's count wins; the player taps again
      return ack;
    },
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

/** Where a device keeps its secret, one entry per server. */
const secretKey = (/** @type {string} */ base) => `luxcores.deviceSecret:${base}`;

/** localStorage can be missing or blocked (private windows), so every access is guarded. */
function readSecret(/** @type {string} */ base) {
  try {
    return localStorage.getItem(secretKey(base));
  } catch {
    return null;
  }
}

function writeSecret(/** @type {string} */ base, /** @type {string | null} */ secret) {
  try {
    if (secret) localStorage.setItem(secretKey(base), secret);
    else localStorage.removeItem(secretKey(base));
  } catch {
    // Without storage the device signs in as a new guest next time.
  }
}

/**
 * Recovery code first, then the stored device secret, then a new guest.
 * @param {string} base
 * @param {string} name
 * @param {string | undefined} recoveryCode
 * @returns {Promise<any>}
 */
async function signIn(base, name, recoveryCode) {
  /** @type {any} */
  let auth;
  if (recoveryCode) {
    auth = await request(`${base}/api/auth/recover`, { body: { recoveryCode } });
  } else {
    const secret = readSecret(base);
    if (secret) {
      // An unknown secret, such as one a recovery replaced, falls through to a new guest.
      auth = await request(`${base}/api/auth/device`, { body: { deviceSecret: secret } }).catch(() => null);
      if (!auth) writeSecret(base, null);
    }
  }
  auth ??= await request(`${base}/api/auth/guest`, { body: { name } });
  if (auth.deviceSecret) writeSecret(base, auth.deviceSecret);
  return auth;
}

