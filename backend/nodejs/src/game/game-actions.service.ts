import { Injectable } from '@nestjs/common';
import type { AuthenticatedPlayer } from '../common/types.js';
import { MatchesService } from '../matches/matches.service.js';
import type { ChatMessageDto, GameCommandDto } from './dto/socket-dtos.js';
import {
  type CommandAck,
  MatchRunnerService,
  type MatchSnapshot,
} from './match-runner.service.js';
import { RoomHub } from './room-hub.service.js';

export type JoinAck =
  | {
      ok: true;
      status: string;
      tick: number | null;
      snapshot: MatchSnapshot | null;
    }
  | { ok: false; error: string };

/**
 * What a connected player can do, independent of the transport. The Socket.IO
 * and plain WebSocket gateways validate the payload, call these methods and
 * keep their own room membership.
 */
@Injectable()
export class GameActions {
  constructor(
    private readonly matches: MatchesService,
    private readonly runner: MatchRunnerService,
    private readonly hub: RoomHub,
  ) {}

  /** Checks that the player belongs to the match. The transport then adds the connection to its room. */
  async join(player: AuthenticatedPlayer, matchId: string): Promise<JoinAck> {
    const match = await this.matches.get(matchId).catch(() => null);
    if (!match) return { ok: false, error: 'Match not found' };
    if (!match.players.some((p) => p.playerId === player.id))
      return { ok: false, error: 'You are not in this match' };
    const snapshot = this.runner.snapshot(match.id);
    return {
      ok: true,
      status: match.status,
      tick: snapshot?.tick ?? null,
      snapshot,
    };
  }

  command(player: AuthenticatedPlayer, dto: GameCommandDto): CommandAck {
    return this.runner.submitCommand(dto.matchId, player.id, dto.seq, dto.cmd);
  }

  /** The transport has already checked that the sender joined the room. */
  chat(player: AuthenticatedPlayer, dto: ChatMessageDto): void {
    this.hub.broadcast(dto.matchId, 'chat:message', {
      from: player.name,
      text: dto.text,
      at: new Date().toISOString(),
    });
  }

  ping(): { serverTime: string } {
    return { serverTime: new Date().toISOString() };
  }
}
