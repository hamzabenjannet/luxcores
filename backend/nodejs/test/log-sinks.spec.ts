import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoHandle } from '../src/database/mongo.handle.js';
import { FileLogSink } from '../src/matchlog/file-log-sink.js';
import type { BufferSink, LogSink } from '../src/matchlog/log-sink.js';
import type { Checkpoint, MatchEvent } from '../src/matchlog/match-event.js';
import { MongoLogSink } from '../src/matchlog/mongo-log-sink.js';
import { RedisStreamSink } from '../src/matchlog/redis-stream-sink.js';
import { TieredEventLog } from '../src/matchlog/tiered-event-log.js';
import { RedisHandle } from '../src/redis/redis.handle.js';
import { TcpProxy } from './helpers/tcp-proxy.js';

/**
 * The same assertions run against every log sink. The file sink always runs. Redis and MongoDB run
 * when TEST_REDIS_URL and TEST_MONGODB_URL are set:
 *   TEST_REDIS_URL=redis://localhost:6379
 *   TEST_MONGODB_URL=mongodb://localhost:27017
 */
const unique = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const event = (matchId: string, seq: number): MatchEvent =>
  ({ matchId, seq, tick: seq * 2, type: 'command', data: { playerId: 0, seq, cmd: { t: 'build', building: 'solar', tileX: 1, tileZ: 2 } } }) as MatchEvent;
const checkpoint = (matchId: string, seq: number): Checkpoint => ({
  matchId,
  seq,
  tick: seq * 2,
  hash: `h${seq}`,
  state: { tick: seq * 2, entities: [{ id: 1, x: 5 }] },
  bots: [{ playerId: 1, memory: { rotation: 3 } }],
});
const bySeq = (events: MatchEvent[]) => [...new Map(events.map((e) => [e.seq, e])).values()].sort((a, b) => a.seq - b.seq);

function contract(name: string, make: () => Promise<{ sink: LogSink; cleanup: () => Promise<void> }>, skip = false) {
  describe.skipIf(skip)(`LogSink contract: ${name}`, () => {
    let sink: LogSink;
    let cleanup: () => Promise<void>;
    beforeAll(async () => {
      ({ sink, cleanup } = await make());
    });
    afterAll(async () => {
      await cleanup();
    });

    it('stores events and reads them back with their data intact', async () => {
      const id = unique();
      await sink.write({ events: [event(id, 0), event(id, 1)], checkpoints: [] });
      await sink.write({ events: [event(id, 2)], checkpoints: [] });
      const read = await sink.read(id);
      expect(bySeq(read.events)).toEqual([event(id, 0), event(id, 1), event(id, 2)]);
      expect(await sink.read(unique())).toEqual({ events: [], checkpoints: [] });
    });

    it('keeps the two newest checkpoints, newest first', async () => {
      const id = unique();
      for (const seq of [4, 8, 12]) await sink.write({ events: [], checkpoints: [checkpoint(id, seq)] });
      expect((await sink.read(id)).checkpoints).toEqual([checkpoint(id, 12), checkpoint(id, 8)]);
    });

    it('stores a repeated batch without harm: a reader still finds one event per position', async () => {
      const id = unique();
      const batch = { events: [event(id, 0), event(id, 1)], checkpoints: [] };
      await sink.write(batch);
      await sink.write(batch);
      expect(bySeq((await sink.read(id)).events)).toHaveLength(2);
    });

    it('deletes a match, or only its checkpoints on request', async () => {
      const id = unique();
      await sink.write({ events: [event(id, 0)], checkpoints: [checkpoint(id, 1)] });
      await sink.purge(id, { keepEvents: true });
      const kept = await sink.read(id);
      expect(kept.events).toHaveLength(1);
      expect(kept.checkpoints).toHaveLength(0);
      await sink.purge(id);
      expect(await sink.read(id)).toEqual({ events: [], checkpoints: [] });
    });

    it('survives a match id it should not accept', async () => {
      if (name === 'mongodb') return; // the Mongo sink stores ids as data, so there is nothing to refuse
      await expect(sink.read('../etc/passwd')).rejects.toThrow();
    });
  });
}

const dir = mkdtemp(join(tmpdir(), 'luxcores-sinks-'));
contract('file', async () => {
  const path = await dir;
  return { sink: new FileLogSink(path), cleanup: () => rm(path, { recursive: true, force: true }) };
});

contract(
  'redis',
  async () => {
    const handle = await RedisHandle.connect(process.env.TEST_REDIS_URL as string);
    return { sink: new RedisStreamSink(handle), cleanup: () => handle.close() };
  },
  !process.env.TEST_REDIS_URL,
);

contract(
  'mongodb',
  async () => {
    const handle = await MongoHandle.connect(process.env.TEST_MONGODB_URL as string, `luxcores_test_${Date.now()}`);
    return {
      sink: new MongoLogSink(handle.db, 14),
      cleanup: async () => {
        await handle.db.dropDatabase();
        await handle.close();
      },
    };
  },
  !process.env.TEST_MONGODB_URL,
);

describe.skipIf(!process.env.TEST_REDIS_URL)('RedisStreamSink as a buffer', () => {
  let handle: RedisHandle;
  let buffer: BufferSink;
  beforeAll(async () => {
    handle = await RedisHandle.connect(process.env.TEST_REDIS_URL as string);
    buffer = new RedisStreamSink(handle);
  });
  afterAll(() => handle.close());

  it('hands on what it holds, oldest first, and forgets it after a trim', async () => {
    const id = unique();
    await buffer.write({ events: [event(id, 0), event(id, 1)], checkpoints: [checkpoint(id, 2)] });
    await buffer.write({ events: [event(id, 2)], checkpoints: [] });
    expect(await buffer.matchIds()).toContain(id);
    const first = await buffer.peek(id, 1);
    expect(first.events.map((e) => e.seq)).toEqual([0, 1]); // one entry holds the events of one flush
    expect(first.checkpoints.map((c) => c.seq)).toEqual([2]);
    await buffer.trim(id, first.cursor);
    const second = await buffer.peek(id, 10);
    expect(second.events.map((e) => e.seq)).toEqual([2]);
    expect(second.checkpoints, 'a checkpoint is handed on once').toEqual([]);
    await buffer.trim(id, second.cursor);
    expect((await buffer.peek(id, 10)).events).toEqual([]);
  });

  it('hands on a checkpoint that comes without events', async () => {
    const id = unique();
    await buffer.write({ events: [event(id, 0)], checkpoints: [] });
    const first = await buffer.peek(id, 10);
    await buffer.trim(id, first.cursor);
    await buffer.write({ events: [], checkpoints: [checkpoint(id, 1)] });
    const next = await buffer.peek(id, 10);
    expect(next.events).toEqual([]);
    expect(next.checkpoints.map((c) => c.seq)).toEqual([1]);
  });

  it('fails at once while Redis is away, so the caller can use another place', async () => {
    const proxy = new TcpProxy(new URL(process.env.TEST_REDIS_URL as string).hostname, Number(new URL(process.env.TEST_REDIS_URL as string).port || 6379));
    const port = await proxy.start();
    const viaProxy = await RedisHandle.connect(`redis://127.0.0.1:${port}`);
    const sink = new RedisStreamSink(viaProxy);
    const id = unique();
    try {
      await sink.write({ events: [event(id, 0)], checkpoints: [] });
      await proxy.cut();
      await new Promise((r) => setTimeout(r, 200));
      const started = Date.now();
      await expect(sink.write({ events: [event(id, 1)], checkpoints: [] })).rejects.toThrow();
      expect(Date.now() - started, 'no waiting on a dead connection').toBeLessThan(500);
      await proxy.start(port);
      await new Promise((r) => setTimeout(r, 1500)); // the client reconnects by itself
      await sink.write({ events: [event(id, 2)], checkpoints: [] });
      expect(bySeq((await sink.read(id)).events).map((e) => e.seq)).toEqual([0, 2]);
      await sink.purge(id);
    } finally {
      await viaProxy.close();
      await proxy.stop();
    }
  }, 20_000);
});

describe.skipIf(!process.env.TEST_REDIS_URL || !process.env.TEST_MONGODB_URL)('the tiered log on Redis and MongoDB', () => {
  let redis: RedisHandle;
  let mongo: MongoHandle;
  let dirPath: string;
  const make = (keep = true) =>
    new TieredEventLog({
      file: new FileLogSink(dirPath),
      buffer: new RedisStreamSink(redis),
      store: new MongoLogSink(mongo.db, 14),
      flushMs: 10,
      drainMs: 50,
      retryMs: 100,
      keepStoredEvents: keep,
    });

  beforeAll(async () => {
    redis = await RedisHandle.connect(process.env.TEST_REDIS_URL as string);
    mongo = await MongoHandle.connect(process.env.TEST_MONGODB_URL as string, `luxcores_test_${Date.now()}`);
    dirPath = await mkdtemp(join(tmpdir(), 'luxcores-tiered-'));
  });
  afterAll(async () => {
    await mongo.db.dropDatabase();
    await mongo.close();
    await redis.close();
    await rm(dirPath, { recursive: true, force: true });
  });

  it('writes to Redis, moves the events to MongoDB in the background and empties the stream', async () => {
    const id = unique();
    const log = make();
    for (let i = 0; i < 50; i++) log.append(id, { type: 'hash', tick: i * 20, data: { hash: `h${i}` } });
    log.saveCheckpoint({ matchId: id, tick: 1000, hash: 'x', state: { a: 1 }, bots: [] });
    await new Promise((r) => setTimeout(r, 400));
    const stored = await new MongoLogSink(mongo.db, 14).read(id);
    expect(stored.events).toHaveLength(50);
    expect(stored.checkpoints).toHaveLength(1);
    expect((await new RedisStreamSink(redis).peek(id, 100)).events, 'the stream is empty').toEqual([]);
    expect((await log.read(id)).map((e) => e.seq)).toEqual([...Array(50).keys()]);
    await log.close();
  });

  it('keeps a finished match in MongoDB when the retention says so, and clears Redis and the files', async () => {
    const id = unique();
    const log = make(true);
    log.append(id, { type: 'hash', tick: 20, data: { hash: 'a' } });
    await log.purge(id);
    expect((await new MongoLogSink(mongo.db, 14).read(id)).events).toHaveLength(1);
    expect((await new RedisStreamSink(redis).read(id)).events).toEqual([]);
    await log.close();
  });

  it('removes a finished match from MongoDB when the retention is zero', async () => {
    const id = unique();
    const log = make(false);
    log.append(id, { type: 'hash', tick: 20, data: { hash: 'a' } });
    await log.purge(id);
    expect((await new MongoLogSink(mongo.db, 14).read(id)).events).toEqual([]);
    await log.close();
  });

  it('keeps every event through a Redis outage and an MongoDB outage, and merges them on a read', async () => {
    const redisProxy = new TcpProxy(new URL(process.env.TEST_REDIS_URL as string).hostname, Number(new URL(process.env.TEST_REDIS_URL as string).port || 6379));
    const mongoProxy = new TcpProxy(new URL(process.env.TEST_MONGODB_URL as string).hostname, Number(new URL(process.env.TEST_MONGODB_URL as string).port || 27017));
    const redisPort = await redisProxy.start();
    const mongoPort = await mongoProxy.start();
    const viaRedis = await RedisHandle.connect(`redis://127.0.0.1:${redisPort}`);
    const viaMongo = await MongoHandle.connect(`mongodb://127.0.0.1:${mongoPort}/?directConnection=true`, mongo.dbName, 800);
    const log = new TieredEventLog({
      file: new FileLogSink(dirPath),
      buffer: new RedisStreamSink(viaRedis),
      store: new MongoLogSink(viaMongo.db, 14),
      flushMs: 10,
      drainMs: 60_000, // the test drives the moves
      retryMs: 100,
      keepStoredEvents: true,
    });
    const id = unique();
    const put = async (from: number, to: number) => {
      for (let i = from; i < to; i++) log.append(id, { type: 'hash', tick: i * 20, data: { hash: `h${i}` } });
      await log.flush();
    };
    try {
      await put(0, 10); // Redis
      await redisProxy.cut();
      await new Promise((r) => setTimeout(r, 250));
      await put(10, 20); // MongoDB
      await mongoProxy.cut();
      await new Promise((r) => setTimeout(r, 1200));
      await put(20, 30); // the file
      expect(log.status().writing).toBe('file');
      await redisProxy.start(redisPort);
      await mongoProxy.start(mongoPort);
      await new Promise((r) => setTimeout(r, 2500)); // both clients reconnect by themselves
      expect((await log.read(id)).map((e) => e.seq), 'all three places form one log').toEqual([...Array(30).keys()]);
      await put(30, 35);
      expect((await log.read(id)).map((e) => e.seq)).toEqual([...Array(35).keys()]);
    } finally {
      await log.close().catch(() => undefined);
      await viaRedis.close().catch(() => undefined);
      await viaMongo.close().catch(() => undefined);
      await redisProxy.stop();
      await mongoProxy.stop();
    }
  }, 40_000);
});
