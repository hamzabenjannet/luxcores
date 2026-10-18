# Deploying to One VPS

This folder runs the whole backend on a single Linux server with Docker Compose: the API, MongoDB, Redis, RabbitMQ, PostgreSQL and Caddy, which gets and renews a TLS certificate by itself. Only Caddy publishes ports (80 and 443). The databases, Redis and the broker stay on the internal network.

Each service has a job and the API works without any of them. MongoDB is the main database and keeps the match events. Redis buffers the match log and holds the match leases. RabbitMQ carries one command queue per running match. PostgreSQL is only checked at start-up for now, because profiles, teams and guilds will use it later. When a service is down as the API starts, the API runs without it until its next restart, and the database falls back to a JSON file on the `api-data` volume.

A match runs in the memory of one API process. To use more than one core, run more API containers (`docker compose up -d --scale api=4`): they share the matches through Redis and RabbitMQ (`backend/nodejs/README.md`, Running Several Servers). Put `JSON_DB_PATH: /app/backend/data/db-{hostname}.json` under the `api` environment first, because two servers cannot share one JSON file.

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

A restart does not end the live matches. They stay running in the database, and the API rebuilds each one from its log (Redis, MongoDB and the volume) when it is back. Players lose about a second and their clients rejoin by themselves. An update that changes the rules, meaning the data files or the code of the sim or the bot, carries a match over from its newest checkpoint with the new rules, and the replay of that match is marked as not reproducible. A match younger than 20 ticks cannot be carried over and ends as a draw. With two or more API containers, a container that stops hands its matches to the others.

## Backups

Everything worth keeping lives in MongoDB: profiles, matches, replays and the match events. A recovery code or a device secret cannot be reissued from the database, because only hashes are stored.

```bash
docker compose exec -T mongodb mongodump -u luxcores -p "$MONGO_PASSWORD" --authenticationDatabase admin --db luxcores --archive --gzip > luxcores-$(date +%F).archive.gz
```

Restore into an empty database with `docker compose exec -T mongodb mongorestore -u luxcores -p "$MONGO_PASSWORD" --authenticationDatabase admin --archive --gzip < file.archive.gz`. The `api-data` volume holds the JSON fallback and the file copy of the match logs, and Redis holds the logs of running matches, so both are worth keeping across a redeploy. Keep the Caddy volume (`caddy-data`) too. Without it, Caddy requests new certificates and may hit the issuer's rate limits.

## What Is Verified

On a Mac with Docker Desktop, the full stack came up with `DOMAIN=localhost` and two API containers (`--scale api=2`). These checks ran against it, with a script that talks to both containers:

- health on both containers shows MongoDB as the database, the log going to Redis, the match leases on Redis and the command queues on RabbitMQ
- a client on the second container joins a match that the first one runs, gets live snapshots through Redis and sends a command through the match queue
- `docker kill` on the container that runs the match, then the other container takes the match over within about ten seconds, the client keeps its snapshots, and its next command number is accepted
- `docker stop` on MongoDB during the match: the surviving container falls back to the JSON file, the match keeps running, and it stops and saves normally
- a new player signs in on the JSON file during the outage
- after MongoDB is back and the container restarted, the log reports three documents copied to MongoDB, which then holds both players, the finished match, its replay and its events

The earlier checks through Caddy's local TLS (health, Swagger, guest and device sign-in, a bot match over both transports on `wss://` with identical hashes, replay verification, the admin route) ran on the previous stack with PostgreSQL as the database and have not been repeated. A real public certificate, a public domain, a Linux host and any load are not verified [UNVERIFIED].

## Security Notes

- Keep `.env` out of git (this folder ignores it) and give it mode 600.
- `ADMIN_API_KEY` opens `/api/admin`. Anyone who has it can read counts and delete replays, so treat it like a password.
- `TRUST_PROXY=1` is set because Caddy is the only proxy. If another proxy or a CDN sits in front of Caddy, raise the number to match, or the rate limiter counts the wrong address.
- `/src`, `/data` and `/assets` are public on purpose, because the game page loads them.
- `MONGO_PASSWORD` protects MongoDB, which is not published outside the Compose network.
- The RabbitMQ management UI is not enabled. Add it only behind the proxy with authentication.
