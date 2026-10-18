# Luxcores Backend

The multiplayer server of Luxcores. It is a NestJS 12 app with a REST API, a Socket.IO match server, replay storage and optional RabbitMQ events. The server runs the same deterministic simulation as the browser (`src/sim` in the repo root), so Node, Chromium and this server produce the same state hashes.

The design follows `docs/TECH_ARCHITECTURE.md` section 13.1: the server owns the simulation, clients send commands and receive snapshots.

## Quick Start

You need Node 22 or newer. The server reads the simulation and the game data from the repo root, so start it from a full checkout.

```bash
cd backend/nodejs
npm install
cp .env.example .env      # optional, every variable has a development default
npm run start:dev         # watch mode on http://localhost:3000
```

To play against the server from a browser, open `http://localhost:3000/?server=&name=Halo&match=new&vsBot=1&autostart=1`. The web client then renders server snapshots, and `?match=<id>` joins an existing lobby (see `src/client/net/server-session.js`).

| URL | What it serves |
|---|---|
| `/ws` | The plain WebSocket match channel (see Plain WebSocket Protocol) |
| `/` | The game page, so a phone on the LAN can play against this server |
| `/api/docs` | Swagger UI (`/api/docs-json` holds the raw OpenAPI document) |
| `/api/health` | Liveness, database state and event bus mode |
| `/public/` | Files that belong to the backend (`backend/nodejs/public`) |

## Configuration

`@nestjs/config` loads `.env` and the process environment, and `src/config/env.validation.ts` rejects bad values at start-up. In production the two secrets are required.

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Listen address |
| `CORS_ORIGIN` | `*` | Comma-separated origins for REST. Sockets reflect the request origin |
| `JWT_SECRET` | development value | Signs player tokens. At least 16 characters in production |
| `JWT_EXPIRES_IN` | `12h` | Token lifetime |
| `ADMIN_API_KEY` | development value | Value of the `x-api-key` header for `/api/admin`. At least 16 characters in production |
| `DATABASE_DRIVER` | `auto` | `auto` uses MongoDB when `MONGODB_URL` is set and the JSON file otherwise. `json`, `mongodb` and `postgres` choose one. Any of them falls back to the JSON file when its database is unreachable (see Storage) |
| `JSON_DB_PATH` | `data/db.json` | The JSON database file. `{hostname}` in the path becomes the host name, so servers that share a volume keep a file each |
| `MONGODB_URL`, `MONGODB_DB` | none, `luxcores` | MongoDB connection. It holds the data and the match events |
| `POSTGRES_URL` | none | PostgreSQL connection string. As the main database it falls back to the JSON file. Otherwise the server only checks that it answers |
| `DATABASE_TIMEOUT_MS` | `3000` | How long one attempt to reach MongoDB or PostgreSQL may take |
| `STARTUP_WAIT_MS` | `6000` | How long a service gets to answer at start-up before the server runs without it until the next restart |
| `REDIS_URL`, `REDIS_TIMEOUT_MS`, `REDIS_KEY_PREFIX` | none, `3000`, `lux` | Redis connection. It buffers the match log, holds the match leases and carries room events between servers. The prefix starts every key, so deployments can share a Redis |
| `RABBITMQ_URL` | empty | Empty keeps events and commands inside the process |
| `RABBITMQ_QUEUE`, `RABBITMQ_PREFETCH`, `RABBITMQ_TIMEOUT_MS` | `luxcores.events`, `10`, `5000` | Event queue name, consumer prefetch and the time one connection attempt may take |
| `NODE_ID` | host name, process id and a random suffix | Names this server in the match leases. It must differ between running servers |
| `CLUSTER_LEASE_MS`, `CLUSTER_ADOPT_EVERY_MS`, `CLUSTER_RPC_TIMEOUT_MS` | `10000`, `3000`, `1500` | Lifetime of a match lease, pause between two looks for matches that no server runs, and the time a request to another server may take |
| `COMMAND_TRANSPORT` | `auto` | `auto` hands the commands of a local match straight to the sim. `queue` sends them through the match queue even then |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_AUTH_PER_MINUTE` | `300`, `10` | Requests per client address and minute: every HTTP route, and the sign-in routes on top |
| `TRUST_PROXY` | `0` | Reverse proxies in front of the app. Set `1` behind Caddy or nginx, or every client shares the proxy's address |
| `WS_AUTH_TIMEOUT_MS`, `WS_MAX_PAYLOAD_BYTES` | `5000`, `16384` | Plain WebSocket auth window and largest frame |
| `LUXCORES_ROOT` | `../..` | Repo root with `src/sim`, `data/` and `index.html` |
| `PUBLIC_DIR` | `public` | Backend static folder |
| `MATCH_ON_SHUTDOWN` | `resume` | A graceful stop leaves running matches running, and the next start rebuilds them from their logs. `end` draws them at once |
| `EVENT_LOG_DIR`, `EVENT_LOG_FLUSH_MS`, `EVENT_LOG_KEEP_FINISHED` | `events` next to the JSON database, `100`, `false` | Where the file copy of the match logs lives, how often logs are written, and whether a finished match keeps its log everywhere (see Match Log and Resume) |
| `EVENT_LOG_RETENTION_DAYS` | `14` | Days a finished match keeps its events in MongoDB. `0` deletes them when the match ends |
| `CHECKPOINT_EVERY_TICKS` | `400` | Ticks between two checkpoints of a running match, a multiple of 20. `0` turns them off |
| `MATCH_MAX_TICKS` | `match.stalemateTicks` in `data/balance.json` (10000) | An undecided match ends as a draw after this many ticks (about 8 minutes at 20 Hz). Set it higher for long test runs |
| `SNAPSHOT_EVERY_TICKS` | `2` | Ticks between snapshots (10 per second) |

## Architecture

| Folder | Role |
|---|---|
| `src/config` | Typed settings and environment validation |
| `src/common` | The global JWT guard, the API key guard, `ParseSeedPipe`, the error filter and shared DTOs |
| `src/database` | The `DataStore` contract, its three adapters, the shared MongoDB connection and `ResilientStore`, which falls back to the JSON file |
| `src/redis` | The shared Redis connection |
| `src/matchlog` | The match log: the `EventLog` port, the tiered writer, the file, Redis Stream and MongoDB sinks, and the resume planner |
| `src/cluster` | Match leases, the command bus with one RabbitMQ queue per match, and the room relay between servers |
| `src/simulation` | `SimService`: loads `src/sim` and `data/*.json` at start-up |
| `src/auth`, `src/players` | Guest sign-in, profiles, leaderboard |
| `src/matches` | Lobby rules and match persistence |
| `src/game` | Match runner, the Socket.IO and plain WebSocket gateways on one `GameActions` service and `RoomHub`, start and stop routes, spec and map routes |
| `src/replays` | Replay storage and server-side verification |
| `src/events` | `EventBus` with a RabbitMQ and an in-process implementation |
| `src/admin`, `src/health`, `src/static` | Operator routes, liveness, static files |

### Match Flow

1. A player signs in as a guest and opens a lobby (`POST /api/matches`). The host takes team 0.
2. A second player joins, or the host asks for a bot (`vsBot`), or for two bots (`botVsBot`). In a bot match the host only watches, and any signed-in player may join the room as a spectator.
3. Both clients connect to the `/game` socket namespace and join the match room.
4. The host starts the match. `MatchRunnerService` creates the sim state from the match seed and ticks it at 20 Hz from a self-correcting timer.
5. Clients send commands. The server stamps the tick and the player id itself, so a client cannot act for another player. Invalid commands are dropped by the sim. Each bot (`src/bot/bot.js`) thinks once per tick on the server, and its commands go into the same replay log as a human's.
6. Every `SNAPSHOT_EVERY_TICKS` ticks the room receives a snapshot. A state `hash` rides along every 20 ticks, so a client that also simulates can detect drift.
7. A victory, a draw or `MATCH_MAX_TICKS` ends the match. Then the server saves the replay, updates the match and publishes `match.finished`, and the consumer applies the result to the player profiles.

### Snapshot Entities

Each entity in a snapshot carries `id`, `kind`, `team`, `owner`, `x` and `z` (units, 1 tile is 1000), plus `hp` and `maxHp` (milli-HP). It also carries the fields a client needs to draw M3:

| Field | Meaning |
|---|---|
| `attack` | Tower attack type: 1 melee, 2 ranged, 3 area |
| `recycle` | Ticks left in the recycle channel |
| `stunTicks` | Ticks left on a stun |
| `targetId` | What a tower or hero aims at, and a projectile's target |
| `powerLevel`, `shellLevel` | Tower upgrade levels |
| `roll` | Wind output in milli-lux per second |
| `arrivalTick` | Projectile impact tick |
| `heroType` | Hero: the roster id plus one (0 for any other entity). The names are in `data/heroes.json` |
| `shieldHp`, `shieldTicks` | What the shield on this entity still absorbs (milli-HP) and the ticks it has left |
| `cd0` to `cd3` | Hero: ticks until ability slot 0 (melee), 1 (ranged), 2 (area) and 3 (shield) can be cast again |
| `itemId` | Ground item: the item id plus one (0 for any other entity). The names are in `data/items.json` |
| `items` | Loot bag: how many of each item id it holds (an empty list for any other entity) |
| `speedMod`, `speedTicks` | The attack speed an item added (Haste +300, Sluggish −300) and the ticks it has left |

A snapshot also carries `groups`, `orders` and `players`. A `players` entry holds `id`, `team`, `kind`, `heroLock` (bit i set while roster hero i is locked by the rotation) and `heroCooldown` (ticks until the player may pick another hero), `items` (how many of each item id the player holds) and `funnelLux` (milli-lux that Energy Grab may still funnel). A hero pick is an order of `type` 2 whose `mix` is `[rosterId, lux]`; creep orders have type 1 and a `mix` of attack codes, and an item order has type 3 with `mix: [itemId]` (`held` is 1 while it waits for a hero or a free slot).

`kind` codes come from `GET /api/game/spec` (`kinds`), so a client never hard-codes them. A projectile lives for one tick, and a snapshot every second tick shows only some of them. Draw an aim line from `targetId` instead of waiting for one.

A `match:join` ack also carries `role`: `player`, or `spectator` for a watcher of a bot match. Spectators receive every event of the room and cannot send commands. It carries `nextSeq` too, the sequence number that the player's next command must use. A client that rejoins (after a reload, a dropped connection or a server restart) continues the count there, and a command rejected for its `seq` carries the same `nextSeq`.

## REST Routes

All routes live under `/api`. A route needs `Authorization: Bearer <token>` unless the Auth column says otherwise.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /auth/guest` | public | Create a guest profile; returns a token and a `deviceSecret` |
| `POST /auth/device` | public | Sign in again as the same guest from the device secret |
| `POST /auth/recovery-code` | token | Make a recovery code that moves this profile to another device |
| `POST /auth/recover` | public | Exchange a recovery code for a token, a new device secret and a new code |
| `GET /players`, `GET /players/leaderboard` | token | List profiles, top players by wins |
| `GET /players/me`, `PATCH /players/me`, `GET /players/:id` | token | Profiles |
| `POST /matches`, `GET /matches`, `GET /matches/:id` | token | Open and browse lobbies |
| `POST /matches/:id/join`, `POST /matches/:id/leave` | token | Lobby membership |
| `POST /matches/:id/start`, `POST /matches/:id/stop` | token, host | Start or stop the simulation |
| `GET /game/spec` | public | Spec version, data hash, tick rate and the socket reference |
| `GET /game/maps/:seed` | public | The generated map for a seed |
| `POST /replays`, `GET /replays`, `GET /replays/:id` | token | Replay storage |
| `POST /replays/:id/verify` | token | Re-simulate a replay and compare every hash |
| `GET /admin/stats`, `DELETE /admin/replays/:id` | `x-api-key` | Operator routes |
| `GET /health` | public | Liveness |

Errors share one shape, `ErrorResponseDto`: `statusCode`, `error`, `message`, `path`, `timestamp`.

## Socket.IO Protocol

Connect to the `/game` namespace and pass the token from `POST /api/auth/guest` in the handshake. A socket without a valid token never connects. Every client event takes an ack callback. A rejected payload answers through the ack with `{ ok: false, error }`.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/game', { auth: { token } });
await socket.emitWithAck('match:join', { matchId });
socket.on('match:snapshot', (snapshot) => render(snapshot));
const ack = await socket.emitWithAck('match:command', {
  matchId,
  seq: 0, // rises with every command; the server drops a repeat
  cmd: { t: 'heroMove', x: 48000, z: 80000 }, // units, 1 tile = 1000
});
```

| Event | Direction | Payload |
|---|---|---|
| `match:join`, `match:leave` | client to server | `{ matchId }` |
| `match:command` | client to server | `{ matchId, seq, cmd }`, acked with `{ accepted, tick?, reason? }` |
| `chat:message` | both | Client sends `{ matchId, text }`; the room gets `{ from, text, at }` |
| `ping` | client to server | The ack holds the server time |
| `match:updated` | server to room | The `MatchDto` after a lobby or status change |
| `match:started` | server to room | `{ matchId, tickHz, players, map, snapshot }` |
| `match:snapshot` | server to room | `{ matchId, tick, hash?, teams, entities, groups, orders, players }` (see Snapshot Entities) |
| `match:ended` | server to room | `{ matchId, endedTick, result, replayId }` |

An accepted ack means that the server queued the command for the next tick. The sim can still refuse it for a reason the ack cannot know, such as too little lux, a locked hero or a cooldown, and the next snapshot shows what happened. The hero commands are `pickHero` (`heroId`, `lux`, `barracksId`), `heroMove`, `heroAttack` and `castAbility` (`slot` 0 to 3, with `targetId` or `x` and `z`); GDD 7.7 describes each.

`GET /api/game/spec` lists the same events in machine-readable form, and the Swagger schemas include their payload DTOs.

## Sign-In and Recovery

There are no passwords. A device proves who it is with a random secret.

1. `POST /auth/guest` creates a profile and returns a JWT with a `deviceSecret` (256 random bits). The client keeps the secret; the web client uses `localStorage`, one entry per server.
2. On the next visit, `POST /auth/device` with that secret returns a fresh JWT for the same player.
3. `POST /auth/recovery-code` (signed in) returns a code like `K7QM-2XWD-9TFB-HN4C`. The player writes it down. Only the newest code works.
4. On another device, `POST /auth/recover` with the code returns a JWT, a new `deviceSecret` and a replacement code. The code works once, and the old device secret stops working, so a lost device cannot sign in any more.

Only sha256 hashes of the secret and the code are stored. A test checks that no response holds a hash and no file on disk holds a raw value. Codes have 16 characters from a 31-symbol alphabet without look-alike pairs, which is about 79 bits. Rate limits cover the sign-in routes per address.

In the web client, `?recover=<code>` moves a profile to the browser, and `?showcode=1` prints a new recovery code in the lobby text.

## Plain WebSocket Protocol

Clients without a Socket.IO library, such as Godot, connect to `ws://host:3000/ws` (`wss://` behind TLS). The events and payloads match the Socket.IO table above. Both transports share one `GameActions` service and one room hub, so players on either side share a match, and a chat line crosses from one transport to the other.

Every frame is one JSON text message: `{ "event": "...", "data": ..., "id": 1 }`. The `id` is optional. Any frame that carries one is a request, and the server answers it with `{ "event": "ack", "id": 1, "data": ... }`. A failed request has `{ "ok": false, "error": "..." }` in its ack. Without an `id`, the error arrives as an `exception` frame.

| Authentication | How |
|---|---|
| Header | `Authorization: Bearer <jwt>` on the upgrade request |
| Query | `/ws?token=<jwt>` for clients that cannot set headers |
| Frame | After connecting, send `{ "event": "auth", "data": { "token": "<jwt>" } }` within `WS_AUTH_TIMEOUT_MS` (5 s). This keeps the token out of URLs and proxy logs, so prefer it on the web |

A token that is present but invalid gets HTTP 401 at the upgrade. Code 4401 closes a socket that never authenticates, and code 1009 closes one that sends a frame over `WS_MAX_PAYLOAD_BYTES` (16 KB). The server pings every 30 seconds and drops silent peers, and it skips snapshots for a client with a large send backlog.

An untested sketch for Godot 4. It follows Godot's documented `WebSocketPeer` API, but no Godot client has run against this server yet [UNVERIFIED].

```gdscript
var peer := WebSocketPeer.new()
var next_id := 1

func connect_to_server(url: String, token: String) -> void:
    peer.connect_to_url(url)            # for example ws://192.168.1.20:3000/ws
    # After the state becomes STATE_OPEN, authenticate with a frame:
    send("auth", {"token": token})

func send(event: String, data: Dictionary = {}) -> int:
    var id := next_id
    next_id += 1
    peer.send_text(JSON.stringify({"event": event, "data": data, "id": id}))
    return id

func _process(_delta: float) -> void:
    peer.poll()
    while peer.get_available_packet_count() > 0:
        var frame: Dictionary = JSON.parse_string(peer.get_packet().get_string_from_utf8())
        match frame.event:
            "match:snapshot": pass      # frame.data.entities, frame.data.tick
            "ack": pass                 # frame.id matches the request
```

## Storage

Services talk to the abstract `DataStore`, so the driver is a configuration choice. Documents have a string `id`. Filters match top-level fields by equality.

| Driver | Where the data lives | Notes |
|---|---|---|
| `json` | One file, kept in memory | Atomic writes through a temp file. Use it for development and small deployments |
| `mongodb` | One collection per entity | The `id` is stored as `_id`. This is the main database when `MONGODB_URL` is set |
| `postgres` | One `documents` table with a `jsonb` column | Adding an entity field needs no migration. Meant for profiles, teams and guilds later |

`docker-compose.yml` starts Postgres, MongoDB, RabbitMQ or Redis on demand through profiles, for example `docker compose --profile mongodb up -d`. For a server, see `deploy/README.md`: a Dockerfile and a production stack with Caddy for TLS.

### The JSON File Is Always There

The server never needs a database to start. `ResilientStore` wraps MongoDB or PostgreSQL with the JSON file behind it.

- **Unreachable at start-up.** The database gets `STARTUP_WAIT_MS` to answer, because a container that booted a second ago is not down. After that the JSON file serves until the next restart, and the server does not retry in the background.
- **Failing during the run.** The first connection error switches the server to the JSON file for good, until the next restart, and the log says so. The file mirrors `players` and `matches` while the database works, both what this server writes and what it reads, so a fallback finds the players and the running matches. Replays are too big to mirror, so they are missing while the server runs on the file.
- **Coming back.** The run on the file remembers which documents it changed. At the next start with the database reachable, the server copies them over, and it fills an empty database from the file the first time it is used. Documents that only the database held are left alone.
- **Health.** `GET /api/health` shows `database.driver` (configured) next to `database.active`, and `degraded: true` while they differ. The reason is in the server log only, because the route is public.

PostgreSQL is not used for anything else yet. With another database as the main one, the server only checks at start-up whether `POSTGRES_URL` answers and reports it as `postgres.reachable`.

Several servers cannot share one JSON file, because each keeps its copy in memory. A fallback run is therefore per server: put `{hostname}` in `JSON_DB_PATH` when servers share a volume.

## Match Log and Resume

Every running match has a write-ahead log (`src/matchlog`). It holds the `started` event (seed, players, the fingerprint of the rules) and every command that the sim executed (humans and bots). It also holds the state hash every 20 ticks, a `resumed` marker after each restart and the `finished` event. A checkpoint (the sim state and the bots' memory) is saved at tick 20 and then every `CHECKPOINT_EVERY_TICKS`. The log is a replay, and because the sim is deterministic it is also enough to rebuild the match.

### Where the Log Goes

| Place | Role | When |
|---|---|---|
| Redis Stream, one per match (`<prefix>:match:<id>:events`) | Fast buffer. Redis answers in under a millisecond and persists with its append-only file | `REDIS_URL` set and reachable |
| MongoDB `match_events` (one collection, unique index on match and sequence number) and `match_checkpoints` | Long-lived store. A TTL index removes events after `EVENT_LOG_RETENTION_DAYS` | MongoDB reachable |
| NDJSON file per match in `EVENT_LOG_DIR` | Last resort, and a copy of every write while Redis has no MongoDB behind it | Always available |

Each flush goes to the first place that works: the Redis Stream, then MongoDB, then the file. A flusher moves the stream to MongoDB every second and trims the stream only after MongoDB holds the entries, so a restart of either one loses nothing. Reading merges all three places, so a log that an outage split across them still comes back whole, cut at the first gap. Five seconds pass before the server tries a failed place again. `GET /api/health` lists the places (`eventLog.tiers`) and the one that took the last write.

### Resuming

- **Resume.** At start-up the server rebuilds every match that the database lists as `running` and that no other server holds. It starts from the newest checkpoint, falls back to an older one and then to the seed, and applies the logged commands up to the last event. With unchanged rules it also checks each logged hash and bot decision. Clients rejoin on their own and carry on. The rebuild runs in the background, yields to the event loop every 200 ticks and does not delay listening.
- **Changed rules.** A deploy that changes the data files or the code of the sim or the bot gives the server a new fingerprint (`dataHash`, `codeHash`). A replay from the seed cannot reproduce the old match any more, so the match continues from its newest checkpoint and the new rules apply from there. The log records this as a `resumed` event with mode `checkpoint-changed`, and the replay saved at the end carries `reproducible: false`. A match younger than tick 20, or one whose checkpoints are off (`CHECKPOINT_EVERY_TICKS=0`), has nothing to continue from and ends as a draw.
- **Graceful stop.** `MATCH_ON_SHUTDOWN=resume` (the default) leaves matches running for the next start and gives their leases back at once. `end` draws them at once, as before.
- **Crash.** The log lacks the last `EVENT_LOG_FLUSH_MS` (100 ms), and the last hash can be up to a second older than the crash. A resumed match rewinds to its last event, so players can lose roughly one to one and a half seconds of play.
- **Refusal.** A match ends as a draw (`stopped`) when its log has no start event. The same happens when every way to rebuild it fails: a hash or a bot decision differs under unchanged rules, or no checkpoint exists under changed ones.
- **Cleanup.** After a match ends and its replay is saved, its log leaves Redis and the files unless `EVENT_LOG_KEEP_FINISHED=true`. MongoDB keeps the events for `EVENT_LOG_RETENTION_DAYS`.
- **Production.** The Docker image keeps the file copy in `/app/backend/data`, which the production Compose stack mounts as the `api-data` volume.

Verified with tests on real containers: the planner, the tiered writer and every sink; a resume after an edit of a data file and of the bot code; a torn last line, a tampered hash and a missing log. A Redis outage and a MongoDB outage, cut with a TCP proxy while events flow, left a log that the merged read put back together. A real `SIGKILL` of one of two servers in the production stack ended with the other server taking the match over within about ten seconds.

## Running Several Servers

One server needs nothing here. With `REDIS_URL` and `RABBITMQ_URL` set, any number of servers can share the running matches, which is how the server uses more than one core: run one process per core (`docker compose up -d --scale api=4`) behind the reverse proxy. The clients use WebSocket only, so the proxy needs no sticky sessions.

- **Who runs a match.** The server that receives `POST /matches/:id/start` runs it and takes a lease, the key `<prefix>:owner:<matchId>` in Redis, valid for `CLUSTER_LEASE_MS` and renewed three times per lease. A server that finds its lease gone or taken stops running the match. No Redis outage takes a match away from the server that holds it, because no other server can claim it either.
- **Commands.** A client sits on any server. A command for a local match is a direct call and costs nothing extra. A command for a match that another server runs becomes a request to the queue `luxcores.match.<id>.commands` with a direct reply-to, and the reply carries the same acknowledgement (`accepted`, `tick`, `reason`, `nextSeq`) that a local call gives. `match:join` and `POST /matches/:id/stop` work the same way. The queue has a five-second message lifetime and disappears a minute after its last consumer.
- **Snapshots and room events.** A server subscribes to the Redis channel of a match room while one of its clients is in the room, and the server that runs the match publishes only while another server is subscribed. A single server therefore publishes nothing.
- **Failover.** A server that stops, or dies, leaves running matches without a lease. Every server looks for such matches every `CLUSTER_ADOPT_EVERY_MS`, takes one and rebuilds it from the log. After a `docker kill` the other server needed about ten seconds, which is the lease lifetime plus one look. A graceful stop releases the leases, so the takeover is immediate.
- **Without the services.** No Redis means every match belongs to the one server. No RabbitMQ means commands reach only the matches of the server that holds the client, and a command for a match elsewhere is refused with a sentence that says so. Both are decided at start-up.

The load is spread by whichever server receives the start request. There is no placement by load yet, and no delta snapshots; both are listed in `docs/HANDOVER.md` under Capacity.

## Redis

A Redis 7 container is in both Compose files (a `redis` profile for development, a password-protected service with append-only persistence in `deploy/`). With `REDIS_URL` set, the server uses it for the match log buffer, the match leases and the room relay (see Match Log and Resume and Running Several Servers). Without it, or when it is unreachable at start-up, the server runs without it until the next restart. A connection that drops later reconnects by itself, and commands sent meanwhile fail at once instead of queueing, so the log falls back to MongoDB or the file. The client is `@redis/client` 6.3.0. Verified on a real container: every sink test, the lease tests, the relay tests and the outage tests through a cut proxy.

## RabbitMQ

With `RABBITMQ_URL` set, RabbitMQ does two jobs. It carries `match.started` and `match.finished` through a durable queue to a consumer in the same process, and a second node can join the same queue so that the consumers share the work. The consumer acknowledges each message by hand and rejects a failing message without a requeue, so one bad event cannot block the queue. It also holds one command queue per running match (see Running Several Servers).

Without `RABBITMQ_URL`, or when the broker does not answer within `STARTUP_WAIT_MS` at start-up, an in-process bus calls the same handler directly and the server runs on until the next restart. During the run, an event that the broker cannot take within two seconds goes to the in-process bus too, so a result is never lost to an outage. After start-up, the connections reconnect on their own.

## Testing

```bash
npm test           # unit and contract tests (Vitest)
npm run test:e2e   # REST, Socket.IO and Swagger against the real app
npm run lint
npm run typecheck
```

The end-to-end tests play a full 1v1 over real sockets and compare the server hash at tick 20 with the hash that the repo's own sim computes. Adapter contract tests run on the JSON file by default. Set these variables to run them, and the app tests, on real services:

```bash
TEST_POSTGRES_URL=postgres://luxcores:luxcores@localhost:5432/luxcores \
TEST_MONGODB_URL=mongodb://localhost:27017 \
TEST_RABBITMQ_URL=amqp://guest:guest@localhost:5672 \
TEST_REDIS_URL=redis://localhost:6379 \
npm test && npm run test:e2e
```

## Docker

Build the image from the repo root, because the server runs the repo's sim and serves the web client:

```bash
docker build -f backend/nodejs/Dockerfile -t luxcores-backend .
```

The image holds the compiled app, production dependencies, and the `src`, `data`, `assets` and `index.html` of the game, and it runs as the unprivileged `node` user. `deploy/` adds a production Compose stack for one VPS (API, PostgreSQL, RabbitMQ, Redis, Caddy with automatic TLS) and a guide.

## Shutdown

With `MATCH_ON_SHUTDOWN=resume` (the default), SIGTERM flushes the match logs and leaves live matches running for the next start. The rest of this section describes `MATCH_ON_SHUTDOWN=end`. On SIGTERM the server ends in three phases, in this order: live matches end and save their replays and results, the RabbitMQ publisher closes, and the database closes. A match that ends this way counts as a draw with the reason `stopped`. The `docker stop` grace period of 20 seconds is far more than it needs. Regression tests cover the order, including one on a real broker that hangs when the order is wrong.

## Limits and Next Steps

- Sign-in is a device guest. There are no passwords, no email, no refresh tokens and no way to list or revoke devices. A recovery code is the only way to move a profile, and it appears once, so a player who loses both the device and the code loses the profile.
- Snapshots carry every entity. Fog of war and delta snapshots are post-MVP work (`docs/TECH_ARCHITECTURE.md` sections 6.2 and 13.1).
- A running match lives in the memory of one process. A restart or a crash hands it to a server that rebuilds it from its log (Match Log and Resume), and several servers share the matches (Running Several Servers), but one match never spreads over more than one core.
- Snapshots are not deltas yet, and a start request goes to whichever server receives it, with no placement by load.
- The JSON driver is the fallback. Use MongoDB when more than one process shares the data.
- `/src` serves the sim and client code, because the game page needs it. Nothing outside `src`, `data`, `assets` and `public` is reachable.
- A match ends in a draw at the tick limit (`MATCH_MAX_TICKS`, default `match.stalemateTicks`). Timed mode needs the score rule that comes with the economy milestone.
