// @ts-check
/**
 * Simulation state. Plain data only: numbers, arrays, plain objects.
 * No Map/Set, no class instances, no functions, so it can be cloned,
 * snapshotted and hashed, and mirrored field by field in Rust.
 */

import { createRng } from './rng.js';
import { MILLI, UNITS_PER_TILE, idiv } from './fixed.js';
import { generateMap } from './mapgen.js';

/** Entity kinds. Integer codes are part of the hash layout: append only. */
export const KIND = Object.freeze({
  CORE: 1,
  SOLAR: 2,
  WIND: 3,
  GEOTHERMAL: 4,
  NUCLEAR: 5,
  BARRACKS: 6,
  TOWER: 7,
  BLOCKER: 8,
  CREEP: 9,
  HERO: 10,
  PROJECTILE: 11,
  GROUND_ITEM: 12,
  LOOT_BAG: 13,
});

/** Team index used for neutral entities (blockers). */
export const NEUTRAL = -1;

/**
 * Entity fields included in the hash, in this exact order.
 * When adding a gameplay field, append it here. SPEC_VERSION stays at 0.10.0
 * while the MVP is built (CLAUDE.md, simulation rule 8), so re-record the
 * golden replays in the same commit instead.
 */
export const ENTITY_HASH_FIELDS = Object.freeze([
  'id', 'kind', 'team', 'owner', 'x', 'z', 'hp', 'maxHp',
  'born', 'roll', 'recycle', 'attack', 'targetId', 'attackCooldown',
  'overrideTargetId', 'overrideTicks', 'stunTicks',
  'moveTargetX', 'moveTargetZ', 'movePathIndex', 'pathDirty',
  'impulseX', 'impulseZ', 'impulseTicks',
  'powerLevel', 'powerDamagePct', 'shellLevel', 'powerLux', 'entropyRemainder',
  'arrivalTick', 'projectileDamage', 'projectileProc',
  'projectileProcChance', 'projectileProcValue', 'groupId',
  'heroType', 'shieldHp', 'shieldTicks', 'cd0', 'cd1', 'cd2', 'cd3',
  'itemId', 'speedMod', 'speedTicks', 'autoSpawn',
]);

/** Team fields included in the hash, in this exact order. */
export const TEAM_HASH_FIELDS = Object.freeze([
  'coreLux', 'pendingLux', 'ticksSinceSpend',
  'statCollected', 'statSpent', 'statDrained', 'statFunneled', 'statRecycled', 'statEntropy',
  'statDrainedTenths', 'statEntropyTenths',
]);

/** The end-of-match counters of a team, in milli-lux (GDD 13.2). They only count and never decide anything. */
export function emptyStats() {
  return {
    statCollected: 0, statSpent: 0, statDrained: 0, statFunneled: 0, statRecycled: 0, statEntropy: 0,
    statDrainedTenths: 0, statEntropyTenths: 0,
  };
}

/**
 * @typedef {Object} Entity
 * @property {number} id      unique, ascending creation order
 * @property {number} kind    KIND code
 * @property {number} team    team index, or NEUTRAL
 * @property {number} owner   player id, or -1
 * @property {number} x       position in units (1 tile = 1000)
 * @property {number} z
 * @property {number} hp      current HP
 * @property {number} maxHp
 * @property {number} born     tick of creation; collectors and entropy count from it
 * @property {number} roll     wind plants: current output in milli-lux per second; 0 for other kinds
 * @property {number} recycle  buildings: ticks left in the recycle channel, 0 when idle
 * @property {number} attack   attack type code (ATTACK_CODE in buildings.js), 0 for untyped entities
 * @property {number} targetId current attack target, or 0
 * @property {number} attackCooldown ticks before the next basic attack
 * @property {number} overrideTargetId tower's hero-aggression target, or 0
 * @property {number} overrideTicks ticks left on the tower target override
 * @property {number} stunTicks ticks left on a stun effect
 * @property {number} moveTargetX hero movement destination, in world units
 * @property {number} moveTargetZ
 * @property {number[]} movePath A* tile indices from start to goal
 * @property {number} movePathIndex next tile in the cached route
 * @property {number} pathDirty 1 when the cached route needs recomputing
 * @property {number} impulseX knockback velocity, x component
 * @property {number} impulseZ knockback velocity, z component
 * @property {number} impulseTicks ticks left in the linear impulse decay
 * @property {number} powerLevel tower power upgrades
 * @property {number} powerDamagePct cumulative tower damage bonus
 * @property {number} shellLevel tower shell upgrades
 * @property {number} powerLux lux spent on tower power upgrades
 * @property {number} entropyRemainder fractional entropy carried between seconds
 * @property {number} arrivalTick projectile impact tick
 * @property {number} projectileDamage projectile damage in milli-HP
 * @property {number} projectileProc projectile proc code
 * @property {number} projectileProcChance projectile proc chance in percent
 * @property {number} projectileProcValue projectile stun ticks or knockback distance
 * @property {number} groupId creeps: id of the creep group, 0 for other kinds
 * @property {number} heroType heroes: roster id plus one, 0 for other kinds
 * @property {number} shieldHp damage the shield still absorbs, in milli-HP
 * @property {number} shieldTicks ticks left on the shield
 * @property {number} cd0 heroes: ticks left before ability slot 0 (melee) can be cast again
 * @property {number} cd1 ranged
 * @property {number} cd2 area
 * @property {number} cd3 shield
 * @property {number} itemId ground items: item id plus one, 0 for other kinds
 * @property {number} speedMod attack speed change from an item, added to the base speed while `speedTicks` runs
 * @property {number} speedTicks ticks left on the attack speed change
 * @property {number[]} items loot bags: how many of each item id the bag holds; empty for other kinds
 * @property {number[][]} waypoints barracks: default path for new groups, as [x, z] pairs in units
 * @property {number} autoSpawn barracks: 1 while auto spawn repeats every finished creep group (GDD 9.4)
 * @property {boolean[]} [visibleTo] derived per-team visibility, excluded from the hash
 */

/**
 * A creep group: its members are the creeps with this `groupId`, in id order.
 * It is created when a barracks finishes an order and removed when its last creep dies.
 * @typedef {Object} Group
 * @property {number} id          from the shared id counter
 * @property {number} owner       player id
 * @property {number} team
 * @property {number} custom      1 when the path was set by a player or a barracks default, 0 for the lane route
 * @property {number} wpIndex     next waypoint; past the end, the group heads for the enemy Core
 * @property {number[][]} waypoints  [x, z] pairs in units, at most `creep.maxWaypoints` for a custom path
 */

/**
 * A barracks queue entry. Today only creep orders exist; hero picks (M5) and items (M6) add types.
 * @typedef {Object} Order
 * @property {number} id          from the shared id counter, so the queue order is the id order
 * @property {number} barracksId
 * @property {number} owner       player id
 * @property {number} type        ORDER_TYPE code (creeps.js)
 * @property {number[]} mix       creeps: the attack type code of each creep (ATTACK_CODE in buildings.js)
 * @property {number} ticksLeft   build time left; a held order has 0
 * @property {number} held        1 when the group is finished but the creep cap has no room for it
 */

/**
 * @typedef {Object} Team
 * @property {number} coreLux          settled lux in the Core, milli-lux
 * @property {number} pendingLux       sum of the pending pool, milli-lux
 * @property {number} ticksSinceSpend  for the nuclear meltdown rule
 * @property {number} statCollected    lux the collectors produced, milli-lux (GDD 13.2)
 * @property {number} statSpent        lux paid for buildings, upgrades, creeps, heroes, abilities and items
 * @property {number} statDrained      enemy lux destroyed by this team's damage
 * @property {number} statFunneled     enemy lux that Energy Grab moved to this team's pending pool
 * @property {number} statRecycled     refunds received for recycled buildings
 * @property {number} statEntropy      lux this team's entities lost to entropy
 * @property {number} statDrainedTenths  tenths of a milli-lux that `statDrained` has not counted yet, so no fraction is lost
 * @property {number} statEntropyTenths  the same for `statEntropy`
 * @property {Array<{settleTick:number, amount:number}>} pending  income buffer entries
 */

/**
 * @typedef {Object} Player
 * @property {number} id
 * @property {number} team
 * @property {'human'|'bot'} kind
 * @property {number} heroLock   bit i set while roster hero i is locked by the rotation (GDD 7.1)
 * @property {number} heroCooldown ticks until the player may pick a hero again after the last one died
 * @property {number} funnelLux milli-lux that Energy Grab may still funnel, 0 when it is not active (GDD 8.2)
 * @property {number[]} items inventory: how many of each item id the player holds (GDD 8.1)
 */

/**
 * @typedef {Object} SimState
 * @property {number} tick
 * @property {import('./rng.js').RngState} rng
 * @property {number} nextId
 * @property {Team[]} teams
 * @property {Player[]} players
 * @property {Entity[]} entities  always sorted by ascending id
 * @property {Group[]} groups  creep groups, ascending id
 * @property {Order[]} orders  barracks queues, ascending id
 * @property {import('./config.js').SimConfig} config  normalized data, read-only
 * @property {null | { winnerTeam: number } | { draw: true }} outcome  set by the victory system
 * @property {StaticMap} map  generated layout, never changes after createState
 * @property {Uint8Array[]} visibility derived per-team tile bitsets, excluded from the hash
 */

/**
 * Static map data from generateMap. It is a pure function of the match seed
 * and the data files, so it stays out of the hash (like visibility, it is
 * derived data). Cores and blockers live in `entities` instead, because
 * their HP changes.
 * @typedef {Object} StaticMap
 * @property {number} width   tiles
 * @property {number} height  tiles
 * @property {number} usedSeed  seed that passed the connectivity check
 * @property {import('./mapgen.js').MapLayout['lanes']} lanes
 * @property {import('./mapgen.js').MapLayout['vents']} vents
 * @property {import('./mapgen.js').MapLayout['itemSpawns']} itemSpawns
 */

/**
 * @param {{ seed: number, players: Player[], config: import('./config.js').SimConfig }} opts
 * @returns {SimState}
 */
export function createState({ seed, players, config }) {
  const teamCount = 1 + players.reduce((m, p) => Math.max(m, p.team), 0);
  /** @type {Team[]} */
  const teams = [];
  for (let t = 0; t < teamCount; t++) {
    const members = players.filter((p) => p.team === t).length;
    teams.push({
      coreLux: config.balance.core.startPerPlayerLux * members,
      pendingLux: 0,
      ticksSinceSpend: 0,
      ...emptyStats(),
      pending: [],
    });
  }
  // The map has its own RNG (see mapgen.js), so state.rng starts the same
  // with or without map generation.
  const layout = generateMap(seed, config.mapgen);
  /** @type {SimState} */
  const state = {
    tick: 0,
    rng: createRng(seed),
    nextId: 1,
    teams,
    players: players.map((p) => ({ heroLock: 0, heroCooldown: 0, funnelLux: 0, items: emptyCounts(config), ...p })),
    entities: [],
    groups: [],
    orders: [],
    config,
    outcome: null,
    visibility: teams.map(() => new Uint8Array(Math.ceil(layout.width * layout.height / 8))),
    map: {
      width: layout.width,
      height: layout.height,
      usedSeed: layout.usedSeed,
      lanes: layout.lanes,
      vents: layout.vents,
      itemSpawns: layout.itemSpawns,
    },
  };

  // Fixed spawn order keeps entity ids stable: Cores by team, then blockers
  // (team 0 in placement order, then their mirror images).
  // HP is stored in milli-HP, like lux, so a Core's HP equals its coreLux.
  const center = idiv(UNITS_PER_TILE, 2);
  for (const c of layout.cores) {
    if (c.team >= teams.length) continue;
    const hp = teams[c.team].coreLux;
    spawnEntity(state, {
      kind: KIND.CORE, team: c.team, owner: -1,
      x: c.tileX * UNITS_PER_TILE + center, z: c.tileZ * UNITS_PER_TILE + center,
      hp, maxHp: hp,
    });
  }
  const blockerHp = config.buildings.blocker.hp * MILLI;
  for (const b of layout.blockers) {
    spawnEntity(state, {
      kind: KIND.BLOCKER, team: NEUTRAL, owner: -1,
      x: b.tileX * UNITS_PER_TILE + center, z: b.tileZ * UNITS_PER_TILE + center,
      hp: blockerHp, maxHp: blockerHp,
    });
  }
  return state;
}

/**
 * Create an entity with the next id and append it (keeps id order).
 * `born` defaults to the current tick, the other extra fields to 0.
 * @param {SimState} state
 * @param {Pick<Entity, 'kind' | 'team' | 'owner' | 'x' | 'z' | 'hp' | 'maxHp'> & Partial<Entity>} fields
 * @returns {Entity}
 */
export function spawnEntity(state, fields) {
  const e = {
    ...entityDefaults(),
    id: state.nextId++, born: state.tick,
    ...fields,
  };
  state.entities.push(e);
  return e;
}

/**
 * The fields an entity starts with, apart from its id and birth tick. A checkpoint from an older
 * version lacks the fields that later milestones added, and `importState` fills them from here.
 * @returns {Omit<Entity, 'id' | 'born' | 'kind' | 'team' | 'owner' | 'x' | 'z' | 'hp' | 'maxHp'>}
 */
export function entityDefaults() {
  return {
    roll: 0, recycle: 0, attack: 0,
    targetId: 0, attackCooldown: 0, overrideTargetId: 0, overrideTicks: 0, stunTicks: 0,
    moveTargetX: 0, moveTargetZ: 0, movePath: [], movePathIndex: 0, pathDirty: 0,
    impulseX: 0, impulseZ: 0, impulseTicks: 0,
    powerLevel: 0, powerDamagePct: 0, shellLevel: 0, powerLux: 0, entropyRemainder: 0,
    arrivalTick: 0, projectileDamage: 0, projectileProc: 0,
    projectileProcChance: 0, projectileProcValue: 0, groupId: 0, waypoints: [],
    heroType: 0, shieldHp: 0, shieldTicks: 0, cd0: 0, cd1: 0, cd2: 0, cd3: 0,
    itemId: 0, speedMod: 0, speedTicks: 0, items: [], autoSpawn: 0,
  };
}

/**
 * An inventory with no items: one zero per item id.
 * @param {import('./config.js').SimConfig} config
 * @returns {number[]}
 */
export function emptyCounts(config) {
  return config.items.list.map(() => 0);
}

/**
 * Binary search in the id-sorted entity array.
 * @param {SimState} state
 * @param {number} id
 * @returns {Entity | undefined}
 */
export function findEntity(state, id) {
  let lo = 0;
  let hi = state.entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = state.entities[mid];
    if (e.id === id) return e;
    if (e.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}
