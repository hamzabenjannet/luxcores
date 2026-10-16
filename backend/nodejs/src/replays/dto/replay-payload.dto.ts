import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_SEED } from '../../common/pipes/parse-seed.pipe.js';

export class ReplayPlayerDto {
  @ApiProperty({ example: 0 }) @IsInt() @Min(0) id!: number;
  @ApiProperty({ example: 0 }) @IsInt() @Min(0) team!: number;
  @ApiProperty({ enum: ['human', 'bot'] }) @IsEnum(['human', 'bot']) kind!:
    'human' | 'bot';
}

/**
 * The replay format of `src/sim/replay.js`: config version, seed, players, the
 * ordered command log and a state hash every 20 ticks.
 */
export class ReplayPayloadDto {
  @ApiProperty({ example: 1, description: 'Replay format version' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({
    example: '0.10.0',
    description: 'Sim spec the replay was recorded with',
  })
  @IsString()
  specVersion!: string;

  @ApiProperty({ description: 'sha256 of the data files used' })
  @IsString()
  dataHash!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  mapgenVersion!: number;

  @ApiProperty({ example: 1234567, minimum: 0, maximum: MAX_SEED })
  @IsInt()
  @Min(0)
  @Max(MAX_SEED)
  seed!: number;

  @ApiProperty({ type: [ReplayPlayerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReplayPlayerDto)
  players!: ReplayPlayerDto[];

  @ApiProperty({ example: 2400, description: 'Ticks simulated' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  ticks!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Command envelopes `{ tick, playerId, seq, cmd }` in record order',
  })
  @IsArray()
  @ArrayMaxSize(200_000)
  @IsObject({ each: true })
  commands!: Record<string, unknown>[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { '20': '66b9dd40', '40': 'a698130c' },
    description: 'State hash by tick, every 20 ticks',
  })
  @IsObject()
  hashes!: Record<string, string>;
}
