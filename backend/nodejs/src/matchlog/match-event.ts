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

/**
 * Which rules a server runs: the spec version, the data files and the code of the sim and the
 * bot. Two servers with the same fingerprint compute the same match from the same commands.
 */
export interface Fingerprint {
  specVersion: string;
  dataHash: string;
  /** Absent in logs written before checkpoints existed. */
  codeHash?: string;
}

/** Everything needed to rebuild the sim: seed, players and which rules it ran with. */
export interface StartedEvent extends Base {
  type: 'started';
  data: Fingerprint & {
    seed: number;
    players: LoggedPlayer[];
    mapgenVersion: number;
    /** Settings of this match, such as the entropy rate. Absent in older logs and for a default match. */
    options?: { entropyPermillePerSecond?: number };
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

/**
 * A match came back after a restart, at this tick, under these rules. A fingerprint that
 * differs from the one before it marks the point where a code or data change took effect.
 */
export interface ResumedEvent extends Base {
  type: 'resumed';
  data: Fingerprint & {
    at: string;
    /** `replay` rebuilt from the seed, `checkpoint` from a saved state, `checkpoint-changed` from a saved state under other rules. */
    mode: 'replay' | 'checkpoint' | 'checkpoint-changed';
  };
}

export interface FinishedEvent extends Base {
  type: 'finished';
  data: { result: MatchResultDto; endedTick: number };
}

/**
 * A running state saved so a match can resume without a replay, and under changed rules.
 * It is not an event: the log keeps only the newest two per match.
 */
export interface Checkpoint {
  matchId: string;
  /** Position in the event log: the sequence number of the first event that follows this checkpoint. */
  seq: number;
  tick: number;
  /** State hash when saved. A strict resume must reproduce it. */
  hash: string;
  /** `exportState` of the sim. */
  state: Record<string, unknown>;
  /** The memory of each bot (`saveState`). */
  bots: { playerId: number; memory: unknown }[];
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
