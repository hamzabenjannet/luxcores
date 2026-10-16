import { resolve } from 'node:path';

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
  };
  static: { publicDir: string };
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
      matchMaxTicks: int(env.MATCH_MAX_TICKS, 12000),
      snapshotEveryTicks: int(env.SNAPSHOT_EVERY_TICKS, 2),
    },
    static: { publicDir: resolve(env.PUBLIC_DIR ?? 'public') },
    ws: {
      authTimeoutMs: int(env.WS_AUTH_TIMEOUT_MS, 5000),
      maxPayloadBytes: int(env.WS_MAX_PAYLOAD_BYTES, 16384),
    },
  };
};
