// @ts-check
/**
 * Simulation state. Plain data only: numbers, arrays, plain objects.
 * No Map/Set, no class instances, no functions, so it can be cloned,
 * snapshotted and hashed, and mirrored field by field in Rust.
 */

import { createRng } from './rng.js';

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
 * When adding a gameplay field, append it here and bump specVersion.
 */
export const ENTITY_HASH_FIELDS = Object.freeze([
  'id', 'kind', 'team', 'owner', 'x', 'z', 'hp', 'maxHp',
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
  return {
    tick: 0,
    rng: createRng(seed),
    nextId: 1,
    teams,
    players: players.map((p) => ({ ...p })),
    entities: [],
    config,
    outcome: null,
  };
}

/**
 * Create an entity with the next id and append it (keeps id order).
 * @param {SimState} state
 * @param {Omit<Entity, 'id'>} fields
 * @returns {Entity}
 */
export function spawnEntity(state, fields) {
  const e = { id: state.nextId++, ...fields };
  state.entities.push(e);
  return e;
}
