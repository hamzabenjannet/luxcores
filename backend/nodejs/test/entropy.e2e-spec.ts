import { describe, expect, it } from 'vitest';
import { ack, api, connectSocket, createTestApp, guest, waitFor } from './helpers/create-app.js';

interface Entity {
  id: number;
  kind: number;
  team: number;
  hp: number;
  maxHp: number;
}
interface Snapshot {
  tick: number;
  entities: Entity[];
}

/** Plays a bot match with a barracks of the player's, and returns the replay id and the barracks as it is after `ticks`. */
async function play(url: string, entropy: number | undefined) {
  const player = await guest(url, `Entropy${entropy ?? 'default'}`);
  const created = await api(url, '/api/matches', {
    token: player.token,
    body: { name: 'Entropy', vsBot: true, seed: 12, ...(entropy === undefined ? {} : { entropyPctPerMinute: entropy }) },
  });
  expect(created.status).toBe(201);
  expect(created.body.entropyPctPerMinute).toBe(entropy);
  const matchId: string = created.body.id;
  const socket = await connectSocket(url, player.token);
  await ack(socket, 'match:join', { matchId });
  const started = waitFor(socket, 'match:started');
  await api(url, `/api/matches/${matchId}/start`, { method: 'POST', token: player.token });
  await started;
  expect(await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'barracks', tileX: 44, tileZ: 90 } })).toMatchObject({ accepted: true });
  const first = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === 6 && e.team === 0));
  const barracks = first.entities.find((e) => e.kind === 6 && e.team === 0) as Entity;
  const later = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= first.tick + 140);
  const after = later.entities.find((e) => e.id === barracks.id) as Entity;
  const ended = waitFor<{ replayId?: string }>(socket, 'match:ended');
  await api(url, `/api/matches/${matchId}/stop`, { method: 'POST', token: player.token });
  const { replayId } = await ended;
  socket.close();
  return { barracks: after, replayId, token: player.token, matchId };
}

describe('the entropy rate of a match', () => {
  it('is set by the host, applied by the sim, kept in the replay and checked by its verify', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '5000' });
    try {
      const off = await play(t.url, 0);
      expect(off.barracks.hp).toBe(off.barracks.maxHp);
      const fast = await play(t.url, 60);
      expect(fast.barracks.hp).toBeLessThan(fast.barracks.maxHp);
      const normal = await play(t.url, undefined);
      expect(normal.barracks.hp).toBeGreaterThan(fast.barracks.hp);

      for (const run of [off, fast]) {
        const replay = await api(t.url, `/api/replays/${run.replayId}`, { token: run.token });
        expect(replay.body.replay.options).toEqual({ entropyPctPerMinute: run === off ? 0 : 60 });
        const verify = await api(t.url, `/api/replays/${run.replayId}/verify`, { method: 'POST', token: run.token });
        expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });
      }
      const defaults = await api(t.url, `/api/replays/${normal.replayId}`, { token: normal.token });
      expect(defaults.body.replay.options).toBeUndefined();
    } finally {
      await t.close();
    }
  }, 90_000);

  it('refuses a rate outside 0 to 100', async () => {
    const t = await createTestApp();
    try {
      const player = await guest(t.url, 'Strict');
      for (const bad of [-1, 101, 1.5, 'a']) {
        const res = await api(t.url, '/api/matches', { token: player.token, body: { name: 'Bad rate', entropyPctPerMinute: bad } });
        expect(res.status, String(bad)).toBe(400);
      }
    } finally {
      await t.close();
    }
  });
});
