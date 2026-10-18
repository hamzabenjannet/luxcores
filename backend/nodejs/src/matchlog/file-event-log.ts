import { Logger } from '@nestjs/common';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventLog } from './event-log.js';
import type { MatchEvent, NewMatchEvent } from './match-event.js';

const MATCH_ID = /^[0-9a-zA-Z-]{1,64}$/;

/**
 * One append-only file per match, a JSON event per line (NDJSON). Appending costs the same
 * however long the match runs, unlike the JSON database, which rewrites its whole file.
 * This is the log of a server with no Redis or MongoDB, and the place where events wait
 * when those services are away.
 */
export class FileEventLog extends EventLog {
  private readonly logger = new Logger(FileEventLog.name);
  /** Lines waiting for the next write, per match. */
  private readonly pending = new Map<string, string[]>();
  /** Next sequence number, per match. Loaded from the file the first time a resumed match appends. */
  private readonly next = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> = Promise.resolve();
  private ready: Promise<void> | undefined;

  constructor(
    private readonly dir: string,
    private readonly flushMs: number,
  ) {
    super();
  }

  async continueNumbering(matchId: string): Promise<void> {
    const events = await this.read(matchId);
    this.next.set(matchId, events.length === 0 ? 0 : events[events.length - 1].seq + 1);
  }

  append(matchId: string, event: NewMatchEvent): MatchEvent {
    const seq = this.next.get(matchId) ?? 0;
    this.next.set(matchId, seq + 1);
    const full = { ...event, matchId, seq } as MatchEvent;
    let lines = this.pending.get(matchId);
    if (!lines) this.pending.set(matchId, (lines = []));
    lines.push(JSON.stringify(full));
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.flushMs);
    return full;
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const batch = [...this.pending.entries()];
    this.pending.clear();
    this.writing = this.writing.then(async () => {
      if (batch.length === 0) return;
      try {
        await this.directory();
        for (const [matchId, lines] of batch) {
          await appendFile(this.file(matchId), `${lines.join('\n')}\n`, 'utf8');
        }
      } catch (err) {
        // Keep the match running. The lines are lost, which a resume would notice as a gap.
        this.logger.error(`Writing the match log failed: ${(err as Error).message}`);
      }
    });
    return this.writing;
  }

  async read(matchId: string): Promise<MatchEvent[]> {
    await this.flush();
    let text: string;
    try {
      text = await readFile(this.file(matchId), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const events: MatchEvent[] = [];
    for (const line of text.split('\n')) {
      if (line === '') continue;
      try {
        events.push(JSON.parse(line) as MatchEvent);
      } catch {
        break; // a torn write can only be the last line, so nothing valid follows it
      }
    }
    return events;
  }

  async purge(matchId: string): Promise<void> {
    await this.flush();
    this.next.delete(matchId);
    await rm(this.file(matchId), { force: true });
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private directory(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  private file(matchId: string): string {
    if (!MATCH_ID.test(matchId)) throw new Error(`Bad match id for a log file: ${matchId}`);
    return join(this.dir, `${matchId}.ndjson`);
  }
}
