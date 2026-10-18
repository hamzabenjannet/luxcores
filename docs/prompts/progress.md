# Progress Log

Newest first. One entry per milestone or notable change. Add the commit hash and the verification, not just the intent.

## 2026-10-18: Web and Godot Clients Aligned at M3

- `d7f018d` A server-run test bot, bot-vs-bot lobbies, spectators, and combat fields in snapshots. `6f37669` The web client plays only through the server, with a menu, build controls and M3 visuals. `ccb16a9` Godot client at M3 with shared parity cases. A later commit adds the menu click-through test.
- Verified: Chromium and Node agree on the idle and the bot hash. A 100-seed bot soak passes, and so do the Godot parity (44 checks) and live (22 checks) tests. Nine browser and Godot tests pass in one sequential run, and `docs/HANDOVER.md` has the counts.
- Next: M4 (creeps), built in both clients together. See `handover-2026-10-18-alignment.md` for the workflow and the open items.

## 2026-10-16: Transports, Accounts, Deployment and M2

- `5f5b0e8` Plain WebSocket gateway. `db3274e` Device guests, recovery codes, rate limits. `9fe4ec5` Shutdown order fix. `21a64ec` Dockerfile and production stack.
- `163b77c` M2 economy done: collectors, day/night, the 2 s buffer, spend rule, placement, recycle, entropy, meltdown, victory. `1942561` Placeholder boxes for buildings and the economy over the server.
- Next: M3 (combat and physics). Open design question for the owners: a meltdown cannot kill a Core (`docs/HANDOVER.md`).

## 2026-10-16: Networked Web Client

- Two browsers play one server match: `?server=` mode in `src/client/main.js`, `net/server-session.js`, `networkWorldView`, and `test/e2e/network.e2e.js`. Both pages receive the sim hashes at ticks 20 and 40 (`66b9dd40`, `a698130c` for seed 1234567).
- Decisions for what follows are in `2026-10-16-backend-decisions.md`.

## 2026-10-16: Multiplayer Backend

- `75badef` NestJS 12 server in `backend/nodejs`: REST, Socket.IO, server-authoritative match runner, replays with verify, Swagger, JSON, MongoDB and PostgreSQL storage, optional RabbitMQ events.
- `f9bcdfa` Name labels under every entity and map marker.
- `eb63f89` `docs/prompts/` tracked as the project memory folder.
- Next: a networked client that talks to this server (see `docs/HANDOVER.md`), then M2 economy.

## 2026-10-16: M1 Closed and Review Decisions

- `9e884cc` Black hole removed. `87011b0` Glow-as-health dropped, Core max HP rises, `SPEC_VERSION` frozen at 0.10.0. `81abe1b` Style checker tiers and test gate. `c17190a` Godot project `vone/` committed.
- `5babb4d` M1 (map generation) done: `3c3888e` generator, `3b06813` golden replay, `0ccd9cb` placeholder rendering, `19bee00` Chromium smoke test.
