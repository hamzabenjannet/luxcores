import { ApiProperty } from '@nestjs/swagger';
import { PLAYER_NAME_MESSAGE, PlayerName } from './player-name.decorator.js';

export class UpdatePlayerDto {
  @ApiProperty({
    example: 'Prism',
    minLength: 2,
    maxLength: 24,
    description: PLAYER_NAME_MESSAGE,
  })
  @PlayerName()
  name!: string;
}
