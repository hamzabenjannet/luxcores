import { Logger } from '@nestjs/common';
import { withinWindow } from '../common/startup-wait.js';
import {
  type DatabaseDriver,
  type Doc,
  type FindOptions,
  type StoreStatus,
  DataStore,
} from './data-store.js';
import type { JsonFileStore } from './json-file.store.js';

/** Collections that the JSON file mirrors while the main database works, so a fallback finds them. Replays are too big to mirror. */
const DEFAULT_MIRRORED = ['players', 'matches'];
/** The internal collection of the JSON file that remembers what a fallback run changed. */
const SYNC = '_sync';
const SYNC_ID = 'state';

interface SyncState extends Doc {
  /** Documents written or removed while the JSON file was the live store, by collection. */
  put: Record<string, string[]>;
  removed: Record<string, string[]>;
}

/**
 * True for the errors of a database that cannot be reached, as opposed to an error in the
 * request. The drivers do not share a class for this, so it matches names, codes and messages.
 */
export function isUnavailable(err: unknown): boolean {
  const e = err as { name?: string; code?: string | number; message?: string } | undefined;
  if (!e) return false;
  if (/^Mongo(Network|NetworkTimeout|ServerSelection|NotConnected|TopologyClosed|ServerClosed|PoolCleared|PoolClosed|WaitQueueTimeout|Runtime)Error$/.test(e.name ?? '')) return true;
  if (typeof e.code === 'string' && /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EHOSTUNREACH|EAI_AGAIN|08\w{3}|57P0[123]|53300)$/.test(e.code)) return true;
  return /connection (terminated|timeout|closed|refused)|timed out|Client was closed|topology was destroyed|not connected/i.test(e.message ?? '');
}

/**
 * The server's database: a main adapter (MongoDB or PostgreSQL) with the JSON file behind it.
 *
 * - At start-up the main adapter is tried. When it is unreachable, the server runs on the JSON
 *   file until the next restart.
 * - While the main adapter works, the JSON file mirrors the small collections (`players` and
 *   `matches`), so a fallback finds the players and the running matches.
 * - When the main adapter fails during the run, the server switches to the JSON file for good,
 *   until the next restart, and logs it. Documents that only the main adapter holds (replays)
 *   are missing while it runs on the file.
 * - The fallback run records which documents it changed. At the next start with a reachable
 *   main adapter they are copied to it, and an empty main adapter is filled from the file.
 */
export class ResilientStore extends DataStore {
  private readonly logger = new Logger(ResilientStore.name);
  private mode: 'primary' | 'fallback';
  private reason?: string;
  private sync: SyncState = { id: SYNC_ID, put: {}, removed: {} };
  private syncChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly primary: DataStore | undefined,
    private readonly fallback: JsonFileStore,
    private readonly options: {
      /** What the settings ask for. */
      configured: DatabaseDriver;
      /** Why there is no main adapter, when the caller could not connect one. */
      unavailableReason?: string;
      mirror?: readonly string[];
      /** Milliseconds the main adapter gets to start at start-up. */
      startupWaitMs?: number;
    },
  ) {
    super();
    this.mode = primary ? 'primary' : 'fallback';
    this.reason = options.unavailableReason;
  }

  get driver(): DatabaseDriver {
    return this.mode === 'primary' && this.primary ? this.primary.driver : 'json';
  }

  status(): StoreStatus {
    return {
      configured: this.options.configured,
      active: this.driver,
      degraded: this.mode === 'fallback' && this.options.configured !== 'json',
      ...(this.reason ? { reason: this.reason } : {}),
    };
  }

  async init(): Promise<void> {
    await this.fallback.init();
    const saved = await this.fallback.get<SyncState>(SYNC, SYNC_ID);
    if (saved) this.sync = saved;
    if (!this.primary) {
      this.logger.warn(`${this.options.configured} is not in use (${this.reason ?? 'not reachable'}); the JSON file serves until the next restart`);
      return;
    }
    try {
      await withinWindow(() => this.primary?.init() ?? Promise.resolve(), this.options.startupWaitMs ?? 0);
      await this.reconcile(this.primary);
    } catch (err) {
      // Whatever went wrong (an unreachable server, a refused login, a missing right), the server must still start.
      this.degrade(err);
    }
  }

  find<T extends Doc>(collection: string, where?: Partial<T>, options?: FindOptions): Promise<T[]> {
    return this.exec(
      (s) => s.find<T>(collection, where, options),
      (docs) => this.mirrorAll(collection, docs),
    );
  }

  count<T extends Doc>(collection: string, where?: Partial<T>): Promise<number> {
    return this.exec((s) => s.count<T>(collection, where));
  }

  get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    return this.exec(
      (s) => s.get<T>(collection, id),
      (doc) => (doc ? this.mirrorAll(collection, [doc]) : Promise.resolve()),
    );
  }

  insert<T extends Doc>(collection: string, doc: T): Promise<T> {
    return this.exec(
      (s) => s.insert<T>(collection, doc),
      (saved) => this.mirror(collection, saved),
      () => this.touch('put', collection, doc.id),
    );
  }

  update<T extends Doc>(collection: string, id: string, patch: Partial<T>): Promise<T | null> {
    return this.exec(
      (s) => s.update<T>(collection, id, patch),
      (saved) => (saved ? this.mirror(collection, saved) : Promise.resolve()),
      (saved) => (saved ? this.touch('put', collection, id) : Promise.resolve()),
    );
  }

  remove(collection: string, id: string): Promise<boolean> {
    return this.exec(
      (s) => s.remove(collection, id),
      (removed) => (removed && this.mirrored(collection) ? this.fallback.remove(collection, id).then(() => undefined) : Promise.resolve()),
      (removed) => (removed ? this.touch('removed', collection, id) : Promise.resolve()),
    );
  }

  async close(): Promise<void> {
    await this.syncChain;
    await this.primary?.close();
    await this.fallback.close();
  }

  private mirrored(collection: string): boolean {
    return (this.options.mirror ?? DEFAULT_MIRRORED).includes(collection);
  }

  /**
   * Runs `op` on the main adapter, or on the file after a fallback. `onPrimary` runs after a main
   * write (to mirror it), `onFallback` after a file write (to remember it for the next sync).
   */
  private async exec<T>(
    op: (store: DataStore) => Promise<T>,
    onPrimary?: (result: T) => Promise<void>,
    onFallback?: (result: T) => Promise<void>,
  ): Promise<T> {
    if (this.mode === 'primary' && this.primary) {
      try {
        const result = await op(this.primary);
        if (onPrimary) {
          await onPrimary(result).catch((err: Error) => this.logger.warn(`Mirroring to the JSON file failed: ${err.message}`));
        }
        return result;
      } catch (err) {
        if (!isUnavailable(err)) throw err;
        this.degrade(err);
      }
    }
    const result = await op(this.fallback);
    if (onFallback) await onFallback(result);
    return result;
  }

  private async mirror(collection: string, doc: Doc): Promise<void> {
    if (this.mirrored(collection)) await this.fallback.upsert(collection, doc);
  }

  /**
   * Keeps the file's copy of what this server reads current too: a match that another server created, or
   * a player who signed in there, is in the file by the time this server needs it as a fallback. A
   * document is written only when it differs from the file's copy.
   */
  private async mirrorAll(collection: string, docs: Doc[]): Promise<void> {
    if (!this.mirrored(collection)) return;
    for (const doc of docs) {
      const copy = await this.fallback.get<Doc>(collection, doc.id);
      if (!copy || canonical(copy) !== canonical(doc)) await this.fallback.upsert(collection, doc);
    }
  }

  private degrade(err: unknown): void {
    if (this.mode === 'fallback') return;
    this.mode = 'fallback';
    this.reason = (err as Error)?.message ?? String(err);
    this.logger.error(
      `${this.options.configured} is unavailable (${this.reason}). The server now runs on the JSON file and stays on it until the next restart.`,
    );
  }

  /** Remembers a change made on the file, so the next start can copy it to the main adapter. */
  private touch(kind: 'put' | 'removed', collection: string, id: string): Promise<void> {
    if (this.options.configured === 'json') return Promise.resolve();
    const other = kind === 'put' ? 'removed' : 'put';
    const add = (this.sync[kind][collection] ??= []);
    if (!add.includes(id)) add.push(id);
    this.sync[other][collection] = (this.sync[other][collection] ?? []).filter((x) => x !== id);
    return this.saveSync();
  }

  private saveSync(): Promise<void> {
    const snapshot = structuredClone(this.sync);
    this.syncChain = this.syncChain.then(() => this.fallback.upsert(SYNC, snapshot));
    return this.syncChain;
  }

  /**
   * Copies what the main adapter lacks: first the changes of an earlier fallback run, then, when the
   * main adapter is empty, everything the file holds (the first start after a move from the file).
   */
  private async reconcile(primary: DataStore): Promise<void> {
    let copied = 0;
    const changes = Object.entries(this.sync.put);
    for (const [collection, ids] of changes) {
      for (const id of ids) {
        const doc = await this.fallback.get<Doc>(collection, id);
        if (!doc) continue;
        const present = await primary.get<Doc>(collection, id);
        if (present) await primary.update(collection, id, doc);
        else await primary.insert(collection, doc);
        copied++;
      }
    }
    for (const [collection, ids] of Object.entries(this.sync.removed)) {
      for (const id of ids) await primary.remove(collection, id);
    }

    const empty = await this.isEmpty(primary);
    if (empty) {
      for (const { collection, docs } of this.fallback.dump()) {
        for (const doc of docs) {
          await primary.insert(collection, doc);
          copied++;
        }
      }
    }
    if (changes.length > 0 || Object.keys(this.sync.removed).length > 0) {
      this.sync = { id: SYNC_ID, put: {}, removed: {} };
      await this.saveSync();
    }
    if (copied > 0) this.logger.log(`Copied ${copied} document(s) from the JSON file to ${primary.driver}`);
  }

  private async isEmpty(primary: DataStore): Promise<boolean> {
    for (const { collection } of this.fallback.dump()) {
      if ((await primary.count(collection)) > 0) return false;
    }
    return true;
  }
}

/** JSON with sorted keys, to compare two documents whatever order their fields came in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}
