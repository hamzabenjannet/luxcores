import { Global, Inject, Module, type OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { REDIS_HANDLE, RedisHandle } from './redis.handle.js';

/**
 * Opens the one Redis connection when `REDIS_URL` is set. It serves the match log buffer, the
 * match ownership and the cross-node fan-out. An unreachable Redis leaves the handle null, and the
 * server runs on without it.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_HANDLE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppConfig, true>): Promise<RedisHandle | null> => {
        const { url, timeoutMs, prefix } = config.get('redis', { infer: true });
        return url ? RedisHandle.tryConnect(url, timeoutMs, prefix) : null;
      },
    },
  ],
  exports: [REDIS_HANDLE],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Optional() @Inject(REDIS_HANDLE) private readonly redis: RedisHandle | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis?.close();
  }
}
