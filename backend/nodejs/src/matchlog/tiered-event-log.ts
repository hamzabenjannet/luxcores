import { Logger } from '@nestjs/common';
import { EventLog } from './event-log.js';
import {
  type BufferSink,
  type LogBatch,
  type LogSink,
  newestCheckpoints,
} from './log-sink.js';
import type { Checkpoint, MatchEvent, NewMatchEvent } from './match-event.js';

export interface TieredLogOptions {
  /** The last resort, tried whenever the others fail. It is never marked down. */
  file: LogSink;
  /** Fast and short-lived (Redis). Takes the writes while it is up. */
  buffer?: BufferSink;
  /** Long-lived (MongoDB). Takes the writes while the buffer is away, and everything the buffer hands on. */
  store?: LogSink;
  /** Milliseconds between two writes of the pending events. */
  flushMs: number;
  /** Milliseconds between two moves from the buffer to the store. */
  drainMs: number;
  /** Milliseconds a sink that failed is left alone before the next try. */
  retryMs: number;
  /** True when finished matches keep their events in the store (a retention period). */
  keepStoredEvents: boolean;
  /** Most events held in memory while no sink accepts writes. The oldest go first. */
  maxPending?: number;
  /** Entries per move from the buffer to the store. */
  drainBatch?: number;
}

/** Longest the shutdown waits for the buffer to empty into the store. */
const CLOSE_DRAIN_MS = 5000;

interface Tier<S extends LogSink = LogSink> {
  sink: S;
  downUntil: number;
}

/**
 * The match log over up to three places. Writes go to the buffer (Redis) while it is up, to
 * the store (MongoDB) when it is not, and to the file when neither is. A background move hands
 * the buffer's entries to the store. A read merges all three, so events that landed in
 * different places during an outage still come back as one log. Sequence numbers are assigned
 * here, in order, so a retry or a second copy of an event is recognizable.
 */
export class TieredEventLog extends EventLog {
  private readonly logger = new Logger(TieredEventLog.name);
  private readonly next = new Map<string, number>();
  private events: MatchEvent[] = [];
  private checkpointsPending = new Map<string, Checkpoint>();
  private flushTimer: NodeJS.Timeout | undefined;
  private drainTimer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  private readonly buffer?: Tier<BufferSink>;
  private readonly store?: Tier;
  private readonly file: Tier;
  private readonly maxPending: number;
  private readonly drainBatch: number;
  private closed = false;
  /** The place that took the last write. */
  private lastWrote: string | undefined;

  constructor(private readonly options: TieredLogOptions) {
    super();
    this.file = { sink: options.file, downUntil: 0 };
    if (options.buffer) this.buffer = { sink: options.buffer, downUntil: 0 };
    if (options.store) this.store = { sink: options.store, downUntil: 0 };
    this.maxPending = options.maxPending ?? 100_000;
    this.drainBatch = options.drainBatch ?? 2000;
    if (this.buffer && this.store) {
      this.drainTimer = setInterval(() => void this.queue(() => this.drainAll()), options.drainMs);
      this.drainTimer.unref();
    }
  }

  /** Which places hold the log now, for the health route. */
  status(): { writing: string; tiers: { name: string; up: boolean }[] } {
    const tiers = [this.buffer, this.store, this.file]
      .filter((t): t is Tier => t !== undefined)
      .map((t) => ({ name: t.sink.name, up: this.up(t) }));
    return { writing: this.lastWrote ?? tiers.find((t) => t.up)?.name ?? this.file.sink.name, tiers };
  }

  append(matchId: string, event: NewMatchEvent): MatchEvent {
    const seq = this.next.get(matchId) ?? 0;
    this.next.set(matchId, seq + 1);
    const full = { ...event, matchId, seq } as MatchEvent;
    this.events.push(full);
    this.arm();
    return full;
  }

  saveCheckpoint(checkpoint: Omit<Checkpoint, 'seq'>): Checkpoint {
    const full = { ...checkpoint, seq: this.next.get(checkpoint.matchId) ?? 0 };
    this.checkpointsPending.set(full.matchId, full);
    this.arm();
    return full;
  }

  async continueNumbering(matchId: string): Promise<void> {
    const { events } = await this.merged(matchId);
    this.next.set(matchId, events.length === 0 ? 0 : events[events.length - 1].seq + 1);
  }

  async read(matchId: string): Promise<MatchEvent[]> {
    return (await this.merged(matchId)).events;
  }

  async checkpoints(matchId: string): Promise<Checkpoint[]> {
    return (await this.merged(matchId)).checkpoints;
  }

  flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const batch: LogBatch = { events: this.events, checkpoints: [...this.checkpointsPending.values()] };
    this.events = [];
    this.checkpointsPending = new Map();
    this.chain = this.chain.then(() => this.deliver(batch)).catch((err: Error) => {
      this.logger.error(`Match log: writing failed: ${err.message}`);
    });
    return this.chain;
  }

  async purge(matchId: string): Promise<void> {
    await this.flush();
    const keep = this.options.keepStoredEvents;
    let drained = true;
    if (keep) drained = await this.queue(() => this.drain(matchId));
    this.next.delete(matchId);
    const jobs: Promise<unknown>[] = [this.file.sink.purge(matchId)];
    // Entries that never reached the store stay in the buffer, so the store can still get them later.
    if (this.buffer && drained) jobs.push(this.buffer.sink.purge(matchId));
    if (this.store) jobs.push(this.store.sink.purge(matchId, { keepEvents: keep }));
    for (const result of await Promise.allSettled(jobs)) {
      if (result.status === 'rejected') this.logger.warn(`Removing a match log failed: ${String(result.reason)}`);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.drainTimer);
    await this.flush();
    // A service that is away must not hold the shutdown: give the last move a few seconds.
    await Promise.race([this.queue(() => this.drainAll()), new Promise((resolve) => setTimeout(resolve, CLOSE_DRAIN_MS).unref())]);
    for (const tier of [this.buffer, this.store, this.file]) {
      await tier?.sink.close().catch((err: Error) => this.logger.warn(`Closing ${tier.sink.name} failed: ${err.message}`));
    }
  }

  private arm(): void {
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.options.flushMs);
  }

  private up(tier: Tier): boolean {
    return tier === this.file || tier.downUntil <= Date.now();
  }

  private markDown(tier: Tier, err: unknown): void {
    if (tier === this.file) return;
    const first = tier.downUntil === 0 || tier.downUntil <= Date.now();
    tier.downUntil = Date.now() + this.options.retryMs;
    if (first) this.logger.warn(`Match log: ${tier.sink.name} is unavailable (${(err as Error).message}); using the next place`);
  }

  private markUp(tier: Tier): void {
    if (tier.downUntil !== 0) {
      tier.downUntil = 0;
      this.logger.log(`Match log: ${tier.sink.name} is back`);
    }
  }

  /** Runs `work` after the writes and moves queued before it. */
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async deliver(batch: LogBatch): Promise<void> {
    if (batch.events.length === 0 && batch.checkpoints.length === 0) return;
    for (const tier of [this.buffer, this.store, this.file]) {
      if (!tier || !this.up(tier)) continue;
      try {
        await tier.sink.write(batch);
        this.markUp(tier);
        this.lastWrote = tier.sink.name;
        return;
      } catch (err) {
        this.markDown(tier, err);
      }
    }
    // Not even the file took it. Keep the events for the next flush, in order, and drop the oldest past the cap.
    this.logger.error('Match log: no place accepts writes; the events wait in memory');
    this.events = [...batch.events, ...this.events];
    if (this.events.length > this.maxPending) {
      const dropped = this.events.length - this.maxPending;
      this.events = this.events.slice(dropped);
      this.logger.error(`Match log: dropped the ${dropped} oldest events (cap ${this.maxPending})`);
    }
    for (const cp of batch.checkpoints) if (!this.checkpointsPending.has(cp.matchId)) this.checkpointsPending.set(cp.matchId, cp);
    if (!this.closed) this.arm();
  }

  /** Moves what the buffer holds for every match to the store. */
  private async drainAll(): Promise<void> {
    if (!this.buffer || !this.store || !this.up(this.buffer) || !this.up(this.store)) return;
    let ids: string[];
    try {
      ids = await this.buffer.sink.matchIds();
    } catch (err) {
      this.markDown(this.buffer, err);
      return;
    }
    for (const id of ids) if (!(await this.drain(id))) return;
  }

  /** One match. Returns false when the buffer or the store failed, true when nothing is left behind. */
  private async drain(matchId: string): Promise<boolean> {
    const { buffer, store } = this;
    if (!buffer || !store) return true;
    if (!this.up(buffer) || !this.up(store)) return false;
    for (;;) {
      let pending;
      try {
        pending = await buffer.sink.peek(matchId, this.drainBatch);
      } catch (err) {
        this.markDown(buffer, err);
        return false;
      }
      if (pending.events.length === 0 && pending.checkpoints.length === 0) return true;
      try {
        await store.sink.write(pending);
      } catch (err) {
        this.markDown(store, err);
        return false;
      }
      try {
        await buffer.sink.trim(matchId, pending.cursor);
      } catch (err) {
        this.markDown(buffer, err);
        return false;
      }
      if (pending.events.length < this.drainBatch) return true;
    }
  }

  /** Every place's copy of the log, merged: one event per `seq`, cut at the first gap, checkpoints newest first. */
  private async merged(matchId: string): Promise<{ events: MatchEvent[]; checkpoints: Checkpoint[] }> {
    await this.flush();
    const bySeq = new Map<number, MatchEvent>();
    const checkpoints: Checkpoint[] = [];
    for (const tier of [this.buffer, this.store, this.file]) {
      if (!tier) continue;
      try {
        const part = await tier.sink.read(matchId);
        for (const e of part.events) bySeq.set(e.seq, e);
        checkpoints.push(...part.checkpoints);
      } catch (err) {
        this.markDown(tier, err);
      }
    }
    const events: MatchEvent[] = [];
    for (let seq = 0; bySeq.has(seq); seq++) events.push(bySeq.get(seq) as MatchEvent);
    return { events, checkpoints: newestCheckpoints(checkpoints) };
  }
}
