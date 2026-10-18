import type { MatchResultDto } from '../matches/dto/match.dto.js';
import type { SimCommand } from '../simulation/sim.types.js';

/** A player of a running match, as the sim and the lobby know them. */
export interface LoggedPlayer {
  /** Absent for a bot. */
  playerId?: string;
  /** Player id inside the sim. In 1v1 it equals the team. */
  simId: number;
  name: string;
  team: number;
  kind: 'human' | 'bot';
}

interface Base {
  matchId: string;
  /** Position in the match's log, from 0. Resumed matches continue after the last one. */
  seq: number;
  /** Sim tick: the execution tick of a command, the state tick of a hash. */
  tick: number;
}

/** Everything needed to rebuild the sim: seed, players and which data it ran with. */
export interface StartedEvent extends Base {
  type: 'started';
  data: {
    seed: number;
    players: LoggedPlayer[];
    specVersion: string;
    dataHash: string;
    mapgenVersion: number;
  };
}

/** One command envelope that the sim executed, from a human or a bot. */
export interface CommandEvent extends Base {
  type: 'command';
  data: { playerId: number; seq: number; cmd: SimCommand };
}

/** The state hash every `hashInterval` ticks. A rebuild must reproduce it. */
export interface HashEvent extends Base {
  type: 'hash';
  data: { hash: string };
}

/** A match came back after a restart, at this tick. For the audit trail only. */
export interface ResumedEvent extends Base {
  type: 'resumed';
  data: { at: string };
}

export interface FinishedEvent extends Base {
  type: 'finished';
  data: { result: MatchResultDto; endedTick: number };
}

export type MatchEvent =
  | StartedEvent
  | CommandEvent
  | HashEvent
  | ResumedEvent
  | FinishedEvent;

/** A match event before the log adds its match id and sequence number. */
export type NewMatchEvent = MatchEvent extends infer E
  ? E extends MatchEvent
    ? Omit<E, 'seq' | 'matchId'>
    : never
  : never;
