import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { PlayerDto } from './dto/player.dto.js';
import type { PlayerListDto } from './dto/player-list.dto.js';

@Injectable()
export class PlayersService {
  constructor(private readonly store: DataStore) {}

  async create(name: string): Promise<PlayerDto> {
    const player: PlayerDto = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      stats: { matchesPlayed: 0, wins: 0, losses: 0, draws: 0 },
    };
    return this.store.insert(COLLECTIONS.players, player);
  }

  async get(id: string): Promise<PlayerDto> {
    const player = await this.store.get<PlayerDto>(COLLECTIONS.players, id);
    if (!player) throw new NotFoundException(`Player ${id} not found`);
    return player;
  }

  async list({ limit, offset }: PaginationQueryDto): Promise<PlayerListDto> {
    const [items, total] = await Promise.all([
      this.store.find<PlayerDto>(COLLECTIONS.players, undefined, {
        limit,
        offset,
      }),
      this.store.count(COLLECTIONS.players),
    ]);
    return { items, total, limit, offset };
  }

  /**
   * Players ranked by wins, then by fewer losses. The sort runs in memory,
   * which is fine for thousands of profiles; move it into the query when the
   * table outgrows that.
   */
  async leaderboard(limit: number): Promise<PlayerDto[]> {
    const all = await this.store.find<PlayerDto>(COLLECTIONS.players);
    return all
      .filter((p) => p.stats.matchesPlayed > 0)
      .sort(
        (a, b) =>
          b.stats.wins - a.stats.wins ||
          a.stats.losses - b.stats.losses ||
          a.createdAt.localeCompare(b.createdAt),
      )
      .slice(0, limit);
  }

  async rename(id: string, name: string): Promise<PlayerDto> {
    const updated = await this.store.update<PlayerDto>(
      COLLECTIONS.players,
      id,
      { name },
    );
    if (!updated) throw new NotFoundException(`Player ${id} not found`);
    return updated;
  }
}
