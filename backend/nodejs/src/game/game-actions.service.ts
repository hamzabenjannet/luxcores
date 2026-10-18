import { Injectable } from '@nestjs/common';
import { ClusterService } from '../cluster/cluster.service.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import { MatchesService } from '../matches/matches.service.js';
import type { ChatMessageDto, GameCommandDto } from './dto/socket-dtos.js';
import type { CommandAck, MatchSnapshot } from './match-runner.service.js';
import { RoomHub } from './room-hub.service.js';

export type JoinAck =
  | {
      ok: true;
      /** `spectator` can watch a bot match and cannot send commands. */
      role: 'player' | 'spectator';
      status: string;
      /** The sequence number the player's next command must use, so a rejoined client continues where it stopped. */
      nextSeq: number;
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
    private readonly cluster: ClusterService,
    private readonly hub: RoomHub,
  ) {}

  /** Checks that the player belongs to the match. The transport then adds the connection to its room. */
  async join(player: AuthenticatedPlayer, matchId: string): Promise<JoinAck> {
    const match = await this.matches.get(matchId).catch(() => null);
    if (!match) return { ok: false, error: 'Match not found' };
    const member = match.players.some((p) => p.playerId === player.id);
    // Only a bot match is open to watchers. Once fog of war ships, watching a human match would leak hidden state.
    if (!member && !match.botVsBot)
      return { ok: false, error: 'You are not in this match' };
    const { snapshot, nextSeq } = await this.cluster.join(match.id, player.id);
    return {
      ok: true,
      role: member ? 'player' : 'spectator',
      status: match.status,
      nextSeq,
      tick: snapshot?.tick ?? null,
      snapshot,
    };
  }

  command(player: AuthenticatedPlayer, dto: GameCommandDto): Promise<CommandAck> {
    return this.cluster.command(dto.matchId, player.id, dto.seq, dto.cmd);
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
