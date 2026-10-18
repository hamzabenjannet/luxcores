// @ts-check
/**
 * System: combat
 * Scope: tower, hero and creep basic attacks, simultaneous damage, attack procs and the Energy Grab funnel. GDD 3.5, 5.0, 7.4, 8.2, 9
 * Milestone: M3, M4 (creeps), M6 (funnel)
 */

import { chancePct } from '../rng.js';
import { dist2, idiv, isqrt, MILLI, TICK_HZ, UNITS_PER_TILE } from '../fixed.js';
import { creditDrain, dealDamage } from '../damage.js';
import { addPending } from '../lux.js';
import { KIND, findEntity, spawnEntity } from '../state.js';
import { meleeReach } from '../reach.js';
import { towerCanTarget } from './behavior.js';

const TYPE_NAMES = ['', 'melee', 'ranged', 'area'];
const PROC_CODE = Object.freeze({ none: 0, stun: 1, knockback: 2 });

/**
 * `heroAttack` command. Heroes can attack enemy units/buildings and neutral blockers.
 * @param {import('../state.js').SimState} state
 * @param {number} playerId
 * @param {{ targetId?: unknown }} cmd
 */
export function tryHeroAttack(state, playerId, cmd) {
  if (!Number.isSafeInteger(cmd.targetId)) return false;
  const hero = state.entities.find((e) => e.kind === KIND.HERO && e.owner === playerId);
  const target = findEntity(state, /** @type {number} */ (cmd.targetId));
  if (!hero || !target || target.id === hero.id || target.hp <= 0) return false;
  if (target.kind !== KIND.BLOCKER && (
    target.team < 0 || target.team === hero.team || !isAttackable(target.kind)
  )) return false;
  hero.movePath = [];
  hero.movePathIndex = 0;
  hero.pathDirty = 0;
  if (target.kind === KIND.BLOCKER) {
    hero.targetId = target.id;
    return true;
  }
  hero.targetId = target.id;
  return true;
}

/** @param {number} kind */
export function isAttackable(kind) {
  return kind === KIND.CORE || (kind >= KIND.SOLAR && kind <= KIND.HERO);
}

/** @param {import('../sim/state.js').Entity} entity */
function attackType(entity) {
  return TYPE_NAMES[entity.attack] ?? '';
}

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const { balance } = state.config;
  /** @type {{ source: import('../state.js').Entity, target: import('../state.js').Entity, damage: number, proc: string, procChance: number, procValue: number }[]} */
  const hits = [];
  const readyHeroes = [];

  for (const entity of state.entities) {
    if (entity.stunTicks > 0 && entity.kind !== KIND.HERO && entity.kind !== KIND.TOWER) entity.stunTicks--;
  }

  for (const projectile of state.entities) {
    if (projectile.kind !== KIND.PROJECTILE || projectile.arrivalTick > state.tick) continue;
    const target = findEntity(state, projectile.targetId);
    if (target && target.hp > 0 && isProjectileTarget(projectile, target)) {
      appendHit(
        hits,
        projectile,
        target,
        projectile.projectileDamage,
        projectile.projectileProc === PROC_CODE.stun ? 'stun' : projectile.projectileProc === PROC_CODE.knockback ? 'knockback' : 'none',
        projectile.projectileProcChance,
        projectile.projectileProcValue,
      );
    }
    projectile.hp = 0;
  }

  // Heroes and creeps attack alike, with their own damage and speed. A creep never attacks a neutral
  // blocker, and its stun timer already ran down in the first loop of this system.
  for (const attacker of state.entities) {
    const isHero = attacker.kind === KIND.HERO;
    if (!isHero && attacker.kind !== KIND.CREEP) continue;
    if (attacker.stunTicks > 0) {
      if (isHero) attacker.stunTicks--;
      continue;
    }
    if (attacker.attackCooldown > 0) {
      attacker.attackCooldown--;
      continue;
    }
    const target = findEntity(state, attacker.targetId);
    const type = attackType(attacker);
    if (!target || !type || !(isHero ? isHeroTarget(attacker, target) : isEnemy(attacker, target))) continue;
    const stats = isHero ? balance.hero : balance.creep;
    const rules = balance.attackTypes[type];
    const range = rules.reachTiles > 0 ? rules.reachTiles : meleeReach(state, target);
    if (dist2(attacker.x, attacker.z, target.x, target.z) > range * range) continue;
    attacker.attackCooldown = attackInterval(stats.attackSpeed + speedChange(attacker)) - 1;
    const damage = idiv(stats.damagePerHit * MILLI * rules.damagePct, 100);
    dispatchAttack(state, hits, attacker, target, damage, rules);
    if (isHero) readyHeroes.push({ attacker, target });
    if (type === 'area') addSplashHits(state, hits, attacker, target, damage, rules.splashMilliTiles);
  }

  // A tower reacts when it can reach the attacking hero.
  for (const { attacker, target } of readyHeroes) alertTowers(state, attacker, target);

  for (const tower of state.entities) {
    if (tower.kind !== KIND.TOWER || tower.stunTicks > 0) {
      if (tower.stunTicks > 0) tower.stunTicks--;
      continue;
    }
    if (tower.attackCooldown > 0) {
      tower.attackCooldown--;
      continue;
    }
    const target = findEntity(state, tower.targetId);
    if (!target || !towerCanTarget(tower, target, state.config.buildings.tower.rangeTiles)) continue;
    const type = attackType(tower);
    if (!type) continue;
    const rules = balance.attackTypes[type];
    tower.attackCooldown = attackInterval(state.config.buildings.tower.attackSpeed + speedChange(tower)) - 1;
    const baseDamage = idiv(state.config.buildings.tower.damagePerHit * MILLI * rules.damagePct, 100);
    const damage = idiv(baseDamage * (100 + tower.powerDamagePct), 100);
    dispatchAttack(state, hits, tower, target, damage, rules);
    if (type === 'area') addSplashHits(state, hits, tower, target, damage, rules.splashMilliTiles);
  }

  /** @type {number[]} */
  const damageById = [];
  /** Who is owed what a hit removed: the team that drains it and, for Energy Grab, the player that funnels it. */
  /** @type {{ targetId: number, team: number, owner: number, damage: number, funnel: boolean }[]} */
  const credits = [];
  for (const hit of hits) {
    damageById[hit.target.id] = (damageById[hit.target.id] ?? 0) + hit.damage;
    if (hit.target.team >= 0 && hit.target.team !== hit.source.team) {
      credits.push({ targetId: hit.target.id, team: hit.source.team, owner: hit.source.owner, damage: hit.damage, funnel: isFunnelHit(hit) });
    }
    if (hit.procChance > 0 && chancePct(state.rng, hit.procChance)) {
      if (hit.proc === 'stun') hit.target.stunTicks = Math.max(hit.target.stunTicks, hit.procValue);
      else if (hit.proc === 'knockback') applyKnockback(hit.source, hit.target, hit.procValue);
    }
  }
  for (const target of state.entities) {
    const damage = damageById[target.id] ?? 0;
    if (damage === 0) continue;
    const removed = dealDamage(state, target, damage);
    if (credits.length > 0) settle(state, target, removed, damage, credits);
  }
}

/**
 * Shares the HP that a target lost among the hits that aimed at it. Each source team counts its share as
 * drained lux (GDD 13.2). Energy Grab (GDD 3.5, 8.2) also turns a hero's share into lux in the owner's
 * pending pool, at the HP factor of the target, until the item's budget runs out.
 * @param {import('../state.js').SimState} state
 * @param {import('../state.js').Entity} target
 * @param {number} removed milli-HP the target lost this tick, after shields
 * @param {number} total milli-HP of damage aimed at the target this tick
 * @param {{ targetId: number, team: number, owner: number, damage: number, funnel: boolean }[]} credits
 */
function settle(state, target, removed, total, credits) {
  if (removed <= 0) return;
  const { hpFactor } = state.config.balance;
  const factor = target.kind === KIND.CORE ? hpFactor.core : hpFactor.default;
  for (const c of credits) {
    if (c.targetId !== target.id) continue;
    const share = idiv(removed * c.damage, total);
    creditDrain(state, c.team, target, share);
    if (!c.funnel) continue;
    const player = state.players.find((p) => p.id === c.owner);
    if (!player || player.funnelLux <= 0) continue;
    const lux = Math.min(idiv(share, factor), player.funnelLux);
    player.funnelLux -= lux;
    state.teams[player.team].statFunneled += lux;
    addPending(state, player.team, lux);
  }
}

/**
 * Whether a hit comes from a hero's basic attack on an enemy: the hero itself, its splash, or a
 * projectile it fired (a projectile carries its shooter's `heroType`).
 * @param {{ source: import('../state.js').Entity, target: import('../state.js').Entity }} hit
 */
function isFunnelHit(hit) {
  const { source, target } = hit;
  if (target.team < 0 || target.team === source.team) return false;
  return source.kind === KIND.HERO || (source.kind === KIND.PROJECTILE && source.heroType > 0);
}

/**
 * Attack speed an item adds to the entity while its effect runs (GDD 8.2).
 * @param {import('../state.js').Entity} entity
 */
function speedChange(entity) {
  return entity.speedTicks > 0 ? entity.speedMod : 0;
}

/**
 * GDD 5.0 override: when a hero attacks a friendly hero, the defending team's towers in reach of the
 * attacker switch to it for a few seconds. A no-op for any other target.
 * @param {import('../state.js').SimState} state
 * @param {import('../state.js').Entity} attacker
 * @param {import('../state.js').Entity} target
 */
export function alertTowers(state, attacker, target) {
  if (target.kind !== KIND.HERO) return;
  const overrideTicks = state.config.balance.tower.targetOverrideTicks;
  const range = state.config.buildings.tower.rangeTiles;
  for (const tower of state.entities) {
    if (tower.kind !== KIND.TOWER || tower.team !== target.team) continue;
    if (dist2(tower.x, tower.z, attacker.x, attacker.z) > range * range) continue;
    tower.overrideTargetId = attacker.id;
    tower.overrideTicks = overrideTicks;
    tower.targetId = attacker.id;
  }
}

/**
 * @param {import('../state.js').Entity} hero
 * @param {import('../state.js').Entity} target
 */
function isHeroTarget(hero, target) {
  return target.id !== hero.id && target.hp > 0 && (
    target.kind === KIND.BLOCKER
    || (target.team >= 0 && target.team !== hero.team && isAttackable(target.kind))
  );
}

/**
 * @param {import('../state.js').Entity} projectile
 * @param {import('../state.js').Entity} target
 */
function isProjectileTarget(projectile, target) {
  return target.kind === KIND.BLOCKER || (
    target.team >= 0 && target.team !== projectile.team && isAttackable(target.kind)
  );
}

/**
 * @param {import('../state.js').SimState} state
 * @param {{ source: import('../state.js').Entity, target: import('../state.js').Entity, damage: number, proc: string, procChance: number, procValue: number }[]} hits
 * @param {import('../state.js').Entity} source
 * @param {import('../state.js').Entity} target
 * @param {number} damage
 * @param {{ projectileFlightTicks?: number, proc: string, procPct: number, stunTicks?: number, knockbackMilliTiles?: number }} rules
 */
function dispatchAttack(state, hits, source, target, damage, rules) {
  const procValue = rules.stunTicks ?? rules.knockbackMilliTiles ?? 0;
  if (!rules.projectileFlightTicks) {
    appendHit(hits, source, target, damage, rules.proc, rules.procPct, procValue);
    return;
  }
  spawnProjectile(state, source, target, damage, rules);
}

/**
 * @param {import('../state.js').SimState} state
 * @param {import('../state.js').Entity} source
 * @param {import('../state.js').Entity} target
 * @param {number} damage
 * @param {{ projectileFlightTicks: number, proc: string, procPct: number, stunTicks?: number, knockbackMilliTiles?: number }} rules
 */
function spawnProjectile(state, source, target, damage, rules) {
  spawnEntity(state, {
    kind: KIND.PROJECTILE,
    team: source.team,
    owner: source.owner,
    x: source.x,
    z: source.z,
    hp: 1,
    maxHp: 1,
    targetId: target.id,
    arrivalTick: state.tick + rules.projectileFlightTicks,
    projectileDamage: damage,
    projectileProc: PROC_CODE[/** @type {keyof typeof PROC_CODE} */ (rules.proc)] ?? PROC_CODE.none,
    projectileProcChance: rules.procPct,
    projectileProcValue: rules.stunTicks ?? rules.knockbackMilliTiles ?? 0,
    heroType: source.kind === KIND.HERO ? source.heroType : 0,
  });
}

/** @param {number} attackSpeed */
function attackInterval(attackSpeed) {
  return Math.max(1, idiv(TICK_HZ * 100, Math.max(attackSpeed, 20)));
}

/**
 * @param {{ source: import('../state.js').Entity, target: import('../state.js').Entity, damage: number, proc: string, procChance: number, procValue: number }[]} hits
 * @param {import('../state.js').Entity} source
 * @param {import('../state.js').Entity} target
 * @param {number} damage
 * @param {string} proc
 * @param {number} procChance
 * @param {number} procValue
 */
function appendHit(hits, source, target, damage, proc, procChance, procValue) {
  hits.push({ source, target, damage, proc, procChance, procValue });
}

/**
 * @param {import('../state.js').SimState} state
 * @param {{ source: import('../state.js').Entity, target: import('../state.js').Entity, damage: number, proc: string, procChance: number, procValue: number }[]} hits
 * @param {import('../state.js').Entity} attacker
 * @param {import('../state.js').Entity} primary
 * @param {number} damage
 * @param {number} radius
 */
function addSplashHits(state, hits, attacker, primary, damage, radius) {
  const radius2 = radius * radius;
  for (const target of state.entities) {
    if (target.id === primary.id || !isEnemy(attacker, target)) continue;
    if (dist2(primary.x, primary.z, target.x, target.z) <= radius2) {
      appendHit(hits, attacker, target, damage, 'none', 0, 0);
    }
  }
}

/**
 * @param {import('../state.js').Entity} source
 * @param {import('../state.js').Entity} target
 */
export function isEnemy(source, target) {
  return target.hp > 0 && target.team >= 0 && target.team !== source.team && isAttackable(target.kind);
}

/**
 * @param {import('../state.js').Entity} source
 * @param {import('../state.js').Entity} target
 * @param {number} strength
 */
function applyKnockback(source, target, strength) {
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  const length = Math.max(1, isqrt(dx * dx + dz * dz));
  target.impulseX = idiv(dx * strength, length);
  target.impulseZ = idiv(dz * strength, length);
  target.impulseTicks = 5;
}
