import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { DataStore } from './data-store.js';
import { JsonFileStore } from './json-file.store.js';

/**
 * Chooses the storage adapter from `DATABASE_DRIVER` (`json`, `mongodb` or
 * `postgres`). The Mongo and Postgres adapters load on demand, so a JSON-only
 * run never opens those drivers.
 */
@Global()
@Module({
  providers: [
    {
      provide: DataStore,
      inject: [ConfigService],
      useFactory: async (
        config: ConfigService<AppConfig, true>,
      ): Promise<DataStore> => {
        const db = config.get('database', { infer: true });
        let store: DataStore;
        switch (db.driver) {
          case 'mongodb': {
            const { MongoStore } = await import('./mongo.store.js');
            store = new MongoStore(db.mongoUrl, db.mongoDb);
            break;
          }
          case 'postgres': {
            const { PostgresStore } = await import('./postgres.store.js');
            store = new PostgresStore(db.postgresUrl);
            break;
          }
          default:
            store = new JsonFileStore(db.jsonPath);
        }
        await store.init();
        return store;
      },
    },
  ],
  exports: [DataStore],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DataStore) private readonly store: DataStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}
