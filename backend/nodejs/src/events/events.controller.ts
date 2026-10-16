import { Controller, Logger } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  Payload,
  type RmqContext,
} from '@nestjs/microservices';
import {
  type MatchFinishedEvent,
  PlayerStatsService,
} from '../players/player-stats.service.js';
import type { MatchStartedEvent } from './event-bus.js';

/**
 * Consumes the domain events from RabbitMQ. It has no HTTP routes. `main.ts`
 * attaches the RabbitMQ transport only when `RABBITMQ_URL` is set.
 *
 * Messages are acknowledged by hand. A message that fails is rejected without a
 * requeue, so one bad event cannot block the queue.
 */
@Controller()
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly stats: PlayerStatsService) {}

  @EventPattern('match.started')
  onMatchStarted(
    @Payload() event: MatchStartedEvent,
    @Ctx() context: unknown,
  ): void {
    this.logger.log(`match.started ${event.matchId}`);
    const rmq = context as RmqContext;
    rmq.getChannelRef().ack(rmq.getMessage());
  }

  @EventPattern('match.finished')
  async onMatchFinished(
    @Payload() event: MatchFinishedEvent,
    @Ctx() context: unknown,
  ): Promise<void> {
    // Nest types handler arguments after the payload as `unknown`, so narrow the context here.
    const rmq = context as RmqContext;
    const channel = rmq.getChannelRef();
    const message = rmq.getMessage();
    try {
      await this.stats.recordMatchResult(event);
      channel.ack(message);
    } catch (err) {
      this.logger.error(
        `match.finished ${event.matchId} failed: ${(err as Error).message}`,
      );
      channel.nack(message, false, false);
    }
  }
}
