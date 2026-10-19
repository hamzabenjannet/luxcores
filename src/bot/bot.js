// @ts-check
/**
 * MVP bot (GDD 12.1). It reads the world only through WorldView and emits
 * the same CommandEnvelopes a human produces. Its commands are recorded in
 * replays, so replays never depend on this code.
 *
 * What it does at M5: every second it picks the next hero of the roster when it can (half of
 * the Core's lux, at its newest barracks), otherwise spends settled lux in the GDD rotation
 * (collector, barracks, tower, creep group of 5), then upgrades its towers once the rotation is
 * full. Its groups walk the default lane route. Its hero attacks the nearest enemy in sight and
 * otherwise walks the lane toward the enemy Core, and the bot casts no abilities (GDD 12.1). A bot
 * never reads the enemy's hidden state, because WorldView offers none.
 *
 * Any randomness comes from the bot's own seeded RNG (rng.js), never
 * Math.random, so bot-vs-bot runs are reproducible.
 */

import { KIND, MILLI, ORDER_TYPE, buildZoneOf, createRng, laneRoute, nextInt } from '../sim/index.js';

/** Ticks between two decisions (1 s at 20 Hz). */
const THINK_EVERY = 20;
/** Ticks between two orders to the hero. It reacts faster than the economy. */
const HERO_EVERY = 10;
/** The hero moves on to the next lane vertex when it is this close, in units. */
const WAYPOINT_REACH = 1500;
/** Whole lux the bot keeps in the Core, so spending never leaves the Core empty. */
const RESERVE_LUX = 20;
/** The GDD 12.1 spending rotation. */
const ROTATION = /** @type {const} */ (['collector', 'barracks', 'tower', 'creeps']);
/** Collector types in build order; geothermal needs a free vent and falls back to solar. */
const COLLECTORS = /** @type {const} */ (['solar', 'wind', 'geothermal', 'solar']);
/** Tower attack types in build order. */
const ATTACKS = /** @type {const} */ (['ranged', 'area', 'melee']);
/** Most buildings of each rotation slot. The bot builds one barracks, and creeps have their own gate (see `creepsFor`). */
const CAP = { collector: 10, barracks: 1, tower: 8, creeps: Infinity };
/** Attack types of the 5 creeps of its groups; the first group is the mix the GDD suggests, the next ones rotate. */
const CREEP_MIX = /** @type {const} */ (['melee', 'melee', 'ranged', 'area', 'melee']);
/** The bot stops ordering while this many creeps are alive or queued, so held groups never pile up (cap is 30). */
const CREEP_LIMIT = 25;
/** Orders it keeps waiting per barracks. */
const QUEUE_LIMIT = 2;
const MAX_UPGRADE_LEVEL = 3;
/** Column centers in tiles (three columns of 32), where the towers go. */
const COLUMN_CENTERS = [16, 48, 80];

const COLLECTOR_KINDS = new Set([KIND.SOLAR, KIND.WIND, KIND.GEOTHERMAL, KIND.NUCLEAR]);

/**
 * @param {{ playerId: number, team: number, config: import('../sim/config.js').SimConfig, seed: number }} opts
 */
export function createBot({ playerId, team, config, seed }) {
  const rng = createRng((seed ^ Math.imul(playerId + 1, 0x9e3779b1)) >>> 0);
  // Every bot decides on the same ticks. A phase that depends on the player would give one side the first move.
  const phase = 0;
  const heroPhase = (phase + 3) % HERO_EVERY;
  const zone = buildZoneOf(config, team);
  let seq = 0;
  let rotation = 0;
  /** Index of the lane vertex the hero walks to. Part of the memory a checkpoint keeps. */
  let heroWp = 0;

  return {
    playerId,
    /**
     * Called once per tick before step().
     * @param {import('../shared/world-view.js').WorldView} view
     * @returns {import('../sim/commands.js').CommandEnvelope[]}
     */
    think(view) {
      /** @type {import('../sim/commands.js').CommandEnvelope[]} */
      const out = [];
      const tick = view.tick();
      if (tick % THINK_EVERY === phase) {
        const cmd = decide(view);
        if (cmd) out.push({ tick, playerId, seq: seq++, cmd });
      }
      if (tick % HERO_EVERY === heroPhase) {
        const cmd = steerHero(view);
        if (cmd) out.push({ tick, playerId, seq: seq++, cmd });
      }
      return out;
    },
    /** The bot's own memory as plain data, for a checkpoint. */
    saveState() {
      return { rng: rng.s, seq, rotation, heroWp };
    },
    /**
     * Restores what `saveState` returned.
     * @param {{ rng: number, seq: number, rotation: number, heroWp?: number }} saved
     */
    loadState(saved) {
      rng.s = saved.rng;
      seq = saved.seq;
      rotation = saved.rotation;
      heroWp = saved.heroWp ?? 0; // a checkpoint from before heroes has none
    },
  };

  /**
   * @param {import('../shared/world-view.js').WorldView} view
   * @returns {import('../sim/commands.js').Command | null}
   */
  function decide(view) {
    const budget = view.team(team).coreLux - RESERVE_LUX * MILLI;
    const orders = view.orders().filter((o) => o.owner === playerId);
    const mine = view.entities().filter((e) => e.owner === playerId && e.kind >= KIND.SOLAR && e.kind <= KIND.TOWER && e.recycle === 0);
    const count = {
      collector: mine.filter((e) => COLLECTOR_KINDS.has(e.kind)).length,
      barracks: mine.filter((e) => e.kind === KIND.BARRACKS).length,
      tower: mine.filter((e) => e.kind === KIND.TOWER).length,
      creeps: 0,
    };

    const pick = pickFor(view, mine, orders);
    if (pick) return pick;

    // The next open slot of the rotation; a full slot is skipped.
    for (let i = 0; i < ROTATION.length; i++) {
      const slot = ROTATION[(rotation + i) % ROTATION.length];
      if (count[slot] >= CAP[slot]) continue;
      const cmd = slot === 'creeps' ? creepsFor(view, mine, orders) : buildFor(view, slot, count[slot]);
      if (!cmd) continue;
      const cost = cmd.t === 'orderCreeps' ? cmd.mix.length * config.balance.creep.costLux : costOf(cmd.building);
      if (cost > budget) return null; // wait for income instead of skipping the slot
      rotation = (rotation + i + 1) % ROTATION.length;
      return cmd;
    }
    return upgradeFor(mine, budget);
  }

  /**
   * @param {import('../shared/world-view.js').WorldView} view
   * @param {'collector' | 'barracks' | 'tower'} slot
   * @param {number} owned
   * @returns {{ t: 'build', building: string, tileX: number, tileZ: number, attack?: string } | null}
   */
  function buildFor(view, slot, owned) {
    let building = 'barracks';
    let tile;
    if (slot === 'collector') {
      building = COLLECTORS[owned % COLLECTORS.length];
      if (building === 'geothermal') tile = freeVent(view);
      if (building === 'geothermal' && !tile) building = 'solar';
      tile ??= pickTile(view, 'near-core', owned);
    } else if (slot === 'barracks') {
      tile = pickTile(view, 'near-core', owned);
    } else {
      building = 'tower';
      tile = pickTile(view, 'front', owned);
    }
    if (!tile) return null;
    const cmd = { t: /** @type {const} */ ('build'), building, tileX: tile.x, tileZ: tile.z };
    return slot === 'tower' ? { ...cmd, attack: ATTACKS[owned % ATTACKS.length] } : cmd;
  }

  /**
   * A group of 5 at the newest barracks, unless the creep limit or the queue is full.
   * @param {import('../shared/world-view.js').WorldView} view
   * @param {readonly import('../sim/state.js').Entity[]} mine
   * @param {readonly import('../sim/state.js').Order[]} orders
   * @returns {import('../sim/commands.js').Command | null}
   */
  function creepsFor(view, mine, orders) {
    const barracks = mine.filter((e) => e.kind === KIND.BARRACKS).pop();
    if (!barracks) return null;
    const alive = view.entities().filter((e) => e.kind === KIND.CREEP && e.owner === playerId).length;
    const queued = orders.reduce((sum, o) => sum + o.mix.length, 0);
    if (alive + queued + CREEP_MIX.length > CREEP_LIMIT || orders.filter((o) => o.barracksId === barracks.id).length >= QUEUE_LIMIT) return null;
    const shift = orders.length + alive; // varies the mix a little from group to group, without randomness
    return { t: 'orderCreeps', barracksId: barracks.id, mix: CREEP_MIX.map((_, i) => CREEP_MIX[(i + shift) % CREEP_MIX.length]) };
  }

  /**
   * GDD 12.1 step 1: the next unlocked hero of the roster, with half of the Core's lux, at the newest
   * barracks. Nothing when a hero lives or waits in a queue, the death cooldown runs, or no barracks stands.
   * @param {import('../shared/world-view.js').WorldView} view
   * @param {readonly import('../sim/state.js').Entity[]} mine
   * @param {readonly import('../sim/state.js').Order[]} orders
   * @returns {import('../sim/commands.js').Command | null}
   */
  function pickFor(view, mine, orders) {
    const barracks = mine.filter((e) => e.kind === KIND.BARRACKS).pop();
    const me = view.players().find((p) => p.id === playerId);
    if (!barracks || !me || me.heroCooldown > 0) return null;
    if (view.entities().some((e) => e.kind === KIND.HERO && e.owner === playerId)) return null;
    if (orders.some((o) => o.type === ORDER_TYPE.hero)) return null;
    let heroId = 0;
    while (heroId < config.balance.hero.rosterSize && (me.heroLock & (1 << heroId)) !== 0) heroId++;
    if (heroId >= config.balance.hero.rosterSize) return null;
    const lux = Math.floor(view.team(team).coreLux / (2 * MILLI));
    if (lux < 1 || view.team(team).coreLux - lux * MILLI < config.balance.core.minLeftAfterSpendLux) return null;
    return { t: 'pickHero', heroId, lux, barracksId: barracks.id };
  }

  /**
   * GDD 12.1 step 2: the hero attacks the nearest enemy in sight, and without one walks the lane toward
   * the enemy Core, the Core itself being the last stop. It uses no abilities.
   * @param {import('../shared/world-view.js').WorldView} view
   * @returns {import('../sim/commands.js').Command | null}
   */
  function steerHero(view) {
    const hero = view.entities().find((e) => e.kind === KIND.HERO && e.owner === playerId);
    if (!hero) {
      heroWp = 0;
      return null;
    }
    const sight = config.balance.hero.sightTiles;
    let nearest;
    let nearestD = sight * sight + 1;
    for (const e of view.entities()) {
      if (e.hp <= 0 || e.team < 0 || e.team === team) continue;
      if (e.kind !== KIND.CORE && !(e.kind >= KIND.SOLAR && e.kind <= KIND.HERO)) continue; // not blockers or projectiles
      const d = (e.x - hero.x) * (e.x - hero.x) + (e.z - hero.z) * (e.z - hero.z);
      if (d < nearestD) {
        nearest = e;
        nearestD = d;
      }
    }
    if (nearest) return hero.targetId === nearest.id ? null : { t: 'heroAttack', targetId: nearest.id };

    const core = view.entities().find((e) => e.kind === KIND.CORE && e.team === team);
    const route = core ? laneRoute(/** @type {any} */ ({ map: view.map() }), team, core.x, core.z) : [];
    const taken = occupied(view);
    const width = view.map().width;
    while (heroWp < route.length) {
      const [wx, wz] = route[heroWp];
      const near = (wx - hero.x) * (wx - hero.x) + (wz - hero.z) * (wz - hero.z) <= WAYPOINT_REACH * WAYPOINT_REACH;
      // A vertex under a building (the lane starts at the Core) cannot be walked to, so the hero skips it.
      const blocked = taken.has(Math.floor(wz / 1000) * width + Math.floor(wx / 1000));
      if (!near && !blocked) break;
      heroWp++;
    }
    if (heroWp < route.length) {
      const [wx, wz] = route[heroWp];
      const sameGoal = hero.targetId === 0 && hero.moveTargetX === wx && hero.moveTargetZ === wz;
      const idle = hero.movePath.length === 0 && hero.pathDirty === 0;
      const away = (wx - hero.x) * (wx - hero.x) + (wz - hero.z) * (wz - hero.z) > 500 * 500;
      return sameGoal && !(idle && away) ? null : { t: 'heroMove', x: wx, z: wz };
    }
    const enemyCore = view.entities().find((e) => e.kind === KIND.CORE && e.team !== team);
    return enemyCore && hero.targetId !== enemyCore.id ? { t: 'heroAttack', targetId: enemyCore.id } : null;
  }

  /** @param {string} building */
  function costOf(building) {
    return config.buildings[/** @type {'solar'} */ (building)].costLux;
  }

  /**
   * Power first, then shell, on the tower with the fewest upgrades.
   * @param {readonly import('../sim/state.js').Entity[]} mine
   * @param {number} budget
   * @returns {import('../sim/commands.js').Command | null}
   */
  function upgradeFor(mine, budget) {
    let pick = null;
    for (const tower of mine) {
      if (tower.kind !== KIND.TOWER) continue;
      if (tower.powerLevel >= MAX_UPGRADE_LEVEL && tower.shellLevel >= MAX_UPGRADE_LEVEL) continue;
      if (!pick || tower.powerLevel + tower.shellLevel < pick.powerLevel + pick.shellLevel) pick = tower;
    }
    if (!pick) return null;
    const track = pick.powerLevel <= pick.shellLevel && pick.powerLevel < MAX_UPGRADE_LEVEL ? 'power' : 'shell';
    const level = track === 'power' ? pick.powerLevel : pick.shellLevel;
    const next = config.buildings.tower.upgrades[track][level];
    if (!next || next.costLux > budget) return null;
    return { t: 'upgrade', towerId: pick.id, track };
  }

  /**
   * A vent of the bot's team that no entity stands on.
   * @param {import('../shared/world-view.js').WorldView} view
   */
  function freeVent(view) {
    const taken = occupied(view);
    const width = view.map().width;
    const vent = view.map().vents.find((v) => v.team === team && !taken.has(v.tileZ * width + v.tileX));
    return vent ? { x: vent.tileX, z: vent.tileZ } : undefined;
  }

  /** @param {import('../shared/world-view.js').WorldView} view */
  function occupied(view) {
    const width = view.map().width;
    const taken = new Set();
    for (const e of view.entities()) {
      if (e.kind > KIND.BLOCKER) continue; // creeps, heroes and items do not block a tile
      taken.add(Math.floor(e.z / 1000) * width + Math.floor(e.x / 1000));
    }
    return taken;
  }

  /**
   * A free build-zone tile off the lanes, vents and item spawns. `near-core`
   * packs the base around the Core, `front` spreads towers along the border
   * facing the DMZ, one column after the other. The seeded RNG picks among the
   * three best tiles, so two bots with different seeds build differently.
   * @param {import('../shared/world-view.js').WorldView} view
   * @param {'near-core' | 'front'} where
   * @param {number} owned
   * @returns {{ x: number, z: number } | undefined}
   */
  function pickTile(view, where, owned) {
    const map = view.map();
    const width = map.width;
    const taken = occupied(view);
    for (const lane of map.lanes) if (lane.team === team) for (const i of lane.tiles) taken.add(i);
    for (const v of map.vents) taken.add(v.tileZ * width + v.tileX);
    for (const s of map.itemSpawns) taken.add(s.tileZ * width + s.tileX);

    const core = view.entities().find((e) => e.kind === KIND.CORE && e.team === team);
    const coreX = core ? Math.floor(core.x / 1000) : 48;
    const coreZ = core ? Math.floor(core.z / 1000) : 96;
    const frontZ = team === 0 ? zone.z0 : zone.z1;
    // The map is point-mirrored, so team 1 builds on the mirrored columns: its towers then guard its own side, as team 0's do.
    const columnX = team === 0 ? COLUMN_CENTERS[owned % COLUMN_CENTERS.length] : width - 1 - COLUMN_CENTERS[owned % COLUMN_CENTERS.length];

    /** @type {{ score: number, x: number, z: number }[]} */
    const best = [];
    // The scan order breaks ties between equal scores, and the map is point-mirrored, so team 1 scans in the
    // mirrored order: its picks are then the mirror images of team 0's.
    for (let zi = 0; zi <= zone.z1 - zone.z0; zi++) {
      const z = team === 0 ? zone.z0 + zi : zone.z1 - zi;
      for (let xi = 0; xi < width; xi++) {
        const x = team === 0 ? xi : width - 1 - xi;
        if (taken.has(z * width + x)) continue;
        if (Math.abs(x - coreX) <= 2 && Math.abs(z - coreZ) <= 2) continue; // keep the Core's surroundings open
        const score = where === 'front'
          ? 4 * (z - frontZ) * (z - frontZ) + (x - columnX) * (x - columnX)
          : (x - coreX) * (x - coreX) + (z - coreZ) * (z - coreZ);
        // Scan order is by z then x, so an equal score keeps the earlier tile.
        if (best.length < 3 || score < best[best.length - 1].score) {
          best.push({ score, x, z });
          best.sort((a, b) => a.score - b.score);
          if (best.length > 3) best.pop();
        }
      }
    }
    if (best.length === 0) return undefined;
    return best[nextInt(rng, best.length)];
  }
}
