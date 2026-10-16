import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { PlayerDto } from './dto/player.dto.js';
import type { PlayerListDto } from './dto/player-list.dto.js';
import { type PlayerRecord, toPublic } from './player-record.js';

/** Profiles. Everything it returns is public; credential hashes stay inside (`PlayerRecord`). */
@Injectable()
export class PlayersService {
  constructor(private readonly store: DataStore) {}

  async create(
    name: string,
    credentials: Pick<
      PlayerRecord,
      'deviceSecretHash' | 'recoveryCodeHash'
    > = {},
  ): Promise<PlayerDto> {
    const record: PlayerRecord = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      stats: { matchesPlayed: 0, wins: 0, losses: 0, draws: 0 },
      ...credentials,
    };
    return toPublic(await this.store.insert(COLLECTIONS.players, record));
  }

  async get(id: string): Promise<PlayerDto> {
    const record = await this.store.get<PlayerRecord>(COLLECTIONS.players, id);
    if (!record) throw new NotFoundException(`Player ${id} not found`);
    return toPublic(record);
  }

  async list({ limit, offset }: PaginationQueryDto): Promise<PlayerListDto> {
    const [records, total] = await Promise.all([
      this.store.find<PlayerRecord>(COLLECTIONS.players, undefined, {
        limit,
        offset,
      }),
      this.store.count(COLLECTIONS.players),
    ]);
    return { items: records.map(toPublic), total, limit, offset };
  }

  /**
   * Players ranked by wins, then by fewer losses. The sort runs in memory,
   * which is fine for thousands of profiles; move it into the query when the
   * table outgrows that.
   */
  async leaderboard(limit: number): Promise<PlayerDto[]> {
    const all = await this.store.find<PlayerRecord>(COLLECTIONS.players);
    return all
      .filter((p) => p.stats.matchesPlayed > 0)
      .sort(
        (a, b) =>
          b.stats.wins - a.stats.wins ||
          a.stats.losses - b.stats.losses ||
          a.createdAt.localeCompare(b.createdAt),
      )
      .slice(0, limit)
      .map(toPublic);
  }

  async rename(id: string, name: string): Promise<PlayerDto> {
    const updated = await this.store.update<PlayerRecord>(
      COLLECTIONS.players,
      id,
      { name },
    );
    if (!updated) throw new NotFoundException(`Player ${id} not found`);
    return toPublic(updated);
  }

  /** The player whose device secret has this hash, or null. */
  async findByDeviceSecretHash(hash: string): Promise<PlayerDto | null> {
    const [record] = await this.store.find<PlayerRecord>(
      COLLECTIONS.players,
      { deviceSecretHash: hash },
      { limit: 1 },
    );
    return record ? toPublic(record) : null;
  }

  /** The player whose current recovery code has this hash, or null. */
  async findByRecoveryCodeHash(hash: string): Promise<PlayerDto | null> {
    const [record] = await this.store.find<PlayerRecord>(
      COLLECTIONS.players,
      { recoveryCodeHash: hash },
      { limit: 1 },
    );
    return record ? toPublic(record) : null;
  }

  /** Replaces credential hashes. A key left out keeps its stored value. */
  async setCredentials(
    id: string,
    credentials: Pick<PlayerRecord, 'deviceSecretHash' | 'recoveryCodeHash'>,
  ): Promise<void> {
    const updated = await this.store.update<PlayerRecord>(
      COLLECTIONS.players,
      id,
      credentials,
    );
    if (!updated) throw new NotFoundException(`Player ${id} not found`);
  }
}
