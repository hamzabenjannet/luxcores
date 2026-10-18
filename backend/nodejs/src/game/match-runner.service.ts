import {
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'node:events';
import type { JoinInfo, MatchRpc } from '../cluster/cluster.types.js';
import { CommandBus } from '../cluster/command-bus.js';
import { MatchOwnership } from '../cluster/match-ownership.js';
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
import { EventLog } from '../matchlog/event-log.js';
import type { LoggedPlayer } from '../matchlog/match-event.js';
import { type ResumeAttempt, planResume } from '../matchlog/match-resume.js';
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
/** The first checkpoint of a match comes this early, so a change of rules loses almost nothing. */
const FIRST_CHECKPOINT_TICK = 20;

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
  /** With a `seq` rejection: the sequence number the next command must use, so a rejoined client can continue. */
  nextSeq?: number;
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
  /** True when the log already ends with this match's `finished` event (a match that ended while the server was down). */
  loggedEnd?: boolean;
  /** False once the match has run under changed rules: its replay no longer verifies from the seed. */
  reproducible: boolean;
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
export class MatchRunnerService
  implements OnModuleDestroy, OnApplicationBootstrap
{
  private readonly logger = new Logger(MatchRunnerService.name);
  private readonly runs = new Map<string, Run>();
  private readonly emitter = new EventEmitter();
  private readonly tickMs: number;
  private readonly maxTicks: number;
  private readonly snapshotEvery: number;
  private readonly checkpointEvery: number;
  private readonly onShutdown: 'resume' | 'end';
  private readonly keepFinishedLogs: boolean;
  private readonly adoptEveryMs: number;
  private adoptTimer?: NodeJS.Timeout;
  /** Matches being rebuilt right now, so the periodic look does not start a second rebuild. */
  private readonly resuming = new Set<string>();
  private closing = false;
  /** Settles when every match that was running at start-up has been rebuilt or given up. Tests wait on it. */
  resumed: Promise<void> = Promise.resolve();

  constructor(
    private readonly sim: SimService,
    private readonly matches: MatchesService,
    private readonly replays: ReplaysService,
    private readonly bus: EventBus,
    private readonly log: EventLog,
    private readonly ownership: MatchOwnership,
    private readonly commands: CommandBus,
    config: ConfigService<AppConfig, true>,
  ) {
    const game = config.get('game', { infer: true });
    // MATCH_MAX_TICKS wins; without it the data file decides, so one number serves the server and the tools.
    this.maxTicks = game.matchMaxTicks > 0 ? game.matchMaxTicks : this.sim.stalemateTicks;
    this.snapshotEvery = game.snapshotEveryTicks;
    this.checkpointEvery = game.checkpointEveryTicks;
    this.onShutdown = game.onShutdown;
    this.keepFinishedLogs = config.get('eventLog', { infer: true }).keepFinished;
    this.tickMs = 1000 / this.sim.tickHz;
    this.adoptEveryMs = this.ownership.mode === 'redis' ? config.get('cluster', { infer: true }).adoptEveryMs : 0;
    // Another node now holds a match this node ran: stop it here, the other node rebuilds it from the log.
    this.ownership.onLost((matchId) => void this.dropLocal(matchId));
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

    if (!(await this.ownership.claim(match.id))) {
      throw new ConflictException('Another server runs this match');
    }
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
      reproducible: true,
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
      await this.ownership.release(match.id);
      throw err;
    }
    this.log.append(match.id, {
      type: 'started',
      tick: 0,
      data: {
        seed: match.seed,
        players: players as LoggedPlayer[],
        ...this.sim.fingerprint,
        mapgenVersion: this.sim.mapgenVersion,
      },
    });
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
    await this.serveRun(run);
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
    const last = run.lastSeq.get(player.simId) ?? -1;
    if (seq <= last)
      return {
        accepted: false,
        reason: 'seq must rise with every command',
        nextSeq: last + 1,
      };
    if (run.inbox.length >= MAX_INBOX)
      return { accepted: false, reason: 'Too many commands in this tick' };
    run.lastSeq.set(player.simId, seq);
    run.inbox.push({ tick: run.state.tick, playerId: player.simId, seq, cmd });
    return { accepted: true, tick: run.state.tick };
  }

  /** The sequence number a player's next command must use. 0 for a match that is not running. */
  nextSeq(matchId: string, playerId: string): number {
    const run = this.runs.get(matchId);
    const player = run?.players.find((p) => p.playerId === playerId);
    return player ? (run?.lastSeq.get(player.simId) ?? -1) + 1 : 0;
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
    this.closing = true;
    clearInterval(this.adoptTimer);
    if (this.onShutdown === 'resume') {
      // Leave the matches `running` in the database. Their logs hold everything, and the next start rebuilds them.
      const runs = [...this.runs.values()];
      for (const run of runs) clearTimeout(run.timer);
      this.runs.clear();
      await this.log.flush();
      // Hand the matches back at once, so another node (or this one, restarted) need not wait for the leases to expire.
      for (const run of runs) await this.letGo(run.matchId);
      return;
    }
    await Promise.all(
      [...this.runs.values()].map((run) =>
        this.finish(run, MatchEndReason.Stopped).catch(() => undefined),
      ),
    );
  }

  /** Rebuilds every match that the database lists as running. It runs in the background, after the server listens. */
  onApplicationBootstrap(): void {
    this.resumed = this.resumeAll().catch((err: Error) =>
      this.logger.error(`Resuming matches failed: ${err.message}`),
    );
    if (this.adoptEveryMs > 0) {
      // With several nodes, a node that dies leaves running matches that no lease covers. Any node may take them.
      this.adoptTimer = setInterval(() => {
        if (!this.closing) void this.resumeAll().catch((err: Error) => this.logger.error(`Looking for orphaned matches failed: ${err.message}`));
      }, this.adoptEveryMs);
      this.adoptTimer.unref();
    }
  }

  /** Rebuilds the running matches that this node does not run and no other node holds. */
  private async resumeAll(): Promise<void> {
    const running = await this.matches.running();
    for (const match of running) {
      if (this.closing) return;
      if (this.runs.has(match.id) || this.resuming.has(match.id)) continue;
      this.resuming.add(match.id);
      try {
        if (!(await this.ownership.claim(match.id))) continue; // another node runs it
        this.logger.log(`Resuming match ${match.id} from its log`);
        try {
          await this.resume(match);
        } catch (err) {
          this.logger.error(`Match ${match.id} cannot be resumed: ${(err as Error).message}`);
          await this.abandon(match);
          await this.ownership.release(match.id);
        }
      } finally {
        this.resuming.delete(match.id);
      }
    }
  }

  /** Stops answering for a match and gives its lease back. */
  private async letGo(matchId: string): Promise<void> {
    await this.commands.unserve(matchId).catch(() => undefined);
    await this.ownership.release(matchId);
  }

  /** Another node holds the match now. Stop ticking it here without ending it: the new owner rebuilds it from the log. */
  private async dropLocal(matchId: string): Promise<void> {
    const run = this.runs.get(matchId);
    if (!run) return;
    run.ending = true;
    clearTimeout(run.timer);
    this.runs.delete(matchId);
    await this.log.flush();
    await this.commands.unserve(matchId).catch(() => undefined);
  }

  /** Answers the requests that other nodes send for a match this node runs. */
  private async serveRun(run: Run): Promise<void> {
    await this.commands
      .serve(run.matchId, (rpc) => this.handleRpc(run.matchId, rpc))
      .catch((err: Error) => this.logger.warn(`Cannot take commands for ${run.matchId} from other nodes: ${err.message}`));
  }

  private async handleRpc(matchId: string, rpc: MatchRpc): Promise<unknown> {
    switch (rpc.t) {
      case 'command':
        return this.submitCommand(matchId, rpc.playerId, rpc.seq, rpc.cmd);
      case 'join':
        return { nextSeq: this.nextSeq(matchId, rpc.playerId), snapshot: this.snapshot(matchId) } satisfies JoinInfo;
      case 'stop':
        return this.stop(matchId);
    }
  }

  /**
   * Rebuilds one match from its log and carries on. The match rewinds to the last event the log
   * holds, which is at most about a second behind the crash, and clients rejoin by themselves.
   *
   * It starts from the newest checkpoint and falls back to older ones and then to the seed. When the
   * data files or the code changed since the log was written, only a checkpoint can carry the match
   * over: its state is kept and the new rules apply from there on.
   */
  private async resume(match: MatchDto): Promise<void> {
    const [events, checkpoints] = await Promise.all([this.log.read(match.id), this.log.checkpoints(match.id)]);
    const plan = planResume(events, checkpoints, this.sim.fingerprint);
    if (!plan) throw new Error('its log has no start event');
    const { seed, players } = plan;
    const simPlayers = players.map((p) => ({ id: p.simId, team: p.team, kind: p.kind }));

    let rebuilt: Awaited<ReturnType<SimService['rebuild']>> | undefined;
    let used: ResumeAttempt | undefined;
    let bots: SimBot[] = [];
    const failures: string[] = [];
    for (const attempt of plan.attempts) {
      bots = players.filter((p) => p.kind === 'bot').map((p) => this.sim.createBot(p.simId, p.team, seed));
      try {
        rebuilt = await this.sim.rebuild({
          seed,
          began: { dataHash: plan.started.data.dataHash, mapgenVersion: plan.started.data.mapgenVersion },
          players: simPlayers,
          bots,
          attempt,
          targetTick: plan.target,
        });
        used = attempt;
        break;
      } catch (err) {
        const where = attempt.checkpoint ? `checkpoint at tick ${attempt.checkpoint.tick}` : 'the seed';
        failures.push(`${where}: ${(err as Error).message}`);
        this.logger.warn(`Match ${match.id}: rebuilding from ${where} failed: ${(err as Error).message}`);
      }
    }
    if (this.closing) {
      await this.ownership.release(match.id);
      return;
    }
    if (!rebuilt || !used) {
      throw new Error(
        failures.length > 0
          ? `no way to rebuild it worked (${failures.join('; ')})`
          : 'the rules changed since it began, and it has no checkpoint to continue from',
      );
    }
    const { state, recorder } = rebuilt;
    const finishedEvent = plan.finished;
    const run: Run = {
      matchId: match.id,
      players: players as RunnerPlayer[],
      state,
      recorder,
      inbox: [],
      bots,
      lastSeq: plan.lastSeq,
      startedAt: Date.now() - state.tick * this.tickMs,
      ending: false,
      loggedEnd: finishedEvent !== undefined,
      reproducible: plan.reproducible,
    };
    this.runs.set(match.id, run);
    await this.log.continueNumbering(match.id);
    const mode = used.checkpoint ? (used.strict ? 'checkpoint' : 'checkpoint-changed') : 'replay';
    this.log.append(match.id, {
      type: 'resumed',
      tick: state.tick,
      data: { ...this.sim.fingerprint, at: new Date().toISOString(), mode },
    });
    this.logger.log(
      mode === 'checkpoint-changed'
        ? `Match ${match.id} resumed at tick ${state.tick} from the checkpoint at tick ${used.checkpoint?.tick}, under rules that changed since it began`
        : `Match ${match.id} resumed at tick ${state.tick} (${mode})`,
    );
    if (finishedEvent?.type === 'finished' || state.outcome || state.tick >= this.maxTicks) {
      const stopped = finishedEvent?.type === 'finished' && finishedEvent.data.result.reason === MatchEndReason.Stopped;
      await this.finish(run, stopped ? MatchEndReason.Stopped : undefined);
      return;
    }
    await this.serveRun(run);
    this.schedule(run);
  }

  /** A running match with no usable log ends as a draw, so it does not stay `running` forever. */
  private async abandon(match: MatchDto): Promise<void> {
    const result: MatchResultDto = { winnerTeam: null, draw: true, reason: MatchEndReason.Stopped };
    try {
      await this.matches.markFinished(match.id, 0, result, undefined);
      await this.publish('match.finished', {
        matchId: match.id,
        players: match.players.filter((p) => p.playerId).map((p) => ({ playerId: p.playerId as string, team: p.team })),
        result,
        endedTick: 0,
      });
    } catch (err) {
      this.logger.error(`Closing match ${match.id} failed: ${(err as Error).message}`);
    }
  }

  /** Arms the timer for the next due tick. Drift never builds up, because due times derive from the start time. */
  private schedule(run: Run): void {
    const due = run.startedAt + (run.state.tick + 1) * this.tickMs;
    run.timer = setTimeout(() => this.pump(run), Math.max(0, due - Date.now()));
  }

  private pump(run: Run): void {
    try {
      const behind =
        Math.floor((Date.now() - run.startedAt) / this.tickMs) - run.state.tick;
      const ticks = Math.min(Math.max(behind, 1), MAX_CATCHUP_TICKS);
      for (let i = 0; i < ticks; i++) {
        if (this.tick(run)) return; // the match ended
      }
      this.schedule(run);
    } catch (err) {
      // A sim or bot that throws would otherwise take the whole process, and every other match, down with it.
      this.logger.error(`Match ${run.matchId} failed at tick ${run.state.tick}: ${(err as Error).stack ?? err}`);
      this.finish(run, MatchEndReason.Stopped).catch((e: Error) =>
        this.logger.error(`Finishing ${run.matchId} failed: ${e.message}`),
      );
    }
  }

  /** Runs one tick. Returns true when the match is over. */
  private tick(run: Run): boolean {
    const { state } = run;
    const envelopes = [
      ...run.inbox.splice(0).map((e) => ({ ...e, tick: state.tick })),
      ...run.bots.flatMap((bot) => bot.think(state)),
    ];
    for (const e of envelopes) {
      this.log.append(run.matchId, {
        type: 'command',
        tick: state.tick,
        data: { playerId: e.playerId, seq: e.seq, cmd: e.cmd },
      });
    }
    this.sim.step(state, envelopes);
    run.recorder.record(state, envelopes);
    const hashed = state.tick % this.sim.hashInterval === 0;
    if (hashed) {
      this.log.append(run.matchId, {
        type: 'hash',
        tick: state.tick,
        data: { hash: this.sim.hash(state) },
      });
    }
    if (
      !state.outcome &&
      this.checkpointEvery > 0 &&
      (state.tick === FIRST_CHECKPOINT_TICK || state.tick % this.checkpointEvery === 0)
    ) {
      this.log.saveCheckpoint({
        matchId: run.matchId,
        tick: state.tick,
        hash: this.sim.hash(state),
        ...this.sim.exportState(state, run.bots),
      });
    }
    if (state.tick % this.snapshotEvery === 0) {
      this.emitter.emit('snapshot', this.snapshotOf(run, hashed));
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
    await this.commands.unserve(run.matchId).catch(() => undefined); // no more commands for a match that ended

    try {
      return await this.conclude(run, forced);
    } finally {
      // Last, so no other node finds the match unowned while it still reads `running`.
      await this.ownership.release(run.matchId);
    }
  }

  /** The part of `finish` that saves the result. */
  private async conclude(run: Run, forced?: MatchEndReason): Promise<MatchDto> {
    const result = resultOf(run.state, forced);
    if (!run.loggedEnd) {
      this.log.append(run.matchId, {
        type: 'finished',
        tick: run.state.tick,
        data: { result, endedTick: run.state.tick },
      });
    }
    let replayId: string | undefined;
    try {
      replayId = (
        await this.replays.saveFromMatch(run.matchId, run.recorder.replay, run.reproducible)
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
    // The replay holds the match now, so the write-ahead log has done its job.
    if (replayId && !this.keepFinishedLogs) {
      await this.log
        .purge(run.matchId)
        .catch((err: Error) =>
          this.logger.warn(`Removing the log of ${run.matchId} failed: ${err.message}`),
        );
    }
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
