// @ts-check
/**
 * Heroes (GDD 7): picking one at a barracks, the rotation lock, the four abilities and the shield.
 * The command handlers in commands.js call these functions, and the production, hero, effects and
 * cleanup systems share the helpers.
 *
 * A pick pays its lux at once and joins the barracks queue as an order of type `hero` whose `mix`
 * is `[rosterId, lux]`. When the order finishes, the hero stands next to the barracks with
 * `lux * 10` HP, and the roster slot joins the player's rotation lock (`Player.heroLock`).
 */

import { dist2, idiv, isqrt, MILLI, UNITS_PER_TILE } from './fixed.js';
import { ATTACK_CODE, ownedBuilding } from './buildings.js';
import { ORDER_TYPE, spawnSpots } from './creeps.js';
import { creditDrain, dealDamage } from './damage.js';
import { spend } from './lux.js';
import { meleeReach } from './reach.js';
import { KIND, findEntity, spawnEntity } from './state.js';
import { alertTowers, isAttackable, isEnemy } from './systems/combat.js';

/** The ability type of each slot (GDD 7.5). Slot numbers are part of the command format. */
export const SLOT_TYPES = Object.freeze(['melee', 'ranged', 'area', 'shield']);

/**
 * The hero of a player, if one is alive.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 */
export function heroOf(state, playerId) {
  for (const e of state.entities) if (e.kind === KIND.HERO && e.owner === playerId && e.hp > 0) return e;
  return undefined;
}

/**
 * The roster entry for a hero entity.
 * @param {import('./state.js').SimState} state
 * @param {number} heroType roster id plus one
 */
export function rosterEntry(state, heroType) {
  return state.config.heroes.roster[heroType - 1];
}

/**
 * An ability as this hero has it: the template of its type with the hero's overrides on top.
 * Numbers are in sim units already (`costLux` in milli-lux, ranges in units).
 * @param {import('./state.js').SimState} state
 * @param {number} heroType roster id plus one
 * @param {number} slot 0 to 3
 * @returns {any}
 */
export function abilityOf(state, heroType, slot) {
  const type = SLOT_TYPES[slot];
  const template = state.config.abilities.templates[type];
  const overrides = rosterEntry(state, heroType)?.overrides?.[type];
  return { ...template, ...overrides };
}

/**
 * Move speed in milli-tiles per second: the roster entry's own, or the base value.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} hero
 */
export function heroSpeed(state, hero) {
  return rosterEntry(state, hero.heroType)?.moveMilliTilesPerSecond ?? state.config.balance.hero.moveMilliTilesPerSecond;
}

/**
 * Whether the player may pick the roster hero now, ignoring lux and barracks: it is not locked,
 * the cooldown after a death has run out, and the player has neither a hero nor a hero order.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {number} rosterId
 */
export function canPickHero(state, playerId, rosterId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !Number.isSafeInteger(rosterId) || rosterId < 0 || rosterId >= state.config.balance.hero.rosterSize) return false;
  if (player.heroCooldown > 0 || (player.heroLock & (1 << rosterId)) !== 0) return false;
  if (heroOf(state, playerId)) return false;
  return !state.orders.some((o) => o.owner === playerId && o.type === ORDER_TYPE.hero);
}

/**
 * `pickHero` command: allocates `lux` whole lux (1 up to the Core's lux minus 1) and queues the
 * hero at a barracks the player owns. HP will be ten times the lux (GDD 7.2).
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ heroId?: unknown, lux?: unknown, barracksId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryPickHero(state, playerId, cmd) {
  const barracks = ownedBuilding(state, playerId, cmd.barracksId);
  if (!barracks || barracks.kind !== KIND.BARRACKS || barracks.recycle > 0) return false;
  if (!Number.isSafeInteger(cmd.heroId) || !Number.isSafeInteger(cmd.lux) || /** @type {number} */ (cmd.lux) < 1) return false;
  const rosterId = /** @type {number} */ (cmd.heroId);
  const lux = /** @type {number} */ (cmd.lux);
  if (!canPickHero(state, playerId, rosterId)) return false;
  if (!spend(state, barracks.team, lux * MILLI)) return false; // leaves at least 1 lux in the Core
  state.orders.push({
    id: state.nextId++,
    barracksId: barracks.id,
    owner: playerId,
    type: ORDER_TYPE.hero,
    mix: [rosterId, lux],
    ticksLeft: state.config.balance.hero.productionTicks,
    held: 0,
  });
  return true;
}

/**
 * Puts the hero of a finished order next to its barracks and advances the rotation lock.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Order} order
 * @param {import('./state.js').Entity} barracks
 */
export function spawnHero(state, order, barracks) {
  const [rosterId, lux] = order.mix;
  const entry = state.config.heroes.roster[rosterId];
  const spot = spawnSpots(state, barracks, 1)[0];
  const hp = lux * MILLI * state.config.balance.hpFactor.default;
  spawnEntity(state, {
    kind: KIND.HERO, team: barracks.team, owner: order.owner,
    x: spot.x, z: spot.z, hp, maxHp: hp,
    attack: ATTACK_CODE[/** @type {keyof typeof ATTACK_CODE} */ (entry.primary)],
    heroType: rosterId + 1,
  });
  const player = state.players.find((p) => p.id === order.owner);
  if (!player) return;
  player.heroLock |= 1 << rosterId;
  if (player.heroLock === (1 << state.config.balance.hero.rosterSize) - 1) player.heroLock = 0; // the whole roster has had its turn
}

/** @param {import('./state.js').Entity} hero @param {number} slot */
function cooldownOf(hero, slot) {
  return slot === 0 ? hero.cd0 : slot === 1 ? hero.cd1 : slot === 2 ? hero.cd2 : hero.cd3;
}

/** @param {import('./state.js').Entity} hero @param {number} slot @param {number} ticks */
function setCooldown(hero, slot, ticks) {
  if (slot === 0) hero.cd0 = ticks;
  else if (slot === 1) hero.cd1 = ticks;
  else if (slot === 2) hero.cd2 = ticks;
  else hero.cd3 = ticks;
}

/**
 * A creature or building a hero ability may hit: an enemy unit, building or Core, or a neutral blocker.
 * @param {import('./state.js').Entity} hero
 * @param {import('./state.js').Entity | undefined} target
 */
function hittable(hero, target) {
  if (!target || target.id === hero.id || target.hp <= 0) return false;
  return target.kind === KIND.BLOCKER || (target.team >= 0 && target.team !== hero.team && isAttackable(target.kind));
}

/**
 * Hits one target with an ability: shield first, then HP, and a stun when the ability has one.
 * Towers react when the target is a hero.
 * @param {import('./state.js').SimState} state
 * @param {import('./state.js').Entity} hero
 * @param {import('./state.js').Entity} target
 * @param {any} ability
 */
function strike(state, hero, target, ability) {
  creditDrain(state, hero.team, target, dealDamage(state, target, ability.damage * MILLI));
  if (ability.stunTicks) target.stunTicks = Math.max(target.stunTicks, ability.stunTicks);
  alertTowers(state, hero, target);
}

/**
 * `castAbility` command (GDD 7.5). Slot 0 melee hits the current target in contact (a dash closes the
 * gap when the hero has one), slot 1 ranged hits `targetId`, slot 2 area hits everything enemy around
 * `x, z`, slot 3 shield covers `targetId`. The cast pays its lux and starts the cooldown, and a bad
 * target costs nothing.
 * @param {import('./state.js').SimState} state
 * @param {number} playerId
 * @param {{ slot?: unknown, x?: unknown, z?: unknown, targetId?: unknown }} cmd
 * @returns {boolean}
 */
export function tryCastAbility(state, playerId, cmd) {
  const slot = /** @type {number} */ (cmd.slot);
  if (!Number.isSafeInteger(slot) || slot < 0 || slot > 3) return false;
  const hero = heroOf(state, playerId);
  if (!hero || hero.stunTicks > 0 || cooldownOf(hero, slot) > 0) return false;
  const ability = abilityOf(state, hero.heroType, slot);
  if (!ability) return false;
  const range2 = ability.rangeTiles * ability.rangeTiles;

  /** @type {() => void} */
  let apply;
  if (slot === 0) {
    const target = findEntity(state, hero.targetId);
    if (!hittable(hero, target) || !target) return false;
    const reach = meleeReach(state, target);
    const distance2 = dist2(hero.x, hero.z, target.x, target.z);
    const dash = ability.dashMilliTiles ?? 0;
    if (distance2 > (reach + dash) * (reach + dash)) return false;
    apply = () => {
      if (distance2 > reach * reach) {
        // Close the gap along the line to the target, to contact distance.
        const distance = isqrt(distance2);
        hero.x = target.x + idiv((hero.x - target.x) * reach, distance);
        hero.z = target.z + idiv((hero.z - target.z) * reach, distance);
        hero.movePath = [];
        hero.movePathIndex = 0;
        hero.pathDirty = 0;
      }
      strike(state, hero, target, ability);
    };
  } else if (slot === 1) {
    const target = findEntity(state, /** @type {number} */ (cmd.targetId));
    if (!Number.isSafeInteger(cmd.targetId) || !hittable(hero, target) || !target) return false;
    if (dist2(hero.x, hero.z, target.x, target.z) > range2) return false;
    apply = () => strike(state, hero, target, ability);
  } else if (slot === 2) {
    const { x, z } = cmd;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return false;
    const px = /** @type {number} */ (x);
    const pz = /** @type {number} */ (z);
    if (dist2(hero.x, hero.z, px, pz) > range2) return false;
    const radius2 = ability.radiusMilliTiles * ability.radiusMilliTiles;
    apply = () => {
      for (const target of state.entities) {
        if (isEnemy(hero, target) && dist2(px, pz, target.x, target.z) <= radius2) strike(state, hero, target, ability);
      }
    };
  } else {
    const target = findEntity(state, /** @type {number} */ (cmd.targetId));
    if (!Number.isSafeInteger(cmd.targetId) || !target || target.hp <= 0 || target.team !== hero.team) return false;
    const covered = target.kind === KIND.HERO || target.kind === KIND.CREEP || (target.kind >= KIND.SOLAR && target.kind <= KIND.TOWER);
    if (!covered || dist2(hero.x, hero.z, target.x, target.z) > range2) return false; // the Core takes no shield
    apply = () => {
      target.shieldHp = ability.absorb * MILLI;
      target.shieldTicks = ability.durationTicks;
    };
  }

  if (!spend(state, hero.team, ability.costLux)) return false;
  setCooldown(hero, slot, ability.cooldownTicks);
  apply();
  return true;
}
