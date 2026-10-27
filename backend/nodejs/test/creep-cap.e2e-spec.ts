import { describe, expect, it } from 'vitest';
import { ack, api, connectSocket, createTestApp, guest, waitFor } from './helpers/create-app.js';

interface Entity {
  id: number;
  kind: number;
  team: number;
}
interface Order {
  barracksId: number;
  held: number;
  mix: number[];
}
interface Snapshot {
  tick: number;
  entities: Entity[];
  orders: Order[];
}

const BARRACKS = 6;
const CREEP = 9;

/** Orders five creeps in a bot match whose creep cap is `cap`, and reports what the cap did to them. */
async function play(url: string, cap: number | undefined) {
  const player = await guest(url, `Cap${cap ?? 'default'}`);
  const created = await api(url, '/api/matches', {
    token: player.token,
    body: { name: 'Creep cap', vsBot: true, seed: 12, ...(cap === undefined ? {} : { creepCapPerPlayer: cap }) },
  });
  expect(created.status).toBe(201);
  expect(created.body.creepCapPerPlayer).toBe(cap);
  const matchId: string = created.body.id;
  const socket = await connectSocket(url, player.token);
  await ack(socket, 'match:join', { matchId });
  const started = waitFor(socket, 'match:started');
  await api(url, `/api/matches/${matchId}/start`, { method: 'POST', token: player.token });
  await started;
  expect(await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'barracks', tileX: 44, tileZ: 90 } })).toMatchObject({ accepted: true });
  const built = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === BARRACKS && e.team === 0));
  const barracks = built.entities.find((e) => e.kind === BARRACKS && e.team === 0) as Entity;
  expect(await ack(socket, 'match:command', {
    matchId,
    seq: 1,
    cmd: { t: 'orderCreeps', barracksId: barracks.id, mix: ['melee', 'melee', 'melee', 'melee', 'melee'] },
  })).toMatchObject({ accepted: true });
  // The group takes 40 ticks to build, so 100 ticks later it has either spawned or been held at the cap.
  const later = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= built.tick + 100);
  const result = {
    creeps: later.entities.filter((e) => e.kind === CREEP && e.team === 0).length,
    held: later.orders.filter((o) => o.barracksId === barracks.id && o.held === 1).length,
  };
  const ended = waitFor<{ replayId?: string }>(socket, 'match:ended');
  await api(url, `/api/matches/${matchId}/stop`, { method: 'POST', token: player.token });
  const { replayId } = await ended;
  socket.close();
  return { ...result, replayId, token: player.token };
}

describe('the creep cap of a match', () => {
  it('is set by the host, applied by the sim and kept in the replay', async () => {
    const t = await createTestApp({ MATCH_MAX_TICKS: '5000' });
    try {
      const tight = await play(t.url, 2);
      expect(tight.creeps).toBe(0);
      expect(tight.held).toBe(1);
      const wide = await play(t.url, undefined);
      expect(wide.creeps).toBe(5);
      expect(wide.held).toBe(0);

      const replay = await api(t.url, `/api/replays/${tight.replayId}`, { token: tight.token });
      expect(replay.body.replay.options).toEqual({ creepCapPerPlayer: 2 });
      const verify = await api(t.url, `/api/replays/${tight.replayId}/verify`, { method: 'POST', token: tight.token });
      expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });
      const defaults = await api(t.url, `/api/replays/${wide.replayId}`, { token: wide.token });
      expect(defaults.body.replay.options).toBeUndefined();
    } finally {
      await t.close();
    }
  }, 90_000);

  it('refuses a cap outside 1 to 1000', async () => {
    const t = await createTestApp();
    try {
      const player = await guest(t.url, 'StrictCap');
      for (const bad of [0, -1, 1001, 1.5, 'a']) {
        const res = await api(t.url, '/api/matches', { token: player.token, body: { name: 'Bad cap', creepCapPerPlayer: bad } });
        expect(res.status, String(bad)).toBe(400);
      }
    } finally {
      await t.close();
    }
  });
});
