import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BufferSink, LogBatch, LogSink, Pending } from '../src/matchlog/log-sink.js';
import { newestCheckpoints } from '../src/matchlog/log-sink.js';
import type { Checkpoint, MatchEvent } from '../src/matchlog/match-event.js';
import { TieredEventLog } from '../src/matchlog/tiered-event-log.js';

/** A sink in memory that can be switched off, to test the fallbacks without a service. */
class MemorySink implements BufferSink {
  up = true;
  events = new Map<string, Map<number, MatchEvent>>();
  checkpointList = new Map<string, Checkpoint[]>();
  writes = 0;
  purged: string[] = [];
  constructor(readonly name: string) {}

  private check(): void {
    if (!this.up) throw new Error(`${this.name} is down`);
  }
  async write(batch: LogBatch): Promise<void> {
    this.check();
    this.writes++;
    for (const e of batch.events) {
      let m = this.events.get(e.matchId);
      if (!m) this.events.set(e.matchId, (m = new Map()));
      m.set(e.seq, e);
    }
    for (const cp of batch.checkpoints) this.checkpointList.set(cp.matchId, newestCheckpoints([cp, ...(this.checkpointList.get(cp.matchId) ?? [])]));
  }
  async read(matchId: string) {
    this.check();
    return { events: [...(this.events.get(matchId)?.values() ?? [])], checkpoints: this.checkpointList.get(matchId) ?? [] };
  }
  async purge(matchId: string, options: { keepEvents?: boolean } = {}) {
    this.check();
    this.purged.push(`${matchId}${options.keepEvents ? ':keep' : ''}`);
    if (!options.keepEvents) this.events.delete(matchId);
    this.checkpointList.delete(matchId);
  }
  async close() {}
  async matchIds() {
    this.check();
    return [...this.events.keys()];
  }
  async peek(matchId: string, limit: number): Promise<Pending> {
    this.check();
    const events = [...(this.events.get(matchId)?.values() ?? [])].sort((a, b) => a.seq - b.seq).slice(0, limit);
    return { events, checkpoints: this.checkpointList.get(matchId) ?? [], cursor: String(events.at(-1)?.seq ?? -1) };
  }
  async trim(matchId: string, cursor: string) {
    this.check();
    const m = this.events.get(matchId);
    for (const seq of m?.keys() ?? []) if (seq <= Number(cursor)) m?.delete(seq);
    if (m && m.size === 0) this.events.delete(matchId);
  }
}

const cp = (tick: number): Omit<Checkpoint, 'seq'> => ({ matchId: 'm', tick, hash: `h${tick}`, state: {}, bots: [] });
const hashEvent = (tick: number) => ({ type: 'hash' as const, tick, data: { hash: `h${tick}` } });

function make(options: { buffer?: MemorySink; store?: MemorySink; file?: MemorySink; keep?: boolean; mirror?: boolean } = {}) {
  const file = options.file ?? new MemorySink('file');
  const log = new TieredEventLog({
    file,
    buffer: options.buffer,
    store: options.store,
    flushMs: 5,
    drainMs: 3_600_000, // the tests drive the moves by hand
    retryMs: 50,
    keepStoredEvents: options.keep ?? false,
    mirrorToFile: options.mirror,
  });
  return { log, file };
}

describe('TieredEventLog', () => {
  afterEach(() => vi.useRealTimers());

  it('numbers events from 0 and gives each checkpoint the position of the next event', async () => {
    const { log, file } = make();
    log.append('m', hashEvent(20));
    log.append('m', hashEvent(40));
    expect(log.saveCheckpoint(cp(40)).seq).toBe(2);
    log.append('m', hashEvent(60));
    await log.flush();
    expect((await log.read('m')).map((e) => e.seq)).toEqual([0, 1, 2]);
    expect((await log.checkpoints('m')).map((c) => c.seq)).toEqual([2]);
    expect(file.writes).toBe(1);
  });

  it('writes to the buffer while it is up and leaves the store to the later move', async () => {
    const buffer = new MemorySink('redis');
    const store = new MemorySink('mongodb');
    const { log, file } = make({ buffer, store });
    log.append('m', hashEvent(20));
    await log.flush();
    expect(buffer.writes).toBe(1);
    expect(store.writes + file.writes).toBe(0);
  });

  it('copies every write to the file as well when asked, for a buffer with no store behind it', async () => {
    const buffer = new MemorySink('redis');
    const { log, file } = make({ buffer, mirror: true });
    log.append('m', hashEvent(20));
    await log.flush();
    expect(buffer.events.get('m')?.size).toBe(1);
    expect(file.events.get('m')?.size).toBe(1);
    buffer.up = false; // the cache restarts empty: the file still has the log
    buffer.events.clear();
    expect((await log.read('m')).map((e) => e.tick)).toEqual([20]);
  });

  it('falls back from the buffer to the store to the file, one place per write', async () => {
    const buffer = new MemorySink('redis');
    const store = new MemorySink('mongodb');
    const { log, file } = make({ buffer, store });
    buffer.up = false;
    log.append('m', hashEvent(20));
    await log.flush();
    expect(store.events.get('m')?.size).toBe(1);
    store.up = false;
    await new Promise((r) => setTimeout(r, 60)); // the buffer's cool-off ends and fails again
    log.append('m', hashEvent(40));
    await log.flush();
    expect(file.events.get('m')?.size).toBe(1);
    expect(log.status().writing).toBe('file');
  });

  it('merges the places on a read, so events spread over an outage form one log', async () => {
    const buffer = new MemorySink('redis');
    const store = new MemorySink('mongodb');
    const { log } = make({ buffer, store });
    log.append('m', hashEvent(20));
    await log.flush(); // buffer
    buffer.up = false;
    log.append('m', hashEvent(40));
    await log.flush(); // store
    buffer.up = true; // back, but with its old content
    expect((await log.read('m')).map((e) => e.tick)).toEqual([20, 40]);
  });

  it('cuts the log at the first gap, because nothing after a lost event can be trusted', async () => {
    const store = new MemorySink('mongodb');
    const { log } = make({ store });
    log.append('m', hashEvent(20));
    log.append('m', hashEvent(40));
    log.append('m', hashEvent(60));
    await log.flush();
    store.events.get('m')?.delete(1);
    expect((await log.read('m')).map((e) => e.tick)).toEqual([20]);
  });

  it('keeps what no sink accepts and delivers it, in order, when one returns', async () => {
    const file = new MemorySink('file');
    const { log } = make({ file });
    file.up = false;
    log.append('m', hashEvent(20));
    await log.flush();
    log.append('m', hashEvent(40));
    file.up = true;
    await log.flush();
    expect([...(file.events.get('m')?.keys() ?? [])]).toEqual([0, 1]);
  });

  it('moves the buffer to the store and empties the buffer', async () => {
    const buffer = new MemorySink('redis');
    const store = new MemorySink('mongodb');
    const { log } = make({ buffer, store });
    for (let i = 0; i < 5; i++) log.append('m', hashEvent(i));
    log.saveCheckpoint(cp(4));
    await log.flush();
    await log.close(); // closing drains
    expect(store.events.get('m')?.size).toBe(5);
    expect(store.checkpointList.get('m')).toHaveLength(1);
    expect(buffer.events.has('m')).toBe(false);
  });

  it('leaves the buffer untouched when the store is away, and moves everything once it is back', async () => {
    const buffer = new MemorySink('redis');
    const store = new MemorySink('mongodb');
    const { log } = make({ buffer, store });
    store.up = false;
    log.append('m', hashEvent(1));
    await log.flush();
    await log.close();
    expect(buffer.events.get('m')?.size).toBe(1);
    store.up = true;
    const again = make({ buffer, store }).log;
    await again.close();
    expect(store.events.get('m')?.size).toBe(1);
  });

  it('purges the buffer and the file, and the store only when finished matches are not kept', async () => {
    for (const keep of [false, true]) {
      const buffer = new MemorySink('redis');
      const store = new MemorySink('mongodb');
      const { log, file } = make({ buffer, store, keep });
      log.append('m', hashEvent(1));
      await log.purge('m');
      expect(buffer.purged).toEqual(['m']);
      expect(file.purged).toEqual(['m']);
      expect(store.purged).toEqual([keep ? 'm:keep' : 'm']);
      expect(store.events.has('m')).toBe(keep);
    }
  });

  it('does not purge the buffer when its events could not reach the store', async () => {
    const buffer = new MemorySink('redis');
    const store = new MemorySink('mongodb');
    const { log } = make({ buffer, store, keep: true });
    log.append('m', hashEvent(1));
    await log.flush();
    store.up = false;
    await log.purge('m');
    expect(buffer.events.get('m')?.size, 'still there for a later move').toBe(1);
  });

  it('resumes numbering after the events already stored', async () => {
    const store = new MemorySink('mongodb');
    const { log } = make({ store });
    log.append('m', hashEvent(1));
    log.append('m', hashEvent(2));
    await log.flush();
    const next = make({ store }).log;
    await next.continueNumbering('m');
    expect(next.append('m', hashEvent(3)).seq).toBe(2);
  });
});

describe('newestCheckpoints', () => {
  it('keeps the two newest by position and drops repeats', () => {
    const c = (seq: number) => ({ matchId: 'm', seq, tick: seq, hash: '', state: {}, bots: [] });
    expect(newestCheckpoints([c(1), c(5), c(3), c(5)]).map((x) => x.seq)).toEqual([5, 3]);
  });
});

// Type check: a MemorySink is a LogSink too.
export const asSink: LogSink = new MemorySink('x');
