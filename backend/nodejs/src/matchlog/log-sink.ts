import type { Checkpoint, MatchEvent } from './match-event.js';

/** What one flush carries to a sink: events in ascending order, and the newest checkpoint of each match that saved one. */
export interface LogBatch {
  events: MatchEvent[];
  checkpoints: Checkpoint[];
}

/** One place that can hold match logs. Every method rejects when the place is unreachable. */
export interface LogSink {
  readonly name: string;
  /** Stores the batch. A retry can store an event twice, so readers keep one event per match and `seq`. */
  write(batch: LogBatch): Promise<void>;
  /** Everything the sink holds for the match: events in any order, checkpoints newest first. */
  read(matchId: string): Promise<{ events: MatchEvent[]; checkpoints: Checkpoint[] }>;
  /** Deletes the match. With `keepEvents` the events stay and only the checkpoints go. */
  purge(matchId: string, options?: { keepEvents?: boolean }): Promise<void>;
  close(): Promise<void>;
}

/** What a buffer holds that a store has not stored yet. */
export interface Pending extends LogBatch {
  /** Opaque position in the buffer: everything up to it is in this batch. */
  cursor: string;
}

/**
 * A fast, short-lived sink (a Redis Stream) that a flusher empties into the long-lived
 * store (MongoDB). An event leaves the buffer only after the store holds it.
 */
export interface BufferSink extends LogSink {
  /** Ids of the matches with entries in the buffer. */
  matchIds(): Promise<string[]>;
  /** The entries not yet handed on, oldest first. */
  peek(matchId: string, limit: number): Promise<Pending>;
  /** Removes everything up to the cursor of a `peek`. */
  trim(matchId: string, cursor: string): Promise<void>;
}

/** The two newest checkpoints of `all`, newest first, without repeats. */
export function newestCheckpoints(all: Checkpoint[]): Checkpoint[] {
  const bySeq = new Map<number, Checkpoint>();
  for (const cp of all) bySeq.set(cp.seq, cp);
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, 2);
}
