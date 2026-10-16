# Handover: WebSocket, Device Guests, Docker and M2

Describes the repo at commit `1942561` (2026-10-16). Read `docs/HANDOVER.md` for the live status.

## Done in This Session

| Commit | Change |
|---|---|
| `5f5b0e8` | Plain WebSocket gateway at `/ws` for Godot, on shared `GameActions` and `RoomHub` |
| `db3274e` | Device guests, recovery codes, rate limits, `TRUST_PROXY` |
| `9fe4ec5` | Shutdown order: matches end, then the broker closes, then the database |
| `21a64ec` | Dockerfile and a production stack (API, Postgres, RabbitMQ, Caddy) in `backend/nodejs/deploy` |
| `163b77c` | M2 economy in `src/sim`, 29 tests, two golden replays |
| `1942561` | Placeholder boxes for buildings, economy test over the server, browser test |

## Verified

| Claim | How |
|---|---|
| Root suite: 72 tests pass; headless hash `1790fc9a` for seed 1234567 at 12 000 ticks | `npm test`, `npm run headless` |
| Backend without services: 38 unit tests (12 skipped), 54 end-to-end tests (4 skipped) | `npm test`, `npm run test:e2e` in `backend/nodejs` |
| Backend on real Postgres 16, MongoDB 7.0 and RabbitMQ 3.13, after M2: 50 unit and contract tests, 58 end-to-end tests, none skipped | Docker containers with `TEST_*_URL` |
| Production stack through TLS (Caddy, local certificate), image rebuilt after M2: health, page, Swagger, device sign-in, a bot match over `wss://` and Socket.IO with equal hashes, stats through RabbitMQ into Postgres, replay verify, admin route. The clean stop with a live match was checked once, before M2 | A script against `docker compose up` with `DOMAIN=localhost` |
| Three browser tests (smoke, two players, device guest) agree with the sim | `npm run test:e2e` at the repo root |
| Five mutations of the economy rules each fail the tests | Edited the code, ran the tests, restored it |
| The RabbitMQ shutdown test hangs and fails with the old shutdown order | Mutation run on a real broker |

## Not Verified

- [UNVERIFIED] A public certificate, a public domain, a Linux host and any load.
- [UNVERIFIED] A Godot client against `/ws`. The GDScript sketch in the backend README follows the documented `WebSocketPeer` API but never ran.
- [UNVERIFIED] The Mongo and Postgres services of the dev `docker-compose.yml`. The same images ran through `docker run` for the tests, not through that file.

## Knowledge Worth Keeping

- Checkout files can have mode 700. `COPY` keeps that mode, so a container that runs as `node` cannot read them. The Dockerfile runs `chmod -R a+rX`.
- `npm ci` in `node:22-alpine` (npm 10) rejects a lock file that npm 11 wrote, when a dependency pins an old TypeScript range. Test the image build, not just local installs.
- Nest runs all `onModuleDestroy` hooks before any `beforeApplicationShutdown` hook, and those before `onApplicationShutdown`. Use the phases to order shutdown work: matches, then the broker, then the database.
- Nest re-raises SIGTERM after a graceful close, so a clean stop shows exit code 143.
- A meltdown cannot kill a Core in M2: a plant earns 600 lux and deals 400 damage. Tests that need a dead Core set `coreLux` directly.
- Two browser tabs in one profile share `localStorage`, so they are the same device guest. Two players need two browser profiles.
