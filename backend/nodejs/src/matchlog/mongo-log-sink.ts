import type { Collection, Db } from 'mongodb';
import { type LogBatch, type LogSink, newestCheckpoints } from './log-sink.js';
import type { Checkpoint, MatchEvent } from './match-event.js';

/** Events of a match that never ends cleanly (or whose purge failed) disappear after this long, whatever the retention. */
const MIN_TTL_DAYS = 7;
const DAY_S = 24 * 3600;
const DUPLICATE_KEY = 11000;

interface EventRow {
  _id: string;
  matchId: string;
  seq: number;
  tick: number;
  type: string;
  data: unknown;
  at: Date;
}

interface CheckpointRow {
  _id: string;
  checkpoints: Checkpoint[];
  at: Date;
}

/**
 * The long-lived match log in MongoDB: one `match_events` collection, indexed by match and sequence
 * number, and one `match_checkpoints` document per match. A TTL index removes events after the retention
 * period, so the collection does not grow without bound.
 */
export class MongoLogSink implements LogSink {
  readonly name = 'mongodb';
  private readonly events: Collection<EventRow>;
  private readonly checkpoints: Collection<CheckpointRow>;
  private indexes: Promise<void> | undefined;

  constructor(
    db: Db,
    private readonly retentionDays: number,
  ) {
    this.events = db.collection<EventRow>('match_events');
    this.checkpoints = db.collection<CheckpointRow>('match_checkpoints');
  }

  async write(batch: LogBatch): Promise<void> {
    await this.ensureIndexes();
    if (batch.events.length > 0) {
      const at = new Date();
      const rows: EventRow[] = batch.events.map((e) => ({
        _id: `${e.matchId}:${e.seq}`,
        matchId: e.matchId,
        seq: e.seq,
        tick: e.tick,
        type: e.type,
        data: e.data,
        at,
      }));
      try {
        await this.events.insertMany(rows, { ordered: false });
      } catch (err) {
        // A retry or a second copy of an event hits the same _id. Anything else is a real failure.
        // A bulk failure with no per-document errors (a lost connection) is not a duplicate.
        const writeErrors = (err as { writeErrors?: { code?: number }[] }).writeErrors;
        if (!writeErrors || writeErrors.length === 0 || writeErrors.some((w) => w.code !== DUPLICATE_KEY)) throw err;
      }
    }
    for (const cp of batch.checkpoints) {
      const existing = await this.checkpoints.findOne({ _id: cp.matchId });
      await this.checkpoints.replaceOne(
        { _id: cp.matchId },
        { checkpoints: newestCheckpoints([cp, ...(existing?.checkpoints ?? [])]), at: new Date() },
        { upsert: true },
      );
    }
  }

  async read(matchId: string): Promise<{ events: MatchEvent[]; checkpoints: Checkpoint[] }> {
    const rows = await this.events.find({ matchId }).sort({ seq: 1 }).toArray();
    const events = rows.map(({ matchId: id, seq, tick, type, data }) => ({ matchId: id, seq, tick, type, data }) as MatchEvent);
    const saved = await this.checkpoints.findOne({ _id: matchId });
    return { events, checkpoints: saved?.checkpoints ?? [] };
  }

  async purge(matchId: string, options: { keepEvents?: boolean } = {}): Promise<void> {
    if (!options.keepEvents) await this.events.deleteMany({ matchId });
    await this.checkpoints.deleteOne({ _id: matchId });
  }

  async close(): Promise<void> {
    // The Mongo handle belongs to the database module.
  }

  private ensureIndexes(): Promise<void> {
    const ttl = Math.max(this.retentionDays, MIN_TTL_DAYS) * DAY_S;
    this.indexes ??= (async () => {
      await this.events.createIndex({ matchId: 1, seq: 1 }, { unique: true });
      await this.events.createIndex({ at: 1 }, { expireAfterSeconds: ttl });
      await this.checkpoints.createIndex({ at: 1 }, { expireAfterSeconds: ttl });
    })().catch((err) => {
      this.indexes = undefined; // try again at the next write
      throw err;
    });
    return this.indexes;
  }
}
