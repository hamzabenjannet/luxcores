import type { RedisHandle } from '../redis/redis.handle.js';
import { type BufferSink, type LogBatch, type Pending, newestCheckpoints } from './log-sink.js';
import type { Checkpoint, MatchEvent } from './match-event.js';

/** A stream that nothing drains or purges (a crashed match, a down store) is removed by Redis after this long. */
const EXPIRE_MS = 7 * 24 * 3600 * 1000;
const MATCH_ID = /^[0-9a-zA-Z-]{1,64}$/;
const KEY = /^lux:match:([0-9a-zA-Z-]{1,64}):(events|cp)$/;

const eventsKey = (matchId: string) => `lux:match:${matchId}:events`;
const checkpointsKey = (matchId: string) => `lux:match:${matchId}:cp`;

/**
 * The hot buffer of the match log: one Redis Stream per match, where each entry holds the events of one
 * flush as a JSON array, and a two-item list with the newest checkpoints. Redis answers in under a
 * millisecond and persists with its append-only file, so a write costs the tick loop nothing and survives
 * a restart of the server. A flusher hands the entries on to MongoDB and trims them.
 */
export class RedisStreamSink implements BufferSink {
  readonly name = 'redis';
  /** Checkpoint positions already handed to the store, so the flusher sends each only once. */
  private readonly handedOn = new Map<string, number>();

  constructor(private readonly redis: RedisHandle) {}

  private get client() {
    if (!this.redis.ready) throw new Error('Redis is not connected');
    return this.redis.client;
  }

  async write(batch: LogBatch): Promise<void> {
    const client = this.client;
    const byMatch = new Map<string, MatchEvent[]>();
    for (const event of batch.events) {
      const list = byMatch.get(event.matchId);
      if (list) list.push(event);
      else byMatch.set(event.matchId, [event]);
    }
    const multi = client.multi();
    for (const [matchId, events] of byMatch) {
      this.check(matchId);
      multi.xAdd(eventsKey(matchId), '*', { d: JSON.stringify(events) });
      multi.pExpire(eventsKey(matchId), EXPIRE_MS);
    }
    for (const cp of batch.checkpoints) {
      this.check(cp.matchId);
      multi.lPush(checkpointsKey(cp.matchId), JSON.stringify(cp));
      multi.lTrim(checkpointsKey(cp.matchId), 0, 1);
      multi.pExpire(checkpointsKey(cp.matchId), EXPIRE_MS);
    }
    await multi.exec();
  }

  async read(matchId: string): Promise<{ events: MatchEvent[]; checkpoints: Checkpoint[] }> {
    this.check(matchId);
    const events: MatchEvent[] = [];
    let from = '-';
    for (;;) {
      const entries = (await this.client.xRange(eventsKey(matchId), from, '+', { COUNT: 1000 })) ?? [];
      for (const entry of entries) events.push(...(JSON.parse(entry.message.d) as MatchEvent[]));
      if (entries.length < 1000) break;
      from = `(${entries[entries.length - 1].id}`;
    }
    return { events, checkpoints: await this.readCheckpoints(matchId) };
  }

  async purge(matchId: string, options: { keepEvents?: boolean } = {}): Promise<void> {
    this.check(matchId);
    this.handedOn.delete(matchId);
    await this.client.del(options.keepEvents ? [checkpointsKey(matchId)] : [eventsKey(matchId), checkpointsKey(matchId)]);
  }

  async close(): Promise<void> {
    // The Redis handle belongs to the module that opened it.
  }

  async matchIds(): Promise<string[]> {
    const ids = new Set<string>();
    let cursor = '0';
    do {
      const reply = await this.client.scan(cursor, { MATCH: 'lux:match:*', COUNT: 200 });
      cursor = reply.cursor.toString();
      for (const key of reply.keys) {
        const found = KEY.exec(key);
        if (found) ids.add(found[1]);
      }
    } while (cursor !== '0');
    return [...ids];
  }

  async peek(matchId: string, limit: number): Promise<Pending> {
    this.check(matchId);
    const entries = (await this.client.xRange(eventsKey(matchId), '-', '+', { COUNT: Math.max(1, limit) })) ?? [];
    const events: MatchEvent[] = [];
    for (const entry of entries) events.push(...(JSON.parse(entry.message.d) as MatchEvent[]));
    const sent = this.handedOn.get(matchId) ?? -1;
    const checkpoints = (await this.readCheckpoints(matchId)).filter((cp) => cp.seq > sent);
    const lastEntry = entries.length > 0 ? entries[entries.length - 1].id : '';
    const newestCheckpoint = checkpoints.reduce((m, cp) => Math.max(m, cp.seq), -1);
    return { events, checkpoints, cursor: `${lastEntry}|${newestCheckpoint}` };
  }

  async trim(matchId: string, cursor: string): Promise<void> {
    this.check(matchId);
    const [entryId, checkpointSeq] = cursor.split('|');
    if (entryId) await this.client.xTrim(eventsKey(matchId), 'MINID', nextId(entryId));
    const sent = Number(checkpointSeq);
    if (sent >= 0) this.handedOn.set(matchId, Math.max(sent, this.handedOn.get(matchId) ?? -1));
  }

  private async readCheckpoints(matchId: string): Promise<Checkpoint[]> {
    const rows = await this.client.lRange(checkpointsKey(matchId), 0, 1);
    return newestCheckpoints(rows.map((row) => JSON.parse(row) as Checkpoint));
  }

  private check(matchId: string): void {
    if (!MATCH_ID.test(matchId)) throw new Error(`Bad match id for a Redis key: ${matchId}`);
  }
}

/** The stream id right after `id` (`ms-seq`), so a trim by minimum id removes `id` itself too. */
function nextId(id: string): string {
  const [ms, seq] = id.split('-');
  return `${ms}-${Number(seq) + 1}`;
}
