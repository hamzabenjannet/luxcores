import type { PlayerDto } from './dto/player.dto.js';

/**
 * A player as stored. It adds the credential hashes to the public profile. The
 * hashes never leave the server: `toPublic` strips them, and every service that
 * returns a player goes through it.
 */
export interface PlayerRecord extends PlayerDto {
  /** sha256 of the secret that this player's device keeps. */
  deviceSecretHash?: string;
  /** sha256 of the current recovery code. */
  recoveryCodeHash?: string;
}

export function toPublic(record: PlayerRecord): PlayerDto {
  const {
    deviceSecretHash: _device,
    recoveryCodeHash: _recovery,
    ...profile
  } = record;
  return profile;
}
