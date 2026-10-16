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
  },
);
