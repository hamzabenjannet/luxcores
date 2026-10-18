import { Logger } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  compareField,
  type Doc,
  type FindOptions,
  matches,
  DataStore,
} from './data-store.js';

type Tables = Record<string, Record<string, Doc>>;

/**
 * Stores every collection in one JSON file, which suits development and small
 * deployments. The whole file lives in memory. Each write replaces the file
 * through a temp file and a rename, so a crash never leaves half a file, and
 * writes run one at a time, in call order.
 */
export class JsonFileStore extends DataStore {
  readonly driver = 'json';
  private readonly logger = new Logger(JsonFileStore.name);
  private tables: Tables = {};
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly path: string) {
    super();
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('top level must be an object of collections');
      }
      this.tables = parsed as Tables;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Cannot read the JSON database at ${this.path}: ${(err as Error).message}`,
        );
      }
      await this.flush(); // first start: create the file
    }
    this.logger.log(`JSON database at ${this.path}`);
  }

  async find<T extends Doc>(
    collection: string,
    where?: Partial<T>,
    options: FindOptions = {},
  ): Promise<T[]> {
    const {
      limit = Infinity,
      offset = 0,
      sortBy = 'createdAt',
      order = 'desc',
    } = options;
    const sign = order === 'asc' ? 1 : -1;
    const rows = this.rows<T>(collection).filter((doc) => matches(doc, where));
    rows.sort(
      (a, b) => sign * compareField((a as never)[sortBy], (b as never)[sortBy]),
    );
    return rows
      .slice(offset, offset + limit)
      .map((doc) => structuredClone(doc));
  }

  async count<T extends Doc>(
    collection: string,
    where?: Partial<T>,
  ): Promise<number> {
    return this.rows<T>(collection).filter((doc) => matches(doc, where)).length;
  }

  async get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    const doc = this.tables[collection]?.[id];
    return doc ? structuredClone(doc as T) : null;
  }

  async insert<T extends Doc>(collection: string, doc: T): Promise<T> {
    const table = (this.tables[collection] ??= {});
    if (table[doc.id])
      throw new Error(`${collection}/${doc.id} already exists`);
    table[doc.id] = structuredClone(doc);
    await this.save();
    return structuredClone(doc);
  }

  async update<T extends Doc>(
    collection: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null> {
    const current = this.tables[collection]?.[id];
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch), id } as T;
    this.tables[collection][id] = next;
    await this.save();
    return structuredClone(next);
  }

  async remove(collection: string, id: string): Promise<boolean> {
    if (!this.tables[collection]?.[id]) return false;
    delete this.tables[collection][id];
    await this.save();
    return true;
  }

  /** Stores the document whether or not its id exists. The resilient store mirrors another database with it. */
  async upsert<T extends Doc>(collection: string, doc: T): Promise<void> {
    (this.tables[collection] ??= {})[doc.id] = structuredClone(doc);
    await this.save();
  }

  /** Every document of every collection except the internal ones, for a copy into another database. */
  dump(): { collection: string; docs: Doc[] }[] {
    return Object.keys(this.tables)
      .filter((collection) => !collection.startsWith('_'))
      .map((collection) => ({ collection, docs: this.rows(collection).map((d) => structuredClone(d)) }));
  }

  async close(): Promise<void> {
    await this.queue;
    this.closed = true; // like a closed connection pool: later writes fail, so a shutdown-order bug shows up
  }

  private rows<T extends Doc>(collection: string): T[] {
    return Object.values(this.tables[collection] ?? {}) as T[];
  }

  /** Queue a write. Callers wait until their own snapshot of the data is on disk. */
  private save(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error('The JSON database is closed'));
    const snapshot = JSON.stringify(this.tables, null, 2);
    const run = this.queue.then(() => this.write(snapshot));
    this.queue = run.catch((err: Error) =>
      this.logger.error(`Write failed: ${err.message}`),
    );
    return run;
  }

  private flush(): Promise<void> {
    return this.save();
  }

  private async write(snapshot: string): Promise<void> {
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, snapshot, 'utf8');
    await rename(tmp, this.path);
  }
}
