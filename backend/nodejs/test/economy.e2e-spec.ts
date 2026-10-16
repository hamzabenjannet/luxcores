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
const KIND = { CORE: 1, SOLAR: 2, BLOCKER: 8 };

interface Snapshot {
  tick: number;
  teams: { coreLux: number; pendingLux: number }[];
  entities: {
    id: number;
    kind: number;
    team: number;
    owner: number;
    x: number;
    z: number;
    hp: number;
    maxHp: number;
  }[];
}

/** A free tile in the bottom build zone (rows 64 to 111), away from the entities of the snapshot. */
function freeTile(snapshot: Snapshot, n: number) {
  const taken = new Set(
    snapshot.entities
      .filter((e) => e.kind <= KIND.BLOCKER)
      .map((e) => `${Math.floor(e.x / 1000)},${Math.floor(e.z / 1000)}`),
  );
  let found = 0;
  for (let z = 70; z < 110; z++) {
    for (let x = 4; x < 92; x += 3) {
      if (!taken.has(`${x},${z}`) && found++ === n)
        return { tileX: x, tileZ: z };
    }
  }
  throw new Error('no free tile');
}

describe('the economy over the match server (M2)', () => {
  let t: TestApp;
  let halo: Session;
  let socket: Socket | undefined;

  beforeAll(async () => {
    t = await createTestApp({ MATCH_MAX_TICKS: '6000' });
    halo = await guest(t.url, 'Halo');
  });

  afterAll(async () => {
    socket?.close();
    await t.close();
  });

  it('builds, earns through the buffer, refuses what the rules refuse, and replays identically', async () => {
    const created = await api(t.url, '/api/matches', {
      token: halo.token,
      body: { name: 'Economy', vsBot: true, seed: 1234567 },
    });
    const matchId: string = created.body.id;
    socket = await connectSocket(t.url, halo.token);
    await ack(socket, 'match:join', { matchId });
    const snapshots: Snapshot[] = [];
    socket.on('match:snapshot', (s: Snapshot) => snapshots.push(s));
    const started = waitFor<{ snapshot: Snapshot }>(socket, 'match:started');
    await api(t.url, `/api/matches/${matchId}/start`, {
      method: 'POST',
      token: halo.token,
    });
    const { snapshot: first } = await started;
    expect(first.teams[0].coreLux).toBe(100_000);

    // A build command is queued for the next tick and costs 20 lux.
    const tile = freeTile(first, 0);
    expect(
      await ack(socket, 'match:command', {
        matchId,
        seq: 0,
        cmd: { t: 'build', building: 'solar', ...tile },
      }),
    ).toMatchObject({ accepted: true });
    const built = await waitFor<Snapshot>(socket, 'match:snapshot', (s) =>
      s.entities.some((e) => e.kind === KIND.SOLAR),
    );
    const solar = built.entities.find((e) => e.kind === KIND.SOLAR)!;
    expect(solar).toMatchObject({
      team: 0,
      owner: 0,
      hp: 200_000,
      maxHp: 200_000,
    });
    expect(built.teams[0].coreLux).toBe(80_000);
    expect(
      built.entities.find((e) => e.kind === KIND.CORE && e.team === 0)!.hp,
    ).toBe(80_000); // Core HP is its lux

    // The server accepts a command the sim refuses (the ack means "queued"), and the sim drops it without a charge.
    expect(
      await ack(socket, 'match:command', {
        matchId,
        seq: 1,
        cmd: { t: 'build', building: 'solar', tileX: 48, tileZ: 60 },
      }),
    ).toMatchObject({ accepted: true }); // DMZ row
    expect(
      await ack(socket, 'match:command', {
        matchId,
        seq: 2,
        cmd: { t: 'build', building: 'nuclear', ...freeTile(first, 1) },
      }),
    ).toMatchObject({ accepted: true }); // 80 > 80 - 1: refused by the spend rule

    // Income waits 40 ticks in the pending pool, then settles into the Core.
    const settled = await waitFor<Snapshot>(
      socket,
      'match:snapshot',
      (s) => s.teams[0].coreLux > 80_000,
      20_000,
    );
    expect(settled.teams[0].pendingLux).toBeGreaterThan(0);
    expect(settled.tick).toBeGreaterThanOrEqual(built.tick + 38); // about 40 ticks after the build
    expect(settled.entities.filter((e) => e.kind === KIND.SOLAR)).toHaveLength(
      1,
    );

    // Recycle: only the owner's building, and the refund arrives after the channel.
    expect(
      await ack(socket, 'match:command', {
        matchId,
        seq: 3,
        cmd: { t: 'recycle', buildingId: solar.id },
      }),
    ).toMatchObject({ accepted: true });
    const gone = await waitFor<Snapshot>(
      socket,
      'match:snapshot',
      (s) =>
        s.tick > settled.tick && !s.entities.some((e) => e.kind === KIND.SOLAR),
      20_000,
    );
    expect(gone.teams[0].coreLux).toBeGreaterThan(80_000 + 12_000 - 1); // 60% of 20 lux, plus income

    // The server ends the match; the replay it recorded plays back with every hash intact.
    const stopped = await api(t.url, `/api/matches/${matchId}/stop`, {
      method: 'POST',
      token: halo.token,
    });
    const verify = await api(
      t.url,
      `/api/replays/${stopped.body.replayId}/verify`,
      { method: 'POST', token: halo.token },
    );
    expect(verify.body).toMatchObject({ ok: true, firstMismatchTick: null });
    const record = await api(t.url, `/api/replays/${stopped.body.replayId}`, {
      token: halo.token,
    });
    const log = record.body.replay.commands.map(
      (c: { cmd: { t: string } }) => c.cmd.t,
    );
    expect(log).toEqual(['build', 'build', 'build', 'recycle']); // refused commands are logged too, so the replay shows what the player sent
  }, 60_000);
});
