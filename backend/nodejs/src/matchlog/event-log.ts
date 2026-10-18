import type { Checkpoint, MatchEvent, NewMatchEvent } from './match-event.js';

/**
 * The write-ahead log of a match: its seed, every command the sim executed, the state
 * hash every 20 ticks and its end. Together they are a replay, and the sim is
 * deterministic, so they are also enough to rebuild a running match after a crash.
 *
 * `append` never throws and never waits, because it runs inside the 20 Hz tick loop. An
 * implementation buffers, writes in the background and logs its own failures. After a crash the
 * log can lack the last `flushMs` of events, so a resumed match can rewind by about that much.
 */
export abstract class EventLog {
  /** Adds an event to the end of the match's log and returns it with its sequence number. */
  abstract append(matchId: string, event: NewMatchEvent): MatchEvent;
  /** Continue a match's numbering after the events already stored. Call it once before appending to a match that resumes. */
  abstract continueNumbering(matchId: string): Promise<void>;
  /**
   * Saves a checkpoint of the match at the current end of its log, behind every event appended so far.
   * Returns it with its `seq`. Like `append` it never throws and never waits. The log keeps the newest two.
   */
  abstract saveCheckpoint(checkpoint: Omit<Checkpoint, 'seq'>): Checkpoint;
  /** The match's checkpoints, newest first. */
  abstract checkpoints(matchId: string): Promise<Checkpoint[]>;
  /** Resolves when every appended event is stored. */
  abstract flush(): Promise<void>;
  /** The match's events in sequence order. A torn last line (a crash during a write) is dropped. */
  abstract read(matchId: string): Promise<MatchEvent[]>;
  /** Deletes the match's log and checkpoints. */
  abstract purge(matchId: string): Promise<void>;
  /** Where the log is written now and which places are reachable, for the health route. */
  abstract status(): { writing: string; tiers: { name: string; up: boolean }[] };
  /** Flushes and releases resources at shutdown. */
  abstract close(): Promise<void>;
}
