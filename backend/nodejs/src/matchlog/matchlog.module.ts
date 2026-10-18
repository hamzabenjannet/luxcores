import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EventLog } from './event-log.js';
import { FileEventLog } from './file-event-log.js';

/**
 * Provides the match event log. Today it is the append-only file log, the setup that needs no
 * other service. Redis Streams and MongoDB implementations will join it behind the same port.
 */
@Global()
@Module({
  providers: [
    {
      provide: EventLog,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): EventLog => {
        const { dir, flushMs } = config.get('eventLog', { infer: true });
        return new FileEventLog(dir, flushMs);
      },
    },
  ],
  exports: [EventLog],
})
export class MatchLogModule {}
