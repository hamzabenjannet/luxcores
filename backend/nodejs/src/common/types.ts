import type { Request } from 'express';

/** The player that a verified JWT or socket handshake identifies. */
export interface AuthenticatedPlayer {
  id: string;
  name: string;
}

export interface RequestWithPlayer extends Request {
  user?: AuthenticatedPlayer;
}

/** JWT payload. `sub` is the player id. */
export interface JwtPayload {
  sub: string;
  name: string;
}
