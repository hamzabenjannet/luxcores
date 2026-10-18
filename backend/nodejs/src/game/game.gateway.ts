import {
  Logger,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthenticatedPlayer, JwtPayload } from '../common/types.js';
import {
  ChatMessageDto,
  GameCommandDto,
  MatchRefDto,
} from './dto/socket-dtos.js';
import { GameActions, type JoinAck } from './game-actions.service.js';
import type { CommandAck } from './match-runner.service.js';
import { RoomHub } from './room-hub.service.js';
import { WsErrorFilter } from './ws-exception.filter.js';
import { WsJwtGuard } from './ws-jwt.guard.js';

/** The Socket.IO room that carries the traffic of one match. */
export const matchRoom = (matchId: string): string => `match:${matchId}`;

/** The part of a match room that holds one team's players, for events that only that team may see. */
export const teamRoom = (matchId: string, team: number): string => `match:${matchId}:team:${team}`;

const wsValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors: ValidationError[]) =>
    new WsException(
      errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') ||
        'Invalid payload',
    ),
});

/**
 * Socket.IO channel of a match, in the `/game` namespace. The web client uses
 * it. `RawWsGateway` offers the same events as JSON over a plain WebSocket.
 *
 * Client to server (each takes an ack callback):
 *   match:join     { matchId }            join the room; the ack holds the current snapshot
 *   match:leave    { matchId }            leave the room
 *   match:command  { matchId, seq, cmd }  queue a sim command; the ack is a CommandAck
 *   chat:message   { matchId, text }      broadcast a chat line to the room
 *   ping           -                      the ack holds the server time
 *
 * Server to client (to the match room):
 *   match:updated  MatchDto               lobby or status change
 *   match:started  { tickHz, players, map, snapshot }
 *   match:snapshot MatchSnapshot          every SNAPSHOT_EVERY_TICKS ticks
 *   match:ended    { endedTick, result, replayId }
 *   chat:message   { from, text, at }
 */
@WebSocketGateway({ namespace: 'game', cors: { origin: true } })
@UseGuards(WsJwtGuard)
@UsePipes(wsValidation)
@UseFilters(new WsErrorFilter())
export class GameGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly actions: GameActions,
    private readonly hub: RoomHub,
  ) {
    hub.addSink({
      emitToRoom: (matchId, event, data) =>
        this.server?.to(matchRoom(matchId)).emit(event, data),
      emitToTeam: (matchId, team, event, data) =>
        this.server?.to(teamRoom(matchId, team)).emit(event, data),
    });
  }

  /** Handshake middleware: a socket without a valid token never connects. */
  afterInit(server: Namespace): void {
    server.use(async (socket, next) => {
      const header = socket.handshake.headers.authorization;
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!token) return next(new Error('unauthorized: missing token'));
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        socket.data.player = {
          id: payload.sub,
          name: payload.name,
        } satisfies AuthenticatedPlayer;
        next();
      } catch {
        next(new Error('unauthorized: invalid or expired token'));
      }
    });
    this.logger.log('Socket.IO namespace /game ready');
  }

  @SubscribeMessage('match:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MatchRefDto,
  ): Promise<JoinAck> {
    const ack = await this.actions.join(this.playerOf(client), dto.matchId);
    if (ack.ok && !client.rooms.has(matchRoom(dto.matchId))) {
      await client.join(matchRoom(dto.matchId));
      if (ack.team !== null) await client.join(teamRoom(dto.matchId, ack.team));
      ((client.data.watched as Set<string> | undefined) ?? (client.data.watched = new Set<string>())).add(dto.matchId);
      this.hub.watch(dto.matchId); // tells the other servers that a client here wants this room
    }
    return ack;
  }

  @SubscribeMessage('match:leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MatchRefDto,
  ): Promise<{ ok: true }> {
    if (client.rooms.has(matchRoom(dto.matchId))) {
      await client.leave(matchRoom(dto.matchId));
      for (const room of client.rooms) if (room.startsWith(`${matchRoom(dto.matchId)}:team:`)) await client.leave(room);
      (client.data.watched as Set<string> | undefined)?.delete(dto.matchId);
      this.hub.unwatch(dto.matchId);
    }
    return { ok: true };
  }

  /** Socket.IO has emptied the socket's rooms by now, so the rooms it held come from the ones it joined here. */
  handleDisconnect(client: Socket): void {
    for (const id of (client.data.watched as Set<string> | undefined) ?? []) this.hub.unwatch(id);
  }

  @SubscribeMessage('match:command')
  command(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: GameCommandDto,
  ): Promise<CommandAck> {
    return this.actions.command(this.playerOf(client), dto);
  }

  @SubscribeMessage('chat:message')
  chat(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatMessageDto,
  ): { ok: boolean } {
    if (!client.rooms.has(matchRoom(dto.matchId))) return { ok: false }; // only members who joined the room may talk in it
    this.actions.chat(this.playerOf(client), dto);
    return { ok: true };
  }

  @SubscribeMessage('ping')
  ping(): { serverTime: string } {
    return this.actions.ping();
  }

  private playerOf(client: Socket): AuthenticatedPlayer {
    return client.data.player as AuthenticatedPlayer;
  }
}
