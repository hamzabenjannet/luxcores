import pg from 'pg';
import { TcpProxy } from './helpers/tcp-proxy.js';
import { describe, expect, it } from 'vitest';
import { api, createTestApp, guest } from './helpers/create-app.js';

/**
 * Boots the whole app on MongoDB or PostgreSQL and runs a short lobby flow.
 * Runs only when `TEST_MONGODB_URL` or `TEST_POSTGRES_URL` is set. Each run uses
 * its own Mongo database and its own Postgres schema, so reruns start empty.
 */
async function run(driver: string, env: Record<string, string>) {
  const t = await createTestApp(env);
  try {
    // Credential lookups filter on a hashed field, so check them on every adapter.
    const signedIn = await api(t.url, '/api/auth/guest', {
      body: { name: 'Halo' },
    });
    const again = await api(t.url, '/api/auth/device', {
      body: { deviceSecret: signedIn.body.deviceSecret },
    });
    expect(again.body.player.id).toBe(signedIn.body.player.id);
    const code = (
      await api(t.url, '/api/auth/recovery-code', {
        method: 'POST',
        token: signedIn.body.accessToken,
      })
    ).body.recoveryCode;
    const recovered = await api(t.url, '/api/auth/recover', {
      body: { recoveryCode: code },
    });
    expect(recovered.body.player.id).toBe(signedIn.body.player.id);
    expect(
      (
        await api(t.url, '/api/auth/device', {
          body: { deviceSecret: signedIn.body.deviceSecret },
        })
      ).status,
    ).toBe(401);
    const halo = {
      token: recovered.body.accessToken,
      player: recovered.body.player,
    };

    const prism = await guest(t.url, 'Prism');
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Stored elsewhere', seed: 99 },
    });
    expect(created.status).toBe(201);
    const joined = await api(t.url, `/api/matches/${created.body.id}/join`, {
      method: 'POST',
      token: prism.token,
    });
    expect(joined.body.players).toHaveLength(2);

    const list = await api(t.url, '/api/matches?status=lobby&limit=5', {
      token: halo.token,
    });
    expect(list.body.items.map((m: { id: string }) => m.id)).toContain(
      created.body.id,
    );
    expect(
      (await api(t.url, '/api/players/me', { token: prism.token })).body.name,
    ).toBe('Prism');

    expect((await api(t.url, '/api/health')).body).toMatchObject({
      status: 'ok',
      database: { driver, ok: true },
    });
    const stats = await api(t.url, '/api/admin/stats', {
      headers: { 'x-api-key': 'test-admin-key-with-enough-length' },
    });
    expect(stats.body).toMatchObject({ players: 2, matches: 1 });
  } finally {
    await t.close();
  }
}

describe.skipIf(!process.env.TEST_MONGODB_URL)('app on mongodb', () => {
  it('serves a lobby flow and reports the driver', () =>
    run('mongodb', {
      DATABASE_DRIVER: 'mongodb',
      MONGODB_URL: process.env.TEST_MONGODB_URL as string,
      MONGODB_DB: `luxcores_e2e_${Date.now()}`,
    }));
});

describe.skipIf(!process.env.TEST_POSTGRES_URL)('app on postgres', () => {
  it('serves a lobby flow and reports the driver', async () => {
    const url = process.env.TEST_POSTGRES_URL as string;
    const schema = `luxcores_e2e_${Date.now()}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    try {
      const scoped = `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
      await run('postgres', {
        DATABASE_DRIVER: 'postgres',
        POSTGRES_URL: scoped,
      });
    } finally {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
});

describe('app with a database that is not there', () => {
  it('runs on the JSON file when MongoDB is unreachable, and says so on the health route', async () => {
    const t = await createTestApp({
      DATABASE_DRIVER: 'auto',
      MONGODB_URL: 'mongodb://127.0.0.1:1',
      DATABASE_TIMEOUT_MS: '500',
    });
    try {
      const halo = await guest(t.url, 'Halo');
      const created = await api(t.url, '/api/matches', { token: halo.token, body: { name: 'Offline', seed: 5 } });
      expect(created.status).toBe(201);
      expect((await api(t.url, '/api/health')).body).toMatchObject({
        status: 'ok',
        database: { driver: 'mongodb', active: 'json', degraded: true, ok: true },
      });
    } finally {
      await t.close();
    }
  });

  it('runs on the JSON file when PostgreSQL is unreachable', async () => {
    const t = await createTestApp({
      DATABASE_DRIVER: 'postgres',
      POSTGRES_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
      DATABASE_TIMEOUT_MS: '500',
    });
    try {
      await guest(t.url, 'Halo');
      expect((await api(t.url, '/api/health')).body).toMatchObject({
        database: { driver: 'postgres', active: 'json', degraded: true },
      });
    } finally {
      await t.close();
    }
  });

  it('only notes an unreachable PostgreSQL when another database is the main one', async () => {
    const t = await createTestApp({
      POSTGRES_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
      DATABASE_TIMEOUT_MS: '500',
    });
    try {
      expect((await api(t.url, '/api/health')).body).toMatchObject({
        database: { driver: 'json', active: 'json', degraded: false },
        postgres: { configured: true, reachable: false },
      });
    } finally {
      await t.close();
    }
  });

  it('picks MongoDB by itself when a URL is set and the driver is left on auto', async () => {
    const t = await createTestApp({ DATABASE_DRIVER: null, MONGODB_URL: 'mongodb://127.0.0.1:1', DATABASE_TIMEOUT_MS: '500' });
    try {
      expect((await api(t.url, '/api/health')).body.database).toMatchObject({ driver: 'mongodb', degraded: true });
    } finally {
      await t.close();
    }
  });
});

describe.skipIf(!process.env.TEST_MONGODB_URL)('a database that is still starting', () => {
  it('waits for MongoDB during the start-up window instead of giving up at once', async () => {
    const url = new URL(process.env.TEST_MONGODB_URL as string);
    const proxy = new TcpProxy(url.hostname, Number(url.port || 27017));
    const port = await proxy.start();
    await proxy.cut(); // closed now, open again in 1.5 seconds, as a container that boots
    setTimeout(() => void proxy.start(port), 1500);
    const t = await createTestApp({
      DATABASE_DRIVER: 'auto',
      MONGODB_URL: `mongodb://127.0.0.1:${port}/?directConnection=true`,
      MONGODB_DB: `luxcores_wait_${Date.now()}`,
      DATABASE_TIMEOUT_MS: '600',
      STARTUP_WAIT_MS: '8000',
    });
    try {
      expect((await api(t.url, '/api/health')).body.database).toMatchObject({ driver: 'mongodb', active: 'mongodb', degraded: false });
    } finally {
      await t.close();
      await proxy.stop();
    }
  }, 30_000);
});
