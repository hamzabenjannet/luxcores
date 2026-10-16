import { describe, expect, it } from 'vitest';
import {
  hashSecret,
  newDeviceSecret,
  newRecoveryCode,
  normalizeRecoveryCode,
} from '../src/auth/credentials.js';

describe('credentials', () => {
  it('makes distinct 256-bit device secrets as URL-safe text', () => {
    const secrets = new Set(Array.from({ length: 200 }, newDeviceSecret));
    expect(secrets.size).toBe(200);
    for (const s of secrets) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('makes recovery codes from an alphabet without look-alike characters', () => {
    for (let i = 0; i < 500; i++) {
      expect(newRecoveryCode()).toMatch(
        /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/,
      );
    }
    expect(new Set(Array.from({ length: 500 }, newRecoveryCode)).size).toBe(
      500,
    );
  });

  it('normalizes case, dashes and spaces', () => {
    expect(normalizeRecoveryCode('k7qm-2xwd 9tfb_hn4c')).toBe(
      'K7QM2XWD9TFBHN4C',
    );
    expect(normalizeRecoveryCode('K7QM2XWD9TFBHN4C')).toBe('K7QM2XWD9TFBHN4C');
  });

  it('hashes to 64 hex characters, the same way every time', () => {
    expect(hashSecret('a')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret('a')).toBe(hashSecret('a'));
    expect(hashSecret('a')).not.toBe(hashSecret('b'));
  });
});
