import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { DatabaseDriver } from '../database/data-store.js';

export type { DatabaseDriver };
/** `auto` picks MongoDB when `MONGODB_URL` is set and the JSON file otherwise. */
export type DatabaseChoice = DatabaseDriver | 'auto';

/** Typed shape of the settings that the rest of the app reads. */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  corsOrigin: string;
  /** Milliseconds a service (MongoDB, Redis, RabbitMQ, PostgreSQL) gets to answer at start-up before the server runs without it until the next restart. */
  startupWaitMs: number;
  jwt: { secret: string; expiresIn: string };
  adminApiKey: string;
  database: {
    driver: DatabaseChoice;
    jsonPath: string;
    /** Milliseconds to wait for a database before the server falls back to the JSON file. */
    timeoutMs: number;
    mongoUrl: string;
    mongoDb: string;
    postgresUrl: string;
  };
  /** An empty `url` turns Redis off. It buffers the match log and carries match ownership and cross-node fan-out. */
  redis: { url: string; timeoutMs: number; prefix: string };
  /** An empty `url` turns RabbitMQ off and the app uses an in-process event bus. */
  rabbitmq: { url: string; queue: string; prefetch: number; timeoutMs: number };
  game: {
    /** Repo root that holds `src/sim`, `data` and the web client. */
    repoRoot: string;
    matchMaxTicks: number;
    snapshotEveryTicks: number;
    /** Ticks between two checkpoints of a running match, a multiple of 20. 0 turns checkpoints off. */
    checkpointEveryTicks: number;
    /** Seconds a running match may have nobody connected before the server stops it as a draw. 0 turns it off. */
    abandonSeconds: number;
    /** What a graceful shutdown does to live matches: `resume` keeps them for the next start, `end` draws them. */
    onShutdown: 'resume' | 'end';
  };
  /** How several servers share the matches. A lone server ignores all of it. */
  cluster: {
    /** Names this server in the match leases. Unique per running server. */
    nodeId: string;
    /** Milliseconds a match lease lasts without renewal. A node that dies loses its matches after this long. */
    leaseMs: number;
    /** Milliseconds between two looks for running matches that no node holds. 0 turns the look off. */
    adoptEveryMs: number;
    /** `auto` runs the commands of a local match directly. `queue` sends them through the command bus even then. */
    commandTransport: 'auto' | 'queue';
    /** Milliseconds a request to another node may take. */
    rpcTimeoutMs: number;
  };
  /** The write-ahead log of every running match (see `src/matchlog`). */
  eventLog: {
    dir: string;
    flushMs: number;
    keepFinished: boolean;
    /** Days a finished match keeps its events in MongoDB. 0 deletes them when the match ends. */
    retentionDays: number;
  };
  static: { publicDir: string };
  /** Whether `/tests` and `GET /api/dev/links` answer. They list the addresses of the server, so production turns them off by default. */
  testHub: boolean;
  rateLimit: { perMinute: number; authPerMinute: number };
  /** Reverse proxies in front of the app. The client address then comes from X-Forwarded-For. */
  trustProxy: number;
  /** Plain WebSocket at /ws. */
  ws: { authTimeoutMs: number; maxPayloadBytes: number };
}

/**
 * Replaces `{hostname}` in a path. Servers that share a volume then keep a JSON file each: one file
 * cannot be shared by two processes, because each keeps its copy in memory.
 */
const expand = (path: string): string => path.replaceAll('{hostname}', hostname());

const int = (value: string | undefined, fallback: number): number =>
  value === undefined || value === '' ? fallback : Number(value);

/**
 * Reads `process.env` once `ConfigModule` has loaded `.env`. The defaults suit local
 * development. `validateEnv` rejects bad values and, in production, missing secrets.
 */
export default (): AppConfig => {
  const env = process.env;
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  return {
    nodeEnv,
    port: int(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN ?? '*',
    startupWaitMs: int(env.STARTUP_WAIT_MS, 6000),
    jwt: {
      secret: env.JWT_SECRET ?? (isProd ? '' : 'dev-only-secret-change-me'),
      expiresIn: env.JWT_EXPIRES_IN ?? '12h',
    },
    adminApiKey: env.ADMIN_API_KEY ?? (isProd ? '' : 'dev-admin-key'),
    database: {
      driver: (env.DATABASE_DRIVER as DatabaseChoice | undefined) ?? 'auto',
      jsonPath: resolve(expand(env.JSON_DB_PATH ?? 'data/db.json')),
      timeoutMs: int(env.DATABASE_TIMEOUT_MS, 3000),
      mongoUrl: env.MONGODB_URL ?? '',
      mongoDb: env.MONGODB_DB ?? 'luxcores',
      postgresUrl: env.POSTGRES_URL ?? '',
    },
    redis: { url: env.REDIS_URL ?? '', timeoutMs: int(env.REDIS_TIMEOUT_MS, 3000), prefix: env.REDIS_KEY_PREFIX ?? 'lux' },
    rabbitmq: {
      url: env.RABBITMQ_URL ?? '',
      queue: env.RABBITMQ_QUEUE ?? 'luxcores.events',
      prefetch: int(env.RABBITMQ_PREFETCH, 10),
      timeoutMs: int(env.RABBITMQ_TIMEOUT_MS, 5000),
    },
    game: {
      repoRoot: resolve(env.LUXCORES_ROOT ?? '../..'),
      // 0 means the default in data/balance.json (match.stalemateTicks); MATCH_MAX_TICKS overrides it.
      matchMaxTicks: int(env.MATCH_MAX_TICKS, 0),
      snapshotEveryTicks: int(env.SNAPSHOT_EVERY_TICKS, 2),
      checkpointEveryTicks: int(env.CHECKPOINT_EVERY_TICKS, 400),
      abandonSeconds: int(env.MATCH_ABANDON_SECONDS, 120),
      onShutdown: env.MATCH_ON_SHUTDOWN === 'end' ? 'end' : 'resume',
    },
    cluster: {
      nodeId: env.NODE_ID ?? `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`,
      leaseMs: int(env.CLUSTER_LEASE_MS, 10_000),
      adoptEveryMs: int(env.CLUSTER_ADOPT_EVERY_MS, 3000),
      commandTransport: env.COMMAND_TRANSPORT === 'queue' ? 'queue' : 'auto',
      rpcTimeoutMs: int(env.CLUSTER_RPC_TIMEOUT_MS, 1500),
    },
    eventLog: {
      // Next to the JSON database by default, so one data folder holds all server state.
      dir: resolve(env.EVENT_LOG_DIR ?? join(dirname(resolve(expand(env.JSON_DB_PATH ?? 'data/db.json'))), 'events')),
      flushMs: int(env.EVENT_LOG_FLUSH_MS, 100),
      keepFinished: env.EVENT_LOG_KEEP_FINISHED === 'true',
      retentionDays: int(env.EVENT_LOG_RETENTION_DAYS, 14),
    },
    static: { publicDir: resolve(env.PUBLIC_DIR ?? 'public') },
    testHub: env.TEST_HUB === undefined ? !isProd : env.TEST_HUB === 'true',
    rateLimit: {
      perMinute: int(env.RATE_LIMIT_PER_MINUTE, 300),
      authPerMinute: int(env.RATE_LIMIT_AUTH_PER_MINUTE, 10),
    },
    trustProxy: int(env.TRUST_PROXY, 0),
    ws: {
      authTimeoutMs: int(env.WS_AUTH_TIMEOUT_MS, 5000),
      maxPayloadBytes: int(env.WS_MAX_PAYLOAD_BYTES, 16384),
    },
  };
};
