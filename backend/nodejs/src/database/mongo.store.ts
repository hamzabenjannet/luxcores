import { Logger } from '@nestjs/common';
import { type Doc, type FindOptions, DataStore } from './data-store.js';
import type { MongoHandle } from './mongo.handle.js';

/**
 * MongoDB adapter. One Mongo collection per Luxcores collection. The `id` field
 * is stored as `_id`, so lookups by id use the primary index. It uses the connection of
 * a `MongoHandle`, which the match log shares, and leaves closing it to the owner.
 */
export class MongoStore extends DataStore {
  readonly driver = 'mongodb';
  private readonly logger = new Logger(MongoStore.name);
  private readonly db;

  constructor(private readonly handle: MongoHandle) {
    super();
    this.db = handle.db;
  }

  async init(): Promise<void> {
    this.logger.log(`MongoDB database "${this.handle.dbName}" in use`);
  }

  async find<T extends Doc>(
    collection: string,
    where?: Partial<T>,
    options: FindOptions = {},
  ): Promise<T[]> {
    const {
      limit = 0,
      offset = 0,
      sortBy = 'createdAt',
      order = 'desc',
    } = options;
    const rows = await this.db
      .collection(collection)
      .find(toFilter(where))
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return rows.map(fromRow<T>);
  }

  async count<T extends Doc>(
    collection: string,
    where?: Partial<T>,
  ): Promise<number> {
    return this.db.collection(collection).countDocuments(toFilter(where));
  }

  async get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    const row = await this.db
      .collection(collection)
      .findOne({ _id: id as never });
    return row ? fromRow<T>(row) : null;
  }

  async insert<T extends Doc>(collection: string, doc: T): Promise<T> {
    const { id, ...rest } = doc;
    await this.db
      .collection(collection)
      .insertOne({ _id: id as never, ...rest });
    return doc;
  }

  async update<T extends Doc>(
    collection: string,
    id: string,
    patch: Partial<T>,
  ): Promise<T | null> {
    const { id: _ignored, ...rest } = patch as Record<string, unknown>;
    const row = await this.db
      .collection(collection)
      .findOneAndUpdate(
        { _id: id as never },
        { $set: rest },
        { returnDocument: 'after' },
      );
    return row ? fromRow<T>(row) : null;
  }

  async remove(collection: string, id: string): Promise<boolean> {
    const result = await this.db
      .collection(collection)
      .deleteOne({ _id: id as never });
    return result.deletedCount === 1;
  }

  async close(): Promise<void> {
    // The handle's owner closes the connection, after the match log has flushed.
  }
}

function toFilter<T extends Doc>(where?: Partial<T>): Record<string, unknown> {
  if (!where) return {};
  const { id, ...rest } = where as Record<string, unknown>;
  return id === undefined ? rest : { ...rest, _id: id };
}

function fromRow<T extends Doc>(row: Record<string, unknown>): T {
  const { _id, ...rest } = row;
  return { id: _id as string, ...rest } as T;
}
