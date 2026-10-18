import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalCommandBus } from '../src/cluster/command-bus.js';
import { LocalOwnership } from '../src/cluster/match-ownership.js';
import { RabbitCommandBus } from '../src/cluster/rabbit-command-bus.js';
import { RedisOwnership } from '../src/cluster/redis-ownership.js';
import { RoomRelay } from '../src/cluster/room-relay.js';
import { RedisHandle } from '../src/redis/redis.handle.js';
import { TcpProxy } from './helpers/tcp-proxy.js';

const REDIS = process.env.TEST_REDIS_URL as string;
const RABBIT = process.env.TEST_RABBITMQ_URL as string;
const id = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LocalOwnership and LocalCommandBus', () => {
  it('owns what it claims and nothing else', async () => {
    const own = new LocalOwnership('n1');
    expect(await own.ownerOf('m')).toBeNull();
    expect(await own.claim('m')).toBe(true);
    expect(await own.ownerOf('m')).toBe('n1');
    await own.release('m');
    expect(await own.ownerOf('m')).toBeNull();
  });

  it('hands a request to the handler of the match, answers null for an unknown match and turns a throw into an error reply', async () => {
    const bus = new LocalCommandBus();
    await bus.serve('m', async (rpc) => ({ got: rpc.t }));
    expect(await bus.request('m', { t: 'stop' }, 100)).toEqual({ got: 'stop' });
    expect(await bus.request('other', { t: 'stop' }, 100)).toBeNull();
    await bus.serve('boom', async () => {
      throw new Error('nope');
    });
    expect(await bus.request('boom', { t: 'stop' }, 100)).toEqual({ error: 'nope' });
    await bus.unserve('m');
    expect(await bus.request('m', { t: 'stop' }, 100)).toBeNull();
  });
});

describe.skipIf(!REDIS)('RedisOwnership', () => {
  let redis: RedisHandle;
  beforeAll(async () => {
    redis = await RedisHandle.connect(REDIS);
  });
  afterAll(() => redis.close());

  it('gives a match to one node at a time, and the owner is visible to the other', async () => {
    const a = new RedisOwnership(redis, 'node-a', 5000);
    const b = new RedisOwnership(redis, 'node-b', 5000);
    const m = id();
    try {
      expect(await a.claim(m)).toBe(true);
      expect(await a.claim(m), 'a second claim by the owner is harmless').toBe(true);
      expect(await b.claim(m)).toBe(false);
      expect(await b.ownerOf(m)).toBe('node-a');
      await a.release(m);
      expect(await b.ownerOf(m)).toBeNull();
      expect(await b.claim(m)).toBe(true);
      await b.release(m);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('lets a node that restarts under its own id take its old lease back', async () => {
    const first = new RedisOwnership(redis, 'same', 5000);
    const m = id();
    await first.claim(m);
    await first.close();
    const again = new RedisOwnership(redis, 'same', 5000);
    expect(await again.claim(m)).toBe(true);
    await again.release(m);
    await again.close();
  });

  it('expires a lease nobody renews, so another node can take the match', async () => {
    const dead = new RedisOwnership(redis, 'dead', 600);
    const other = new RedisOwnership(redis, 'other', 600);
    const m = id();
    await dead.claim(m);
    await dead.close(); // stops renewing, as a crashed node does
    expect(await other.claim(m)).toBe(false);
    await wait(800);
    expect(await other.claim(m)).toBe(true);
    await other.release(m);
    await other.close();
  });

  it('keeps a lease alive by renewing it', async () => {
    const own = new RedisOwnership(redis, 'steady', 600);
    const rival = new RedisOwnership(redis, 'rival', 600);
    const m = id();
    await own.claim(m);
    await wait(1500); // longer than the lease
    expect(await rival.claim(m)).toBe(false);
    await own.release(m);
    await own.close();
    await rival.close();
  });

  it('steps down when another node holds the lease', async () => {
    const own = new RedisOwnership(redis, 'loser', 600);
    const m = id();
    const lost: string[] = [];
    own.onLost((x) => lost.push(x));
    await own.claim(m);
    await redis.client.set(`lux:owner:${m}`, 'thief', { expiration: { type: 'PX', value: 5000 } });
    await wait(500);
    expect(lost).toEqual([m]);
    expect(own.held()).toEqual([]);
    await redis.client.del(`lux:owner:${m}`);
    await own.close();
  });

  it('keeps its matches while Redis is away, because no other node can claim them either', async () => {
    const proxy = new TcpProxy(new URL(REDIS).hostname, Number(new URL(REDIS).port || 6379));
    const port = await proxy.start();
    const viaProxy = await RedisHandle.connect(`redis://127.0.0.1:${port}`);
    const own = new RedisOwnership(viaProxy, 'steady', 600);
    const m = id();
    const lost: string[] = [];
    own.onLost((x) => lost.push(x));
    try {
      await own.claim(m);
      await proxy.cut();
      await wait(1500);
      expect(lost).toEqual([]);
      expect(own.held()).toEqual([m]);
      await proxy.start(port);
      await wait(2500); // reconnects, finds the lease expired, and takes it again
      expect(await own.ownerOf(m)).toBe('steady');
      expect(lost).toEqual([]);
    } finally {
      await own.close();
      await viaProxy.close();
      await proxy.stop();
      await redis.client.del(`lux:owner:${m}`);
    }
  }, 20_000);
});

describe.skipIf(!REDIS)('RoomRelay', () => {
  let redis: RedisHandle;
  beforeAll(async () => {
    redis = await RedisHandle.connect(REDIS);
  });
  afterAll(() => redis.close());

  it('carries events to a node that follows the room, and not back to the sender', async () => {
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    const a = new RoomRelay(redis, 'a', (m, e, d) => gotA.push([m, e, d]));
    const b = new RoomRelay(redis, 'b', (m, e, d) => gotB.push([m, e, d]));
    const m = id();
    await a.watch(m);
    await b.watch(m);
    a.publish(m, 'match:snapshot', { tick: 1 });
    await wait(200);
    expect(gotB).toEqual([[m, 'match:snapshot', { tick: 1 }]]);
    expect(gotA, 'a node does not hear itself').toEqual([]);
    await a.unwatch(m);
    await b.unwatch(m);
    await a.close();
    await b.close();
  });

  it('publishes nothing while no other node follows the room', async () => {
    const lone = new RoomRelay(redis, 'lone', () => undefined);
    const m = id();
    await lone.watch(m);
    const watcher = await redis.subscriber(); // a probe that counts what is published
    let seen = 0;
    await watcher.pSubscribe(`lux:room:${m}`, () => {
      seen++;
    });
    // A pattern subscription is not a channel subscriber, so the relay does not count the probe as another node.
    lone.publish(m, 'match:snapshot', { tick: 2 });
    await wait(200);
    expect(seen, 'nothing was published').toBe(0);
    await watcher.pUnsubscribe(`lux:room:${m}`);
    await lone.unwatch(m);
    await lone.close();
  });

  it('stops delivering once the last client of a node has left', async () => {
    const got: unknown[] = [];
    const a = new RoomRelay(redis, 'a', () => undefined);
    const b = new RoomRelay(redis, 'b', (_m, e) => got.push(e));
    const m = id();
    await b.watch(m);
    await b.watch(m); // two clients on node b
    await b.unwatch(m);
    a.publish(m, 'one', 1);
    await wait(150);
    expect(got).toEqual(['one']);
    await b.unwatch(m); // the last one leaves
    await wait(1100); // the count of followers is cached for a second
    a.publish(m, 'two', 2);
    await wait(150);
    expect(got).toEqual(['one']);
    await a.close();
    await b.close();
  });
});

describe.skipIf(!RABBIT)('RabbitCommandBus', () => {
  const buses: RabbitCommandBus[] = [];
  const open = async (): Promise<RabbitCommandBus> => {
    const bus = new RabbitCommandBus(RABBIT);
    await bus.connect(5000);
    buses.push(bus);
    return bus;
  };
  afterAll(async () => {
    for (const bus of buses) await bus.close();
  });

  it('delivers a request to the node that serves the match and returns its reply', async () => {
    const owner = await open();
    const caller = await open();
    const m = id();
    await owner.serve(m, async (rpc) => ({ accepted: true, echoed: rpc }));
    const reply = await caller.request(m, { t: 'command', playerId: 'p', seq: 3, cmd: { t: 'noop' } }, 2000);
    expect(reply).toEqual({ accepted: true, echoed: { t: 'command', playerId: 'p', seq: 3, cmd: { t: 'noop' } } });
    await owner.unserve(m);
  });

  it('answers a failing handler with an error reply, and an unserved match with null', async () => {
    const owner = await open();
    const caller = await open();
    const m = id();
    await owner.serve(m, async () => {
      throw new Error('refused');
    });
    expect(await caller.request(m, { t: 'stop' }, 2000)).toEqual({ error: 'refused' });
    await owner.unserve(m);
    const started = Date.now();
    expect(await caller.request(m, { t: 'stop' }, 400)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('gives each match its own queue, so one match never reads the commands of another', async () => {
    const owner = await open();
    const caller = await open();
    const [x, y] = [id(), id()];
    await owner.serve(x, async () => 'x');
    await owner.serve(y, async () => 'y');
    expect(await caller.request(x, { t: 'stop' }, 2000)).toBe('x');
    expect(await caller.request(y, { t: 'stop' }, 2000)).toBe('y');
    await owner.unserve(x);
    await owner.unserve(y);
  });

  it('answers null at once while the broker is away, and works again after it returns', async () => {
    const url = new URL(RABBIT);
    const proxy = new TcpProxy(url.hostname, Number(url.port || 5672));
    const port = await proxy.start();
    const bus = new RabbitCommandBus(`amqp://${url.username || 'guest'}:${url.password || 'guest'}@127.0.0.1:${port}`);
    await bus.connect(5000);
    buses.push(bus);
    const caller = await open();
    const m = id();
    await bus.serve(m, async () => 'alive');
    expect(await caller.request(m, { t: 'stop' }, 2000)).toBe('alive');
    await proxy.cut();
    await wait(300);
    const started = Date.now();
    expect(await bus.request(m, { t: 'stop' }, 1500)).toBeNull();
    expect(Date.now() - started, 'no waiting on a dead connection').toBeLessThan(300);
    await proxy.start(port);
    await wait(3500); // the connection manager reconnects and consumes the queue again
    expect(await caller.request(m, { t: 'stop' }, 2000)).toBe('alive');
    await proxy.stop();
  }, 30_000);
});
