import { Inject, Injectable, Optional } from '@nestjs/common';
import { MatchOwnership } from '../cluster/match-ownership.js';
import { RoomRelay } from '../cluster/room-relay.js';
import { MatchesService } from '../matches/matches.service.js';
import { REDIS_HANDLE, type RedisHandle } from '../redis/redis.handle.js';
import { MatchRunnerService } from './match-runner.service.js';

/** A transport that can deliver an event to everyone it has put in a match room. */
export interface RoomSink {
  emitToRoom(matchId: string, event: string, data: unknown): void;
  /** Delivers an event only to the room's members who play for `team`. */
  emitToTeam(matchId: string, team: number, event: string, data: unknown): void;
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
  /** Clients of this server that sit in each match room. */
  private readonly listeners = new Map<string, number>();

  constructor(
    runner: MatchRunnerService,
    matches: MatchesService,
    ownership: MatchOwnership,
    @Optional() @Inject(REDIS_HANDLE) redis?: RedisHandle | null,
  ) {
    if (redis) this.relay = new RoomRelay(redis, ownership.nodeId, (matchId, event, data, team) => this.deliver(matchId, event, data, team));
    runner.setPresence((matchId) => this.anyoneListening(matchId));
    matches.changes.on('changed', (match: { id: string }) =>
      this.broadcast(match.id, 'match:updated', match),
    );
    runner.onStarted((info) =>
      this.broadcast(info.matchId, 'match:started', info),
    );
    runner.onSnapshot((snapshot) =>
      this.broadcast(snapshot.matchId, 'match:snapshot', snapshot),
    );
    runner.onPrivate((state) => this.broadcast(state.matchId, 'match:private', state, state.team));
    runner.onEnded((info) => this.broadcast(info.matchId, 'match:ended', info));
  }

  addSink(sink: RoomSink): void {
    this.sinks.push(sink);
  }

  /** A client of this server joined the room. */
  watch(matchId: string): void {
    this.listeners.set(matchId, (this.listeners.get(matchId) ?? 0) + 1);
    void this.relay?.watch(matchId);
  }

  /** A client of this server left the room. */
  unwatch(matchId: string): void {
    const left = (this.listeners.get(matchId) ?? 0) - 1;
    if (left > 0) this.listeners.set(matchId, left);
    else this.listeners.delete(matchId);
    void this.relay?.unwatch(matchId);
  }

  /** Whether any client, on this server or another, sits in the match room. */
  async anyoneListening(matchId: string): Promise<boolean> {
    if ((this.listeners.get(matchId) ?? 0) > 0) return true;
    return this.relay ? (await this.relay.othersListening(matchId)) > 0 : false;
  }

  /**
   * Sends an event to the room's clients here and, when another server follows the room, there too.
   * With a `team`, only the members who play for that team receive it.
   */
  broadcast(matchId: string, event: string, data: unknown, team?: number): void {
    this.deliver(matchId, event, data, team);
    this.relay?.publish(matchId, event, data, team);
  }

  private deliver(matchId: string, event: string, data: unknown, team?: number): void {
    for (const sink of this.sinks) {
      if (team === undefined) sink.emitToRoom(matchId, event, data);
      else sink.emitToTeam(matchId, team, event, data);
    }
  }
}
