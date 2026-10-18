# Deploying to One VPS

This folder runs the whole backend on a single Linux server with Docker Compose: the API, PostgreSQL, RabbitMQ, Redis and Caddy, which gets and renews a TLS certificate by itself. Only Caddy publishes ports (80 and 443). The database, the broker and Redis stay on the internal network. Redis is not used by the server yet.

Matches live in the memory of the API process, so run one API container. A second one would need sticky routing and a shared match registry.

## Before You Start

- A server with Docker and the Compose plugin. The stack is small, but how much memory and CPU a given number of simultaneous matches needs has not been measured [UNVERIFIED].
- A domain name with an A record that points at the server. Caddy needs it to get a certificate, so create it before the first start.
- Ports 80 and 443 open in the firewall. Port 443 also needs UDP for HTTP/3.

## First Start

```bash
git clone <repo-url> luxcores && cd luxcores/backend/nodejs/deploy
cp .env.example .env
# Fill in .env: DOMAIN, and one fresh value per secret from `openssl rand -base64 36`
docker compose up -d --build
docker compose ps            # every service should be healthy or running
curl https://your.domain/api/health
```

Compose stops with a clear message when a secret is missing. The image build uses the repo root as its context, so the clone must be complete: the server runs the repo's `src/sim` and serves the web client.

Open `https://your.domain/` for the game page and `https://your.domain/api/docs` for the API. A client connects to `wss://your.domain/ws` (plain WebSocket) or to the `/game` Socket.IO namespace.

## Day-to-Day

| Task | Command |
|---|---|
| Follow the API logs | `docker compose logs -f api` |
| Update to a new version | `git pull && docker compose up -d --build` |
| Restart the API only | `docker compose restart api` |
| Stop everything | `docker compose down` (add `-v` to delete the data) |

A restart ends the live matches. The server saves each one with its replay and counts it as a draw. The result waits in a durable queue, so the stats reach the players when the API is back. Plan updates for a quiet moment all the same.

## Backups

Everything worth keeping lives in PostgreSQL: profiles, matches and replays. A recovery code or a device secret cannot be reissued from the database, because only hashes are stored.

```bash
docker compose exec -T postgres pg_dump -U luxcores luxcores | gzip > luxcores-$(date +%F).sql.gz
```

Restore into an empty database with `gunzip -c file.sql.gz | docker compose exec -T postgres psql -U luxcores luxcores`. Keep the Caddy volume (`caddy-data`) too. Without it, Caddy requests new certificates and may hit the issuer's rate limits.

## What Is Verified

On a Mac with Docker Desktop, the full stack came up with `DOMAIN=localhost` and passed these checks through Caddy's local TLS:

- health with Postgres and RabbitMQ, the game page and Swagger
- guest and device sign-in
- a bot match over both transports on `wss://`, with identical hashes
- the stats path through RabbitMQ into Postgres, and replay verification
- the admin route
- a stop of the API with a live match

A real public certificate, a public domain, a Linux host and any load are not verified [UNVERIFIED].

## Security Notes

- Keep `.env` out of git (this folder ignores it) and give it mode 600.
- `ADMIN_API_KEY` opens `/api/admin`. Anyone who has it can read counts and delete replays, so treat it like a password.
- `TRUST_PROXY=1` is set because Caddy is the only proxy. If another proxy or a CDN sits in front of Caddy, raise the number to match, or the rate limiter counts the wrong address.
- `/src`, `/data` and `/assets` are public on purpose, because the game page loads them.
- The RabbitMQ management UI is not enabled. Add it only behind the proxy with authentication.
