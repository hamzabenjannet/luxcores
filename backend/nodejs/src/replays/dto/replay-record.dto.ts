import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { ReplayPayloadDto } from './replay-payload.dto.js';

/** A stored replay. Also the document of the `replays` collection. */
export class ReplayRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ format: 'uuid' }) matchId?: string;
  @ApiProperty({
    description: 'Player id, or `system` for a replay the server recorded',
  })
  uploadedBy!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ example: 1234567 }) seed!: number;
  @ApiProperty({ example: '0.10.0' }) specVersion!: string;
  @ApiProperty({ example: 2400 }) ticks!: number;
  @ApiPropertyOptional({
    description:
      'False when the match resumed from a checkpoint under changed data or code, so its replay no longer verifies from the seed. Absent otherwise.',
  })
  reproducible?: boolean;
  @ApiProperty({ type: ReplayPayloadDto }) replay!: ReplayPayloadDto;
}

/** A replay without its payload, for lists. */
export class ReplaySummaryDto extends OmitType(ReplayRecordDto, [
  'replay',
] as const) {}

export class ReplayListDto {
  @ApiProperty({ type: [ReplaySummaryDto] }) items!: ReplaySummaryDto[];
  @ApiProperty({ example: 3 }) total!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 0 }) offset!: number;
}

export class ReplayVerifyResultDto {
  @ApiProperty({ description: 'Every recorded hash matched the re-simulation' })
  ok!: boolean;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'First tick whose hash differed',
  })
  firstMismatchTick!: number | null;
  @ApiProperty({ example: 'e626db0e', description: 'Hash of the final state' })
  finalHash!: string;
  @ApiProperty({
    example: '0.10.0',
    description: 'Spec version of this server',
  })
  specVersion!: string;
}
