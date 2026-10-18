import { Inject, Injectable, Optional } from '@nestjs/common';
import { MatchOwnership } from '../cluster/match-ownership.js';
import { RoomRelay } from '../cluster/room-relay.js';
import { MatchesService } from '../matches/matches.service.js';
import { REDIS_HANDLE, type RedisHandle } from '../redis/redis.handle.js';
import { MatchRunnerService } from './match-runner.service.js';

/** A transport that can deliver an event to everyone it has put in a match room. */
export interface RoomSink {
  emitToRoom(matchId: string, event: string, data: unknown): void;
}

/**
 * Fan-out point for match events. The Socket.IO gateway and the plain
 * WebSocket gateway each register a sink, so one event (a snapshot, a chat
 * line, a lobby change) reaches clients on either transport.
 *
 * With Redis, an event also reaches the clients that sit on other servers: the gateways tell the hub
 * when a room gains its first local client or loses its last (`watch`, `unwatch`), and the relay
 * forwards events only for rooms that another server follows.
 */
@Injectable()
export class RoomHub {
  private readonly sinks: RoomSink[] = [];
  private readonly relay?: RoomRelay;

  constructor(
    runner: MatchRunnerService,
    matches: MatchesService,
    ownership: MatchOwnership,
    @Optional() @Inject(REDIS_HANDLE) redis?: RedisHandle | null,
  ) {
    if (redis) this.relay = new RoomRelay(redis, ownership.nodeId, (matchId, event, data) => this.deliver(matchId, event, data));
    matches.changes.on('changed', (match: { id: string }) =>
      this.broadcast(match.id, 'match:updated', match),
    );
    runner.onStarted((info) =>
      this.broadcast(info.matchId, 'match:started', info),
    );
    runner.onSnapshot((snapshot) =>
      this.broadcast(snapshot.matchId, 'match:snapshot', snapshot),
    );
    runner.onEnded((info) => this.broadcast(info.matchId, 'match:ended', info));
  }

  addSink(sink: RoomSink): void {
    this.sinks.push(sink);
  }

  /** A client of this server joined the room. */
  watch(matchId: string): void {
    void this.relay?.watch(matchId);
  }

  /** A client of this server left the room. */
  unwatch(matchId: string): void {
    void this.relay?.unwatch(matchId);
  }

  /** Sends an event to the room's clients here and, when another server follows the room, there too. */
  broadcast(matchId: string, event: string, data: unknown): void {
    this.deliver(matchId, event, data);
    this.relay?.publish(matchId, event, data);
  }

  private deliver(matchId: string, event: string, data: unknown): void {
    for (const sink of this.sinks) sink.emitToRoom(matchId, event, data);
  }
}
