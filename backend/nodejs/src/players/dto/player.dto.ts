import { ApiProperty } from '@nestjs/swagger';

export class PlayerStatsDto {
  @ApiProperty({ example: 3 }) matchesPlayed!: number;
  @ApiProperty({ example: 2 }) wins!: number;
  @ApiProperty({ example: 1 }) losses!: number;
  @ApiProperty({ example: 0 }) draws!: number;
}

/** A player profile. Also the stored document of the `players` collection. */
export class PlayerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Halo' }) name!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: PlayerStatsDto }) stats!: PlayerStatsDto;
}
