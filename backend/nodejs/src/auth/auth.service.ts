import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../common/types.js';
import type { PlayerDto } from '../players/dto/player.dto.js';
import { PlayersService } from '../players/players.service.js';
import {
  hashSecret,
  newDeviceSecret,
  newRecoveryCode,
  normalizeRecoveryCode,
} from './credentials.js';
import type { AuthResponseDto } from './dto/auth-response.dto.js';

/**
 * Sign-in without passwords. A guest profile belongs to a device through a
 * random secret that the device keeps. A recovery code moves the profile to
 * another device. Only hashes of both are stored.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly players: PlayersService,
    private readonly jwt: JwtService,
  ) {}

  /** Creates a guest profile, and returns the secret its device keeps. */
  async guestLogin(name: string): Promise<AuthResponseDto> {
    const deviceSecret = newDeviceSecret();
    const player = await this.players.create(name, {
      deviceSecretHash: hashSecret(deviceSecret),
    });
    return { ...(await this.token(player)), deviceSecret };
  }

  /** Signs an existing guest in again from the secret that its device kept. */
  async deviceLogin(deviceSecret: string): Promise<AuthResponseDto> {
    const player = await this.players.findByDeviceSecretHash(
      hashSecret(deviceSecret),
    );
    if (!player) throw new UnauthorizedException('Unknown device secret');
    return this.token(player);
  }

  /** Makes a new recovery code for the player, replacing the old one. */
  async issueRecoveryCode(playerId: string): Promise<string> {
    const recoveryCode = newRecoveryCode();
    await this.players.setCredentials(playerId, {
      recoveryCodeHash: hashSecret(normalizeRecoveryCode(recoveryCode)),
    });
    return recoveryCode;
  }

  /**
   * Moves a profile to a new device. The code works once. The response carries a
   * new device secret and a new recovery code, and the old device secret stops
   * working, so a lost device cannot sign in any more.
   */
  async recover(recoveryCode: string): Promise<AuthResponseDto> {
    const player = await this.players.findByRecoveryCodeHash(
      hashSecret(normalizeRecoveryCode(recoveryCode)),
    );
    if (!player)
      throw new UnauthorizedException('Unknown or used recovery code');

    const deviceSecret = newDeviceSecret();
    const nextCode = newRecoveryCode();
    await this.players.setCredentials(player.id, {
      deviceSecretHash: hashSecret(deviceSecret),
      recoveryCodeHash: hashSecret(normalizeRecoveryCode(nextCode)),
    });
    return {
      ...(await this.token(player)),
      deviceSecret,
      recoveryCode: nextCode,
    };
  }

  private async token(player: PlayerDto): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: player.id, name: player.name };
    const accessToken = await this.jwt.signAsync(payload);
    const { iat, exp } = this.jwt.decode<{ iat: number; exp: number }>(
      accessToken,
    );
    return { accessToken, tokenType: 'Bearer', expiresIn: exp - iat, player };
  }
}
