import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../common/types.js';
import { PlayersService } from '../players/players.service.js';
import type { AuthResponseDto } from './dto/auth-response.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly players: PlayersService,
    private readonly jwt: JwtService,
  ) {}

  /** Creates a guest profile and signs a token for it. */
  async guestLogin(name: string): Promise<AuthResponseDto> {
    const player = await this.players.create(name);
    const payload: JwtPayload = { sub: player.id, name: player.name };
    const accessToken = await this.jwt.signAsync(payload);
    const { iat, exp } = this.jwt.decode<{ iat: number; exp: number }>(
      accessToken,
    );
    return { accessToken, tokenType: 'Bearer', expiresIn: exp - iat, player };
  }
}
