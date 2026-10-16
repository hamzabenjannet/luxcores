import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

/**
 * Socket guard. The handshake middleware in `GameGateway` verifies the JWT and
 * stores the player on `socket.data`; this guard refuses any event from a socket
 * that has none.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    if (!client.data?.player) throw new WsException('Unauthorized');
    return true;
  }
}
