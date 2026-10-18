import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import { SimService } from '../simulation/sim.service.js';
import type { SimReplay } from '../simulation/sim.types.js';
import type { ReplayPayloadDto } from './dto/replay-payload.dto.js';
import type {
  ReplayListDto,
  ReplayRecordDto,
  ReplayVerifyResultDto,
} from './dto/replay-record.dto.js';

const HASH_PATTERN = /^[0-9a-f]{8}$/;

@Injectable()
export class ReplaysService {
  constructor(
    private readonly store: DataStore,
    private readonly sim: SimService,
  ) {}

  /** Stores a replay that a client uploaded. */
  async upload(
    playerId: string,
    replay: ReplayPayloadDto,
    matchId?: string,
  ): Promise<ReplayRecordDto> {
    for (const [tick, hash] of Object.entries(replay.hashes)) {
      if (
        !/^\d+$/.test(tick) ||
        typeof hash !== 'string' ||
        !HASH_PATTERN.test(hash)
      ) {
        throw new BadRequestException(
          `hashes["${tick}"] must map a tick to 8 hex characters`,
        );
      }
    }
    return this.save(playerId, replay, matchId);
  }

  /** Stores a replay that the server recorded. */
  saveFromMatch(
    matchId: string,
    replay: SimReplay,
    reproducible = true,
  ): Promise<ReplayRecordDto> {
    return this.save(
      'system',
      replay as unknown as ReplayPayloadDto,
      matchId,
      reproducible,
    );
  }

  async list({ limit, offset }: PaginationQueryDto): Promise<ReplayListDto> {
    const [rows, total] = await Promise.all([
      this.store.find<ReplayRecordDto>(COLLECTIONS.replays, undefined, {
        limit,
        offset,
      }),
      this.store.count(COLLECTIONS.replays),
    ]);
    const items = rows.map(({ replay: _payload, ...summary }) => summary);
    return { items, total, limit, offset };
  }

  async get(id: string): Promise<ReplayRecordDto> {
    const record = await this.store.get<ReplayRecordDto>(
      COLLECTIONS.replays,
      id,
    );
    if (!record) throw new NotFoundException(`Replay ${id} not found`);
    return record;
  }

  async remove(id: string): Promise<void> {
    if (!(await this.store.remove(COLLECTIONS.replays, id)))
      throw new NotFoundException(`Replay ${id} not found`);
  }

  /** Re-simulates the replay and compares every recorded hash. */
  async verify(id: string): Promise<ReplayVerifyResultDto> {
    const { replay } = await this.get(id);
    try {
      const { ok, firstMismatchTick, finalHash } = this.sim.playReplay(
        replay as unknown as SimReplay,
      );
      return {
        ok,
        firstMismatchTick,
        finalHash,
        specVersion: this.sim.specVersion,
      };
    } catch (err) {
      // The sim refuses a replay from another spec version, and it throws on malformed state.
      throw new UnprocessableEntityException((err as Error).message);
    }
  }

  private save(
    uploadedBy: string,
    replay: ReplayPayloadDto,
    matchId?: string,
    reproducible = true,
  ): Promise<ReplayRecordDto> {
    const record: ReplayRecordDto = {
      id: randomUUID(),
      ...(matchId ? { matchId } : {}),
      ...(reproducible ? {} : { reproducible }),
      uploadedBy,
      createdAt: new Date().toISOString(),
      seed: replay.seed,
      specVersion: replay.specVersion,
      ticks: replay.ticks,
      replay,
    };
    return this.store.insert(COLLECTIONS.replays, record);
  }
}
