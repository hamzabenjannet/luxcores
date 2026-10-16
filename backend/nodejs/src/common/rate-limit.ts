import { type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/configuration.js';

const AUTH_LIMIT_KEY = 'authRateLimit';

/** Marks a route for the strict `auth` limit, on top of the general one. */
export const AuthRateLimit = () => SetMetadata(AUTH_LIMIT_KEY, true);

/**
 * Two limits per client address and minute: a general one for every HTTP route,
 * and a strict one for the sign-in routes that guess nothing but still invite
 * abuse (creating profiles, trying device secrets and recovery codes).
 */
export function throttlerOptions(
  config: ConfigService<AppConfig, true>,
): ThrottlerModuleOptions {
  const { perMinute, authPerMinute } = config.get('rateLimit', { infer: true });
  return {
    throttlers: [
      { name: 'general', ttl: 60_000, limit: perMinute },
      {
        name: 'auth',
        ttl: 60_000,
        limit: authPerMinute,
        skipIf: (context) =>
          !Reflect.getMetadata(AUTH_LIMIT_KEY, context.getHandler()),
      },
    ],
  };
}

/** The throttler only understands HTTP. Sockets pass: they sign in with a JWT first. */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    return super.canActivate(context);
  }
}
