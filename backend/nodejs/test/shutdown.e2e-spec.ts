import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { api, createTestApp, guest } from './helpers/create-app.js';

/**
 * Shutdown order: live matches end first, while the database and the event bus
 * are still open; then the broker closes; then the database. If the order is
 * wrong, a SIGTERM during a match loses the match, its replay and the stats.
 */
describe('graceful shutdown', () => {
  it('saves a live match, its replay and the stats before the database closes', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '6000', MATCH_ON_SHUTDOWN: 'end' });
    try {
      const halo = await guest(t.url, 'Halo');
      const created = await api(t.url, '/api/matches', {
        token: halo.token,
        body: { name: 'Interrupted', vsBot: true, seed: 3 },
      });
      expect(
        (
          await api(t.url, `/api/matches/${created.body.id}/start`, {
            method: 'POST',
            token: halo.token,
          })
        ).status,
      ).toBe(200);
      await new Promise((r) => setTimeout(r, 500)); // let a few ticks run

      const started = Date.now();
      await t.shutdown();
      expect(Date.now() - started).toBeLessThan(5000);

      const db = JSON.parse(await readFile(t.dbPath, 'utf8')) as {
        matches: Record<
          string,
          {
            status: string;
            endedTick: number;
            result: { reason: string };
            replayId?: string;
          }
        >;
        replays: Record<string, { matchId: string; ticks: number }>;
        players: Record<
          string,
          { stats: { matchesPlayed: number; draws: number } }
        >;
      };
      const match = db.matches[created.body.id];
      expect(match).toMatchObject({
        status: 'finished',
        result: { reason: 'stopped' },
      });
      expect(match.endedTick).toBeGreaterThan(0);
      expect(db.replays[match.replayId as string]).toMatchObject({
        matchId: created.body.id,
      });
      expect(db.players[halo.player.id].stats).toMatchObject({
        matchesPlayed: 1,
        draws: 1,
      });
    } finally {
      await t.close();
    }
  }, 20_000);
});
