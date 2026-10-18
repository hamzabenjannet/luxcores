import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { PlayerStatsService } from '../players/player-stats.service.js';
import { PlayersModule } from '../players/players.module.js';
import { EventBus } from './event-bus.js';
import { EventsController } from './events.controller.js';
import { LocalEventBus } from './local-event-bus.js';
import { RabbitMqEventBus } from './rabbitmq-event-bus.js';

@Global()
@Module({
  imports: [PlayersModule],
  controllers: [EventsController],
  providers: [
    {
      provide: EventBus,
      inject: [ConfigService, PlayerStatsService],
      useFactory: async (
        config: ConfigService<AppConfig, true>,
        stats: PlayerStatsService,
      ): Promise<EventBus> => {
        const { url, queue, timeoutMs } = config.get('rabbitmq', { infer: true });
        const local = new LocalEventBus(stats);
        if (!url) return local;
        const bus = new RabbitMqEventBus(url, queue, local, timeoutMs);
        try {
          await bus.connect();
          return bus;
        } catch (err) {
          // The server must work alone: without the broker, events stay in this process until the next restart.
          new Logger('EventBus').warn(`${(err as Error).message}; domain events stay in this process`);
          return local;
        }
      },
    },
  ],
  exports: [EventBus],
})
export class EventsModule {}
