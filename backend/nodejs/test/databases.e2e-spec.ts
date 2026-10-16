import pg from 'pg';
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
