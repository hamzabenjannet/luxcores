import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPlayer, RequestWithPlayer } from '../types.js';

/** Injects the player that `JwtAuthGuard` attached to the request. */
export const CurrentPlayer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPlayer => {
    const request = ctx.switchToHttp().getRequest<RequestWithPlayer>();
    return request.user as AuthenticatedPlayer;
  },
);
