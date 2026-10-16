import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Letters and digits without the pairs that look alike (0 and O, 1 and I and L).
 * 31 symbols over 16 positions give about 79 bits, so guessing a code is hopeless
 * even before rate limiting.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 16;

/** A 256-bit secret for a device, as URL-safe text. */
export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** A recovery code like `K7QM-2XWD-9TFB-HN4C`. A player types it on another device. */
export function newRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Upper-cases and drops dashes and spaces, so `k7qm 2xwd...` matches `K7QM-2XWD-...`. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Both secrets are high-entropy random values, so a plain sha256 is enough to store them. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
