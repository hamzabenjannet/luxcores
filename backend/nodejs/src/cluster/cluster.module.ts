import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { withinWindow } from '../common/startup-wait.js';
import { REDIS_HANDLE, type RedisHandle } from '../redis/redis.handle.js';
import { CommandBus, LocalCommandBus } from './command-bus.js';
import { LocalOwnership, MatchOwnership } from './match-ownership.js';
import { RabbitCommandBus } from './rabbit-command-bus.js';
import { RedisOwnership } from './redis-ownership.js';

/**
 * The pieces that let several servers share the running matches: leases that say who runs which
 * match (Redis) and one command queue per match (RabbitMQ). Each falls back to an in-process stand-in
 * when its service is not configured or not reachable at start-up, so one server works alone.
 */
@Global()
@Module({
  providers: [
    {
      provide: MatchOwnership,
      inject: [ConfigService, { token: REDIS_HANDLE, optional: true }],
      useFactory: (config: ConfigService<AppConfig, true>, redis: RedisHandle | null | undefined): MatchOwnership => {
        const { nodeId, leaseMs } = config.get('cluster', { infer: true });
        return redis ? new RedisOwnership(redis, nodeId, leaseMs) : new LocalOwnership(nodeId);
      },
    },
    {
      provide: CommandBus,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppConfig, true>): Promise<CommandBus> => {
        const { url, timeoutMs } = config.get('rabbitmq', { infer: true });
        const logger = new Logger('CommandBus');
        if (!url) return new LocalCommandBus();
        const bus = new RabbitCommandBus(url);
        try {
          await withinWindow(() => bus.connect(timeoutMs), config.get('startupWaitMs', { infer: true }));
          logger.log('Commands travel over one RabbitMQ queue per match');
          return bus;
        } catch (err) {
          logger.warn(`RabbitMQ is unreachable (${(err as Error).message}); matches take commands in this process until the next restart`);
          return new LocalCommandBus();
        }
      },
    },
  ],
  exports: [MatchOwnership, CommandBus],
})
export class ClusterModule implements OnApplicationShutdown {
  constructor(
    @Inject(MatchOwnership) private readonly ownership: MatchOwnership,
    @Inject(CommandBus) private readonly bus: CommandBus,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.ownership.close();
    await this.bus.close();
  }
}
