// @ts-check
/**
 * MVP bot (GDD 12.1). It reads the world only through WorldView and emits
 * the same CommandEnvelopes a human produces. Its commands are recorded in
 * replays, so replays never depend on this code.
 *
 * What it does at M3: every second it spends settled lux in the GDD rotation
 * (collector, barracks, tower), then upgrades its towers once the rotation is
 * full. Creep groups and heroes arrive with M4 and M5, and so do the rest of
 * GDD 12.1. A bot never reads the enemy's hidden state, because WorldView
 * offers none.
 *
 * Any randomness comes from the bot's own seeded RNG (rng.js), never
 * Math.random, so bot-vs-bot runs are reproducible.
 */

import { KIND, MILLI, buildZoneOf, createRng, nextInt } from '../sim/index.js';

/** Ticks between two decisions (1 s at 20 Hz). */
const THINK_EVERY = 20;
/** Whole lux the bot keeps in the Core, so spending never leaves the Core empty. */
const RESERVE_LUX = 20;
/** The GDD 12.1 spending rotation. */
const ROTATION = /** @type {const} */ (['collector', 'barracks', 'tower']);
/** Collector types in build order; geothermal needs a free vent and falls back to solar. */
const COLLECTORS = /** @type {const} */ (['solar', 'wind', 'geothermal', 'solar']);
/** Tower attack types in build order. */
const ATTACKS = /** @type {const} */ (['ranged', 'area', 'melee']);
/** Most buildings of each rotation slot. A barracks does nothing before M4, so the bot builds one. */
const CAP = { collector: 10, barracks: 1, tower: 8 };
const MAX_UPGRADE_LEVEL = 3;
/** Column centers in tiles (three columns of 32), where the towers go. */
const COLUMN_CENTERS = [16, 48, 80];

const COLLECTOR_KINDS = new Set([KIND.SOLAR, KIND.WIND, KIND.GEOTHERMAL, KIND.NUCLEAR]);

/**
 * @param {{ playerId: number, team: number, config: import('../sim/config.js').SimConfig, seed: number }} opts
 */
export function createBot({ playerId, team, config, seed }) {
  const rng = createRng((seed ^ Math.imul(playerId + 1, 0x9e3779b1)) >>> 0);
  // Two bots with different phases do not act on the same tick.
  const phase = (playerId * 7) % THINK_EVERY;
  const zone = buildZoneOf(config, team);
  let seq = 0;
  let rotation = 0;

  return {
    playerId,
    /**
     * Called once per tick before step().
     * @param {import('../shared/world-view.js').WorldView} view
     * @returns {import('../sim/commands.js').CommandEnvelope[]}
     */
    think(view) {
      if (view.tick() % THINK_EVERY !== phase) return [];
      const cmd = decide(view);
      return cmd ? [{ tick: view.tick(), playerId, seq: seq++, cmd }] : [];
    },
  };

  /**
   * @param {import('../shared/world-view.js').WorldView} view
   * @returns {import('../sim/commands.js').Command | null}
   */
  function decide(view) {
    const budget = view.team(team).coreLux - RESERVE_LUX * MILLI;
    const mine = view.entities().filter((e) => e.owner === playerId && e.kind >= KIND.SOLAR && e.kind <= KIND.TOWER && e.recycle === 0);
    const count = {
      collector: mine.filter((e) => COLLECTOR_KINDS.has(e.kind)).length,
      barracks: mine.filter((e) => e.kind === KIND.BARRACKS).length,
      tower: mine.filter((e) => e.kind === KIND.TOWER).length,
    };

    // The next open slot of the rotation; a full slot is skipped.
    for (let i = 0; i < ROTATION.length; i++) {
      const slot = ROTATION[(rotation + i) % ROTATION.length];
      if (count[slot] >= CAP[slot]) continue;
      const cmd = buildFor(view, slot, count[slot]);
      if (!cmd) continue;
      if (costOf(cmd.building) > budget) return null; // wait for income instead of skipping the slot
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
    const columnX = COLUMN_CENTERS[owned % COLUMN_CENTERS.length];

    /** @type {{ score: number, x: number, z: number }[]} */
    const best = [];
    for (let z = zone.z0; z <= zone.z1; z++) {
      for (let x = 0; x < width; x++) {
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
