import { describe, expect, it } from 'vitest';
import { ack, api, connectSocket, createTestApp, guest, waitFor } from './helpers/create-app.js';

/**
 * An undecided match ends as a draw at a tick limit. The data file sets the default
 * (`match.stalemateTicks`), and MATCH_MAX_TICKS overrides it for longer test runs.
 */
describe('the match tick limit', () => {
  it('defaults to the stalemate value in data/balance.json', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: null });
    try {
      const spec = await api(t.url, '/api/game/spec');
      expect(spec.body.matchMaxTicks).toBe(10_000);
    } finally {
      await t.close();
    }
  });

  it('takes MATCH_MAX_TICKS when it is set, so a test run can go on longer', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '25000' });
    try {
      const spec = await api(t.url, '/api/game/spec');
      expect(spec.body.matchMaxTicks).toBe(25_000);
    } finally {
      await t.close();
    }
  });

  it('lets the host choose a limit per match: a cap of its own, or none', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '40' });
    try {
      const host = await guest(t.url, 'Limits');
      const socket = await connectSocket(t.url, host.token);
      const watch = async (maxTicks: number | undefined) => {
        const created = await api(t.url, '/api/matches', { token: host.token, body: { name: 'Limit', botVsBot: true, seed: 5, ...(maxTicks === undefined ? {} : { maxTicks }) } });
        expect(created.status).toBe(201);
        expect(created.body.maxTicks).toBe(maxTicks);
        await ack(socket, 'match:join', { matchId: created.body.id });
        return created.body.id as string;
      };

      // A capped match ends at its own tick, not at the server's 40.
      const capped = await watch(100);
      const endedCapped = waitFor<{ result: { reason: string } }>(socket, 'match:ended', () => true, 30_000);
      await api(t.url, `/api/matches/${capped}/start`, { method: 'POST', token: host.token });
      expect((await endedCapped).result.reason).toBe('tick-limit');
      expect((await api(t.url, `/api/matches/${capped}`, { token: host.token })).body.endedTick).toBe(100);

      // An unlimited match runs past the server's limit and ends only when stopped.
      const open = await watch(0);
      const past = waitFor<{ tick: number }>(socket, 'match:snapshot', (s) => s.tick >= 160, 30_000);
      await api(t.url, `/api/matches/${open}/start`, { method: 'POST', token: host.token });
      await past;
      expect((await api(t.url, `/api/matches/${open}`, { token: host.token })).body.status).toBe('running');
      const stopped = waitFor<{ result: { reason: string } }>(socket, 'match:ended', () => true, 10_000);
      await api(t.url, `/api/matches/${open}/stop`, { method: 'POST', token: host.token });
      expect((await stopped).result.reason).toBe('stopped');

      // A match with no choice takes the server default.
      const plain = await watch(undefined);
      const endedPlain = waitFor<{ result: { reason: string } }>(socket, 'match:ended', () => true, 30_000);
      await api(t.url, `/api/matches/${plain}/start`, { method: 'POST', token: host.token });
      expect((await endedPlain).result.reason).toBe('tick-limit');
      expect((await api(t.url, `/api/matches/${plain}`, { token: host.token })).body.endedTick).toBe(40);
      socket.close();
    } finally {
      await t.close();
    }
  }, 90_000);

  it('refuses a limit that is negative, fractional or above 1 000 000', async () => {
    const t = await createTestApp();
    try {
      const player = await guest(t.url, 'Strict');
      for (const bad of [-1, 1.5, 1_000_001, 'a']) {
        const res = await api(t.url, '/api/matches', { token: player.token, body: { name: 'Bad limit', maxTicks: bad } });
        expect(res.status, String(bad)).toBe(400);
      }
    } finally {
      await t.close();
    }
  });
});
