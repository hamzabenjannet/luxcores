# Owner Decisions on the Backend

Session of 2026-10-16, after commit `fba1e06`. The owner asked for questions and a proposal for the next step, and chose the recommended option on all four. These are selected options, not the owner's own words.

| Question | Decision |
|---|---|
| What to build next | A networked web client: a second `WorldView` over server snapshots, so two browsers play one server match |
| How Godot connects | A plain WebSocket gateway beside Socket.IO, carrying the same events as JSON, so Godot uses its native `WebSocketPeer` with no addon |
| Accounts | A device guest with a recovery code: the profile persists on the device and a short code moves it to another one. No passwords or email yet |
| Hosting for playtests | One VPS with Docker Compose: a Dockerfile, a compose service with Postgres and RabbitMQ, and a reverse proxy with TLS |

## Order

1. Networked web client. Done in the commit that follows this note.
2. Plain WebSocket gateway for Godot.
3. Device guest with a recovery code.
4. Dockerfile and compose service for the VPS.

Items 2 to 4 are queued in `docs/HANDOVER.md`.
