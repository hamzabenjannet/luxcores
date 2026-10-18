// @ts-check
/**
 * Building rules: placing, recycling and cancelling (GDD 3.4, 3.6, 4, 5).
 * The command handlers in commands.js call these functions.
 */

import { MILLI, UNITS_PER_TILE, idiv } from './fixed.js';
import { nextRange } from './rng.js';
import { spend } from './lux.js';
import { KIND, findEntity, spawnEntity } from './state.js';

/** Building data keys and their entity kinds, in a fixed order. */
const BUILDINGS = /** @type {const} */ ([
  { key: 'solar', kind: KIND.SOLAR },
  { key: 'wind', kind: KIND.WIND },
  { key: 'geothermal', kind: KIND.GEOTHERMAL },
  { key: 'nuclear', kind: KIND.NUCLEAR },
  { key: 'barracks', kind: KIND.BARRACKS },
  { key: 'tower', kind: KIND.TOWER },
]);

/** Tower attack types as stored in `Entity.attack`. The codes are part of the hash: append only. */
export const ATTACK_CODE = Object.freeze({ melee: 1, ranged: 2, area: 3 });

/**
 * True for the entity kinds that are buildings the player places (not the Core, not blockers).
 * @param {number} kind
 */
export function isBuildingKind(kind) {
  return kind >= KIND.SOLAR && kind <= KIND.TOWER;
}

/**
 * Inclusive tile rows of a team's build zone (Core row and build row, GDD 10.1).
 * @param {{ mapgen: { rows: readonly { team: number, height: number }[] } }} config
 * @param {number} team
 * @returns {{ z0: number, z1: number }}
 */
export function buildZoneOf(config, team) {
  let z = 0;
  let z0 = -1;
  let z1 = -1;
  for (const row of config.mapgen.rows) {
    if (row.team === team) {
      if (z0 < 0) z0 = z;
      z1 = z + row.height - 1;
    }
    z += row.height;
  }
  return { z0, z1 };
}

/**
 * Inclusive tile rows of a team's build zone, read from the match config.
 * @param {import('./state.js').SimState} state
 * @param {number} team
 * @returns {{ z0: number, z1: number }}
 */
export function buildZone(state, team) {
  return buildZoneOf(state.config, team);
}

/**
 * Whether a static entity (Core, building, blocker) already stands on the tile.
 * @param {import('./state.js').SimState} state
 * @param {number} tileX @param {number} tileZ
 */
function tileTaken(state, tileX, tileZ) {
  for (const e of state.entities) {
    if (e.kind > KIND.BLOCKER) continue; // creeps, heroes and items do not block a tile here
    if (idiv(e.x, UNITS_PER_TILE) === tileX && idiv(e.z, UNITS_PER_TILE) === tileZ) return true;
  }
  return false;
}

/**
 * `build` command. Every refusal leaves the state untouched.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ building?: unknown, tileX?: unknown, tileZ?: unknown, attack?: unknown }} cmd
 * @returns {boolean}
 */
export function tryBuild(state, playerId, cmd) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  const entry = BUILDINGS.find((b) => b.key === cmd.building);
  if (!entry) return false;
  const { tileX, tileZ } = cmd;
  if (!Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileZ)) return false;
  const tx = /** @type {number} */ (tileX);
  const tz = /** @type {number} */ (tileZ);

  // Placement: inside the team's build zone (the DMZ and the enemy half are out), on a free tile.
  const zone = buildZone(state, player.team);
  if (tz < zone.z0 || tz > zone.z1 || tx < 0 || tx >= state.map.width) return false;
  if (tileTaken(state, tx, tz)) return false;

  const data = state.config.buildings[entry.key];
  if (data.requiresVent && !state.map.vents.some((v) => v.team === player.team && v.tileX === tx && v.tileZ === tz)) return false;

  // A tower picks its attack type when it is built. No other building takes one.
  let attack = 0;
  if (entry.kind === KIND.TOWER) {
    const code = typeof cmd.attack === 'string' && Object.hasOwn(ATTACK_CODE, cmd.attack) ? ATTACK_CODE[/** @type {keyof typeof ATTACK_CODE} */ (cmd.attack)] : 0;
    if (code === 0) return false;
    attack = code;
  } else if (cmd.attack !== undefined) {
    return false;
  }

  if (!spend(state, player.team, data.costLux)) return false;

  // HP is milli-HP, so cost (milli-lux) times the HP factor is already in the right unit.
  const hp = data.hp !== undefined ? data.hp * MILLI : data.costLux * state.config.balance.hpFactor.default;
  const half = idiv(UNITS_PER_TILE, 2);
  // A wind plant rolls its first output when it is built, then again every rerollTicks.
  const roll = entry.kind === KIND.WIND ? nextRange(state.rng, data.outputMinMilliLuxPerSecond, data.outputMaxMilliLuxPerSecond) : 0;
  spawnEntity(state, {
    kind: entry.kind,
    team: player.team,
    owner: playerId,
    x: tx * UNITS_PER_TILE + half,
    z: tz * UNITS_PER_TILE + half,
    hp,
    maxHp: hp,
    roll,
    attack,
  });
  return true;
}

/**
 * `upgrade` command. Power increases tower damage; shell increases current and maximum HP.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ towerId?: unknown, track?: unknown }} cmd
 */
export function tryUpgradeTower(state, playerId, cmd) {
  if (!state.players.some((player) => player.id === playerId) || !Number.isSafeInteger(cmd.towerId)) return false;
  if (cmd.track !== 'power' && cmd.track !== 'shell') return false;
  const tower = findEntity(state, /** @type {number} */ (cmd.towerId));
  if (!tower || tower.kind !== KIND.TOWER || tower.owner !== playerId || tower.recycle > 0) return false;

  const track = cmd.track;
  const level = track === 'power' ? tower.powerLevel : tower.shellLevel;
  const upgrades = state.config.buildings.tower.upgrades[track];
  const upgrade = upgrades[level];
  if (!upgrade || !spend(state, tower.team, upgrade.costLux)) return false;

  if (track === 'power') {
    tower.powerLevel++;
    tower.powerDamagePct += upgrade.damagePct;
    tower.powerLux += upgrade.costLux;
  } else {
    const addedHp = upgrade.hp * MILLI;
    tower.shellLevel++;
    tower.hp += addedHp;
    tower.maxHp += addedHp;
  }
  return true;
}

/**
 * The building a command names, if the player owns it. Only the owner recycles
 * a building (GDD 2.1: buildings belong to the player who built them).
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {unknown} buildingId
 */
export function ownedBuilding(state, playerId, buildingId) {
  if (!state.players.some((p) => p.id === playerId) || !Number.isSafeInteger(buildingId)) return undefined;
  const e = findEntity(state, /** @type {number} */ (buildingId));
  return e && isBuildingKind(e.kind) && e.owner === playerId ? e : undefined;
}

/**
 * `recycle` command: starts the channel. The refund comes when it ends (recycle system).
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ buildingId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryRecycle(state, playerId, cmd) {
  const e = ownedBuilding(state, playerId, cmd.buildingId);
  if (!e || e.recycle > 0) return false;
  e.recycle = state.config.balance.economy.recycleChannelTicks;
  return true;
}

/**
 * `cancelRecycle` command: tapping the building again (GDD 3.6).
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ buildingId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryCancelRecycle(state, playerId, cmd) {
  const e = ownedBuilding(state, playerId, cmd.buildingId);
  if (!e || e.recycle === 0) return false;
  e.recycle = 0;
  return true;
}

/**
 * Lux a building returns when recycled: the refund percent of its current lux value.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} e
 */
export function recycleRefund(state, e) {
  const luxValue = idiv(e.hp, state.config.balance.hpFactor.default) + e.powerLux;
  return idiv(luxValue * state.config.balance.economy.recycleRefundPct, 100);
}
