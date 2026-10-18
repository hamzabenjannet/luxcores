import { Logger } from '@nestjs/common';
import { createClient, type RedisClientType } from '@redis/client';
import { withinWindow } from '../common/startup-wait.js';

/** Injection token for the shared Redis connection. Its value is a `RedisHandle`, or null when Redis is not in use. */
export const REDIS_HANDLE = 'REDIS_HANDLE';

/** Longest pause between two attempts to reconnect, in milliseconds. */
const MAX_BACKOFF_MS = 3000;

/**
 * The server's Redis connection. It is opened once at start-up. When Redis is unreachable then, the
 * server runs without it until the next restart. Once connected, the client reconnects by itself after an
 * outage, and commands sent while it is away fail at once instead of queueing, so the callers can fall back.
 */
export class RedisHandle {
  private readonly logger = new Logger(RedisHandle.name);
  private complained = false;
  private subscribers: RedisClientType[] = [];

  private constructor(
    readonly client: RedisClientType,
    /** Starts every key and channel the server uses, so deployments can share one Redis. */
    readonly prefix: string,
  ) {
    client.on('error', (err: Error) => {
      // The client emits an error for every failed reconnect. Say it once per outage.
      if (this.complained) return;
      this.complained = true;
      this.logger.warn(`Redis connection problem: ${err.message}`);
    });
    client.on('ready', () => {
      if (this.complained) this.logger.log('Redis is back');
      this.complained = false;
    });
  }

  /** Connects within `timeoutMs`, or rejects. */
  static async connect(url: string, timeoutMs = 3000, prefix = 'lux'): Promise<RedisHandle> {
    let connected = false;
    const client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: timeoutMs,
        // Before the first connection a failure ends the attempt. After it, the client keeps trying.
        reconnectStrategy: (retries: number) => (connected ? Math.min(250 * (retries + 1), MAX_BACKOFF_MS) : false),
      },
    }) as RedisClientType;
    const handle = new RedisHandle(client, prefix);
    try {
      await client.connect();
      connected = true;
      return handle;
    } catch (err) {
      client.destroy();
      throw err;
    }
  }

  /** Like `connect`, but answers null and logs a warning when Redis is unreachable. */
  static async tryConnect(url: string, timeoutMs = 3000, prefix = 'lux', windowMs = 0): Promise<RedisHandle | null> {
    try {
      return await withinWindow(() => RedisHandle.connect(url, timeoutMs, prefix), windowMs);
    } catch (err) {
      new Logger(RedisHandle.name).warn(`Redis is unreachable (${(err as Error).message || 'connection refused'})`);
      return null;
    }
  }

  /** True while the connection works. */
  get ready(): boolean {
    return this.client.isReady;
  }

  /** A second connection for subscriptions, which cannot share a connection with commands. */
  async subscriber(): Promise<RedisClientType> {
    const sub = this.client.duplicate() as RedisClientType;
    sub.on('error', () => undefined); // the main connection reports outages
    await sub.connect();
    this.subscribers.push(sub);
    return sub;
  }

  async close(): Promise<void> {
    for (const sub of this.subscribers) await sub.quit().catch(() => sub.destroy());
    this.subscribers = [];
    await this.client.quit().catch(() => this.client.destroy());
  }
}
