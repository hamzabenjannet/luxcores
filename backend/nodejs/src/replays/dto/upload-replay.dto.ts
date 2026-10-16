import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { ReplayPayloadDto } from './replay-payload.dto.js';

export class UploadReplayDto {
  @ApiProperty({ type: ReplayPayloadDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ReplayPayloadDto)
  replay!: ReplayPayloadDto;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Match this replay belongs to',
  })
  @IsOptional()
  @IsUUID()
  matchId?: string;
}
