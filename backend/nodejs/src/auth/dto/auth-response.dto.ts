import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

  @ApiPropertyOptional({
    description:
      'Secret that this device keeps to sign in again through `POST /auth/device`. Returned only by `guest` and `recover`, and never shown again.',
  })
  deviceSecret?: string;

  @ApiPropertyOptional({
    example: 'K7QM-2XWD-9TFB-HN4C',
    description:
      'Returned by `recover` only: the replacement for the code that was just used',
  })
  recoveryCode?: string;
}
