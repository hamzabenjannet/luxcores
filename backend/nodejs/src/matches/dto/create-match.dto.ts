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
    default: false,
    description: 'Fill the second slot with a bot',
  })
  @IsOptional()
  @IsBoolean()
  vsBot: boolean = false;
}
