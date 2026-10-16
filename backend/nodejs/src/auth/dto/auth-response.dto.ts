import { ApiProperty } from '@nestjs/swagger';
import { PlayerDto } from '../../players/dto/player.dto.js';

export class AuthResponseDto {
  @ApiProperty({
    description:
      'Send as `Authorization: Bearer <token>` and as `auth.token` in the Socket.IO handshake',
  })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: 43200,
    description: 'Seconds until the token expires',
  })
  expiresIn!: number;

  @ApiProperty({ type: PlayerDto })
  player!: PlayerDto;
}
