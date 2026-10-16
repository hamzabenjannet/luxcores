# Handover: Backend, Labels and Project Memory

Describes the repo at commit `a3cf86c` (2026-10-16). Read `docs/HANDOVER.md` for the live status and `backend/nodejs/README.md` for the backend reference.

## Done in This Session

- Removed the black hole (`9e884cc`), made glow-as-health history, froze `SPEC_VERSION` at 0.10.0, added tiers and a test gate to `tools/check_style.py`, committed the Godot project `vone/`.
- Tracked `docs/prompts/` (`eb63f89`) and recorded the owners' prompts there.
- Added name labels under every entity and map marker (`f9bcdfa`).
- Added the NestJS multiplayer backend (`75badef`).

## Verified

| Claim | How |
|---|---|
| Root suite passes: 42 tests, headless hash `e626db0e` for seed 1234567 at 12 000 ticks | `npm test`, `npm run headless` |
| Backend passes without services: 34 unit tests (12 skipped), 33 end-to-end tests (3 skipped) | `npm test` and `npm run test:e2e` in `backend/nodejs` |
| Backend passes with real services: 46 unit and contract tests, 36 end-to-end tests, twice in a row | Postgres 16, MongoDB 7.0 and RabbitMQ 3.13 containers on local Docker Desktop, with `TEST_*_URL` set |
| Server hash at tick 20 equals the sim hash computed in Node | `test/multiplayer.e2e-spec.ts` |
| Chromium and Node agree on the tick-120 hash `a3dbf89c` | `npm run test:e2e` at the repo root |
| The compose RabbitMQ service starts and passes its test | `docker compose --profile rabbitmq up` |
| An unreachable broker stops the server with exit code 1 | Run by hand with `RABBITMQ_URL=amqp://guest:secret@localhost:1` |

## Not Verified

- [UNVERIFIED] Behavior on Docker hosts other than this Mac. The `user: rabbitmq` setting in `docker-compose.yml` fixed a start-up crash here ("eacces" on `.erlang.cookie`); other hosts may not need it.
- [UNVERIFIED] The Postgres and MongoDB compose services themselves. The same images ran through `docker run` for the tests, not through compose.
- [UNVERIFIED] Load: how many simultaneous matches one process runs at 20 Hz. No benchmark exists.
- [UNVERIFIED] Any phone or LAN test of `/` served by the backend. The route was checked with `fetch` and curl only.

## Open Questions for the Owners

Answered in `2026-10-16-backend-decisions.md`: a networked web client first, then a plain WebSocket gateway for Godot, a device guest with a recovery code, and a VPS with Docker Compose.

## Knowledge Worth Keeping

- NestJS 12 is ESM-first (`"type": "module"`, `nodenext`, `.js` suffixes in imports) and its CLI generates a Vitest setup. The decorator metadata that dependency injection needs works under Vitest.
- `ServeStaticModule` picks its loader while providers are built. Under `Test.createTestingModule().compile()` the HTTP adapter does not exist yet, so it silently serves nothing. Boot end-to-end tests with `NestFactory.create`.
- Nest's `ClientProxy.close()` hung against RabbitMQ 3.13. Publishing through `amqp-connection-manager` closes in milliseconds.
- Nest's RabbitMQ server retries for ever when the broker is down, so `main.ts` probes the broker first and exits.
- `Test` modules and `@UsePipes` on gateways: the global `ValidationPipe` also runs on socket events. The `WsErrorFilter` turns its errors into ack replies.
