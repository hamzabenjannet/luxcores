import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MAX_SEED } from '../../common/pipes/parse-seed.pipe.js';
import { MatchMode } from './match.dto.js';

/** The largest tick limit a host can choose: 1 000 000 ticks, about 14 hours at 20 Hz. 0 means unlimited. */
export const MAX_MATCH_TICKS = 1_000_000;

export class CreateMatchDto {
  @ApiProperty({ example: 'Friday duel', minLength: 3, maxLength: 40 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 40)
  name!: string;

  @ApiPropertyOptional({ enum: MatchMode, default: MatchMode.OneVsOne })
  @IsOptional()
  @IsEnum(MatchMode)
  mode: MatchMode = MatchMode.OneVsOne;

  @ApiPropertyOptional({
    example: 1234567,
    minimum: 0,
    maximum: MAX_SEED,
    description:
      'Map and RNG seed. The server picks a random one when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEED)
  seed?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    maximum: 1000,
    description:
      'Entropy rate in tenths of a percent of the maximum HP per second (1000 is 100 percent); 0 turns entropy off. The default of data/balance.json applies when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  entropyPermillePerSecond?: number;

  @ApiPropertyOptional({
    example: 120,
    minimum: 1,
    maximum: 1000,
    description:
      'Creeps a player may have alive at once (GDD 9). A high cap costs frame rate. The default of data/balance.json applies when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  creepCapPerPlayer?: number;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    maximum: MAX_MATCH_TICKS,
    description:
      'Tick limit of this match: an undecided match ends as a draw at this tick. 0 means unlimited, so the match runs until a Core falls. The server default (`MATCH_MAX_TICKS`, or `match.stalemateTicks` in data/balance.json) applies when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MATCH_TICKS)
  maxTicks?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Fill the second slot with a bot',
  })
  @IsOptional()
  @IsBoolean()
  vsBot: boolean = false;

  @ApiPropertyOptional({
    default: false,
    description:
      'Two bots play each other and the host only watches. Any signed-in player can join the room as a spectator. Cannot be combined with `vsBot`.',
  })
  @IsOptional()
  @IsBoolean()
  botVsBot: boolean = false;
}
