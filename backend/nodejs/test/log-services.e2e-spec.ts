import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MongoClient } from 'mongodb';
import { createClient } from '@redis/client';
import { afterAll, describe, expect, it } from 'vitest';
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
 * The whole server with the match log on Redis and MongoDB. Runs when TEST_REDIS_URL and
 * TEST_MONGODB_URL are set. Each run uses its own Mongo database.
 */
const REDIS = process.env.TEST_REDIS_URL as string;
const MONGO = process.env.TEST_MONGODB_URL as string;
const database = `luxcores_e2e_${Date.now()}`;

interface Snapshot {
  tick: number;
  entities: { kind: number; team: number }[];
}

const settings = (extra: Record<string, string> = {}) => ({
  MATCH_MAX_TICKS: '6000',
  CHECKPOINT_EVERY_TICKS: '20',
  REDIS_URL: REDIS,
  MONGODB_URL: MONGO,
  MONGODB_DB: database,
  DATABASE_DRIVER: 'auto',
  ...extra,
});

async function play(t: TestApp, seed: number, tick: number) {
  const halo = await guest(t.url, 'Halo');
  const created = await api(t.url, '/api/matches', { token: halo.token, body: { name: 'Stored', vsBot: true, seed } });
  const matchId: string = created.body.id;
  const socket = await connectSocket(t.url, halo.token);
  await ack(socket, 'match:join', { matchId });
  const started = waitFor(socket, 'match:started');
  await api(t.url, `/api/matches/${matchId}/start`, { method: 'POST', token: halo.token });
  await started;
  expect(
    await ack(socket, 'match:command', { matchId, seq: 0, cmd: { t: 'build', building: 'solar', tileX: 44, tileZ: 90 } }),
  ).toMatchObject({ accepted: true });
  await waitFor<Snapshot>(socket, 'match:snapshot', (s) => s.tick >= tick, 30_000);
  socket.close();
  return { halo, matchId };
}

const eventFiles = async (t: TestApp): Promise<string[]> =>
  readdir(join(dirname(t.dbPath), 'events')).catch(() => []);

describe.skipIf(!REDIS || !MONGO)('match log on Redis and MongoDB', () => {
  const mongo = new MongoClient(MONGO);
  const redis = createClient({ url: REDIS });
  afterAll(async () => {
    await mongo.db(database).dropDatabase().catch(() => undefined);
    await mongo.close();
    if (redis.isOpen) await redis.quit();
  });

  it('moves a running match into MongoDB, leaves no file or stream behind, and resumes from there', async () => {
    await mongo.connect();
    await redis.connect();
    const first = await createTestApp(settings());
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await play(first, 21, 110);
      const health = await api(first.url, '/api/health');
      expect(health.body.database).toMatchObject({ driver: 'mongodb', active: 'mongodb', degraded: false });
      expect(health.body.eventLog.tiers).toEqual([
        { name: 'redis', up: true },
        { name: 'mongodb', up: true },
        { name: 'file', up: true },
      ]);
      await first.shutdown(); // flushes to Redis and moves everything on to MongoDB

      const events = mongo.db(database).collection('match_events');
      const stored = await events.find({ matchId }).sort({ seq: 1 }).toArray();
      expect(stored.length).toBeGreaterThanOrEqual(8);
      expect(stored.map((e) => e.seq)).toEqual(stored.map((_, i) => i));
      expect(stored[0]).toMatchObject({ type: 'started', tick: 0 });
      expect(await mongo.db(database).collection('match_checkpoints').findOne({ _id: matchId as never })).toMatchObject({
        checkpoints: expect.any(Array),
      });
      expect(await redis.xLen(`lux:match:${matchId}:events`), 'the stream was emptied').toBe(0);
      expect(await eventFiles(first), 'no file was needed').not.toContain(`${matchId}.ndjson`);

      second = await createTestApp(settings({ JSON_DB_PATH: first.dbPath }));
      await second.app.get(MatchRunnerService).resumed;
      const socket = await connectSocket(second.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined).toMatchObject({ ok: true, status: 'running', nextSeq: 1 });
      expect(joined.snapshot.entities.some((e: { kind: number; team: number }) => e.kind === 2 && e.team === 0)).toBe(true);

      // The match ends, its replay is saved, and the events stay for the retention period.
      const stopped = await api(second.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      expect(stopped.body.status).toBe('finished');
      await second.shutdown();
      expect((await events.countDocuments({ matchId })) > stored.length, 'the stop was logged too').toBe(true);
      expect(await mongo.db(database).collection('match_checkpoints').countDocuments({ _id: matchId as never }), 'checkpoints go').toBe(0);
      socket.close();
    } finally {
      await second?.close();
      await first.close();
    }
  }, 120_000);

  it('keeps a running match in Redis when MongoDB is away, and resumes from the stream', async () => {
    await redis.connect().catch(() => undefined);
    const away = { MONGODB_URL: 'mongodb://127.0.0.1:1', DATABASE_TIMEOUT_MS: '500' };
    const first = await createTestApp(settings(away));
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await play(first, 22, 110);
      expect((await api(first.url, '/api/health')).body.database).toMatchObject({ driver: 'mongodb', active: 'json', degraded: true });
      await first.shutdown();
      expect(await redis.exists(`lux:match:${matchId}:events`), 'the stream holds the log').toBe(1);
      expect(await eventFiles(first)).not.toContain(`${matchId}.ndjson`);

      second = await createTestApp(settings({ ...away, JSON_DB_PATH: first.dbPath }));
      await second.app.get(MatchRunnerService).resumed;
      const socket = await connectSocket(second.url, halo.token);
      const joined = await ack(socket, 'match:join', { matchId });
      expect(joined).toMatchObject({ ok: true, status: 'running' });
      expect(joined.snapshot.tick).toBeGreaterThan(80);
      await api(second.url, `/api/matches/${matchId}/stop`, { method: 'POST', token: halo.token });
      socket.close();
      expect(await redis.exists(`lux:match:${matchId}:events`), 'the stream is deleted with the match').toBe(0);
    } finally {
      await second?.close();
      await first.close();
    }
  }, 120_000);

  it('writes files when Redis and MongoDB are both away, and still resumes', async () => {
    const away = { REDIS_URL: 'redis://127.0.0.1:1', REDIS_TIMEOUT_MS: '500', MONGODB_URL: 'mongodb://127.0.0.1:1', DATABASE_TIMEOUT_MS: '500' };
    const first = await createTestApp(settings(away));
    let second: TestApp | undefined;
    try {
      const { halo, matchId } = await play(first, 23, 90);
      expect((await api(first.url, '/api/health')).body.eventLog).toMatchObject({ writing: 'file' });
      await first.shutdown();
      expect(await eventFiles(first)).toContain(`${matchId}.ndjson`);
      second = await createTestApp(settings({ ...away, JSON_DB_PATH: first.dbPath }));
      await second.app.get(MatchRunnerService).resumed;
      const socket = await connectSocket(second.url, halo.token);
      expect(await ack(socket, 'match:join', { matchId })).toMatchObject({ ok: true, status: 'running' });
      socket.close();
    } finally {
      await second?.close();
      await first.close();
    }
  }, 120_000);
});
