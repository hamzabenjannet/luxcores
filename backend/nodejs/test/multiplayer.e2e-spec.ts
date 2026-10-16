import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ack,
  api,
  connectSocket,
  createTestApp,
  guest,
  type Session,
  type TestApp,
  waitFor,
} from './helpers/create-app.js';

/** Hash of the repo's own sim after `ticks` ticks, computed here without the server. */
async function referenceHash(
  seed: number,
  players: { id: number; team: number; kind: string }[],
  ticks: number,
): Promise<string> {
  const root = resolve('../..');
  const sim = await import(
    pathToFileURL(resolve(root, 'src/sim/index.js')).href
  );
  const { loadData } = await import(
    pathToFileURL(resolve(root, 'test/helpers/load-data.js')).href
  );
  const state = sim.createState({ seed, players, config: loadData().config });
  while (state.tick < ticks) sim.step(state, []);
  return sim.hashState(state);
}

describe('multiplayer over Socket.IO', () => {
  let t: TestApp;
  let halo: Session;
  let prism: Session;
  const sockets: Socket[] = [];

  const connect = async (token?: string) => {
    const socket = await connectSocket(t.url, token);
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    t = await createTestApp();
    halo = await guest(t.url, 'Halo');
    prism = await guest(t.url, 'Prism');
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
  });

  afterAll(() => t.close());

  it('refuses a socket without a valid token', async () => {
    await expect(connectSocket(t.url)).rejects.toThrow(/missing token/);
    await expect(connectSocket(t.url, 'garbage')).rejects.toThrow(
      /invalid or expired token/,
    );
  });

  it('plays a 1v1 from lobby to finish and keeps the sim in step with the repo', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Duel', seed: 1234567 },
    });
    const matchId: string = created.body.id;
    await api(t.url, `/api/matches/${matchId}/join`, {
      method: 'POST',
      token: prism.token,
    });

    const a = await connect(halo.token);
    const b = await connect(prism.token);

    // Players may join the room while the lobby is open.
    const joinA = await ack(a, 'match:join', { matchId });
    expect(joinA).toMatchObject({ ok: true, status: 'lobby', snapshot: null });
    await ack(b, 'match:join', { matchId });

    // A stranger cannot join the room.
    const stranger = await guest(t.url, 'Stranger');
    const c = await connect(stranger.token);
    expect(await ack(c, 'match:join', { matchId })).toEqual({
      ok: false,
      error: 'You are not in this match',
    });
    expect(
      await ack(c, 'match:join', {
        matchId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toEqual({ ok: false, error: 'Match not found' });

    const startedA = waitFor(a, 'match:started');
    const snapshotsA: any[] = [];
    a.on('match:snapshot', (s) => snapshotsA.push(s));
    const hashAt20 = waitFor(
      b,
      'match:snapshot',
      (s) => s.tick === 20 && typeof s.hash === 'string',
    );
    const ended = waitFor(a, 'match:ended');

    const start = await api(t.url, `/api/matches/${matchId}/start`, {
      method: 'POST',
      token: halo.token,
    });
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('running');

    const started = await startedA;
    expect(started).toMatchObject({ matchId, tickHz: 20 });
    expect(started.map.lanes).toHaveLength(6);
    expect(started.snapshot).toMatchObject({
      tick: 0,
      entities: expect.any(Array),
    });
    expect(started.snapshot.entities).toHaveLength(14); // 2 Cores and 12 blockers

    // Commands: the ack says whether the server queued it.
    expect(
      await ack(a, 'match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'heroMove', x: 48000, z: 80000 },
      }),
    ).toMatchObject({ accepted: true });
    expect(
      await ack(a, 'match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'heroMove', x: 1, z: 1 },
      }),
    ).toMatchObject({ accepted: false, reason: expect.stringMatching(/seq/) });
    expect(
      await ack(b, 'match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'heroMove', x: 1, z: 1 },
      }),
    ).toMatchObject({ accepted: true }); // seq counts per player
    expect(
      await ack(c, 'match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'heroMove', x: 1, z: 1 },
      }),
    ).toMatchObject({ accepted: false, reason: 'You are not in this match' });

    // Bad payloads come back through the ack instead of hanging.
    expect(
      await ack(a, 'match:command', {
        matchId,
        seq: 1,
        cmd: { t: 'launchNukes' },
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/cmd must be/) });
    expect(
      await ack(a, 'match:command', {
        matchId: 'nope',
        seq: 1,
        cmd: { t: 'build' },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await ack(a, 'match:command', { matchId, seq: -1, cmd: { t: 'build' } }),
    ).toMatchObject({ ok: false });
    expect(await ack(a, 'ping')).toMatchObject({
      serverTime: expect.any(String),
    });

    // Chat reaches the room, and only members who joined it.
    const chat = waitFor(b, 'chat:message');
    expect(
      await ack(a, 'chat:message', { matchId, text: 'good luck' }),
    ).toEqual({ ok: true });
    expect(await chat).toMatchObject({ from: 'Halo', text: 'good luck' });
    expect(await ack(c, 'chat:message', { matchId, text: 'hi' })).toEqual({
      ok: false,
    });

    // The hash at tick 20 equals the one Node computes from the same seed and players.
    const expected = await referenceHash(
      1234567,
      [
        { id: 0, team: 0, kind: 'human' },
        { id: 1, team: 1, kind: 'human' },
      ],
      20,
    );
    expect((await hashAt20).hash).toBe(expected);

    const end = await ended;
    expect(end).toMatchObject({
      matchId,
      endedTick: 60,
      result: { winnerTeam: null, draw: true, reason: 'tick-limit' },
    });
    expect(end.replayId).toEqual(expect.any(String));
    expect(snapshotsA.map((s) => s.tick).slice(0, 4)).toEqual([2, 4, 6, 8]); // every 2 ticks, 10 per second
    expect(
      snapshotsA.filter((s) => s.hash).every((s) => s.tick % 20 === 0),
    ).toBe(true);

    // The match, its replay and the profiles are updated.
    const finished = await api(t.url, `/api/matches/${matchId}`, {
      token: halo.token,
    });
    expect(finished.body).toMatchObject({
      status: 'finished',
      endedTick: 60,
      replayId: end.replayId,
    });

    const verify = await api(t.url, `/api/replays/${end.replayId}/verify`, {
      method: 'POST',
      token: halo.token,
    });
    expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });
    const record = await api(t.url, `/api/replays/${end.replayId}`, {
      token: halo.token,
    });
    expect(
      record.body.replay.commands.map(
        (e: { playerId: number; seq: number }) => [e.playerId, e.seq],
      ),
    ).toEqual([
      [0, 0],
      [1, 0],
    ]);

    const me = await api(t.url, '/api/players/me', { token: halo.token });
    expect(me.body.stats).toEqual({
      matchesPlayed: 1,
      wins: 0,
      losses: 0,
      draws: 1,
    });

    // After the match, commands are refused.
    expect(
      await ack(a, 'match:command', { matchId, seq: 5, cmd: { t: 'build' } }),
    ).toEqual({ accepted: false, reason: 'The match is not running' });
  }, 30_000);

  it('runs a bot match and stops it on request', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Practice', vsBot: true, seed: 7 },
    });
    const matchId: string = created.body.id;
    const a = await connect(halo.token);
    await ack(a, 'match:join', { matchId });
    const snapshot = waitFor(a, 'match:snapshot', (s) => s.tick >= 4);
    const ended = waitFor(a, 'match:ended');

    const started = await api(t.url, `/api/matches/${matchId}/start`, {
      method: 'POST',
      token: halo.token,
    });
    expect(started.body.players).toEqual([
      { playerId: halo.player.id, name: 'Halo', team: 0, kind: 'human' },
      { name: 'Bot', team: 1, kind: 'bot' },
    ]);
    expect(
      (
        await api(t.url, `/api/matches/${matchId}/start`, {
          method: 'POST',
          token: halo.token,
        })
      ).status,
    ).toBe(409); // already running
    await snapshot;

    const health = await api(t.url, '/api/health');
    expect(health.body.runningMatches).toBe(1);
    expect(
      (
        await api(t.url, `/api/matches/${matchId}/stop`, {
          method: 'POST',
          token: prism.token,
        })
      ).status,
    ).toBe(403);

    const stopped = await api(t.url, `/api/matches/${matchId}/stop`, {
      method: 'POST',
      token: halo.token,
    });
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({
      status: 'finished',
      result: { draw: true, reason: 'stopped' },
    });
    expect((await ended).result.reason).toBe('stopped');
    expect(
      (
        await api(t.url, `/api/matches/${matchId}/stop`, {
          method: 'POST',
          token: halo.token,
        })
      ).status,
    ).toBe(409);
    expect((await api(t.url, '/api/health')).body.runningMatches).toBe(0);
  }, 30_000);

  it('tells room members when the lobby changes', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Lobby news' },
    });
    const matchId: string = created.body.id;
    const a = await connect(halo.token);
    await ack(a, 'match:join', { matchId });
    const update = waitFor(a, 'match:updated', (m) => m.players.length === 2);
    await api(t.url, `/api/matches/${matchId}/join`, {
      method: 'POST',
      token: prism.token,
    });
    expect((await update).players.map((p: { name: string }) => p.name)).toEqual(
      ['Halo', 'Prism'],
    );
  });
});
