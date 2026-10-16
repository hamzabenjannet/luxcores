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
  'born', 'roll', 'recycle', 'attack',
]);

/** Team fields included in the hash, in this exact order. */
export const TEAM_HASH_FIELDS = Object.freeze([
  'coreLux', 'pendingLux', 'ticksSinceSpend',
]);

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
 * @property {number} attack   towers: attack type code (ATTACK_CODE in buildings.js), 0 for other kinds
 */

/**
 * @typedef {Object} Team
 * @property {number} coreLux          settled lux in the Core, milli-lux
 * @property {number} pendingLux       sum of the pending pool, milli-lux
 * @property {number} ticksSinceSpend  for the nuclear meltdown rule
 * @property {Array<{settleTick:number, amount:number}>} pending  income buffer entries
 */

/**
 * @typedef {Object} Player
 * @property {number} id
 * @property {number} team
 * @property {'human'|'bot'} kind
 */

/**
 * @typedef {Object} SimState
 * @property {number} tick
 * @property {import('./rng.js').RngState} rng
 * @property {number} nextId
 * @property {Team[]} teams
 * @property {Player[]} players
 * @property {Entity[]} entities  always sorted by ascending id
 * @property {import('./config.js').SimConfig} config  normalized data, read-only
 * @property {null | { winnerTeam: number } | { draw: true }} outcome  set by the victory system
 * @property {StaticMap} map  generated layout, never changes after createState
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
    players: players.map((p) => ({ ...p })),
    entities: [],
    config,
    outcome: null,
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
 * @param {Omit<Entity, 'id' | 'born' | 'roll' | 'recycle' | 'attack'> & Partial<Pick<Entity, 'born' | 'roll' | 'recycle' | 'attack'>>} fields
 * @returns {Entity}
 */
export function spawnEntity(state, fields) {
  const e = { id: state.nextId++, born: state.tick, roll: 0, recycle: 0, attack: 0, ...fields };
  state.entities.push(e);
  return e;
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
