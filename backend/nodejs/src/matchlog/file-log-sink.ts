import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type LogBatch, type LogSink, newestCheckpoints } from './log-sink.js';
import type { Checkpoint, MatchEvent } from './match-event.js';

const MATCH_ID = /^[0-9a-zA-Z-]{1,64}$/;

/**
 * One append-only file per match, a JSON event per line (NDJSON), and one small file with the
 * newest two checkpoints. Appending costs the same however long the match runs, unlike the JSON
 * database, which rewrites its whole file. This is the sink of a server with no Redis or
 * MongoDB, and the last place an event can go when those services are away.
 */
export class FileLogSink implements LogSink {
  readonly name = 'file';
  private ready: Promise<void> | undefined;

  constructor(private readonly dir: string) {}

  async write(batch: LogBatch): Promise<void> {
    await this.directory();
    const lines = new Map<string, string[]>();
    for (const event of batch.events) {
      const list = lines.get(event.matchId);
      if (list) list.push(JSON.stringify(event));
      else lines.set(event.matchId, [JSON.stringify(event)]);
    }
    for (const [matchId, list] of lines) {
      await appendFile(this.eventsFile(matchId), `${list.join('\n')}\n`, 'utf8');
    }
    for (const cp of batch.checkpoints) {
      const kept = newestCheckpoints([cp, ...(await this.readCheckpoints(cp.matchId))]);
      const tmp = `${this.checkpointsFile(cp.matchId)}.tmp`;
      await writeFile(tmp, JSON.stringify(kept), 'utf8');
      await rename(tmp, this.checkpointsFile(cp.matchId));
    }
  }

  async read(matchId: string): Promise<{ events: MatchEvent[]; checkpoints: Checkpoint[] }> {
    return { events: await this.readEvents(matchId), checkpoints: await this.readCheckpoints(matchId) };
  }

  async purge(matchId: string, options: { keepEvents?: boolean } = {}): Promise<void> {
    if (!options.keepEvents) await rm(this.eventsFile(matchId), { force: true });
    await rm(this.checkpointsFile(matchId), { force: true });
  }

  async close(): Promise<void> {
    // Writes are awaited by the caller, so there is nothing to release.
  }

  private async readEvents(matchId: string): Promise<MatchEvent[]> {
    let text: string;
    try {
      text = await readFile(this.eventsFile(matchId), 'utf8');
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

  private async readCheckpoints(matchId: string): Promise<Checkpoint[]> {
    try {
      return JSON.parse(await readFile(this.checkpointsFile(matchId), 'utf8')) as Checkpoint[];
    } catch {
      return []; // missing, or torn by a crash: an older checkpoint or the seed serves
    }
  }

  private directory(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  private eventsFile(matchId: string): string {
    return join(this.dir, `${this.safe(matchId)}.ndjson`);
  }

  private checkpointsFile(matchId: string): string {
    return join(this.dir, `${this.safe(matchId)}.checkpoints.json`);
  }

  private safe(matchId: string): string {
    if (!MATCH_ID.test(matchId)) throw new Error(`Bad match id for a log file: ${matchId}`);
    return matchId;
  }
}
