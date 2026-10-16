import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Guards admin routes with the `x-api-key` header. Pair it with `@Public()` so the
 * global JWT guard steps aside. The comparison takes the same time for any wrong key.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const given = request.headers['x-api-key'];
    const expected = this.config.get('adminApiKey', { infer: true });
    if (typeof given !== 'string' || !expected || !safeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid API key');
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
