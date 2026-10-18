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
  /** Tower attack type code (1 melee, 2 ranged, 3 area), 0 for other kinds. */
  attack: number;
  /** Buildings: ticks left in the recycle channel, 0 when idle. */
  recycle: number;
  /** Ticks left on a stun. */
  stunTicks: number;
  /** Current attack target (a projectile's target), or 0. */
  targetId: number;
  /** Tower upgrade levels. */
  powerLevel: number;
  shellLevel: number;
  /** Wind plants: current output in milli-lux per second. */
  roll: number;
  /** Projectiles: the tick of impact. */
  arrivalTick: number;
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

/** A bot driven by the server: it reads the state and returns the commands it wants this tick. */
export interface SimBot {
  think(state: SimState): SimCommandEnvelope[];
}

export interface BotApi {
  createBot(opts: {
    playerId: number;
    team: number;
    config: unknown;
    seed: number;
  }): { think(view: unknown): SimCommandEnvelope[] };
}

export interface WorldViewApi {
  localWorldView(state: SimState, viewerTeam: number): unknown;
}

export interface SimApi {
  SPEC_VERSION: string;
  TICK_HZ: number;
  HASH_INTERVAL: number;
  /** Entity kind codes by name, for example `KIND.TOWER`. */
  KIND: Record<string, number>;
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
