import { Global, Module } from '@nestjs/common';
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
      useFactory: (
        config: ConfigService<AppConfig, true>,
        stats: PlayerStatsService,
      ): EventBus => {
        const { url, queue } = config.get('rabbitmq', { infer: true });
        return url
          ? new RabbitMqEventBus(url, queue)
          : new LocalEventBus(stats);
      },
    },
  ],
  exports: [EventBus],
})
export class EventsModule {}
