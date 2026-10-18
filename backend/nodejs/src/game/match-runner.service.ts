import {
  ConflictException,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import type { AppConfig } from '../config/configuration.js';
import { EventBus } from '../events/event-bus.js';
import {
  MatchEndReason,
  type MatchDto,
  type MatchPlayerDto,
  type MatchResultDto,
  MatchStatus,
} from '../matches/dto/match.dto.js';
import { MatchesService } from '../matches/matches.service.js';
import { ReplaysService } from '../replays/replays.service.js';
import { SimService } from '../simulation/sim.service.js';
import type {
  SimCommand,
  SimCommandEnvelope,
  SimBot,
  SimEntity,
  SimGroup,
  SimOrder,
  SimMap,
  SimPlayer,
  SimRecorder,
  SimState,
} from '../simulation/sim.types.js';

/** After a stall, run at most this many ticks per timer call, so one match cannot starve the others. */
const MAX_CATCHUP_TICKS = 5;
/** Commands queued per match between two ticks. More are dropped. */
const MAX_INBOX = 200;

export interface RunnerPlayer {
  /** Absent for the bot. */
  playerId?: string;
  /** Player id inside the sim. In 1v1 it equals the team. */
  simId: number;
  name: string;
  team: number;
  kind: 'human' | 'bot';
}

/** Full world state at one tick. Fog of war will filter `entities` per team later. */
export interface MatchSnapshot {
  matchId: string;
  tick: number;
  /** State hash. Present every `HASH_INTERVAL` ticks, so clients can detect drift. */
  hash?: string;
  teams: { coreLux: number; pendingLux: number }[];
  entities: SimEntity[];
  /** Creep groups with their paths. */
  groups: SimGroup[];
  /** Barracks queues, held groups included. */
  orders: SimOrder[];
}

export interface CommandAck {
  accepted: boolean;
  tick?: number;
  reason?: string;
}

export interface StartedInfo {
  matchId: string;
  tickHz: number;
  players: MatchPlayerDto[];
  map: SimMap;
  snapshot: MatchSnapshot;
}

export interface EndedInfo {
  matchId: string;
  endedTick: number;
  result: MatchResultDto;
  replayId?: string;
}

interface Run {
  matchId: string;
  players: RunnerPlayer[];
  state: SimState;
  recorder: SimRecorder;
  inbox: SimCommandEnvelope[];
  bots: SimBot[];
  lastSeq: Map<number, number>;
  startedAt: number;
  timer?: NodeJS.Timeout;
  ending: boolean;
}

/**
 * Runs every live match: one sim per match, stepped at the sim tick rate from a
 * self-correcting timer. Clients send commands, the server applies them on the
 * next tick and broadcasts snapshots (docs/TECH_ARCHITECTURE.md section 13.1).
 *
 * The sim itself stays deterministic. Only this service reads the wall clock,
 * to decide when the next tick is due. Everything it records in the replay is
 * tick-based.
 */
@Injectable()
export class MatchRunnerService implements OnModuleDestroy {
  private readonly logger = new Logger(MatchRunnerService.name);
  private readonly runs = new Map<string, Run>();
  private readonly emitter = new EventEmitter();
  private readonly tickMs: number;
  private readonly maxTicks: number;
  private readonly snapshotEvery: number;

  constructor(
    private readonly sim: SimService,
    private readonly matches: MatchesService,
    private readonly replays: ReplaysService,
    private readonly bus: EventBus,
    config: ConfigService<AppConfig, true>,
  ) {
    const game = config.get('game', { infer: true });
    // MATCH_MAX_TICKS wins; without it the data file decides, so one number serves the server and the tools.
    this.maxTicks = game.matchMaxTicks > 0 ? game.matchMaxTicks : this.sim.stalemateTicks;
    this.snapshotEvery = game.snapshotEveryTicks;
    this.tickMs = 1000 / this.sim.tickHz;
  }

  onStarted(listener: (info: StartedInfo) => void): void {
    this.emitter.on('started', listener);
  }

  onSnapshot(listener: (snapshot: MatchSnapshot) => void): void {
    this.emitter.on('snapshot', listener);
  }

  onEnded(listener: (info: EndedInfo) => void): void {
    this.emitter.on('ended', listener);
  }

  /** The tick at which an undecided match ends as a draw. */
  get matchMaxTicks(): number {
    return this.maxTicks;
  }

  get runningMatchIds(): string[] {
    return [...this.runs.keys()];
  }

  isRunning(matchId: string): boolean {
    return this.runs.has(matchId);
  }

  /** Builds the sim for an open lobby and starts ticking. */
  async start(match: MatchDto): Promise<MatchDto> {
    if (this.runs.has(match.id) || match.status !== MatchStatus.Lobby) {
      throw new ConflictException('The match has already started or ended');
    }
    const humans = match.players
      .filter((p) => p.kind === 'human')
      .sort((a, b) => a.team - b.team);
    if (!match.botVsBot && humans.length < 2 && !match.vsBot)
      throw new ConflictException('Waiting for a second player');

    const players: RunnerPlayer[] = humans.map((p) => ({
      playerId: p.playerId,
      simId: p.team,
      name: p.name,
      team: p.team,
      kind: 'human',
    }));
    if (match.vsBot)
      players.push({ simId: 1, name: 'Bot', team: 1, kind: 'bot' });
    if (match.botVsBot)
      players.push(
        { simId: 0, name: 'Bot Blue', team: 0, kind: 'bot' },
        { simId: 1, name: 'Bot Red', team: 1, kind: 'bot' },
      );
    const simPlayers: SimPlayer[] = players.map((p) => ({
      id: p.simId,
      team: p.team,
      kind: p.kind,
    }));

    const { state, recorder } = this.sim.createMatch(match.seed, simPlayers);
    const run: Run = {
      matchId: match.id,
      players,
      state,
      recorder,
      inbox: [],
      bots: players
        .filter((p) => p.kind === 'bot')
        .map((p) => this.sim.createBot(p.simId, p.team, match.seed)),
      lastSeq: new Map(),
      startedAt: Date.now(),
      ending: false,
    };
    this.runs.set(match.id, run);

    let started: MatchDto;
    try {
      started = await this.matches.markRunning(
        match.id,
        players.map(toMatchPlayer),
      );
    } catch (err) {
      this.runs.delete(match.id); // the match never started, so leave nothing behind
      throw err;
    }
    await this.publish('match.started', {
      matchId: match.id,
      seed: match.seed,
      players: players.map((p) => ({
        playerId: p.playerId,
        team: p.team,
        kind: p.kind,
      })),
    });
    this.emitter.emit('started', {
      matchId: match.id,
      tickHz: this.sim.tickHz,
      players: started.players,
      map: state.map,
      snapshot: this.snapshotOf(run, true),
    } satisfies StartedInfo);

    run.startedAt = Date.now();
    this.schedule(run);
    this.logger.log(
      `Match ${match.id} started: seed ${match.seed}, ${players.length} players`,
    );
    return started;
  }

  /** Ends a running match early. The replay up to this tick is kept. */
  async stop(matchId: string): Promise<MatchDto> {
    const run = this.runs.get(matchId);
    if (!run) throw new ConflictException('The match is not running');
    return this.finish(run, MatchEndReason.Stopped);
  }

  /**
   * Queues a command for the next tick. The server stamps the tick and the player
   * id itself, so a client cannot act for another player or for a past tick.
   */
  submitCommand(
    matchId: string,
    playerId: string,
    seq: number,
    cmd: SimCommand,
  ): CommandAck {
    const run = this.runs.get(matchId);
    if (!run) return { accepted: false, reason: 'The match is not running' };
    const player = run.players.find((p) => p.playerId === playerId);
    if (!player)
      return { accepted: false, reason: 'You are not in this match' };
    if (seq <= (run.lastSeq.get(player.simId) ?? -1))
      return { accepted: false, reason: 'seq must rise with every command' };
    if (run.inbox.length >= MAX_INBOX)
      return { accepted: false, reason: 'Too many commands in this tick' };
    run.lastSeq.set(player.simId, seq);
    run.inbox.push({ tick: run.state.tick, playerId: player.simId, seq, cmd });
    return { accepted: true, tick: run.state.tick };
  }

  /** The current snapshot, or null when the match is not running. */
  snapshot(matchId: string): MatchSnapshot | null {
    const run = this.runs.get(matchId);
    return run ? this.snapshotOf(run, true) : null;
  }

  /**
   * Ends every live match on shutdown. This is the first shutdown phase, on purpose: saving
   * a replay and publishing `match.finished` need the database and the broker, which close in
   * later phases (`beforeApplicationShutdown` for the broker, `onApplicationShutdown` for the database).
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.runs.values()].map((run) =>
        this.finish(run, MatchEndReason.Stopped).catch(() => undefined),
      ),
    );
  }

  /** Arms the timer for the next due tick. Drift never builds up, because due times derive from the start time. */
  private schedule(run: Run): void {
    const due = run.startedAt + (run.state.tick + 1) * this.tickMs;
    run.timer = setTimeout(() => this.pump(run), Math.max(0, due - Date.now()));
  }

  private pump(run: Run): void {
    const behind =
      Math.floor((Date.now() - run.startedAt) / this.tickMs) - run.state.tick;
    const ticks = Math.min(Math.max(behind, 1), MAX_CATCHUP_TICKS);
    for (let i = 0; i < ticks; i++) {
      if (this.tick(run)) return; // the match ended
    }
    this.schedule(run);
  }

  /** Runs one tick. Returns true when the match is over. */
  private tick(run: Run): boolean {
    const { state } = run;
    const envelopes = [
      ...run.inbox.splice(0).map((e) => ({ ...e, tick: state.tick })),
      ...run.bots.flatMap((bot) => bot.think(state)),
    ];
    this.sim.step(state, envelopes);
    run.recorder.record(state, envelopes);
    if (state.tick % this.snapshotEvery === 0) {
      this.emitter.emit(
        'snapshot',
        this.snapshotOf(run, state.tick % this.sim.hashInterval === 0),
      );
    }
    if (state.outcome || state.tick >= this.maxTicks) {
      this.finish(run).catch((err: Error) =>
        this.logger.error(`Finishing ${run.matchId} failed: ${err.message}`),
      );
      return true;
    }
    return false;
  }

  private async finish(run: Run, forced?: MatchEndReason): Promise<MatchDto> {
    if (run.ending) return this.matches.get(run.matchId);
    run.ending = true;
    clearTimeout(run.timer);
    this.runs.delete(run.matchId);

    const result = resultOf(run.state, forced);
    let replayId: string | undefined;
    try {
      replayId = (
        await this.replays.saveFromMatch(run.matchId, run.recorder.replay)
      ).id;
    } catch (err) {
      this.logger.error(
        `Saving the replay of ${run.matchId} failed: ${(err as Error).message}`,
      );
    }
    const finished = await this.matches.markFinished(
      run.matchId,
      run.state.tick,
      result,
      replayId,
    );
    await this.publish('match.finished', {
      matchId: run.matchId,
      players: run.players
        .filter((p) => p.playerId)
        .map((p) => ({ playerId: p.playerId as string, team: p.team })),
      result,
      endedTick: run.state.tick,
    });
    this.emitter.emit('ended', {
      matchId: run.matchId,
      endedTick: run.state.tick,
      result,
      replayId,
    } satisfies EndedInfo);
    this.logger.log(
      `Match ${run.matchId} ended at tick ${run.state.tick}: ${result.reason}`,
    );
    return finished;
  }

  /** A broker outage must not stop a match from ending, so publish errors are logged. */
  private async publish(
    ...args: Parameters<EventBus['publish']>
  ): Promise<void> {
    try {
      await this.bus.publish(...args);
    } catch (err) {
      this.logger.error(
        `Publishing ${args[0]} failed: ${(err as Error).message}`,
      );
    }
  }

  private snapshotOf(run: Run, withHash: boolean): MatchSnapshot {
    const { state } = run;
    return {
      matchId: run.matchId,
      tick: state.tick,
      ...(withHash ? { hash: this.sim.hash(state) } : {}),
      teams: state.teams.map((t) => ({
        coreLux: t.coreLux,
        pendingLux: t.pendingLux,
      })),
      entities: state.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        team: e.team,
        owner: e.owner,
        x: e.x,
        z: e.z,
        hp: e.hp,
        maxHp: e.maxHp,
        attack: e.attack,
        recycle: e.recycle,
        stunTicks: e.stunTicks,
        targetId: e.targetId,
        powerLevel: e.powerLevel,
        shellLevel: e.shellLevel,
        roll: e.roll,
        arrivalTick: e.arrivalTick,
        groupId: e.groupId,
        waypoints: e.waypoints,
      })),
      groups: state.groups.map((g) => ({
        id: g.id,
        owner: g.owner,
        team: g.team,
        custom: g.custom,
        wpIndex: g.wpIndex,
        waypoints: g.waypoints,
      })),
      orders: state.orders.map((o) => ({
        id: o.id,
        barracksId: o.barracksId,
        owner: o.owner,
        type: o.type,
        mix: o.mix,
        ticksLeft: o.ticksLeft,
        held: o.held,
      })),
    };
  }
}

function toMatchPlayer(p: RunnerPlayer): MatchPlayerDto {
  return {
    ...(p.playerId ? { playerId: p.playerId } : {}),
    name: p.name,
    team: p.team,
    kind: p.kind,
  };
}

function resultOf(state: SimState, forced?: MatchEndReason): MatchResultDto {
  if (forced) return { winnerTeam: null, draw: true, reason: forced };
  const outcome = state.outcome;
  if (outcome && 'winnerTeam' in outcome)
    return {
      winnerTeam: outcome.winnerTeam,
      draw: false,
      reason: MatchEndReason.Victory,
    };
  if (outcome)
    return { winnerTeam: null, draw: true, reason: MatchEndReason.Draw };
  // Timed mode needs a score rule that the GDD defines for later milestones.
  return { winnerTeam: null, draw: true, reason: MatchEndReason.TickLimit };
}
