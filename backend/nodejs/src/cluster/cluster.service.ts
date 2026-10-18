import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import type { CommandAck, MatchSnapshot } from '../game/match-runner.service.js';
import { MatchRunnerService } from '../game/match-runner.service.js';
import type { MatchDto } from '../matches/dto/match.dto.js';
import type { SimCommand } from '../simulation/sim.types.js';
import { type JoinInfo, type MatchRpc, isRpcFailure } from './cluster.types.js';
import { CommandBus } from './command-bus.js';
import { MatchOwnership } from './match-ownership.js';

/** What a client's `match:join` learns from the node that runs the match. */
export interface JoinState {
  nextSeq: number;
  snapshot: MatchSnapshot | null;
}

/**
 * Reaches a match wherever it runs. A match this server runs is handled by a direct call, which
 * costs nothing. A match another server runs gets a request over the command bus, to the queue of
 * that match, and the reply carries the same acknowledgement a local call would give.
 */
@Injectable()
export class ClusterService {
  private readonly transport: 'auto' | 'queue';
  private readonly timeoutMs: number;

  constructor(
    private readonly runner: MatchRunnerService,
    private readonly ownership: MatchOwnership,
    private readonly bus: CommandBus,
    config: ConfigService<AppConfig, true>,
  ) {
    const cluster = config.get('cluster', { infer: true });
    this.transport = cluster.commandTransport;
    this.timeoutMs = cluster.rpcTimeoutMs;
  }

  get nodeId(): string {
    return this.ownership.nodeId;
  }

  /** For the health route. */
  status(): { nodeId: string; ownership: string; commands: string; transport: string; matches: string[] } {
    return {
      nodeId: this.ownership.nodeId,
      ownership: this.ownership.mode,
      commands: this.bus.mode,
      transport: this.transport,
      matches: this.runner.runningMatchIds,
    };
  }

  async command(matchId: string, playerId: string, seq: number, cmd: SimCommand): Promise<CommandAck> {
    if (this.runner.isRunning(matchId) && this.transport === 'auto') {
      return this.runner.submitCommand(matchId, playerId, seq, cmd);
    }
    const reply = await this.ask(matchId, { t: 'command', playerId, seq, cmd });
    if (reply === NOT_RUNNING) return { accepted: false, reason: 'The match is not running' };
    if (typeof reply === 'string') return { accepted: false, reason: reply };
    return reply as CommandAck;
  }

  async join(matchId: string, playerId: string): Promise<JoinState> {
    if (this.runner.isRunning(matchId) && this.transport === 'auto') {
      return { nextSeq: this.runner.nextSeq(matchId, playerId), snapshot: this.runner.snapshot(matchId) };
    }
    const reply = await this.ask(matchId, { t: 'join', playerId });
    if (reply === NOT_RUNNING || typeof reply === 'string') return { nextSeq: 0, snapshot: null };
    const info = reply as JoinInfo;
    return { nextSeq: info.nextSeq, snapshot: info.snapshot as MatchSnapshot | null };
  }

  async stop(matchId: string): Promise<MatchDto> {
    if (this.runner.isRunning(matchId)) return this.runner.stop(matchId);
    const reply = await this.ask(matchId, { t: 'stop' });
    if (reply === NOT_RUNNING) return this.runner.stop(matchId); // throws the usual "not running"
    if (typeof reply === 'string') throw new ConflictException(reply);
    return reply as MatchDto;
  }

  /**
   * Sends a request to the node that runs the match. Returns its reply, `NOT_RUNNING` when no node
   * holds the match, or a sentence that says why the request could not be served.
   */
  private async ask(matchId: string, rpc: MatchRpc): Promise<unknown | typeof NOT_RUNNING | string> {
    const owner = this.runner.isRunning(matchId) ? this.ownership.nodeId : await this.ownership.ownerOf(matchId);
    if (!owner) return NOT_RUNNING;
    if (owner !== this.ownership.nodeId && this.bus.mode === 'local') {
      return 'Another server runs this match, and the command queue is not set up between the servers';
    }
    const reply = await this.bus.request(matchId, rpc, this.timeoutMs);
    if (reply === null) return owner === this.ownership.nodeId ? 'The match did not answer' : 'The server that runs the match did not answer';
    if (isRpcFailure(reply)) return reply.error;
    return reply;
  }
}

const NOT_RUNNING = Symbol('not running');
