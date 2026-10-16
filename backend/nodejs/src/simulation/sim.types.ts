/**
 * Types for the pieces of the repo's simulation (`src/sim/index.js`) that the
 * server uses. The sim is plain JavaScript that the server loads at run time, so
 * these interfaces describe what the sim guarantees. `test/simulation.e2e-spec.ts`
 * checks them against the real module.
 */

export interface SimPlayer {
  id: number;
  team: number;
  kind: 'human' | 'bot';
}

export interface SimEntity {
  id: number;
  kind: number;
  team: number;
  owner: number;
  /** Position in units; 1 tile is 1000 units. */
  x: number;
  z: number;
  hp: number;
  maxHp: number;
}

export interface SimTeam {
  coreLux: number;
  pendingLux: number;
  ticksSinceSpend: number;
}

export interface SimLane {
  team: number;
  lane: 'left' | 'mid' | 'right';
  points: number[][];
  tiles: number[];
}

export interface SimTile {
  team: number;
  tileX: number;
  tileZ: number;
}

export interface SimMap {
  width: number;
  height: number;
  usedSeed: number;
  lanes: SimLane[];
  vents: SimTile[];
  itemSpawns: SimTile[];
}

export interface SimMapLayout extends SimMap {
  cores: SimTile[];
  blockers: SimTile[];
}

export type SimOutcome = null | { winnerTeam: number } | { draw: true };

export interface SimState {
  tick: number;
  teams: SimTeam[];
  entities: SimEntity[];
  outcome: SimOutcome;
  map: SimMap;
}

export interface SimCommand {
  t: string;
  [field: string]: unknown;
}

export interface SimCommandEnvelope {
  tick: number;
  playerId: number;
  seq: number;
  cmd: SimCommand;
}

export interface SimReplay {
  version: number;
  specVersion: string;
  dataHash: string;
  mapgenVersion: number;
  seed: number;
  players: SimPlayer[];
  ticks: number;
  commands: SimCommandEnvelope[];
  hashes: Record<string, string>;
}

export interface SimRecorder {
  replay: SimReplay;
  record(state: SimState, envelopes: SimCommandEnvelope[]): void;
}

export interface SimApi {
  SPEC_VERSION: string;
  TICK_HZ: number;
  HASH_INTERVAL: number;
  normalizeData(
    raw: Record<string, unknown>,
  ): { mapgen: { version: number } } & Record<string, unknown>;
  createState(opts: {
    seed: number;
    players: SimPlayer[];
    config: unknown;
  }): SimState;
  step(state: SimState, envelopes: SimCommandEnvelope[]): void;
  hashState(state: SimState): string;
  generateMap(seed: number, mapgen: unknown): SimMapLayout;
  playReplay(
    replay: SimReplay,
    config: unknown,
  ): {
    ok: boolean;
    firstMismatchTick: number | null;
    finalHash: string;
    state: SimState;
  };
  Recorder: new (meta: {
    seed: number;
    players: SimPlayer[];
    dataHash: string;
    mapgenVersion: number;
  }) => SimRecorder;
}
