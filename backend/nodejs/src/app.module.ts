import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClusterModule } from './cluster/cluster.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { HttpThrottlerGuard, throttlerOptions } from './common/rate-limit.js';
import type { AppConfig } from './config/configuration.js';
import configuration from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { MatchLogModule } from './matchlog/matchlog.module.js';
import { EventsModule } from './events/events.module.js';
import { GameModule } from './game/game.module.js';
import { HealthModule } from './health/health.module.js';
import { MatchesModule } from './matches/matches.module.js';
import { PlayersModule } from './players/players.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ReplaysModule } from './replays/replays.module.js';
import { SimulationModule } from './simulation/simulation.module.js';
import { StaticModule } from './static/static.module.js';
import { TestHubModule } from './testhub/testhub.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        throttlerOptions(config),
    }),
    DatabaseModule,
    RedisModule,
    ClusterModule,
    MatchLogModule,
    SimulationModule,
    EventsModule,
    AuthModule,
    PlayersModule,
    MatchesModule,
    ReplaysModule,
    GameModule,
    HealthModule,
    AdminModule,
    StaticModule,
    TestHubModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
