// @ts-check
/**
 * System: meltdown (pipeline step 13)
 * A team that spends nothing for `noSpendTicks` while it owns nuclear plants
 * loses them all. Each plant is destroyed and deals `damagePctOfMaxHp` percent
 * of its max HP to everything within `radiusTiles`, on both teams. GDD 4.
 *
 * Damage is dealt here and deaths are processed by the cleanup system, so plants
 * that stand next to each other all explode, and two Cores that die on the same
 * tick are a draw.
 */

import { dist2, idiv } from '../fixed.js';
import { damageCore } from '../lux.js';
import { isBuildingKind } from '../buildings.js';
import { KIND } from '../state.js';

/**
 * Entities that an explosion hurts: Cores, buildings, creeps and heroes. Neutral
 * blockers, items and projectiles are not hurt.
 * @param {number} kind
 */
function hurtByExplosion(kind) {
  return kind === KIND.CORE || isBuildingKind(kind) || kind === KIND.CREEP || kind === KIND.HERO;
}

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const { noSpendTicks, damagePctOfMaxHp, radiusTiles } = state.config.balance.meltdown;
  const reach2 = radiusTiles * radiusTiles;

  /** @type {import('../state.js').Entity[]} */
  const plants = [];
  for (const e of state.entities) {
    if (e.kind === KIND.NUCLEAR && state.teams[e.team].ticksSinceSpend >= noSpendTicks) plants.push(e);
  }
  if (plants.length === 0) return;

  // Every plant hits whatever stands near it, including the other plants. All hits
  // use the HP the plants had when the meltdown began.
  const hits = plants.map((p) => ({ x: p.x, z: p.z, damage: idiv(p.maxHp * damagePctOfMaxHp, 100) }));
  for (const h of hits) {
    for (const e of state.entities) {
      if (!hurtByExplosion(e.kind) || dist2(e.x, e.z, h.x, h.z) > reach2) continue;
      if (e.kind === KIND.CORE) damageCore(state, e.team, h.damage);
      else e.hp = Math.max(0, e.hp - h.damage);
    }
  }
  for (const p of plants) p.hp = 0;
}
