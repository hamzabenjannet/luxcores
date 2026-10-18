import { withinWindow } from '../common/startup-wait.js';

/** Injection token for the result of the start-up check of PostgreSQL. */
export const POSTGRES_PROBE = 'POSTGRES_PROBE';

export interface PostgresProbe {
  /** True when `POSTGRES_URL` is set. */
  configured: boolean;
  /** True when a connection and `SELECT 1` worked at start-up. */
  reachable: boolean;
}

/**
 * Tries to reach PostgreSQL once and reports. The server does not need it yet (user profiles,
 * teams and guilds will), so an unreachable database only shows up in the logs and on the health route.
 */
export async function probePostgres(url: string, timeoutMs: number, windowMs = 0): Promise<PostgresProbe> {
  if (!url) return { configured: false, reachable: false };
  const { default: pg } = await import('pg');
  try {
    await withinWindow(async () => {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
      client.on('error', () => undefined); // a connection that drops later must not end the process
      try {
        await client.connect();
        await client.query('SELECT 1');
      } finally {
        await client.end().catch(() => undefined);
      }
    }, windowMs);
    return { configured: true, reachable: true };
  } catch {
    return { configured: true, reachable: false };
  }
}
