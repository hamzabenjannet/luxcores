import { ApiProperty } from '@nestjs/swagger';
import { MatchDto } from './match.dto.js';

export class MatchListDto {
  @ApiProperty({ type: [MatchDto] }) items!: MatchDto[];
  @ApiProperty({ example: 5, description: 'Matches that fit the filter' })
  total!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 0 }) offset!: number;
}
