import { Injectable } from '@nestjs/common';
import { MatchesService } from '../matches/matches.service.js';
import { MatchRunnerService } from './match-runner.service.js';

/** A transport that can deliver an event to everyone it has put in a match room. */
export interface RoomSink {
  emitToRoom(matchId: string, event: string, data: unknown): void;
}

/**
 * Fan-out point for match events. The Socket.IO gateway and the plain
 * WebSocket gateway each register a sink, so one event (a snapshot, a chat
 * line, a lobby change) reaches clients on either transport.
 */
@Injectable()
export class RoomHub {
  private readonly sinks: RoomSink[] = [];

  constructor(runner: MatchRunnerService, matches: MatchesService) {
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

  broadcast(matchId: string, event: string, data: unknown): void {
    for (const sink of this.sinks) sink.emitToRoom(matchId, event, data);
  }
}
