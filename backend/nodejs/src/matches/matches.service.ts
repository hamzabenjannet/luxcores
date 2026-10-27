import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { COLLECTIONS, DataStore } from '../database/data-store.js';
import { MAX_SEED } from '../common/pipes/parse-seed.pipe.js';
import type { AuthenticatedPlayer } from '../common/types.js';
import type { CreateMatchDto } from './dto/create-match.dto.js';
import type { ListMatchesQueryDto } from './dto/list-matches-query.dto.js';
import type { MatchListDto } from './dto/match-list.dto.js';
import {
  type MatchDto,
  type MatchPlayerDto,
  type MatchResultDto,
  MatchStatus,
} from './dto/match.dto.js';

const MAX_HUMANS = 2; // 1v1 is the only mode so far

/** Lobby rules and match persistence. The match runner (`game/`) drives running matches. */
@Injectable()
export class MatchesService {
  /** Emits `changed` with the new `MatchDto` after every write, for the socket gateway. */
  readonly changes = new EventEmitter();

  constructor(private readonly store: DataStore) {}

  async create(
    host: AuthenticatedPlayer,
    dto: CreateMatchDto,
  ): Promise<MatchDto> {
    if (dto.vsBot && dto.botVsBot)
      throw new BadRequestException('vsBot and botVsBot cannot both be set');
    const match: MatchDto = {
      id: randomUUID(),
      name: dto.name,
      mode: dto.mode,
      status: MatchStatus.Lobby,
      seed: dto.seed ?? randomInt(0, MAX_SEED + 1),
      ...(dto.entropyPermillePerSecond === undefined ? {} : { entropyPermillePerSecond: dto.entropyPermillePerSecond }),
      ...(dto.creepCapPerPlayer === undefined ? {} : { creepCapPerPlayer: dto.creepCapPerPlayer }),
      ...(dto.maxTicks === undefined ? {} : { maxTicks: dto.maxTicks }),
      vsBot: dto.vsBot,
      botVsBot: dto.botVsBot,
      hostId: host.id,
      // In a bot match the host only watches, so the lobby holds no human.
      players: dto.botVsBot
        ? []
        : [{ playerId: host.id, name: host.name, team: 0, kind: 'human' }],
      createdAt: new Date().toISOString(),
    };
    return this.publish(await this.store.insert(COLLECTIONS.matches, match));
  }

  async get(id: string): Promise<MatchDto> {
    const match = await this.store.get<MatchDto>(COLLECTIONS.matches, id);
    if (!match) throw new NotFoundException(`Match ${id} not found`);
    return match;
  }

  /** Matches the database lists as running. At start-up these are the ones to resume. */
  running(): Promise<MatchDto[]> {
    return this.store.find<MatchDto>(
      COLLECTIONS.matches,
      { status: MatchStatus.Running } as Partial<MatchDto>,
      { sortBy: 'createdAt', order: 'asc' },
    );
  }

  async list({
    limit,
    offset,
    status,
  }: ListMatchesQueryDto): Promise<MatchListDto> {
    const where = status ? { status } : undefined;
    const [items, total] = await Promise.all([
      this.store.find<MatchDto>(COLLECTIONS.matches, where, { limit, offset }),
      this.store.count<MatchDto>(COLLECTIONS.matches, where),
    ]);
    return { items, total, limit, offset };
  }

  async join(id: string, player: AuthenticatedPlayer): Promise<MatchDto> {
    const match = await this.get(id);
    if (match.status !== MatchStatus.Lobby)
      throw new ConflictException('The match is no longer open');
    if (match.players.some((p) => p.playerId === player.id)) return match; // joining twice changes nothing
    if (match.botVsBot)
      throw new ConflictException('Two bots play this match; watch it instead');
    if (match.vsBot) throw new ConflictException('This match is against a bot');
    if (match.players.length >= MAX_HUMANS)
      throw new ConflictException('The match is full');

    const taken = new Set(match.players.map((p) => p.team));
    const team = taken.has(0) ? 1 : 0;
    const players: MatchPlayerDto[] = [
      ...match.players,
      { playerId: player.id, name: player.name, team, kind: 'human' },
    ];
    return this.update(id, { players });
  }

  /** A guest leaves the lobby. When the host leaves, the lobby closes. */
  async leave(id: string, player: AuthenticatedPlayer): Promise<MatchDto> {
    const match = await this.get(id);
    if (match.status !== MatchStatus.Lobby)
      throw new ConflictException('Only an open lobby can be left');
    if (
      !match.players.some((p) => p.playerId === player.id) &&
      !(match.botVsBot && match.hostId === player.id)
    )
      throw new ConflictException('You are not in this match');
    if (match.hostId === player.id)
      return this.update(id, {
        status: MatchStatus.Cancelled,
        finishedAt: new Date().toISOString(),
      });
    return this.update(id, {
      players: match.players.filter((p) => p.playerId !== player.id),
    });
  }

  /** Host-only check shared by the start and stop routes. */
  async requireHost(
    id: string,
    player: AuthenticatedPlayer,
  ): Promise<MatchDto> {
    const match = await this.get(id);
    if (match.hostId !== player.id)
      throw new ForbiddenException('Only the host can do this');
    return match;
  }

  markRunning(id: string, players: MatchPlayerDto[]): Promise<MatchDto> {
    return this.update(id, {
      status: MatchStatus.Running,
      players,
      startedAt: new Date().toISOString(),
    });
  }

  markFinished(
    id: string,
    endedTick: number,
    result: MatchResultDto,
    replayId: string | undefined,
  ): Promise<MatchDto> {
    return this.update(id, {
      status: MatchStatus.Finished,
      finishedAt: new Date().toISOString(),
      endedTick,
      result,
      ...(replayId ? { replayId } : {}),
    });
  }

  private async update(
    id: string,
    patch: Partial<MatchDto>,
  ): Promise<MatchDto> {
    const updated = await this.store.update<MatchDto>(
      COLLECTIONS.matches,
      id,
      patch,
    );
    if (!updated) throw new NotFoundException(`Match ${id} not found`);
    return this.publish(updated);
  }

  private publish(match: MatchDto): MatchDto {
    this.changes.emit('changed', match);
    return match;
  }
}
