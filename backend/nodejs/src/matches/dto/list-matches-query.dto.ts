import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { MatchStatus } from './match.dto.js';

export class ListMatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: MatchStatus,
    description: 'Only matches in this state',
  })
  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;
}
