import { Logger } from '@nestjs/common';
import type { PlayerStatsService } from '../players/player-stats.service.js';
import { EventBus, type EventMap, type EventPattern } from './event-bus.js';

/** In-process bus used when RabbitMQ is off. */
export class LocalEventBus extends EventBus {
  readonly mode = 'local' as const;
  private readonly logger = new Logger('EventBus');

  constructor(private readonly stats: PlayerStatsService) {
    super();
  }

  async publish<K extends EventPattern>(
    pattern: K,
    payload: EventMap[K],
  ): Promise<void> {
    this.logger.debug(`${pattern} ${JSON.stringify(payload)}`);
    if (pattern === 'match.finished')
      await this.stats.recordMatchResult(payload as EventMap['match.finished']);
  }
}
