import { describe, expect, it } from 'vitest';
import { api, createTestApp, guest } from './helpers/create-app.js';

/**
 * With RabbitMQ on, a finished match travels as `match.finished` through the
 * broker and the consumer updates the profiles. Runs only when
 * `TEST_RABBITMQ_URL` is set, for example amqp://guest:guest@localhost:5672.
 */
describe.skipIf(!process.env.TEST_RABBITMQ_URL)(
  'domain events through RabbitMQ',
  () => {
    it('updates player stats after a match ends', async () => {
      const t = await createTestApp({
        RABBITMQ_URL: process.env.TEST_RABBITMQ_URL as string,
        RABBITMQ_QUEUE: `luxcores.test.${Date.now()}`,
        MATCH_MAX_TICKS: '40',
      });
      try {
        expect((await api(t.url, '/api/health')).body.events).toBe('rabbitmq');
        const halo = await guest(t.url, 'Halo');
        const created = await api(t.url, '/api/matches', {
          token: halo.token,
          body: { name: 'Via broker', vsBot: true, seed: 5 },
        });
        expect(
          (
            await api(t.url, `/api/matches/${created.body.id}/start`, {
              method: 'POST',
              token: halo.token,
            })
          ).status,
        ).toBe(200);

        // The stats change only if the event went out to RabbitMQ and came back to the consumer.
        let stats = { matchesPlayed: 0, draws: 0 };
        for (let i = 0; i < 50 && stats.matchesPlayed === 0; i++) {
          await new Promise((r) => setTimeout(r, 200));
          stats = (await api(t.url, '/api/players/me', { token: halo.token }))
            .body.stats;
        }
        expect(stats).toMatchObject({ matchesPlayed: 1, draws: 1 });
      } finally {
        await t.close();
      }
    }, 30_000);

    it('ends a live match and still publishes its result when the app shuts down', async () => {
      const queue = `luxcores.test.shutdown.${Date.now()}`;
      const url = process.env.TEST_RABBITMQ_URL as string;
      const first = await createTestApp({
        RABBITMQ_URL: url,
        RABBITMQ_QUEUE: queue,
        MATCH_MAX_TICKS: '5000',
        MATCH_ON_SHUTDOWN: 'end', // this test is about ending a live match cleanly
      });
      const halo = await guest(first.url, 'Halo');
      const created = await api(first.url, '/api/matches', {
        token: halo.token,
        body: { name: 'Cut short', vsBot: true, seed: 8 },
      });
      expect(
        (
          await api(first.url, `/api/matches/${created.body.id}/start`, {
            method: 'POST',
            token: halo.token,
          })
        ).status,
      ).toBe(200);
      await new Promise((r) => setTimeout(r, 500));

      // With the broker closed before the runner finished, this call never returned.
      const started = Date.now();
      await first.shutdown();
      expect(
        Date.now() - started,
        'shutdown must not hang on the broker',
      ).toBeLessThan(5000);

      // The published match.finished waits in the durable queue. A second node with the
      // same database and queue consumes it and updates the stats.
      const second = await createTestApp({
        RABBITMQ_URL: url,
        RABBITMQ_QUEUE: queue,
        JSON_DB_PATH: first.dbPath,
      });
      try {
        let stats = { matchesPlayed: 0, draws: 0 };
        for (let i = 0; i < 50 && stats.matchesPlayed === 0; i++) {
          await new Promise((r) => setTimeout(r, 200));
          stats = (
            await api(second.url, '/api/players/me', { token: halo.token })
          ).body.stats;
        }
        expect(stats).toMatchObject({ matchesPlayed: 1, draws: 1 });
      } finally {
        await second.close();
        await first.close();
      }
    }, 30_000);
  },
);
