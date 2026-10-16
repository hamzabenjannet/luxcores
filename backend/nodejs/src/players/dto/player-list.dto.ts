import { ApiProperty } from '@nestjs/swagger';
import { PlayerDto } from './player.dto.js';

export class PlayerListDto {
  @ApiProperty({ type: [PlayerDto] }) items!: PlayerDto[];
  @ApiProperty({ example: 42, description: 'Players in the database' })
  total!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 0 }) offset!: number;
}
