// @ts-check
/**
 * Turns a `WorldView` into the small JSON object a language model reads.
 *
 * The model never sees sim state. It sees whole lux, whole tiles and seconds,
 * because a 3 billion parameter model handles those better than milli-lux and
 * ticks, and because the vocabulary in `actions.js` speaks the same units. The
 * object stays short on purpose: every field costs tokens on every turn.
 *
 * It reads the view the same way the scripted bot does, so an LLM bot learns
 * nothing a human player could not see.
 */

import { KIND, MILLI, ORDER_TYPE, UNITS_PER_TILE, buildZoneOf } from '../sim/index.js';

/** Enemy entities the observation lists, nearest to the player's Core first. */
const ENEMIES_SHOWN = 10;
/** Free tiles offered per spot, which the `build` action may use as its tile. */
const TILES_SHOWN = 3;
/** Entity kind name by code, for the model to read and write. */
export const KIND_NAMES = /** @type {Record<number, string>} */ ({
  [KIND.CORE]: 'core',
  [KIND.SOLAR]: 'solar',
  [KIND.WIND]: 'wind',
  [KIND.GEOTHERMAL]: 'geothermal',
  [KIND.NUCLEAR]: 'nuclear',
  [KIND.BARRACKS]: 'barracks',
  [KIND.TOWER]: 'tower',
  [KIND.BLOCKER]: 'blocker',
  [KIND.CREEP]: 'creep',
  [KIND.HERO]: 'hero',
  [KIND.GROUND_ITEM]: 'item',
  [KIND.LOOT_BAG]: 'bag',
});
/** Tower attack type by code (`ATTACK_CODE` in src/sim/buildings.js). */
const ATTACK_NAMES = /** @type {Record<number, string>} */ ({ 1: 'melee', 2: 'ranged', 3: 'area' });
/** The buildings a player may order, in the order the model sees them. */
export const BUILDINGS = /** @type {const} */ (['solar', 'wind', 'geothermal', 'nuclear', 'barracks', 'tower']);

/**
 * @typedef {Object} Observation
 * @property {number} tick
 * @property {number} second       seconds of match time
 * @property {number} team
 * @property {'day' | 'night'} phase
 * @property {number} coreLux      whole lux in the Core, which pays for everything
 * @property {number} pendingLux   whole lux still settling
 * @property {{ id: number, tile: number[], lux: number } | null} myCore
 * @property {{ id: number, tile: number[], lux: number } | null} enemyCore
 * @property {{ id: number, kind: string, tile: number[], lux: number, attack?: string, power?: number, shell?: number, recycling?: boolean }[]} myBuildings
 * @property {{ creeps: number, groups: { id: number, size: number }[] }} myArmy
 * @property {{ id: number, name: string, tile: number[], lux: number, readyAbilities: number[] } | null} myHero
 * @property {{ id: number, kind: string, tile: number[], lux: number }[]} enemies
 * @property {{ barracksId: number, what: string, secondsLeft: number }[]} queue
 * @property {{ canPick: boolean, nextHeroId: number | null, cooldownSeconds: number, barracksId: number | null }} heroPick
 * @property {Record<string, number>} costLux  whole lux per building, plus one creep
 * @property {{ base: number[][], front: number[][] }} freeTiles  tiles the build action may use
 */

/**
 * @param {import('../shared/world-view.js').WorldView} view
 * @param {{ playerId: number, team: number, config: import('../sim/config.js').SimConfig }} ctx
 * @returns {Observation}
 */
export function observe(view, { playerId, team, config }) {
  const tick = view.tick();
  const map = view.map();
  const balance = /** @type {any} */ (config).balance;
  const hpFactor = balance.hpFactor;
  const cycle = balance.dayNight.dayTicks + balance.dayNight.nightTicks;
  const entities = view.entities();
  const mine = entities.filter((e) => e.owner === playerId && e.hp > 0);
  const myCore = entities.find((e) => e.kind === KIND.CORE && e.team === team);
  const enemyCore = entities.find((e) => e.kind === KIND.CORE && e.team !== team && e.team >= 0);
  const hero = mine.find((e) => e.kind === KIND.HERO);
  const barracks = mine.filter((e) => e.kind === KIND.BARRACKS && e.recycle === 0);
  const groups = view.groups().filter((g) => g.owner === playerId);
  const creeps = mine.filter((e) => e.kind === KIND.CREEP);
  const me = view.players().find((p) => p.id === playerId);
  const roster = /** @type {any[]} */ (/** @type {any} */ (config).heroes?.roster ?? []);

  const anchor = myCore ?? mine[0];
  const enemies = entities
    .filter((e) => e.team >= 0 && e.team !== team && e.hp > 0 && (e.kind === KIND.CORE || (e.kind >= KIND.SOLAR && e.kind <= KIND.HERO)))
    .map((e) => ({ e, d: anchor ? sqDistance(e, anchor) : 0 }))
    .sort((a, b) => a.d - b.d || a.e.id - b.e.id)
    .slice(0, ENEMIES_SHOWN)
    .map(({ e }) => ({ id: e.id, kind: KIND_NAMES[e.kind] ?? String(e.kind), tile: tileOf(e), lux: luxOf(e, hpFactor) }));

  let nextHeroId = null;
  if (me) {
    for (let id = 0; id < balance.hero.rosterSize; id++) {
      if ((me.heroLock & (1 << id)) === 0) {
        nextHeroId = id;
        break;
      }
    }
  }

  return {
    tick,
    second: Math.floor(tick / 20),
    team,
    phase: tick % cycle < balance.dayNight.dayTicks ? 'day' : 'night',
    coreLux: Math.floor(view.team(team).coreLux / MILLI),
    pendingLux: Math.floor(view.team(team).pendingLux / MILLI),
    myCore: myCore ? { id: myCore.id, tile: tileOf(myCore), lux: luxOf(myCore, hpFactor) } : null,
    enemyCore: enemyCore ? { id: enemyCore.id, tile: tileOf(enemyCore), lux: luxOf(enemyCore, hpFactor) } : null,
    myBuildings: mine
      .filter((e) => e.kind >= KIND.SOLAR && e.kind <= KIND.TOWER)
      .map((e) => ({
        id: e.id,
        kind: KIND_NAMES[e.kind] ?? String(e.kind),
        tile: tileOf(e),
        lux: luxOf(e, hpFactor),
        ...(e.kind === KIND.TOWER ? { attack: ATTACK_NAMES[e.attack] ?? 'ranged', power: e.powerLevel, shell: e.shellLevel } : {}),
        ...(e.recycle > 0 ? { recycling: true } : {}),
      })),
    myArmy: {
      creeps: creeps.length,
      groups: groups.map((g) => ({ id: g.id, size: creeps.filter((c) => c.groupId === g.id).length })),
    },
    myHero: hero
      ? {
          id: hero.id,
          name: String(roster[hero.heroType - 1]?.name ?? 'Hero'),
          tile: tileOf(hero),
          lux: luxOf(hero, hpFactor),
          readyAbilities: [hero.cd0, hero.cd1, hero.cd2, hero.cd3].flatMap((cd, slot) => (cd === 0 ? [slot] : [])),
        }
      : null,
    enemies,
    queue: view
      .orders()
      .filter((o) => o.owner === playerId)
      .map((o) => ({ barracksId: o.barracksId, what: orderName(o), secondsLeft: Math.ceil(o.ticksLeft / 20) })),
    heroPick: {
      canPick: Boolean(me) && (me?.heroCooldown ?? 1) === 0 && !hero && barracks.length > 0 && nextHeroId !== null,
      nextHeroId,
      cooldownSeconds: Math.ceil((me?.heroCooldown ?? 0) / 20),
      barracksId: barracks.length > 0 ? barracks[barracks.length - 1].id : null,
    },
    // Whole lux, as the model reads and writes everywhere. The config holds milli-lux.
    costLux: {
      ...Object.fromEntries(BUILDINGS.map((b) => [b, Math.floor(/** @type {any} */ (config).buildings[b].costLux / MILLI)])),
      creep: Math.floor(balance.creep.costLux / MILLI),
    },
    freeTiles: freeTiles(view, { team, config, core: myCore, map }),
  };
}

/**
 * Free build-zone tiles the model may build on: `base` around the Core and
 * `front` along the border facing the enemy. The lanes, the vents and the item
 * spawns stay out, so a suggested tile is one the sim accepts.
 * @param {import('../shared/world-view.js').WorldView} view
 * @param {{ team: number, config: import('../sim/config.js').SimConfig, core: import('../sim/state.js').Entity | undefined, map: import('../sim/state.js').StaticMap }} ctx
 * @returns {{ base: number[][], front: number[][] }}
 */
export function freeTiles(view, { team, config, core, map }) {
  const zone = buildZoneOf(config, team);
  const width = map.width;
  const taken = new Set();
  for (const e of view.entities()) {
    if (e.kind > KIND.BLOCKER || e.hp <= 0) continue;
    taken.add(Math.floor(e.z / UNITS_PER_TILE) * width + Math.floor(e.x / UNITS_PER_TILE));
  }
  for (const lane of map.lanes) if (lane.team === team) for (const i of lane.tiles) taken.add(i);
  for (const v of map.vents) taken.add(v.tileZ * width + v.tileX);
  for (const s of map.itemSpawns) taken.add(s.tileZ * width + s.tileX);
  const coreX = core ? Math.floor(core.x / UNITS_PER_TILE) : Math.floor(width / 2);
  const coreZ = core ? Math.floor(core.z / UNITS_PER_TILE) : Math.floor(map.height / 2);
  const frontZ = team === 0 ? zone.z1 : zone.z0;

  /** @type {{ score: number, tile: number[] }[]} */
  const base = [];
  /** @type {{ score: number, tile: number[] }[]} */
  const front = [];
  for (let z = zone.z0; z <= zone.z1; z++) {
    for (let x = 0; x < width; x++) {
      if (taken.has(z * width + x)) continue;
      if (Math.abs(x - coreX) <= 1 && Math.abs(z - coreZ) <= 1) continue; // the Core keeps its own ring open
      keep(base, (x - coreX) * (x - coreX) + (z - coreZ) * (z - coreZ), [x, z]);
      keep(front, 4 * (z - frontZ) * (z - frontZ) + (x - coreX) * (x - coreX), [x, z]);
    }
  }
  return { base: base.map((b) => b.tile), front: front.map((f) => f.tile) };
}

/**
 * @param {{ score: number, tile: number[] }[]} list
 * @param {number} score
 * @param {number[]} tile
 */
function keep(list, score, tile) {
  if (list.length >= TILES_SHOWN && score >= list[list.length - 1].score) return;
  list.push({ score, tile });
  list.sort((a, b) => a.score - b.score);
  if (list.length > TILES_SHOWN) list.pop();
}

/** @param {import('../sim/state.js').Order} order */
function orderName(order) {
  if (order.type === ORDER_TYPE.hero) return `hero ${order.mix[0]}`;
  if (order.type === ORDER_TYPE.item) return `item ${order.mix[0]}`;
  return `${order.mix.length} creeps`;
}

/**
 * @param {{ kind: number, hp: number }} e
 * @param {{ core: number, default: number }} hpFactor
 */
function luxOf(e, hpFactor) {
  const factor = e.kind === KIND.CORE ? hpFactor.core : hpFactor.default;
  return Math.floor(e.hp / (factor * MILLI));
}

/** @param {{ x: number, z: number }} e */
function tileOf(e) {
  return [Math.floor(e.x / UNITS_PER_TILE), Math.floor(e.z / UNITS_PER_TILE)];
}

/** @param {{ x: number, z: number }} a @param {{ x: number, z: number }} b */
function sqDistance(a, b) {
  return (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);
}
