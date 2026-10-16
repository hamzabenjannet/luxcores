# Progress Log

Newest first. One entry per milestone or notable change. Add the commit hash and the verification, not just the intent.

## 2026-10-16: Multiplayer Backend

- `75badef` NestJS 12 server in `backend/nodejs`: REST, Socket.IO, server-authoritative match runner, replays with verify, Swagger, JSON, MongoDB and PostgreSQL storage, optional RabbitMQ events.
- `f9bcdfa` Name labels under every entity and map marker.
- `eb63f89` `docs/prompts/` tracked as the project memory folder.
- Next: a networked client that talks to this server (see `docs/HANDOVER.md`), then M2 economy.

## 2026-10-16: M1 Closed and Review Decisions

- `9e884cc` Black hole removed. `87011b0` Glow-as-health dropped, Core max HP rises, `SPEC_VERSION` frozen at 0.10.0. `81abe1b` Style checker tiers and test gate. `c17190a` Godot project `vone/` committed.
- `5babb4d` M1 (map generation) done: `3c3888e` generator, `3b06813` golden replay, `0ccd9cb` placeholder rendering, `19bee00` Chromium smoke test.
