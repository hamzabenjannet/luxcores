import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { AppConfig } from '../config/configuration.js';
import { Public } from '../common/decorators/public.decorator.js';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import { EventBus } from '../events/event-bus.js';
import { MatchRunnerService } from '../game/match-runner.service.js';
import { SimService } from '../simulation/sim.service.js';
import { APP_VERSION } from '../version.js';

class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty({ example: '0.1.0' }) version!: string;
  @ApiProperty({ example: 42 }) uptimeSeconds!: number;
  @ApiProperty({ example: '0.10.0' }) specVersion!: string;
  @ApiProperty({ example: { driver: 'json', ok: true } }) database!: {
    driver: string;
    ok: boolean;
  };
  @ApiProperty({
    example: 'local',
    enum: ['local', 'rabbitmq'],
    description: 'How domain events travel',
  })
  events!: string;
  @ApiProperty({ example: 0 }) runningMatches!: number;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly store: DataStore,
    private readonly bus: EventBus,
    private readonly sim: SimService,
    private readonly runner: MatchRunnerService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency check' })
  @ApiOkResponse({ type: HealthDto })
  async health(): Promise<HealthDto> {
    const driver = this.config.get('database.driver', { infer: true });
    const ok = await this.store.count(COLLECTIONS.players).then(
      () => true,
      () => false,
    );
    return {
      status: ok ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      specVersion: this.sim.specVersion,
      database: { driver, ok },
      events: this.bus.mode,
      runningMatches: this.runner.runningMatchIds.length,
    };
  }
}
