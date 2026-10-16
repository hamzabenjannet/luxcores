import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, type TestApp } from './helpers/create-app.js';

describe('device guests and recovery codes', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const guest = async (name = 'Halo') =>
    (await api(t.url, '/api/auth/guest', { body: { name } })).body;

  it('gives a guest a device secret that signs the same player in again', async () => {
    const first = await guest('Halo');
    expect(first.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.recoveryCode).toBeUndefined();

    const again = await api(t.url, '/api/auth/device', {
      body: { deviceSecret: first.deviceSecret },
    });
    expect(again.status).toBe(200);
    expect(again.body.player.id).toBe(first.player.id);
    expect(again.body.deviceSecret).toBeUndefined(); // the secret is never repeated

    const me = await api(t.url, '/api/players/me', {
      token: again.body.accessToken,
    });
    expect(me.body.id).toBe(first.player.id);
  });

  it('keeps guests apart and rejects unknown or malformed secrets', async () => {
    const a = await guest('Alpha');
    const b = await guest('Bravo');
    expect(a.deviceSecret).not.toBe(b.deviceSecret);
    expect(
      (
        await api(t.url, '/api/auth/device', {
          body: { deviceSecret: b.deviceSecret },
        })
      ).body.player.name,
    ).toBe('Bravo');

    expect(
      (
        await api(t.url, '/api/auth/device', {
          body: { deviceSecret: 'x'.repeat(43) },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api(t.url, '/api/auth/device', {
          body: { deviceSecret: 'short' },
        })
      ).status,
    ).toBe(400);
    expect((await api(t.url, '/api/auth/device', { body: {} })).status).toBe(
      400,
    );
  });

  it('moves a profile to a new device with a recovery code', async () => {
    const old = await guest('Prism');
    expect(
      (
        await api(t.url, '/api/auth/recovery-code', {
          method: 'POST',
          body: undefined,
        })
      ).status,
    ).toBe(401); // needs a token

    const made = await api(t.url, '/api/auth/recovery-code', {
      method: 'POST',
      token: old.accessToken,
    });
    expect(made.status).toBe(201);
    const code: string = made.body.recoveryCode;
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);

    // Case and separators do not matter.
    const spaced = code.toLowerCase().replaceAll('-', ' ');
    const moved = await api(t.url, '/api/auth/recover', {
      body: { recoveryCode: spaced },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.player).toMatchObject({
      id: old.player.id,
      name: 'Prism',
    });
    expect(moved.body.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(moved.body.recoveryCode).toMatch(
      /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/,
    );
    expect(moved.body.recoveryCode).not.toBe(code);

    // The old device is cut off, the new one works, and the used code is dead.
    expect(
      (
        await api(t.url, '/api/auth/device', {
          body: { deviceSecret: old.deviceSecret },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api(t.url, '/api/auth/device', {
          body: { deviceSecret: moved.body.deviceSecret },
        })
      ).body.player.id,
    ).toBe(old.player.id);
    expect(
      (await api(t.url, '/api/auth/recover', { body: { recoveryCode: code } }))
        .status,
    ).toBe(401);

    // The replacement code works once more.
    const next = await api(t.url, '/api/auth/recover', {
      body: { recoveryCode: moved.body.recoveryCode },
    });
    expect(next.body.player.id).toBe(old.player.id);
  });

  it('lets only the newest recovery code work', async () => {
    const g = await guest('Flare');
    const first = (
      await api(t.url, '/api/auth/recovery-code', {
        method: 'POST',
        token: g.accessToken,
      })
    ).body.recoveryCode;
    const second = (
      await api(t.url, '/api/auth/recovery-code', {
        method: 'POST',
        token: g.accessToken,
      })
    ).body.recoveryCode;
    expect(
      (await api(t.url, '/api/auth/recover', { body: { recoveryCode: first } }))
        .status,
    ).toBe(401);
    expect(
      (
        await api(t.url, '/api/auth/recover', {
          body: { recoveryCode: second },
        })
      ).status,
    ).toBe(200);
  });

  it('rejects malformed and unknown recovery codes', async () => {
    for (const recoveryCode of [
      '',
      'short',
      '!!!!-!!!!-!!!!-!!!!',
      'A'.repeat(40),
    ]) {
      expect(
        (await api(t.url, '/api/auth/recover', { body: { recoveryCode } }))
          .status,
        recoveryCode,
      ).toBe(400);
    }
    expect(
      (
        await api(t.url, '/api/auth/recover', {
          body: { recoveryCode: 'AAAA-BBBB-CCCC-DDDD' },
        })
      ).status,
    ).toBe(401);
  });

  it('keeps stats, name and id across a recovery', async () => {
    const g = await guest('Corona');
    await api(t.url, '/api/players/me', {
      method: 'PATCH',
      token: g.accessToken,
      body: { name: 'Corona II' },
    });
    const code = (
      await api(t.url, '/api/auth/recovery-code', {
        method: 'POST',
        token: g.accessToken,
      })
    ).body.recoveryCode;
    const moved = await api(t.url, '/api/auth/recover', {
      body: { recoveryCode: code },
    });
    const me = await api(t.url, '/api/players/me', {
      token: moved.body.accessToken,
    });
    expect(me.body).toMatchObject({
      id: g.player.id,
      name: 'Corona II',
      stats: { matchesPlayed: 0 },
    });
  });

  it('never exposes a secret, a code or a hash', async () => {
    const g = await guest('Quiet');
    const code = (
      await api(t.url, '/api/auth/recovery-code', {
        method: 'POST',
        token: g.accessToken,
      })
    ).body.recoveryCode;
    const responses = [
      await api(t.url, '/api/players/me', { token: g.accessToken }),
      await api(t.url, `/api/players/${g.player.id}`, { token: g.accessToken }),
      await api(t.url, '/api/players?limit=100', { token: g.accessToken }),
      await api(t.url, '/api/players/leaderboard', { token: g.accessToken }),
      await api(t.url, '/api/players/me', {
        method: 'PATCH',
        token: g.accessToken,
        body: { name: 'Quiet II' },
      }),
      await api(t.url, '/api/auth/device', {
        body: { deviceSecret: g.deviceSecret },
      }),
      await api(t.url, '/api/admin/stats', {
        headers: { 'x-api-key': 'test-admin-key-with-enough-length' },
      }),
    ];
    const text = JSON.stringify(responses.map((r) => r.body));
    expect(text).not.toMatch(/Hash/i);
    expect(text).not.toContain(g.deviceSecret);
    expect(text).not.toContain(code);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    // On disk only hashes are stored.
    const db = await readFile(t.dbPath, 'utf8');
    expect(db).not.toContain(g.deviceSecret);
    expect(db).not.toContain(code);
    expect(db).toContain('deviceSecretHash');
  });

  it('documents the sign-in routes', async () => {
    const doc = (await (await fetch(`${t.url}/api/docs-json`)).json()) as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    for (const path of [
      '/api/auth/guest',
      '/api/auth/device',
      '/api/auth/recovery-code',
      '/api/auth/recover',
    ])
      expect(doc.paths[path], path).toBeDefined();
    for (const name of [
      'DeviceLoginDto',
      'RecoverDto',
      'RecoveryCodeDto',
      'AuthResponseDto',
    ])
      expect(doc.components.schemas[name], name).toBeDefined();
  });
});

describe('rate limiting', () => {
  it('limits the sign-in routes per address and leaves other routes alone', async () => {
    const t = await createTestApp({ RATE_LIMIT_AUTH_PER_MINUTE: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++)
        statuses.push(
          (
            await api(t.url, '/api/auth/guest', {
              body: { name: `Guest ${i}` },
            })
          ).status,
        );
      expect(statuses).toEqual([201, 201, 201, 429, 429]);

      const limited = await api(t.url, '/api/auth/guest', {
        body: { name: 'Late' },
      });
      expect(limited.body).toMatchObject({
        statusCode: 429,
        path: '/api/auth/guest',
      });
      expect(
        (
          await api(t.url, '/api/auth/recover', {
            body: { recoveryCode: 'AAAA-BBBB-CCCC-DDDD' },
          })
        ).status,
      ).toBe(401); // its own counter
      expect((await api(t.url, '/api/health')).status).toBe(200);
      expect((await api(t.url, '/api/game/spec')).status).toBe(200);
    } finally {
      await t.close();
    }
  });

  it('counts each client address behind a reverse proxy', async () => {
    const t = await createTestApp({
      RATE_LIMIT_AUTH_PER_MINUTE: '2',
      TRUST_PROXY: '1',
    });
    try {
      const as = (ip: string) =>
        api(t.url, '/api/auth/guest', {
          body: { name: 'Proxied' },
          headers: { 'x-forwarded-for': ip },
        });
      expect([
        (await as('203.0.113.1')).status,
        (await as('203.0.113.1')).status,
        (await as('203.0.113.1')).status,
      ]).toEqual([201, 201, 429]);
      expect((await as('203.0.113.2')).status).toBe(201); // another client is not affected
    } finally {
      await t.close();
    }
  });

  it('does not trust X-Forwarded-For without TRUST_PROXY', async () => {
    const t = await createTestApp({ RATE_LIMIT_AUTH_PER_MINUTE: '2' });
    try {
      const as = (ip: string) =>
        api(t.url, '/api/auth/guest', {
          body: { name: 'Spoofer' },
          headers: { 'x-forwarded-for': ip },
        });
      expect([
        (await as('1.1.1.1')).status,
        (await as('2.2.2.2')).status,
        (await as('3.3.3.3')).status,
      ]).toEqual([201, 201, 429]);
    } finally {
      await t.close();
    }
  });
});
