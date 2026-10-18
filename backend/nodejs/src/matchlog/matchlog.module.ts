import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EventLog } from './event-log.js';
import { FileLogSink } from './file-log-sink.js';
import { TieredEventLog } from './tiered-event-log.js';

/**
 * Provides the match event log: the file sink always, with the Redis buffer and the MongoDB
 * store joining it when they are configured and reachable.
 */
@Global()
@Module({
  providers: [
    {
      provide: EventLog,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): EventLog => {
        const { dir, flushMs } = config.get('eventLog', { infer: true });
        return new TieredEventLog({
          file: new FileLogSink(dir),
          flushMs,
          drainMs: 1000,
          retryMs: 5000,
          keepStoredEvents: false,
        });
      },
    },
  ],
  exports: [EventLog],
})
export class MatchLogModule {}
