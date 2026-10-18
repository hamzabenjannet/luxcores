import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
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

/** Entity kind codes of the sim (`KIND` in src/sim/state.js). */
const KIND = { CORE: 1, SOLAR: 2, BARRACKS: 6, TOWER: 7 };

interface Snapshot {
  tick: number;
  teams: { coreLux: number }[];
  groups: { id: number; owner: number; team: number; wpIndex: number; waypoints: number[][] }[];
  orders: { id: number; barracksId: number; owner: number; mix: number[]; ticksLeft: number; held: number }[];
  entities: {
    id: number;
    kind: number;
    team: number;
    attack: number;
    recycle: number;
    powerLevel: number;
    shellLevel: number;
    groupId: number;
  }[];
}

describe('bots and spectators over the match server', () => {
  let t: TestApp;
  let halo: Session;
  let watcher: Session;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    // 700 ticks: the bot pays for a hero before its tower and its first creep group, so those come later than in M4.
    t = await createTestApp({ MATCH_MAX_TICKS: '700' });
    halo = await guest(t.url, 'Halo');
    watcher = await guest(t.url, 'Watcher');
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await t.close();
  });

  it('plays a bot against a human: the bot builds, and snapshots carry the combat fields', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Versus bot', vsBot: true, seed: 11 },
    });
    const socket = await connectSocket(t.url, halo.token);
    sockets.push(socket);
    await ack(socket, 'match:join', { matchId: created.body.id });
    const tower = waitFor<Snapshot>(
      socket,
      'match:snapshot',
      (s) => s.entities.some((e) => e.kind === KIND.TOWER && e.team === 1),
      25_000, // the bot pays for a hero first now, so its tower comes around tick 250, 12 seconds in
    );
    await api(t.url, `/api/matches/${created.body.id}/start`, {
      method: 'POST',
      token: halo.token,
    });
    const s = await tower;
    // The bot follows the GDD rotation: a collector, a barracks, then a tower.
    const bot = s.entities.filter((e) => e.team === 1);
    expect(bot.some((e) => e.kind === KIND.SOLAR)).toBe(true);
    expect(bot.some((e) => e.kind === KIND.BARRACKS)).toBe(true);
    const built = bot.find((e) => e.kind === KIND.TOWER)!;
    expect(built).toMatchObject({
      attack: 2, // ranged: the first tower type in the bot's order
      recycle: 0,
      powerLevel: 0,
      shellLevel: 0,
    });
    expect(built).toHaveProperty('stunTicks', 0);
    expect(built).toHaveProperty('targetId', 0);
    expect(s.teams[1].coreLux).toBeLessThan(100_000); // the bot paid for it
    expect(s.teams[0].coreLux).toBeGreaterThanOrEqual(100_000); // the human did nothing

    // The fourth slot of the rotation is a creep group: the queue shows it, then the group walks.
    const queued = await waitFor<Snapshot>(
      socket,
      'match:snapshot',
      (x) => x.orders.some((o) => o.owner === 1),
      15_000,
    );
    expect(queued.orders[0]).toMatchObject({ owner: 1, held: 0 });
    expect(queued.orders[0].mix).toHaveLength(5);
    const walking = await waitFor<Snapshot>(
      socket,
      'match:snapshot',
      (x) => x.groups.some((g) => g.team === 1),
      15_000,
    );
    const group = walking.groups.find((g) => g.team === 1)!;
    expect(group.waypoints.length).toBeGreaterThanOrEqual(8); // the lane route
    const members = walking.entities.filter((e) => e.groupId === group.id);
    expect(members).toHaveLength(5);
    expect(members.every((m) => m.kind === 9 && m.team === 1)).toBe(true);
  }, 60_000);

  it('plays bot against bot while a spectator watches, and refuses the spectator commands', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Bots only', botVsBot: true, seed: 12 },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ botVsBot: true, players: [] });
    const id: string = created.body.id;

    // Nobody can take a slot, but anyone signed in may watch.
    expect(
      (
        await api(t.url, `/api/matches/${id}/join`, {
          method: 'POST',
          token: watcher.token,
        })
      ).status,
    ).toBe(409);
    const socket = await connectSocket(t.url, watcher.token);
    sockets.push(socket);
    expect(await ack(socket, 'match:join', { matchId: id })).toMatchObject({
      ok: true,
      role: 'spectator',
    });

    const started = waitFor<{ players: { kind: string }[] }>(
      socket,
      'match:started',
    );
    // The host who only watches still starts the match.
    expect(
      (
        await api(t.url, `/api/matches/${id}/start`, {
          method: 'POST',
          token: halo.token,
        })
      ).status,
    ).toBe(200);
    expect((await started).players.map((p) => p.kind)).toEqual(['bot', 'bot']);

    const both = await waitFor<Snapshot>(
      socket,
      'match:snapshot',
      (s) =>
        [0, 1].every((team) =>
          s.entities.some((e) => e.kind === KIND.TOWER && e.team === team),
        ),
    );
    expect(both.tick).toBeGreaterThan(0);

    expect(
      await ack(socket, 'match:command', {
        matchId: id,
        seq: 0,
        cmd: { t: 'build', building: 'solar', tileX: 40, tileZ: 90 },
      }),
    ).toMatchObject({ accepted: false, reason: 'You are not in this match' });

    // The match ends at the tick limit, and its replay holds both bots' commands and verifies.
    const ended = await waitFor<{ replayId: string; result: { reason: string } }>(
      socket,
      'match:ended',
      () => true,
      45_000,
    );
    expect(ended.result.reason).toBe('tick-limit');
    // The end-of-match counters (GDD 13.2): both bots collected and spent lux.
    const stats = (ended.result as unknown as { stats: { team: number; collected: number; spent: number }[] }).stats;
    expect(stats.map((s) => s.team)).toEqual([0, 1]);
    for (const s of stats) {
      expect(s.collected).toBeGreaterThan(0);
      expect(s.spent).toBeGreaterThan(0);
    }
    const verify = await api(t.url, `/api/replays/${ended.replayId}/verify`, {
      method: 'POST',
      token: halo.token,
    });
    expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });
    const record = await api(t.url, `/api/replays/${ended.replayId}`, {
      token: halo.token,
    });
    const owners = new Set(
      (record.body.replay.commands as { playerId: number }[]).map(
        (c) => c.playerId,
      ),
    );
    expect([...owners].sort()).toEqual([0, 1]);
  }, 90_000);

  it('keeps a human match closed to strangers', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Private duel', vsBot: true, seed: 13 },
    });
    const socket = await connectSocket(t.url, watcher.token);
    sockets.push(socket);
    expect(
      await ack(socket, 'match:join', { matchId: created.body.id }),
    ).toMatchObject({ ok: false, error: 'You are not in this match' });
  });

  it('rejects a lobby that asks for two bot modes at once', async () => {
    const res = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Confused', vsBot: true, botVsBot: true },
    });
    expect(res.status).toBe(400);
  });

  it('lets the host leave a bot lobby, which cancels it', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Never started', botVsBot: true },
    });
    const left = await api(t.url, `/api/matches/${created.body.id}/leave`, {
      method: 'POST',
      token: halo.token,
    });
    expect(left.body.status).toBe('cancelled');
  });
});
