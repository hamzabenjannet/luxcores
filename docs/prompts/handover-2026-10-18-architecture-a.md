# Handover: Spacing, Tick Cap, Redis and Architecture Phase A

Describes the state after the commits `4606040` (sim), `122bf40` (Redis container) and the phase A commits that follow. `docs/HANDOVER.md` holds the live status, including the architecture plan and the capacity figures.

## What Changed

- **Sim.** Units never overlap. The old overlap pass skipped every pair where the static body had the lower id, so a creep walked through any older building. Group members walk in a grid with half a tile between edges, and a melee attacker stops a quarter tile short of contact. Both distances are data (`unitSpacingMilliTiles`, `meleeGapMilliTiles`). An undecided match ends as a draw at 10000 ticks (`match.stalemateTicks`, or `MATCH_MAX_TICKS`). The M4 rules are approved (GDD v0.9.7).
- **Redis.** A container in the dev and production Compose files, not used by the server yet.
- **Phase A.** `src/matchlog` (the `EventLog` port and an NDJSON file implementation), `SimService.rebuild`, automatic resume in the runner, `MATCH_ON_SHUTDOWN` (default `resume`), `nextSeq` on join and on a `seq` rejection, reconnect and rejoin in the web and Godot clients, an `api-data` volume in the production stack, and `determinism.html` in the Docker image (it was missing).

## Verified

- Backend: 6 new end-to-end tests (log content, rebuild with bot and command counter, torn last line, tampered hash, missing log, log cleanup). Two deliberate breaks of the rebuild each made a test fail.
- A real `SIGKILL` of the server, restart on the same port and folder, and a Chromium page that rejoined, saw its own and the bot's buildings, and had its next command accepted. It passed twice in a row.
- Godot closes its socket under itself, reconnects, rejoins and sends an accepted command (44 live checks).
- The production image resumes a match across `docker stop` and `docker start` on a volume. The production Redis service starts healthy and refuses a client without the password.
- The RabbitMQ end-to-end tests pass on a real broker after I changed their shutdown mode.

## Decisions I Made Without Asking

- The match log is its own port and its own file per match, not a collection in the JSON database, because the JSON store rewrites its whole file on every write.
- Graceful shutdown resumes matches by default. `MATCH_ON_SHUTDOWN=end` keeps the old behavior, and the old shutdown tests use it.
- A resumed match rewinds to its last logged event, so a crash can cost about a second of play. Commands lost in that window are lost.
- A match whose log is missing, empty or in disagreement with the sim ends as a draw with the reason `stopped`.
- A client that gets a `seq` rejection adopts the server's count and does not retry by itself.

## Not Verified

- A resume across a code or data change. It ends the match, which the tests show for a tampered hash, but I did not try a real data edit.
- MongoDB, PostgreSQL and the Redis stream in a running server. They are phases B and C.
- Load. The capacity numbers come from one machine and one 1v1 bot match, and the 5v5 figures are extrapolated.
- A real phone, and a Godot export.

## Open for the Owners

- Whether to treat the capacity figures as a reason to plan delta, fog-filtered snapshots and worker processes before phase E. I think yes.
- Phase B is next. It needs a MongoDB choice for the fallback order at start-up when Mongo is configured but down: fall back to the JSON file for the whole run, or keep retrying Mongo in the background. I would fall back and retry.
