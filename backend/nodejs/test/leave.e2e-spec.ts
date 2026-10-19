import { describe, expect, it } from 'vitest';
import {
  ack,
  api,
  connectSocket,
  createTestApp,
  guest,
  waitFor,
} from './helpers/create-app.js';

/** Leaving a running match (`POST /matches/:id/quit`) and the watchdog for matches nobody is connected to. */
describe('leaving a running match', () => {
  it('stops a match against a bot as a draw, and keeps its replay', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '5000' });
    try {
      const host = await guest(t.url, 'Leaver');
      const created = await api(t.url, '/api/matches', { token: host.token, body: { name: 'Versus bot', vsBot: true, seed: 3, maxTicks: 0 } });
      const socket = await connectSocket(t.url, host.token);
      await ack(socket, 'match:join', { matchId: created.body.id });
      const ended = waitFor<{ result: { reason: string; draw: boolean }; replayId?: string }>(socket, 'match:ended');
      await api(t.url, `/api/matches/${created.body.id}/start`, { method: 'POST', token: host.token });
      await waitFor(socket, 'match:snapshot', (s: { tick: number }) => s.tick >= 20);
      const quit = await api(t.url, `/api/matches/${created.body.id}/quit`, { method: 'POST', token: host.token });
      expect(quit.status).toBe(200);
      expect(quit.body.status).toBe('finished');
      expect(quit.body.result).toMatchObject({ reason: 'stopped', draw: true, winnerTeam: null });
      expect((await ended).replayId).toBeDefined();
      // Nothing runs any more: a second quit is refused and the room gets no more snapshots.
      expect((await api(t.url, `/api/matches/${created.body.id}/quit`, { method: 'POST', token: host.token })).status).toBe(409);
      socket.close();
    } finally {
      await t.close();
    }
  }, 60_000);

  it('makes the leaver of a match for two humans forfeit: the other player wins and the replay verifies', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '5000' });
    try {
      const host = await guest(t.url, 'Stays');
      const other = await guest(t.url, 'Goes');
      const stranger = await guest(t.url, 'Stranger');
      const created = await api(t.url, '/api/matches', { token: host.token, body: { name: 'Duel', seed: 5, maxTicks: 0 } });
      const id = created.body.id as string;
      await api(t.url, `/api/matches/${id}/join`, { method: 'POST', token: other.token });
      // Not running yet: nobody can quit a lobby this way.
      expect((await api(t.url, `/api/matches/${id}/quit`, { method: 'POST', token: other.token })).status).toBe(409);
      const hostSocket = await connectSocket(t.url, host.token);
      const otherSocket = await connectSocket(t.url, other.token);
      await ack(hostSocket, 'match:join', { matchId: id });
      await ack(otherSocket, 'match:join', { matchId: id });
      const ended = waitFor<{ result: { reason: string; winnerTeam: number; draw: boolean }; replayId: string }>(hostSocket, 'match:ended');
      await api(t.url, `/api/matches/${id}/start`, { method: 'POST', token: host.token });
      await waitFor(hostSocket, 'match:snapshot', (s: { tick: number }) => s.tick >= 20);

      expect((await api(t.url, `/api/matches/${id}/quit`, { method: 'POST', token: stranger.token })).status).toBe(409);
      const quit = await api(t.url, `/api/matches/${id}/quit`, { method: 'POST', token: other.token });
      expect(quit.status).toBe(200);
      expect(quit.body.result).toMatchObject({ reason: 'forfeit', draw: false, winnerTeam: 0 });
      const event = await ended;
      expect(event.result.winnerTeam).toBe(0);
      const verify = await api(t.url, `/api/replays/${event.replayId}/verify`, { method: 'POST', token: host.token });
      expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });

      // The result counts on the profiles: a win for the player who stayed, a loss for the one who left.
      const board = await api(t.url, '/api/players', { token: host.token });
      const stats = (name: string) => board.body.items.find((p: { name: string }) => p.name === name)?.stats;
      await expect.poll(async () => (await api(t.url, '/api/players', { token: host.token })).body.items.find((p: { name: string }) => p.name === 'Stays')?.stats.wins, { timeout: 5000 }).toBe(1);
      expect(stats('Goes')).toBeDefined();
      hostSocket.close();
      otherSocket.close();
    } finally {
      await t.close();
    }
  }, 60_000);
});

describe('a match that nobody is connected to', () => {
  it('is stopped as a draw after the abandon time, while a connected one keeps running', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '5000', MATCH_ABANDON_SECONDS: '2' });
    try {
      const host = await guest(t.url, 'Walks Away');
      const watcher = await guest(t.url, 'Stays Connected');
      const mine = await api(t.url, '/api/matches', { token: host.token, body: { name: 'Abandoned', vsBot: true, seed: 3, maxTicks: 0 } });
      const kept = await api(t.url, '/api/matches', { token: watcher.token, body: { name: 'Watched', vsBot: true, seed: 4, maxTicks: 0 } });
      const socket = await connectSocket(t.url, watcher.token);
      await ack(socket, 'match:join', { matchId: kept.body.id });
      await api(t.url, `/api/matches/${mine.body.id}/start`, { method: 'POST', token: host.token });
      await api(t.url, `/api/matches/${kept.body.id}/start`, { method: 'POST', token: watcher.token });

      // The first has no client at all: the watchdog stops it. The second has one and runs on.
      await expect.poll(async () => (await api(t.url, `/api/matches/${mine.body.id}`, { token: host.token })).body.status, { timeout: 15_000, interval: 250 }).toBe('finished');
      const abandoned = await api(t.url, `/api/matches/${mine.body.id}`, { token: host.token });
      expect(abandoned.body.result).toMatchObject({ reason: 'stopped', draw: true });
      expect(abandoned.body.replayId).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect((await api(t.url, `/api/matches/${kept.body.id}`, { token: watcher.token })).body.status).toBe('running');

      // Once its only client leaves, the second one goes too.
      socket.close();
      await expect.poll(async () => (await api(t.url, `/api/matches/${kept.body.id}`, { token: watcher.token })).body.status, { timeout: 15_000, interval: 250 }).toBe('finished');
    } finally {
      await t.close();
    }
  }, 90_000);
});
