import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import type { AppConfig } from '../config/configuration.js';
import type { AuthenticatedPlayer, JwtPayload } from '../common/types.js';
import {
  ChatMessageDto,
  GameCommandDto,
  MatchRefDto,
} from './dto/socket-dtos.js';
import { GameActions } from './game-actions.service.js';
import { RoomHub } from './room-hub.service.js';
import { validatePayload } from './validate-payload.js';

/** Where the plain WebSocket listens. Socket.IO keeps `/socket.io`. */
export const RAW_WS_PATH = '/ws';

/** Skip a snapshot for a client that has this many bytes waiting to be sent. */
const SLOW_CLIENT_BYTES = 1_000_000;
/** Close code for a missing or invalid token. 4000 to 4999 are free for apps. */
const CLOSE_UNAUTHORIZED = 4401;

/** One frame in either direction. A request carries an `id`; its reply is `{ event: 'ack', id, data }`. */
interface Frame {
  event: string;
  data?: unknown;
  id?: number;
}

interface Connection {
  player?: AuthenticatedPlayer;
  rooms: Set<string>;
  authTimer?: NodeJS.Timeout;
  alive: boolean;
}

/**
 * The match channel as JSON over a plain WebSocket at `/ws`, for clients that
 * have no Socket.IO library, such as Godot's `WebSocketPeer`. It exposes the same
 * events as `GameGateway` through the same `GameActions`, so both transports
 * see the same matches, and a chat line crosses from one to the other.
 *
 * Authentication, any one of:
 *   - an `Authorization: Bearer <jwt>` header on the upgrade request
 *   - a `?token=<jwt>` query parameter (for clients that cannot set headers)
 *   - an `{ "event": "auth", "data": { "token": "<jwt>" } }` frame within
 *     `WS_AUTH_TIMEOUT_MS`, which keeps the token out of URLs and proxy logs
 * A token that is present but invalid is refused with HTTP 401 at the upgrade.
 *
 * Frames from the client: auth, match:join, match:leave, match:command,
 * chat:message, ping. Frames from the server: ack, exception, and the events
 * listed on `GameGateway`. A failed request is answered with
 * `{ ok: false, error }` in its ack, or in an `exception` frame without an id.
 */
@Injectable()
export class RawWsGateway
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('RawWsGateway');
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private wss?: WebSocketServer;
  private heartbeat?: NodeJS.Timeout;
  private server?: Server;
  private readonly onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void this.upgrade(req, socket, head);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
    private readonly actions: GameActions,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly hub: RoomHub,
  ) {
    hub.addSink({
      emitToRoom: (matchId, event, data) =>
        this.emitToRoom(matchId, event, data),
    });
  }

  onApplicationBootstrap(): void {
    const { maxPayloadBytes } = this.config.get('ws', { infer: true });
    this.server = this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: maxPayloadBytes,
    });
    this.server.on('upgrade', this.onUpgrade);
    // A phone that loses signal leaves a half-open socket. Ping every 30 s and drop the silent ones.
    this.heartbeat = setInterval(() => this.sweep(), 30_000);
    this.heartbeat.unref();
    this.logger.log(`Plain WebSocket ready at ${RAW_WS_PATH}`);
  }

  onApplicationShutdown(): void {
    clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    for (const ws of this.connections.keys())
      ws.close(1001, 'server shutting down');
    this.wss?.close();
  }

  /** Delivers a frame to every connection in the match room. */
  emitToRoom(matchId: string, event: string, data: unknown): void {
    const members = this.rooms.get(matchId);
    if (!members?.size) return;
    const text = JSON.stringify({ event, data } satisfies Frame);
    for (const ws of members) {
      if (event === 'match:snapshot' && ws.bufferedAmount > SLOW_CLIENT_BYTES)
        continue;
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }

  private async upgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== RAW_WS_PATH) return; // not ours: Socket.IO or another handler takes it

    const header = req.headers.authorization;
    const token =
      url.searchParams.get('token') ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    let player: AuthenticatedPlayer | undefined;
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<JwtPayload>(token);
        player = { id: payload.sub, name: payload.name };
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    this.wss?.handleUpgrade(req, socket, head, (ws) => this.accept(ws, player));
  }

  private accept(ws: WebSocket, player?: AuthenticatedPlayer): void {
    const connection: Connection = { player, rooms: new Set(), alive: true };
    this.connections.set(ws, connection);

    if (!player) {
      const { authTimeoutMs } = this.config.get('ws', { infer: true });
      connection.authTimer = setTimeout(
        () => ws.close(CLOSE_UNAUTHORIZED, 'auth timeout'),
        authTimeoutMs,
      );
    }
    ws.on('pong', () => (connection.alive = true));
    ws.on('message', (raw) => void this.onMessage(ws, connection, raw));
    ws.on('close', () => this.drop(ws, connection));
    ws.on('error', () => ws.terminate());
  }

  private async onMessage(
    ws: WebSocket,
    connection: Connection,
    raw: RawData,
  ): Promise<void> {
    let frame: Frame;
    try {
      frame = JSON.parse(raw.toString()) as Frame;
      if (
        typeof frame !== 'object' ||
        frame === null ||
        typeof frame.event !== 'string'
      )
        throw new Error();
    } catch {
      return this.send(ws, 'exception', {
        ok: false,
        error: 'Frames must be JSON like {"event":"ping","id":1}',
      });
    }
    const id = typeof frame.id === 'number' ? frame.id : undefined;
    try {
      const data = await this.handle(ws, connection, frame);
      if (id !== undefined) this.send(ws, 'ack', data, id);
    } catch (err) {
      const body = { ok: false, error: (err as Error).message };
      if (id !== undefined) this.send(ws, 'ack', body, id);
      else this.send(ws, 'exception', body);
    }
  }

  private async handle(
    ws: WebSocket,
    connection: Connection,
    frame: Frame,
  ): Promise<unknown> {
    if (frame.event === 'auth')
      return this.authenticate(connection, frame.data);
    const player = connection.player;
    if (!player) throw new Error('Unauthorized: send an auth frame first');

    switch (frame.event) {
      case 'match:join': {
        const dto = await validatePayload(MatchRefDto, frame.data);
        const ack = await this.actions.join(player, dto.matchId);
        if (ack.ok) this.joinRoom(ws, connection, dto.matchId);
        return ack;
      }
      case 'match:leave': {
        const dto = await validatePayload(MatchRefDto, frame.data);
        this.leaveRoom(ws, connection, dto.matchId);
        return { ok: true };
      }
      case 'match:command':
        return this.actions.command(
          player,
          await validatePayload(GameCommandDto, frame.data),
        );
      case 'chat:message': {
        const dto = await validatePayload(ChatMessageDto, frame.data);
        if (!connection.rooms.has(dto.matchId)) return { ok: false }; // only members who joined the room may talk in it
        this.actions.chat(player, dto);
        return { ok: true };
      }
      case 'ping':
        return this.actions.ping();
      default:
        throw new Error(`Unknown event "${frame.event}"`);
    }
  }

  private async authenticate(
    connection: Connection,
    data: unknown,
  ): Promise<{ ok: true; player: AuthenticatedPlayer }> {
    const token = (data as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string') throw new Error('auth needs { token }');
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      connection.player = { id: payload.sub, name: payload.name };
    } catch {
      throw new Error('Unauthorized: invalid or expired token');
    }
    clearTimeout(connection.authTimer);
    return { ok: true, player: connection.player };
  }

  private joinRoom(
    ws: WebSocket,
    connection: Connection,
    matchId: string,
  ): void {
    if (!connection.rooms.has(matchId)) this.hub.watch(matchId); // tells the other servers that a client here wants this room
    connection.rooms.add(matchId);
    let members = this.rooms.get(matchId);
    if (!members) this.rooms.set(matchId, (members = new Set()));
    members.add(ws);
  }

  private leaveRoom(
    ws: WebSocket,
    connection: Connection,
    matchId: string,
  ): void {
    if (connection.rooms.delete(matchId)) this.hub.unwatch(matchId);
    const members = this.rooms.get(matchId);
    members?.delete(ws);
    if (members && members.size === 0) this.rooms.delete(matchId);
  }

  private drop(ws: WebSocket, connection: Connection): void {
    clearTimeout(connection.authTimer);
    for (const matchId of connection.rooms)
      this.leaveRoom(ws, connection, matchId);
    this.connections.delete(ws);
  }

  private sweep(): void {
    for (const [ws, connection] of this.connections) {
      if (!connection.alive) {
        ws.terminate();
        continue;
      }
      connection.alive = false;
      ws.ping();
    }
  }

  private send(ws: WebSocket, event: string, data: unknown, id?: number): void {
    if (ws.readyState === ws.OPEN)
      ws.send(
        JSON.stringify({
          event,
          data,
          ...(id === undefined ? {} : { id }),
        } satisfies Frame),
      );
  }
}
