import { ApiProperty } from '@nestjs/swagger';
import {
  PLAYER_NAME_MESSAGE,
  PlayerName,
} from '../../players/dto/player-name.decorator.js';

export class GuestLoginDto {
  @ApiProperty({
    example: 'Halo',
    minLength: 2,
    maxLength: 24,
    description: PLAYER_NAME_MESSAGE,
  })
  @PlayerName()
  name!: string;
}
