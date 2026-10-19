import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MatchMode {
  OneVsOne = '1v1',
}

export enum MatchStatus {
  Lobby = 'lobby',
  Running = 'running',
  Finished = 'finished',
  Cancelled = 'cancelled',
}

export enum MatchEndReason {
  Victory = 'victory',
  Draw = 'draw',
  TickLimit = 'tick-limit',
  Stopped = 'stopped',
  /** A player left a running match for two humans, so the other one won. */
  Forfeit = 'forfeit',
}

export class MatchPlayerDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Absent for the bot' })
  playerId?: string;

  @ApiProperty({ example: 'Halo' }) name!: string;

  @ApiProperty({
    example: 0,
    description: 'Team 0 starts at the bottom (blue), team 1 at the top (red)',
  })
  team!: number;

  @ApiProperty({ enum: ['human', 'bot'] }) kind!: 'human' | 'bot';
}

/** What one team did over the match, in milli-lux (GDD 13.2). Whole lux is the value divided by 1000. */
export class TeamStatsDto {
  @ApiProperty({ example: 0 }) team!: number;
  @ApiProperty({ description: 'Total collector output' }) collected!: number;
  @ApiProperty({ description: 'Paid for buildings, upgrades, creeps, heroes, abilities and items' }) spent!: number;
  @ApiProperty({ description: 'Enemy lux destroyed by this team\'s damage' }) drained!: number;
  @ApiProperty({ description: 'Enemy lux that Energy Grab moved to this team' }) funneled!: number;
  @ApiProperty({ description: 'Refunds received for recycled buildings' }) recycled!: number;
  @ApiProperty({ description: 'Lux this team\'s units and buildings lost to entropy' }) entropy!: number;
}

export class MatchResultDto {
  @ApiProperty({ nullable: true, type: Number, example: 0 }) winnerTeam!:
    number | null;
  @ApiProperty() draw!: boolean;
  @ApiProperty({ enum: MatchEndReason }) reason!: MatchEndReason;
  @ApiPropertyOptional({ type: [TeamStatsDto], description: 'The counters of each team at the end of the match' })
  stats?: TeamStatsDto[];
}

/** A lobby or match. Also the stored document of the `matches` collection. */
export class MatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Friday duel' }) name!: string;
  @ApiProperty({ enum: MatchMode }) mode!: MatchMode;
  @ApiProperty({ enum: MatchStatus }) status!: MatchStatus;
  @ApiProperty({
    example: 1234567,
    description: 'Seed of the map and the match RNG',
  })
  seed!: number;
  @ApiProperty({ description: 'The second slot is a bot instead of a human' })
  vsBot!: boolean;
  @ApiPropertyOptional({
    default: false,
    description:
      'Both slots are bots and nobody plays. The lobby has no human players; anyone signed in may watch.',
  })
  botVsBot?: boolean;
  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    maximum: 1000,
    description:
      'Entropy rate of this match in tenths of a percent of the maximum HP per second (GDD 3.7). The host sets it when the match is created, and the lobby shows it to the other player. The default of data/balance.json applies when it is absent.',
  })
  entropyPermillePerSecond?: number;
  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    description:
      'Tick limit of this match; an undecided match ends as a draw at this tick. 0 means unlimited. The server default applies when it is absent.',
  })
  maxTicks?: number;
  @ApiProperty({ format: 'uuid' }) hostId!: string;
  @ApiProperty({ type: [MatchPlayerDto] }) players!: MatchPlayerDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiPropertyOptional({ format: 'date-time' }) startedAt?: string;
  @ApiPropertyOptional({ format: 'date-time' }) finishedAt?: string;
  @ApiPropertyOptional({
    example: 2142,
    description: 'Tick at which the match ended',
  })
  endedTick?: number;
  @ApiPropertyOptional({ type: MatchResultDto }) result?: MatchResultDto;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Replay saved when the match ended',
  })
  replayId?: string;
}
