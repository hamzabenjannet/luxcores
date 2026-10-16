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
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthenticatedPlayer, JwtPayload } from '../common/types.js';
import { MatchesService } from '../matches/matches.service.js';
import {
  ChatMessageDto,
  GameCommandDto,
  MatchRefDto,
} from './dto/socket-dtos.js';
import {
  type CommandAck,
  MatchRunnerService,
  type MatchSnapshot,
} from './match-runner.service.js';
import { WsErrorFilter } from './ws-exception.filter.js';
import { WsJwtGuard } from './ws-jwt.guard.js';

/** The Socket.IO room that carries the traffic of one match. */
export const matchRoom = (matchId: string): string => `match:${matchId}`;

type JoinAck =
  | {
      ok: true;
      status: string;
      tick: number | null;
      snapshot: MatchSnapshot | null;
    }
  | { ok: false; error: string };

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
 * Real-time channel of a match, in the `/game` namespace.
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
export class GameGateway implements OnGatewayInit {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly runner: MatchRunnerService,
    private readonly matches: MatchesService,
  ) {
    this.matches.changes.on('changed', (match: { id: string }) =>
      this.server?.to(matchRoom(match.id)).emit('match:updated', match),
    );
    this.runner.onStarted((info) =>
      this.server?.to(matchRoom(info.matchId)).emit('match:started', info),
    );
    this.runner.onSnapshot((snapshot) =>
      this.server
        ?.to(matchRoom(snapshot.matchId))
        .emit('match:snapshot', snapshot),
    );
    this.runner.onEnded((info) =>
      this.server?.to(matchRoom(info.matchId)).emit('match:ended', info),
    );
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
    const match = await this.matches.get(dto.matchId).catch(() => null);
    if (!match) return { ok: false, error: 'Match not found' };
    if (!match.players.some((p) => p.playerId === this.playerOf(client).id))
      return { ok: false, error: 'You are not in this match' };
    await client.join(matchRoom(match.id));
    const snapshot = this.runner.snapshot(match.id);
    return {
      ok: true,
      status: match.status,
      tick: snapshot?.tick ?? null,
      snapshot,
    };
  }

  @SubscribeMessage('match:leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MatchRefDto,
  ): Promise<{ ok: true }> {
    await client.leave(matchRoom(dto.matchId));
    return { ok: true };
  }

  @SubscribeMessage('match:command')
  command(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: GameCommandDto,
  ): CommandAck {
    return this.runner.submitCommand(
      dto.matchId,
      this.playerOf(client).id,
      dto.seq,
      dto.cmd,
    );
  }

  @SubscribeMessage('chat:message')
  chat(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatMessageDto,
  ): { ok: boolean } {
    const room = matchRoom(dto.matchId);
    if (!client.rooms.has(room)) return { ok: false }; // only members who joined the room may talk in it
    this.server.to(room).emit('chat:message', {
      from: this.playerOf(client).name,
      text: dto.text,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }

  @SubscribeMessage('ping')
  ping(): { serverTime: string } {
    return { serverTime: new Date().toISOString() };
  }

  private playerOf(client: Socket): AuthenticatedPlayer {
    return client.data.player as AuthenticatedPlayer;
  }
}
