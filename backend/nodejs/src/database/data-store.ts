/** Every stored document has a string `id`. */
export interface Doc {
  id: string;
}

export interface FindOptions {
  limit?: number;
  offset?: number;
  /** Top-level field to sort by. Defaults to `createdAt` when documents have one. */
  sortBy?: string;
  order?: 'asc' | 'desc';
}

/**
 * The storage contract the services use. Three adapters implement it: a JSON file
 * (default), MongoDB and PostgreSQL, so a service never knows which one runs.
 *
 * `where` matches documents whose top-level fields equal the given values.
 */
export abstract class DataStore {
  /** Open connections and create tables or files. Runs once at startup. */
  abstract init(): Promise<void>;
  abstract find<T extends Doc>(
    collection: string,
    where?: Partial<T>,
    options?: FindOptions,
  ): Promise<T[]>;
  abstract count<T extends Doc>(
    collection: string,
    where?: Partial<T>,
  ): Promise<number>;
  abstract get<T extends Doc>(
    collection: string,
    id: string,
  ): Promise<T | null>;
  /** Fails when a document with the same id exists. */
  abstract insert<T extends Doc>(collection: string, doc: T): Promise<T>;
  /** Merges `patch` into the stored document. Returns null when the id is unknown. */
  abstract update<T extends Doc>(
    collection: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null>;
  abstract remove(collection: string, id: string): Promise<boolean>;
  /** Release connections at shutdown. */
  abstract close(): Promise<void>;
}

/** Collection names, shared by every adapter. */
export const COLLECTIONS = {
  players: 'players',
  matches: 'matches',
  replays: 'replays',
} as const;

/** Compare two values of a sort field. Missing values sort first. */
export function compareField(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
}

/** True when every key in `where` equals the same key in `doc`. */
export function matches<T extends Doc>(
  doc: T,
  where: Partial<T> | undefined,
): boolean {
  if (!where) return true;
  return (Object.keys(where) as (keyof T)[]).every(
    (key) => where[key] === doc[key],
  );
}
