import { dirname, join, resolve } from 'node:path';

export type DatabaseDriver = 'json' | 'mongodb' | 'postgres';

/** Typed shape of the settings that the rest of the app reads. */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  corsOrigin: string;
  jwt: { secret: string; expiresIn: string };
  adminApiKey: string;
  database: {
    driver: DatabaseDriver;
    jsonPath: string;
    mongoUrl: string;
    mongoDb: string;
    postgresUrl: string;
  };
  /** An empty `url` turns RabbitMQ off and the app uses an in-process event bus. */
  rabbitmq: { url: string; queue: string; prefetch: number };
  game: {
    /** Repo root that holds `src/sim`, `data` and the web client. */
    repoRoot: string;
    matchMaxTicks: number;
    snapshotEveryTicks: number;
    /** What a graceful shutdown does to live matches: `resume` keeps them for the next start, `end` draws them. */
    onShutdown: 'resume' | 'end';
  };
  /** The write-ahead log of every running match (see `src/matchlog`). */
  eventLog: { dir: string; flushMs: number; keepFinished: boolean };
  static: { publicDir: string };
  rateLimit: { perMinute: number; authPerMinute: number };
  /** Reverse proxies in front of the app. The client address then comes from X-Forwarded-For. */
  trustProxy: number;
  /** Plain WebSocket at /ws. */
  ws: { authTimeoutMs: number; maxPayloadBytes: number };
}

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
    jwt: {
      secret: env.JWT_SECRET ?? (isProd ? '' : 'dev-only-secret-change-me'),
      expiresIn: env.JWT_EXPIRES_IN ?? '12h',
    },
    adminApiKey: env.ADMIN_API_KEY ?? (isProd ? '' : 'dev-admin-key'),
    database: {
      driver: (env.DATABASE_DRIVER as DatabaseDriver | undefined) ?? 'json',
      jsonPath: resolve(env.JSON_DB_PATH ?? 'data/db.json'),
      mongoUrl: env.MONGODB_URL ?? '',
      mongoDb: env.MONGODB_DB ?? 'luxcores',
      postgresUrl: env.POSTGRES_URL ?? '',
    },
    rabbitmq: {
      url: env.RABBITMQ_URL ?? '',
      queue: env.RABBITMQ_QUEUE ?? 'luxcores.events',
      prefetch: int(env.RABBITMQ_PREFETCH, 10),
    },
    game: {
      repoRoot: resolve(env.LUXCORES_ROOT ?? '../..'),
      // 0 means the default in data/balance.json (match.stalemateTicks); MATCH_MAX_TICKS overrides it.
      matchMaxTicks: int(env.MATCH_MAX_TICKS, 0),
      snapshotEveryTicks: int(env.SNAPSHOT_EVERY_TICKS, 2),
      onShutdown: env.MATCH_ON_SHUTDOWN === 'end' ? 'end' : 'resume',
    },
    eventLog: {
      // Next to the JSON database by default, so one data folder holds all server state.
      dir: resolve(env.EVENT_LOG_DIR ?? join(dirname(resolve(env.JSON_DB_PATH ?? 'data/db.json')), 'events')),
      flushMs: int(env.EVENT_LOG_FLUSH_MS, 100),
      keepFinished: env.EVENT_LOG_KEEP_FINISHED === 'true',
    },
    static: { publicDir: resolve(env.PUBLIC_DIR ?? 'public') },
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
