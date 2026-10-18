import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MatchRunnerService } from '../src/game/match-runner.service.js';
import {
  ack,
  api,
  connectSocket,
  createTestApp,
  guest,
  type TestApp,
  waitFor,
} from './helpers/create-app.js';

/**
 * Two servers that share Redis, RabbitMQ and MongoDB: a client on one reaches a match that the other
 * runs. Runs when TEST_REDIS_URL, TEST_RABBITMQ_URL and TEST_MONGODB_URL are set.
 */
const REDIS = process.env.TEST_REDIS_URL as string;
const RABBIT = process.env.TEST_RABBITMQ_URL as string;
const MONGO = process.env.TEST_MONGODB_URL as string;
const database = `luxcores_cluster_${Date.now()}`;
/** A prefix of its own, so these servers never touch the keys of another test file that shares the Redis. */
const PREFIX = `c-${Date.now().toString(36)}`;

interface Snapshot {
  matchId: string;
  tick: number;
  entities: { kind: number; team: number }[];
}

const shared = (extra: Record<string, string> = {}): Record<string, string> => ({
  MATCH_MAX_TICKS: '5000',
  CHECKPOINT_EVERY_TICKS: '20',
  REDIS_URL: REDIS,
  REDIS_KEY_PREFIX: PREFIX,
  RABBITMQ_URL: RABBIT,
  MONGODB_URL: MONGO,
  MONGODB_DB: database,
  DATABASE_DRIVER: 'auto',
  CLUSTER_LEASE_MS: '2000',
  CLUSTER_ADOPT_EVERY_MS: '400',
  RABBITMQ_QUEUE: `luxcores.events.${database}`,
  ...extra,
});

const node = (name: string, extra: Record<string, string> = {}) => createTestApp(shared({ NODE_ID: name, ...extra }));

describe.skipIf(!REDIS || !RABBIT || !MONGO)('two servers, one match', () => {
  let mongo: MongoClient;
  beforeAll(async () => {
    mongo = new MongoClient(MONGO);
    await mongo.connect();
  });
  afterAll(async () => {
    await mongo.db(database).dropDatabase().catch(() => undefined);
    await mongo.close();
  });

  it('lets a client on the second server join, command and stop a match that the first one runs', async () => {
    const a = await node('node-a');
    const b = await node('node-b');
    try {
      const halo = await guest(a.url, 'Halo');
      const created = await api(a.url, '/api/matches', { token: halo.token, body: { name: 'Shared', vsBot: true, seed: 31 } });
      const matchId: string = created.body.id;
      const started = await api(a.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
      expect(started.status).toBe(200);

      expect((await api(a.url, '/api/health')).body.cluster).toMatchObject({ nodeId: 'node-a', ownership: 'redis', commands: 'rabbitmq', matches: 1 });
      expect((await api(b.url, '/api/health')).body.cluster).toMatchObject({ nodeId: 'node-b', matches: 0 });
      expect(a.app.get(MatchRunnerService).isRunning(matchId)).toBe(true);
      expect(b.app.get(MatchRunnerService).isRunning(matchId)).toBe(false);

      // The player's socket sits on node B. Node B runs nothing, and still answers the join with a live snapshot.
      const socket = await connectSocket(b.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined).toMatchObject({ ok: true, role: 'player', status: 'running', nextSeq: 0 });
      expect(joined.snapshot.entities.length).toBeGreaterThan(0);

      // Snapshots arrive through Redis.
      const first = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick > joined.snapshot.tick, 10_000);

      // A command sent to node B reaches node A through the match queue, and the ack says what it would say on A.
      const sent = await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 } });
      expect(sent).toMatchObject({ accepted: true });
      expect(sent.tick).toBeGreaterThanOrEqual(first.tick - 5);
      const later = await waitFor<Snapshot>(
        socket,
        'match:snapshot',
        (s) => s.entities.some((e) => e.kind === 2 && e.team === 0),
        10_000,
      );
      expect(later.tick).toBeGreaterThan(first.tick);
      expect(await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'wind', tileX: 46, tileZ: 90 } })).toMatchObject({
        accepted: false,
        nextSeq: 1,
      });

      // The lobby events travel too: the stop is requested on B, runs on A, and B's client hears the end.
      const ended = waitFor(socket, 'match:ended', () => true, 10_000);
      const stopped = await api(b.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      expect(stopped.status).toBe(200);
      expect(stopped.body.status).toBe('finished');
      await ended;
      expect((await api(a.url, '/api/health')).body.cluster.matches).toBe(0);
      socket.close();
    } finally {
      await b.close();
      await a.close();
    }
  }, 120_000);

  it('hands a running match to the other server when its server stops, and the client carries on', async () => {
    const a = await node('node-a');
    const b = await node('node-b');
    try {
      const halo = await guest(a.url, 'Halo');
      const created = await api(a.url, '/api/matches', { token: halo.token, body: { name: 'Failover', vsBot: true, seed: 32 } });
      const matchId: string = created.body.id;
      await api(a.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
      const socket = await connectSocket(b.url, halo.token);
      await ack(socket, 'match:join', { matchId });
      await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 } });
      await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= 90, 15_000);

      await a.shutdown(); // node A stops and lets its matches go; node B finds them without a lease
      await waitFor(socket, 'match:snapshot', (s: Snapshot) => s.tick > 0, 15_000).catch(() => undefined);
      await b.app.get(MatchRunnerService).resumed;
      for (let i = 0; i < 40 && !b.app.get(MatchRunnerService).isRunning(matchId); i++) await new Promise((r) => setTimeout(r, 250));
      expect(b.app.get(MatchRunnerService).isRunning(matchId), 'node B took the match').toBe(true);

      const resumed = await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.matchId === matchId, 10_000);
      expect(resumed.entities.some((e) => e.kind === 2 && e.team === 0)).toBe(true);
      expect(await ack(socket, 'match:command', { matchId, seq: 1, cmd: { t: 'build', building: 'wind', tileX: 46, tileZ: 90 } })).toMatchObject({ accepted: true });
      await api(b.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      socket.close();
    } finally {
      await b.close();
      await a.close();
    }
  }, 120_000);

  it('sends the commands of a local match through its queue when asked to', async () => {
    const solo = await node('node-solo', { COMMAND_TRANSPORT: 'queue' });
    try {
      const halo = await guest(solo.url, 'Halo');
      const created = await api(solo.url, '/api/matches', { token: halo.token, body: { name: 'Queued', vsBot: true, seed: 33 } });
      const matchId: string = created.body.id;
      await api(solo.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
      const socket = await connectSocket(solo.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined).toMatchObject({ ok: true, nextSeq: 0 });
      expect(await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 } })).toMatchObject({ accepted: true });
      await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.entities.some((e) => e.kind === 2 && e.team === 0), 10_000);
      await api(solo.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      socket.close();
    } finally {
      await solo.close();
    }
  }, 60_000);

  it('works alone when Redis and RabbitMQ are both unreachable', async () => {
    const t = await node('node-alone', { REDIS_URL: 'redis://127.0.0.1:1', REDIS_TIMEOUT_MS: '500', RABBITMQ_URL: 'amqp://guest:guest@127.0.0.1:1', MONGODB_URL: 'mongodb://127.0.0.1:1', DATABASE_TIMEOUT_MS: '500' });
    try {
      const health = (await api(t.url, '/api/health')).body;
      expect(health.cluster).toMatchObject({ ownership: 'local', commands: 'local' });
      expect(health.events).toBe('local');
      const halo = await guest(t.url, 'Halo');
      const created = await api(t.url, '/api/matches', { token: halo.token, body: { name: 'Alone', vsBot: true, seed: 34 } });
      const matchId: string = created.body.id;
      await api(t.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
      const socket = await connectSocket(t.url, halo.token);
      await ack(socket, 'match:join', { matchId });
      expect(await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 } })).toMatchObject({ accepted: true });
      const ended = waitFor(socket, 'match:ended', () => true, 10_000);
      await api(t.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      await ended;
      socket.close();
    } finally {
      await t.close();
    }
  }, 60_000);
});

export type { TestApp };
