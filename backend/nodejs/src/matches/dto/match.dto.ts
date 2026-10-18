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

export class MatchResultDto {
  @ApiProperty({ nullable: true, type: Number, example: 0 }) winnerTeam!:
    number | null;
  @ApiProperty() draw!: boolean;
  @ApiProperty({ enum: MatchEndReason }) reason!: MatchEndReason;
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
