import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import { POSTGRES_PROBE, type PostgresProbe } from '../database/postgres.probe.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { EventLog } from '../matchlog/event-log.js';
import { EventBus } from '../events/event-bus.js';
import { MatchRunnerService } from '../game/match-runner.service.js';
import { SimService } from '../simulation/sim.service.js';
import { APP_VERSION } from '../version.js';

class HealthDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status!: 'ok' | 'degraded';
  @ApiProperty({ example: '0.1.0' }) version!: string;
  @ApiProperty({ example: 42 }) uptimeSeconds!: number;
  @ApiProperty({ example: '0.10.0' }) specVersion!: string;
  @ApiProperty({
    example: { driver: 'mongodb', active: 'json', degraded: true, ok: true },
    description:
      '`driver` is the configured database and `active` the one that answers. They differ while the server runs on the JSON file.',
  })
  database!: {
    driver: string;
    active: string;
    degraded: boolean;
    ok: boolean;
    reason?: string;
  };
  @ApiProperty({
    example: { writing: 'file', tiers: [{ name: 'file', up: true }] },
    description: 'Where the write-ahead log of the running matches goes',
  })
  eventLog!: { writing: string; tiers: { name: string; up: boolean }[] };
  @ApiProperty({
    example: { nodeId: 'host-123-ab12cd', ownership: 'local', commands: 'local', transport: 'auto', matches: [] },
    description:
      'This server in a group of servers. `ownership` is `redis` when match leases are shared, `commands` is `rabbitmq` when each match has a command queue.',
  })
  cluster!: {
    nodeId: string;
    ownership: string;
    commands: string;
    transport: string;
    matches: string[];
  };
  @ApiProperty({
    example: { configured: false, reachable: false },
    description: 'PostgreSQL is not used yet; this only tells whether it answered at start-up',
  })
  postgres!: { configured: boolean; reachable: boolean };
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
    private readonly log: EventLog,
    private readonly cluster: ClusterService,
    @Inject(POSTGRES_PROBE) private readonly postgres: PostgresProbe,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency check' })
  @ApiOkResponse({ type: HealthDto })
  async health(): Promise<HealthDto> {
    const status = this.store.status();
    const ok = await this.store.count(COLLECTIONS.players).then(
      () => true,
      () => false,
    );
    return {
      status: ok ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      specVersion: this.sim.specVersion,
      database: {
        driver: status.configured,
        active: status.active,
        degraded: status.degraded,
        ok,
        ...(status.reason ? { reason: status.reason } : {}),
      },
      eventLog: this.log.status(),
      cluster: this.cluster.status(),
      postgres: this.postgres,
      events: this.bus.mode,
      runningMatches: this.runner.runningMatchIds.length,
    };
  }
}
