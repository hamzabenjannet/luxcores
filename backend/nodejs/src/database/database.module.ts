import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { DataStore } from './data-store.js';
import { JsonFileStore } from './json-file.store.js';
import { MONGO_HANDLE, MongoHandle } from './mongo.handle.js';
import { POSTGRES_PROBE, probePostgres } from './postgres.probe.js';
import { ResilientStore } from './resilient.store.js';

/**
 * Chooses the storage at start-up from `DATABASE_DRIVER` (`auto`, `json`, `mongodb` or
 * `postgres`). `auto` uses MongoDB when `MONGODB_URL` is set and the JSON file otherwise.
 * When the chosen database cannot be reached, the server runs on the JSON file until the
 * next restart (see `ResilientStore`). The Mongo and Postgres drivers load on demand, so a
 * JSON-only run never opens them.
 */
@Global()
@Module({
  providers: [
    {
      provide: MONGO_HANDLE,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<AppConfig, true>,
      ): Promise<MongoHandle | null> => {
        const db = config.get('database', { infer: true });
        // MongoDB also holds the match events, so it connects even when PostgreSQL is the main database.
        // An explicit `json` choice leaves MongoDB alone.
        if (!db.mongoUrl || db.driver === 'json') return null;
        return MongoHandle.tryConnect(db.mongoUrl, db.mongoDb, db.timeoutMs);
      },
    },
    {
      provide: POSTGRES_PROBE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppConfig, true>) => {
        const db = config.get('database', { infer: true });
        // When PostgreSQL is the main database, the store itself reports. Otherwise only note whether it is there.
        const probe = db.driver === 'postgres' ? { configured: false, reachable: false } : await probePostgres(db.postgresUrl, db.timeoutMs);
        if (probe.configured) new Logger('Database').log(`PostgreSQL ${probe.reachable ? 'is reachable (not used yet)' : 'is not reachable; the server runs without it'}`);
        return probe;
      },
    },
    {
      provide: DataStore,
      inject: [ConfigService, MONGO_HANDLE],
      useFactory: async (
        config: ConfigService<AppConfig, true>,
        mongo: MongoHandle | null,
      ): Promise<DataStore> => {
        const db = config.get('database', { infer: true });
        const wanted = db.driver === 'auto' ? (db.mongoUrl ? 'mongodb' : 'json') : db.driver;
        const logger = new Logger('Database');
        const file = new JsonFileStore(db.jsonPath);
        let store: DataStore;
        if (wanted === 'json') {
          store = file;
        } else if (wanted === 'mongodb') {
          const { MongoStore } = await import('./mongo.store.js');
          store = new ResilientStore(mongo ? new MongoStore(mongo) : undefined, file, {
            configured: 'mongodb',
            unavailableReason: mongo ? undefined : 'unreachable at start-up',
          });
        } else {
          const { PostgresStore } = await import('./postgres.store.js');
          store = new ResilientStore(new PostgresStore(db.postgresUrl, db.timeoutMs), file, { configured: 'postgres' });
        }
        await store.init();
        const status = store.status();
        logger.log(
          status.degraded
            ? `Storage: JSON file at ${db.jsonPath} (${status.configured} is not available)`
            : `Storage: ${status.active}`,
        );
        return store;
      },
    },
  ],
  exports: [DataStore, MONGO_HANDLE, POSTGRES_PROBE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DataStore) private readonly store: DataStore,
    @Optional() @Inject(MONGO_HANDLE) private readonly mongo: MongoHandle | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
    await this.mongo?.close();
  }
}
