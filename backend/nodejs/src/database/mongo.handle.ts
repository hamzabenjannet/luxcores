import { Logger } from '@nestjs/common';
import { type Db, MongoClient } from 'mongodb';

/** Injection token for the shared MongoDB connection. Its value is a `MongoHandle`, or null when MongoDB is not in use. */
export const MONGO_HANDLE = 'MONGO_HANDLE';

/**
 * One MongoDB connection for the whole server: the data store and the match log share it. It is
 * opened once at start-up. Nothing reconnects it by hand, because the driver does that itself.
 */
export class MongoHandle {
  private constructor(
    readonly client: MongoClient,
    readonly db: Db,
    readonly dbName: string,
  ) {}

  /** Connects and pings, or rejects within `timeoutMs`. */
  static async connect(url: string, dbName: string, timeoutMs = 3000): Promise<MongoHandle> {
    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
    });
    try {
      await client.connect();
      const db = client.db(dbName);
      await db.command({ ping: 1 });
      return new MongoHandle(client, db, dbName);
    } catch (err) {
      await client.close().catch(() => undefined);
      throw err;
    }
  }

  /** Like `connect`, but answers null and logs a warning when MongoDB is unreachable. */
  static async tryConnect(url: string, dbName: string, timeoutMs = 3000): Promise<MongoHandle | null> {
    try {
      return await MongoHandle.connect(url, dbName, timeoutMs);
    } catch (err) {
      new Logger(MongoHandle.name).warn(`MongoDB is unreachable (${(err as Error).message})`);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
