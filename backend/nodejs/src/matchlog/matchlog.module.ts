import {
  type BeforeApplicationShutdown,
  Global,
  Inject,
  Logger,
  Module,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { MONGO_HANDLE, type MongoHandle } from '../database/mongo.handle.js';
import { REDIS_HANDLE, type RedisHandle } from '../redis/redis.handle.js';
import { EventLog } from './event-log.js';
import { FileLogSink } from './file-log-sink.js';
import { MongoLogSink } from './mongo-log-sink.js';
import { RedisStreamSink } from './redis-stream-sink.js';
import { TieredEventLog } from './tiered-event-log.js';

/**
 * Provides the match event log. The file sink is always there. A reachable Redis joins as the fast
 * buffer and a reachable MongoDB as the long-lived store: events go to Redis, a flusher moves them to
 * MongoDB, and either one missing leaves the other (or the file) to take the writes.
 */
@Global()
@Module({
  providers: [
    {
      provide: EventLog,
      inject: [ConfigService, { token: REDIS_HANDLE, optional: true }, { token: MONGO_HANDLE, optional: true }],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        redis: RedisHandle | null | undefined,
        mongo: MongoHandle | null | undefined,
      ): EventLog => {
        const { dir, flushMs, retentionDays } = config.get('eventLog', { infer: true });
        const log = new TieredEventLog({
          file: new FileLogSink(dir),
          buffer: redis ? new RedisStreamSink(redis) : undefined,
          store: mongo ? new MongoLogSink(mongo.db, retentionDays) : undefined,
          flushMs,
          drainMs: 1000,
          retryMs: 5000,
          keepStoredEvents: retentionDays > 0,
        });
        const places = [redis ? 'Redis' : '', mongo ? 'MongoDB' : '', 'files'].filter(Boolean).join(' + ');
        new Logger('MatchLog').log(`Match log: ${places}`);
        return log;
      },
    },
  ],
  exports: [EventLog],
})
export class MatchLogModule implements BeforeApplicationShutdown {
  constructor(@Inject(EventLog) private readonly log: EventLog) {}

  /** After the match runner has written its last events, before the database and Redis close. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.log.close();
  }
}
