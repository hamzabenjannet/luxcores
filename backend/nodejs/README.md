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

| URL | What it serves |
|---|---|
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
| `DATABASE_DRIVER` | `json` | `json`, `mongodb` or `postgres` |
| `JSON_DB_PATH` | `data/db.json` | The JSON database file |
| `MONGODB_URL`, `MONGODB_DB` | none, `luxcores` | MongoDB connection |
| `POSTGRES_URL` | none | PostgreSQL connection string |
| `RABBITMQ_URL` | empty | Empty keeps events inside the process |
| `RABBITMQ_QUEUE`, `RABBITMQ_PREFETCH` | `luxcores.events`, `10` | Queue name and consumer prefetch |
| `LUXCORES_ROOT` | `../..` | Repo root with `src/sim`, `data/` and `index.html` |
| `PUBLIC_DIR` | `public` | Backend static folder |
| `MATCH_MAX_TICKS` | `12000` | A match ends after this many ticks (10 minutes at 20 Hz) |
| `SNAPSHOT_EVERY_TICKS` | `2` | Ticks between snapshots (10 per second) |

## Architecture

| Folder | Role |
|---|---|
| `src/config` | Typed settings and environment validation |
| `src/common` | The global JWT guard, the API key guard, `ParseSeedPipe`, the error filter and shared DTOs |
| `src/database` | The `DataStore` contract and its three adapters |
| `src/simulation` | `SimService`: loads `src/sim` and `data/*.json` at start-up |
| `src/auth`, `src/players` | Guest sign-in, profiles, leaderboard |
| `src/matches` | Lobby rules and match persistence |
| `src/game` | Match runner, Socket.IO gateway, start and stop routes, spec and map routes |
| `src/replays` | Replay storage and server-side verification |
| `src/events` | `EventBus` with a RabbitMQ and an in-process implementation |
| `src/admin`, `src/health`, `src/static` | Operator routes, liveness, static files |

### Match Flow

1. A player signs in as a guest and opens a lobby (`POST /api/matches`). The host takes team 0.
2. A second player joins, or the host asks for a bot (`vsBot`).
3. Both clients connect to the `/game` socket namespace and join the match room.
4. The host starts the match. `MatchRunnerService` creates the sim state from the match seed and ticks it at 20 Hz from a self-correcting timer.
5. Clients send commands. The server stamps the tick and the player id itself, so a client cannot act for another player. As in the browser, the sim drops invalid commands.
6. Every `SNAPSHOT_EVERY_TICKS` ticks the room receives a snapshot. A state `hash` rides along every 20 ticks, so a client that also simulates can detect drift.
7. A victory, a draw or `MATCH_MAX_TICKS` ends the match. Then the server saves the replay, updates the match and publishes `match.finished`, and the consumer applies the result to the player profiles.

## REST Routes

All routes live under `/api`. A route needs `Authorization: Bearer <token>` unless the Auth column says otherwise.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /auth/guest` | public | Create a guest profile and get a token |
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
| `match:snapshot` | server to room | `{ matchId, tick, hash?, teams, entities }` |
| `match:ended` | server to room | `{ matchId, endedTick, result, replayId }` |

`GET /api/game/spec` lists the same events in machine-readable form, and the Swagger schemas include their payload DTOs.

## Storage

Services talk to the abstract `DataStore`, so the driver is a configuration choice. Documents have a string `id`. Filters match top-level fields by equality.

| Driver | Where the data lives | Notes |
|---|---|---|
| `json` | One file, kept in memory | Atomic writes through a temp file. Use it for development and small deployments |
| `mongodb` | One collection per entity | The `id` is stored as `_id` |
| `postgres` | One `documents` table with a `jsonb` column | Adding an entity field needs no migration |

`docker-compose.yml` starts Postgres, MongoDB or RabbitMQ on demand through profiles, for example `docker compose --profile postgres up -d`.

## RabbitMQ

With `RABBITMQ_URL` set, the server publishes `match.started` and `match.finished` to a durable queue, and a consumer in the same process handles them. A second node can join the same queue, and the consumers then share the work. The consumer acknowledges each message by hand and rejects a failing message without a requeue, so one bad event cannot block the queue. Start-up fails with exit code 1 when the broker is unreachable. After start-up, both sides reconnect on their own.

Without `RABBITMQ_URL`, an in-process bus calls the same handler directly. A single-node setup needs no broker.

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
npm test && npm run test:e2e
```

## Limits and Next Steps

- Sign-in is guest only. There are no passwords, no refresh tokens and no rate limiting yet.
- Snapshots carry every entity. Fog of war and delta snapshots are post-MVP work (`docs/TECH_ARCHITECTURE.md` sections 6.2 and 13.1).
- A running match lives in the memory of one process, and a restart ends it. Scaling out needs sticky routing or a shared match registry.
- The JSON driver suits development. Use Postgres or MongoDB when more than one process shares the data.
- `/src` serves the sim and client code, because the game page needs it. Nothing outside `src`, `data`, `assets` and `public` is reachable.
- A match ends in a draw at `MATCH_MAX_TICKS`. Timed mode needs the score rule that comes with the economy milestone.
