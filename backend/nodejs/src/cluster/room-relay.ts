import { Logger } from '@nestjs/common';
import type { RedisClientType } from '@redis/client';
import type { RedisHandle } from '../redis/redis.handle.js';

const MATCH_ID = /^[0-9a-zA-Z-]{1,64}$/;
/** How long a count of the other nodes' subscribers stays valid. */
const INTEREST_TTL_MS = 1000;

interface Message {
  /** Node id of the sender, so a node ignores its own messages. */
  o: string;
  e: string;
  d: unknown;
  /** Set when only one team's members may receive the event. */
  t?: number;
}

/**
 * Carries a match room's events to clients on other nodes, over Redis Pub/Sub, one channel per match.
 * A node subscribes while it has a client in the room, and the node that runs the match publishes only
 * while another node is subscribed. A server on its own therefore publishes nothing. Pub/Sub keeps no
 * history, which suits snapshots: the next one arrives within 100 ms.
 */
export class RoomRelay {
  private readonly logger = new Logger(RoomRelay.name);
  private readonly watchers = new Map<string, number>();
  private readonly interest = new Map<string, { at: number; others: Promise<number> }>();
  private subscriber?: RedisClientType;

  constructor(
    private readonly redis: RedisHandle,
    private readonly nodeId: string,
    /** Delivers an event from another node to the local clients of the room. */
    private readonly deliver: (matchId: string, event: string, data: unknown, team?: number) => void,
  ) {}

  private channel(matchId: string): string {
    if (!MATCH_ID.test(matchId)) throw new Error(`Bad match id for a channel: ${matchId}`);
    return `${this.redis.prefix}:room:${matchId}`;
  }

  /** A client of this node joined the room. The first one subscribes. */
  async watch(matchId: string): Promise<void> {
    const count = (this.watchers.get(matchId) ?? 0) + 1;
    this.watchers.set(matchId, count);
    if (count !== 1) return;
    try {
      this.subscriber ??= await this.redis.subscriber();
      await this.subscriber.subscribe(this.channel(matchId), (text) => this.receive(matchId, text));
    } catch (err) {
      this.logger.warn(`Cannot follow the room of ${matchId} on other nodes: ${(err as Error).message}`);
    }
  }

  /** A client left. The last one unsubscribes. */
  async unwatch(matchId: string): Promise<void> {
    const count = (this.watchers.get(matchId) ?? 0) - 1;
    if (count > 0) {
      this.watchers.set(matchId, count);
      return;
    }
    this.watchers.delete(matchId);
    await this.subscriber?.unsubscribe(this.channel(matchId)).catch(() => undefined);
  }

  /** Sends an event to the other nodes that have a client in the room. Never throws, never waits for the caller. */
  publish(matchId: string, event: string, data: unknown, team?: number): void {
    void this.send(matchId, event, data, team);
  }

  async close(): Promise<void> {
    this.watchers.clear();
    this.interest.clear();
  }

  private async send(matchId: string, event: string, data: unknown, team?: number): Promise<void> {
    try {
      if ((await this.othersListening(matchId)) === 0) return;
      const message: Message = { o: this.nodeId, e: event, d: data, ...(team === undefined ? {} : { t: team }) };
      await this.redis.client.publish(this.channel(matchId), JSON.stringify(message));
    } catch {
      // Redis is away or busy. The clients on other nodes miss this event and get the next one.
    }
  }

  /** How many subscribers the room has besides this node. Cached for a second. */
  private othersListening(matchId: string): Promise<number> {
    const cached = this.interest.get(matchId);
    if (cached && Date.now() - cached.at < INTEREST_TTL_MS) return cached.others;
    const name = this.channel(matchId);
    const others = this.redis.client
      .pubSubNumSub(name)
      .then((counts) => Math.max(0, Number(counts[name] ?? 0) - (this.watchers.has(matchId) ? 1 : 0)));
    this.interest.set(matchId, { at: Date.now(), others });
    return others;
  }

  private receive(matchId: string, text: string): void {
    try {
      const message = JSON.parse(text) as Message;
      if (message.o === this.nodeId) return;
      this.deliver(matchId, message.e, message.d, message.t);
    } catch (err) {
      this.logger.warn(`Dropped a malformed room message: ${(err as Error).message}`);
    }
  }
}
