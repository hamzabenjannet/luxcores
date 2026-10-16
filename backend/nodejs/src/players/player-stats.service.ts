import { Injectable } from '@nestjs/common';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import type { PlayerDto } from './dto/player.dto.js';

export interface MatchFinishedEvent {
  matchId: string;
  /** Human players only; bots have no profile. */
  players: { playerId: string; team: number }[];
  result: { winnerTeam: number | null; draw: boolean; reason: string };
  endedTick: number;
}

/** Applies a finished match to the profiles of its human players. */
@Injectable()
export class PlayerStatsService {
  constructor(private readonly store: DataStore) {}

  async recordMatchResult(event: MatchFinishedEvent): Promise<void> {
    for (const { playerId, team } of event.players) {
      const player = await this.store.get<PlayerDto>(
        COLLECTIONS.players,
        playerId,
      );
      if (!player) continue; // the profile was deleted
      const stats = {
        ...player.stats,
        matchesPlayed: player.stats.matchesPlayed + 1,
      };
      if (event.result.draw) stats.draws += 1;
      else if (event.result.winnerTeam === team) stats.wins += 1;
      else stats.losses += 1;
      await this.store.update<PlayerDto>(COLLECTIONS.players, playerId, {
        stats,
      });
    }
  }
}
