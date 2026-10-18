import { Logger } from '@nestjs/common';
import type { RedisHandle } from '../redis/redis.handle.js';
import { MatchOwnership } from './match-ownership.js';

const MATCH_ID = /^[0-9a-zA-Z-]{1,64}$/;

/** Extends the lease only when this node still holds it. */
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
/** Deletes the lease only when this node holds it. */
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Match leases in Redis: `lux:owner:<matchId>` holds the owner's node id and expires after
 * `leaseMs`. The owner renews it three times per lease. A node that sees its lease gone or taken
 * stops running the match, so two nodes never run one match for longer than a renewal interval.
 *
 * An unreachable Redis never takes a match away: the node keeps what it holds, because a Redis
 * outage also keeps every other node from claiming it.
 */
export class RedisOwnership extends MatchOwnership {
  readonly mode = 'redis' as const;
  private readonly logger = new Logger(RedisOwnership.name);
  private readonly mine = new Set<string>();
  private readonly lostListeners: ((matchId: string) => void)[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisHandle,
    readonly nodeId: string,
    private readonly leaseMs: number,
  ) {
    super();
    this.timer = setInterval(() => void this.renewAll(), Math.max(100, Math.floor(leaseMs / 3)));
    this.timer.unref();
  }

  private key(matchId: string): string {
    if (!MATCH_ID.test(matchId)) throw new Error(`Bad match id for a Redis key: ${matchId}`);
    return `${this.redis.prefix}:owner:${matchId}`;
  }

  async claim(matchId: string): Promise<boolean> {
    if (this.mine.has(matchId)) return true;
    try {
      const taken = await this.redis.client.set(this.key(matchId), this.nodeId, { condition: 'NX', expiration: { type: 'PX', value: this.leaseMs } });
      if (taken === 'OK' || (await this.redis.client.get(this.key(matchId))) === this.nodeId) {
        // The second test covers a restart under the same node id, which finds its own old lease.
        await this.redis.client.pExpire(this.key(matchId), this.leaseMs);
        this.mine.add(matchId);
        return true;
      }
      return false;
    } catch (err) {
      this.logger.warn(`Cannot reach Redis to claim ${matchId} (${(err as Error).message}); running it without a lease`);
      this.mine.add(matchId);
      return true;
    }
  }

  async release(matchId: string): Promise<void> {
    this.mine.delete(matchId);
    try {
      await this.redis.client.eval(RELEASE, { keys: [this.key(matchId)], arguments: [this.nodeId] });
    } catch {
      // The lease expires by itself.
    }
  }

  async ownerOf(matchId: string): Promise<string | null> {
    try {
      return (await this.redis.client.get(this.key(matchId))) ?? null;
    } catch {
      return this.mine.has(matchId) ? this.nodeId : null;
    }
  }

  onLost(listener: (matchId: string) => void): void {
    this.lostListeners.push(listener);
  }

  held(): string[] {
    return [...this.mine];
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
  }

  private async renewAll(): Promise<void> {
    for (const matchId of this.mine) { // deleting the current entry while iterating a Set is safe
      try {
        const renewed = await this.redis.client.eval(RENEW, { keys: [this.key(matchId)], arguments: [this.nodeId, String(this.leaseMs)] });
        if (renewed === 1) continue;
        // The lease is gone. If it simply expired (Redis was away for a while), take it back; if another node holds it, step down.
        const again = await this.redis.client.set(this.key(matchId), this.nodeId, { condition: 'NX', expiration: { type: 'PX', value: this.leaseMs } });
        if (again !== 'OK') this.lose(matchId);
      } catch {
        // Redis is away. Keep the match: no other node can claim it either.
      }
    }
  }

  private lose(matchId: string): void {
    this.mine.delete(matchId);
    this.logger.warn(`Match ${matchId} is held by another node now; this node stops running it`);
    for (const listener of this.lostListeners) listener(matchId);
  }
}
