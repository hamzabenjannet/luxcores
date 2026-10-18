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
  /** Creeps: the id of their group, 0 for other kinds. */
  groupId: number;
  /** Barracks: the default path of new groups, as [x, z] pairs in units. */
  waypoints: number[][];
  /** Heroes: the roster id plus one, 0 for other kinds. */
  heroType: number;
  /** Damage the shield still absorbs, in milli-HP, and the ticks it has left. */
  shieldHp: number;
  shieldTicks: number;
  /** Heroes: ticks left before ability slot 0 (melee), 1 (ranged), 2 (area) and 3 (shield) can be cast again. */
  cd0: number;
  cd1: number;
  cd2: number;
  cd3: number;
}

/** A creep group. Its members are the creeps that carry its id in `groupId`. */
export interface SimGroup {
  id: number;
  owner: number;
  team: number;
  /** 1 when a player or a barracks default set the path, 0 for the lane route. */
  custom: number;
  /** Next waypoint; past the end, the group heads for the enemy Core. */
  wpIndex: number;
  waypoints: number[][];
}

/** A barracks queue entry. */
export interface SimOrder {
  id: number;
  barracksId: number;
  owner: number;
  type: number;
  /** Creep order: the attack type code of each creep. Hero order (type 2): the roster id and the allocated lux. */
  mix: number[];
  ticksLeft: number;
  /** 1 when the group is finished but the creep cap has no room for it. */
  held: number;
}

/** A player and the state of their hero rotation. */
export interface SimPlayerState extends SimPlayer {
  /** Bit i is set while roster hero i is locked by the rotation. */
  heroLock: number;
  /** Ticks until the player may pick a hero again after the last one died. */
  heroCooldown: number;
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
  players: SimPlayerState[];
  entities: SimEntity[];
  groups: SimGroup[];
  orders: SimOrder[];
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
  readonly playerId: number;
  think(state: SimState): SimCommandEnvelope[];
  /** The bot's own memory as plain data, for a checkpoint. */
  save(): unknown;
  /** Restores what `save` returned. */
  load(memory: unknown): void;
}

export interface BotApi {
  createBot(opts: {
    playerId: number;
    team: number;
    config: unknown;
    seed: number;
  }): {
    think(view: unknown): SimCommandEnvelope[];
    saveState(): unknown;
    loadState(saved: unknown): void;
  };
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
  exportState(state: SimState): Record<string, unknown>;
  importState(data: Record<string, unknown>, config: unknown): SimState;
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
