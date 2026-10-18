# Handover: Architecture Phases B to E and Resume Across Edits

Describes the state after the commits from `45251cf` (sim checkpoints) to the commit that adds this file. `docs/HANDOVER.md` holds the live status, and `backend/nodejs/README.md` the settings and the behavior.

## What Changed

- **Checkpoints.** `src/sim/checkpoint.js` saves the sim state without the data files and the visibility cache, and the bots save their memory (`saveState`, `loadState`). The runner logs a checkpoint at tick 20 and every `CHECKPOINT_EVERY_TICKS` (400). A resume starts from the newest one. When the data files or the code of the sim or the bot changed, the match continues from the checkpoint under the new rules and its replay is flagged `reproducible: false`. A throwing tick now ends one match instead of the process.
- **Storage (phase B).** `DATABASE_DRIVER=auto` is the default: MongoDB if `MONGODB_URL` is set, otherwise the JSON file. `ResilientStore` falls back to the JSON file when the chosen database is unreachable at start-up (after `STARTUP_WAIT_MS`) or fails during the run, and stays there until the next restart, as the owner decided. The file mirrors players and matches (what the server writes and reads), remembers what a fallback run changed, and the next start copies it back. PostgreSQL is only probed.
- **Match log (phase C).** `TieredEventLog` writes to a Redis Stream per match, else MongoDB, else files, and a flusher moves the stream to MongoDB (`match_events` with a TTL, `match_checkpoints`). Reads merge the three places. Without MongoDB, every write also goes to a file.
- **Command queues (phase D).** `RabbitCommandBus`: one queue per match, requests with a direct reply-to. The event bus now falls back to the in-process bus at start-up and during the run.
- **Several servers (phase E).** `RedisOwnership` leases, adoption of orphaned matches, `ClusterService` for join, command and stop on a remote match, `RoomRelay` over Redis Pub/Sub. Keys take `REDIS_KEY_PREFIX`.
- **Deploy.** The production stack gains MongoDB and uses Redis, RabbitMQ with an AMQP-level health check, and supports `--scale api=N`.

## Verified

- 135 backend unit tests and 88 end-to-end tests pass twice in a row against real MongoDB 7.0, Redis 7, RabbitMQ 3.13 and PostgreSQL 16 containers. Without the services, 93 and 75 pass and the rest skip. Root: 162 tests, and 11 end-to-end tests including Godot (63 parity and 44 live checks) and the real `SIGKILL` resume.
- Outages were made by cutting a TCP proxy while the system ran: Redis, MongoDB and RabbitMQ each. One test found a real bug, a failed bulk insert with no per-document errors that the Mongo sink took for a duplicate.
- Production stack on Docker Desktop with two API containers: cross-server join and command, `docker kill` of the owner and takeover within about ten seconds, `docker stop` of MongoDB with the match running on the JSON file, and the copy back after the restart. `mongodump` and `mongorestore` from the deploy README work.

## Decisions I Made Without Asking

- Redis Pub/Sub, not the Socket.IO Redis Streams adapter, carries room events between servers. It serves the plain WebSocket gateway too, needs no second dependency and is the lowest latency. It keeps no history.
- A service that is down at start-up stays off until the next restart, as the owner said for MongoDB, and the same rule holds for Redis and RabbitMQ. A short start-up window (`STARTUP_WAIT_MS`, 6 s) covers a container that is still booting. A real run showed why: both API containers gave up on a RabbitMQ that had been healthy for a second.
- A Redis outage never takes a match from the server that holds it. The lease is lost only when Redis answers that another server has it.
- The public health route shows counts and booleans, not match ids or error messages.
- The first checkpoint comes at tick 20, so a change of rules loses only a match younger than one second.
- A new dependency, `@redis/client` 6.3.0, approved by Hamza. Hamza later ruled that his approval is enough for infrastructure dependencies; Hama decides graphics and user experience.

## Not Verified

- Three or more servers, a Linux host, managed Redis or MongoDB, a network partition between one server and Redis, and any load beyond the single benchmark in `docs/HANDOVER.md`.
- A real phone, and a Godot export. The Godot default server URL in `vone/scripts/main.gd` and `vone/tests/live_match.gd` has local edits that are not mine and are not committed.
- 5v5 capacity. Delta snapshots and placement by load are not built.

## Open for the Owners

- Deferred by Hamza: delta, fog-filtered snapshots and placement by load, which the 100-match target needs. They change the protocol of both clients.
- Then M5 (heroes).
