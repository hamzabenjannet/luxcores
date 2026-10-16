import {
  BadRequestException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiKeyGuard } from '../src/common/guards/api-key.guard.js';
import {
  MAX_SEED,
  ParseSeedPipe,
} from '../src/common/pipes/parse-seed.pipe.js';
import { validateEnv } from '../src/config/env.validation.js';

describe('ParseSeedPipe', () => {
  const pipe = new ParseSeedPipe();

  it('accepts whole numbers from 0 to 2^32 - 1', () => {
    expect(pipe.transform('0')).toBe(0);
    expect(pipe.transform('1234567')).toBe(1234567);
    expect(pipe.transform(String(MAX_SEED))).toBe(MAX_SEED);
  });

  it.each(['-1', '1.5', 'abc', '', '4294967296', '12345678901', '1e3', ' 7'])(
    'rejects %j',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(BadRequestException);
    },
  );
});

describe('ApiKeyGuard', () => {
  const config = { get: () => 'right-key-right-key' } as never;
  const guard = new ApiKeyGuard(config);
  const context = (key?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: key === undefined ? {} : { 'x-api-key': key },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('lets the right key in', () => {
    expect(guard.canActivate(context('right-key-right-key'))).toBe(true);
  });

  it.each([
    undefined,
    '',
    'wrong',
    'right-key-right-keyX',
    'right-key-right-ke',
  ])('rejects %j', (key) => {
    expect(() => guard.canActivate(context(key))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('validateEnv', () => {
  it('accepts an empty development environment', () => {
    expect(() => validateEnv({})).not.toThrow();
  });

  it('demands strong secrets in production', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /JWT_SECRET[\s\S]*ADMIN_API_KEY/,
    );
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'short',
        ADMIN_API_KEY: 'short',
      }),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(16),
        ADMIN_API_KEY: 'y'.repeat(16),
      }),
    ).not.toThrow();
  });

  it('demands a connection string for the chosen database', () => {
    expect(() => validateEnv({ DATABASE_DRIVER: 'mongodb' })).toThrow(
      /MONGODB_URL/,
    );
    expect(() => validateEnv({ DATABASE_DRIVER: 'postgres' })).toThrow(
      /POSTGRES_URL/,
    );
    expect(() =>
      validateEnv({
        DATABASE_DRIVER: 'postgres',
        POSTGRES_URL: 'postgres://x',
      }),
    ).not.toThrow();
  });

  it('rejects unknown drivers and bad numbers', () => {
    expect(() => validateEnv({ DATABASE_DRIVER: 'sqlite' })).toThrow(
      /DATABASE_DRIVER/,
    );
    expect(() => validateEnv({ PORT: '99999' })).toThrow(/PORT/);
    expect(() => validateEnv({ MATCH_MAX_TICKS: '5' })).toThrow(
      /MATCH_MAX_TICKS/,
    );
  });
});
