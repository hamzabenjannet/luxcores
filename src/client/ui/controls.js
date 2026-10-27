// @ts-check
/**
 * Player controls of the web client: a build palette, a panel for the selected
 * building (recycle, tower upgrades, creep orders and queue), creep groups (path,
 * merge, split) and hero orders. Every action becomes a
 * command for the server; the UI only pre-checks the obvious refusals so the
 * player gets instant feedback. The sim result is final (CLAUDE.md, Client Rules).
 *
 * The pure helpers at the top carry the decisions and are unit-tested in Node.
 * `createControls` below only builds the DOM and forwards taps to them.
 */

import { KIND, MILLI, UNITS_PER_TILE, buildZoneOf } from '../../sim/index.js';
import { ATTACK_NAMES, entityText } from '../entity-text.js';
import { holdAimPhase, holdAimRelease } from '../input/gestures.js';
import { actionForKey, defaultKeyBindings, keyLabel, normalizeKeyBindings, KEY_BINDINGS_STORAGE_KEY } from '../input/key-bindings.js';
import { HERO_ORDER, orderLabel, orderWait, secondsText } from './order-log.js';
import { createOrderWindow } from './order-window.js';

/** The palette, in display order. `key` is the building name in data/buildings.json. */
export const PALETTE = /** @type {const} */ ([
  { key: 'solar', label: 'Solar' },
  { key: 'wind', label: 'Wind' },
  { key: 'geothermal', label: 'Geothermal' },
  { key: 'nuclear', label: 'Nuclear' },
  { key: 'barracks', label: 'Barracks' },
  { key: 'tower', label: 'Tower' },
]);

/** Tower attack types in the order of the selector. */
export const ATTACK_TYPES = /** @type {const} */ (['melee', 'ranged', 'area']);

/** Attack choices of a creep order; Mixed cycles melee, ranged, area. */
export const ORDER_TYPES = /** @type {const} */ (['melee', 'ranged', 'area', 'mixed']);

/** How long a dim queue row waits for the snapshot after the server accepted the order, in milliseconds. */
export const PENDING_MS = 3000;

/** How close a tap must land to an entity to pick it, in tiles. */
const PICK_RADIUS_TILES = 1.0;

const BUILDING_KINDS = new Set([KIND.SOLAR, KIND.WIND, KIND.GEOTHERMAL, KIND.NUCLEAR, KIND.BARRACKS, KIND.TOWER]);

/**
 * Whether the Core can pay `costLux` and still keep its minimum (GDD 3.4).
 * @param {number} coreLuxMilli
 * @param {number} costLux whole lux
 * @param {number} minLeftLux whole lux
 */
export function canAfford(coreLuxMilli, costLux, minLeftLux) {
  return coreLuxMilli - costLux * MILLI >= minLeftLux * MILLI;
}

/**
 * The attack types of a creep order. A uniform order repeats one type; Mixed cycles melee, ranged, area.
 * @param {number} count 1 to 5
 * @param {string} type one of ORDER_TYPES
 * @returns {string[]}
 */
export function mixFor(count, type) {
  const cycle = ['melee', 'ranged', 'area'];
  return Array.from({ length: count }, (_, i) => (type === 'mixed' ? cycle[i % cycle.length] : type));
}

export { secondsText };

/**
 * The lines of a barracks queue, in queue order. A held group shows HELD; others show seconds left.
 * A hero pick shows the hero's name and the lux allocated to it, and an item shows its name and HELD
 * while it waits for a hero or a free slot.
 * @param {readonly import('../../sim/state.js').Order[]} orders
 * @param {number} barracksId
 * @param {number} tickHz
 * @param {readonly string[]} [heroNames] roster names in roster order
 * @param {readonly string[]} [itemNames] item names by item id
 * @returns {{ index: number, orderId: number, text: string }[]}
 */
export function queueLines(orders, barracksId, tickHz, heroNames = [], itemNames = []) {
  return orders.filter((o) => o.barracksId === barracksId).map((o, index) => ({
    index,
    orderId: o.id,
    text: `${orderLabel(o, heroNames, itemNames)} ${orderWait(o, tickHz)}`,
  }));
}

/**
 * The queue text of an order the player just sent, shown before the server's snapshot has it.
 * Returns an empty string for a command that does not enter a barracks queue.
 * @param {{ t: string, mix?: string[], heroId?: number, lux?: number, itemId?: number }} command
 * @param {readonly string[]} [heroNames] roster names in roster order
 * @param {readonly string[]} [itemNames] item names by item id
 */
export function pendingLine(command, heroNames = [], itemNames = []) {
  if (command.t === 'orderCreeps' && command.mix) return `Group of ${command.mix.length} ${command.mix.map((c) => c.charAt(0).toUpperCase()).join('')} ...`;
  if (command.t === 'pickHero') return `Hero ${heroNames[command.heroId ?? -1] ?? '?'} ${command.lux} lux ...`;
  if (command.t === 'orderItem') return `Item ${itemNames[command.itemId ?? -1] ?? '?'} ...`;
  return '';
}

/**
 * Whether a dim queue row stays. It goes when its time ran out or when the barracks has more real orders
 * than the row counted when it was added (`base`), because the snapshot then holds the order.
 * @param {number} base
 * @param {number} expires  milliseconds on the clock of `now`; Infinity until the server has answered
 * @param {number} realCount
 * @param {number} now
 */
export function pendingKept(base, expires, realCount, now) {
  return expires > now && realCount <= base;
}

/** The four abilities in slot order: the type in data/abilities.json, its letter and how it is aimed. */
export const ABILITY_SLOTS = /** @type {const} */ ([
  { slot: 0, type: 'melee', letter: 'M', aim: 'none' },
  { slot: 1, type: 'ranged', letter: 'R', aim: 'target' },
  { slot: 2, type: 'area', letter: 'A', aim: 'point' },
  { slot: 3, type: 'shield', letter: 'S', aim: 'none' },
]);

/**
 * The ability buttons of the hero bar. `ready` is false while the cooldown runs, `poor` when the Core
 * could not pay and keep its minimum. Melee strikes the current target and shield covers the hero,
 * so neither needs a second tap; ranged takes a target and area a point.
 * @param {{ cd0: number, cd1: number, cd2: number, cd3: number }} hero
 * @param {{ templates: Record<string, { costLux: number }> }} abilities data/abilities.json
 * @param {number} coreLuxMilli
 * @param {number} minLeftLux whole lux
 * @param {number} tickHz
 * @returns {{ slot: number, type: string, letter: string, aim: string, costLux: number, ready: boolean, poor: boolean, text: string }[]}
 */
export function abilityStates(hero, abilities, coreLuxMilli, minLeftLux, tickHz) {
  const cooldowns = [hero.cd0, hero.cd1, hero.cd2, hero.cd3];
  return ABILITY_SLOTS.map(({ slot, type, letter, aim }) => {
    const costLux = abilities.templates[type].costLux;
    const ticks = cooldowns[slot];
    return {
      slot,
      type,
      letter,
      aim,
      costLux,
      ready: ticks === 0,
      poor: !canAfford(coreLuxMilli, costLux, minLeftLux),
      text: ticks > 0 ? `${letter} ${secondsText(ticks, tickHz)}` : `${letter} ${costLux}`,
    };
  });
}

/**
 * The command of an ability that needs no second tap, or null for the aimed ones.
 * @param {number} slot
 * @param {{ id: number }} hero
 * @returns {import('../../sim/commands.js').Command | null}
 */
export function immediateCast(slot, hero) {
  if (slot === 0) return { t: 'castAbility', slot: 0 };
  if (slot === 3) return { t: 'castAbility', slot: 3, targetId: hero.id };
  return null;
}

/** How each item target in data/items.json is aimed: no tap, an own hero or building, or an enemy hero or creep. */
const ITEM_AIM = /** @type {Record<string, string>} */ ({ self: 'none', ownHeroOrBuilding: 'ally', enemyUnit: 'enemy' });

/**
 * The short name of an item for a button: the last word, so Energy Boost reads Boost.
 * @param {string} name
 */
export function itemShortName(name) {
  return name.split(' ').pop() ?? name;
}

/**
 * The item quick slots of the hero bar (GDD 8.1): one per item, with how many the hero holds. An item is
 * ready when the hero holds one and, for Energy Grab, no funnel runs. A running Energy Grab shows the whole
 * lux it can still funnel instead of the count.
 * @param {readonly { id: number, name: string, target: string, effect: { kind: string } }[]} items data/items.json `list`
 * @param {readonly number[]} counts the player's inventory by item id
 * @param {number} funnelLux milli-lux Energy Grab may still funnel
 * @returns {{ id: number, aim: string, count: number, active: boolean, ready: boolean, text: string }[]}
 */
export function itemStates(items, counts, funnelLux) {
  return items.map((item) => {
    const count = counts[item.id] ?? 0;
    const active = item.effect.kind === 'funnelMode' && funnelLux > 0;
    const short = itemShortName(item.name);
    return {
      id: item.id,
      aim: ITEM_AIM[item.target] ?? 'none',
      count,
      active,
      ready: count > 0 && !active,
      text: active ? `${short} ${Math.floor(funnelLux / MILLI)}` : `${short} ${count}`,
    };
  });
}

/**
 * The command of an item that needs no second tap, or null for the aimed ones.
 * @param {number} id item id
 * @param {readonly { id: number, target: string }[]} items data/items.json `list`
 * @returns {import('../../sim/commands.js').Command | null}
 */
export function immediateUse(id, items) {
  const item = items.find((i) => i.id === id);
  return item && ITEM_AIM[item.target] === 'none' ? { t: 'useItem', inventorySlot: id } : null;
}

/**
 * The item buttons of a barracks panel (GDD 8.1): name, price and whether the Core can pay.
 * @param {readonly { id: number, name: string, costLux: number }[]} items data/items.json `list`
 * @param {number} coreLuxMilli
 * @param {number} minLeftLux whole lux
 * @returns {{ id: number, name: string, costLux: number, poor: boolean }[]}
 */
export function shopStates(items, coreLuxMilli, minLeftLux) {
  return items.map((item) => ({ id: item.id, name: itemShortName(item.name), costLux: item.costLux, poor: !canAfford(coreLuxMilli, item.costLux, minLeftLux) }));
}

/**
 * Whether sending this command ends build mode: a placement frees the palette selection.
 * @param {{ t: string }} command
 */
export function endsBuildMode(command) {
  return command.t === 'build';
}

/**
 * What the barracks panel offers for picking a hero (GDD 7.1): a note when no pick is possible now, and
 * the roster with each hero's lock. A hero is enabled when it is not locked and the note is empty.
 * @param {{
 *   player: { heroLock: number, heroCooldown: number } | undefined,
 *   heroAlive: boolean,
 *   heroQueued: boolean,
 *   roster: readonly { id: number, name: string, primary: string }[],
 *   tickHz: number,
 * }} ctx
 * @returns {{ note: string, options: { id: number, name: string, primary: string, locked: boolean, enabled: boolean }[] }}
 */
export function heroPickState({ player, heroAlive, heroQueued, roster, tickHz }) {
  let note = '';
  if (heroAlive) note = 'Your hero is on the field.';
  else if (heroQueued) note = 'Your hero is being built.';
  else if (player && player.heroCooldown > 0) note = `Next pick in ${secondsText(player.heroCooldown, tickHz)}`;
  const options = roster.map((r) => {
    const locked = player !== undefined && (player.heroLock & (1 << r.id)) !== 0;
    return { id: r.id, name: r.name, primary: r.primary, locked, enabled: !locked && note === '' };
  });
  return { note, options };
}

/**
 * The lux a hero pick can allocate (GDD 7.2): 25%, 50% and 75% of the Core's lux, and the most the Core
 * can pay while keeping its minimum. Whole lux, at least 1, without repeats.
 * @param {number} coreLuxMilli
 * @param {number} minLeftLux whole lux
 * @returns {{ label: string, lux: number }[]}
 */
export function heroLuxChoices(coreLuxMilli, minLeftLux) {
  const max = Math.floor((coreLuxMilli - minLeftLux * MILLI) / MILLI);
  if (max < 1) return [];
  /** @type {{ label: string, lux: number }[]} */
  const out = [];
  for (const [label, pct] of /** @type {const} */ ([['25%', 25], ['50%', 50], ['75%', 75], ['Max', 100]])) {
    const lux = Math.min(max, Math.floor((coreLuxMilli * pct) / (100 * MILLI)));
    if (lux >= 1 && !out.some((c) => c.lux === lux)) out.push({ label, lux });
  }
  return out;
}

/**
 * Buttons of the group panel. Split needs 2 or more creeps; the lane route button shows only after a custom path.
 * @param {number} size creeps in the group
 * @param {boolean} custom whether the group has a custom path
 * @returns {{ id: string, label: string }[]}
 */
export function groupActions(size, custom) {
  const out = [{ id: 'path', label: 'Path' }, { id: 'merge', label: 'Merge' }];
  if (size >= 2) out.push({ id: 'split', label: 'Split' });
  if (custom) out.push({ id: 'lane', label: 'Lane Route' });
  return out;
}

/**
 * Creeps in a group.
 * @param {readonly import('../../sim/state.js').Entity[]} entities
 * @param {number} groupId
 */
export function groupSize(entities, groupId) {
  return entities.filter((e) => e.kind === KIND.CREEP && e.groupId === groupId).length;
}

/**
 * The entity nearest to a ground point (tiles), within the pick radius. Ties go to the lowest id.
 * Projectiles and nameless kinds are never picked.
 * @param {readonly import('../../sim/state.js').Entity[]} entities
 * @param {{ x: number, z: number }} ground
 */
export function pickEntity(entities, ground) {
  let best;
  let bestD = PICK_RADIUS_TILES * PICK_RADIUS_TILES;
  for (const e of entities) {
    if (e.kind === KIND.PROJECTILE) continue;
    const dx = e.x / UNITS_PER_TILE - ground.x;
    const dz = e.z / UNITS_PER_TILE - ground.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/**
 * Whether a building can go on a tile now, as the command to send or the reason it cannot. The sim result
 * is final; this answers at once what it would refuse for sure (build zone, taken tile, vent, lux).
 * @param {{
 *   tileX: number, tileZ: number,
 *   entities: readonly import('../../sim/state.js').Entity[],
 *   viewerTeam: number,
 *   building: string,
 *   attack: string,
 *   coreLuxMilli: number,
 *   data: { buildings: any, balance: any, mapgen: any },
 *   vents: readonly { team: number, tileX: number, tileZ: number }[],
 * }} ctx
 * @returns {{ command: import('../../sim/commands.js').Command } | { message: string }}
 */
export function placement(ctx) {
  const { tileX, tileZ, entities, viewerTeam, building, attack, data } = ctx;
  const zone = buildZoneOf({ mapgen: data.mapgen }, viewerTeam);
  if (tileZ < zone.z0 || tileZ > zone.z1 || tileX < 0 || tileX >= data.mapgen.width) return { message: 'Build inside your own zone.' };
  const taken = entities.some((e) => e.kind <= KIND.BLOCKER && Math.floor(e.x / UNITS_PER_TILE) === tileX && Math.floor(e.z / UNITS_PER_TILE) === tileZ);
  if (taken) return { message: 'That tile is taken.' };
  const info = data.buildings[building];
  if (info.requiresVent && !ctx.vents.some((v) => v.team === viewerTeam && v.tileX === tileX && v.tileZ === tileZ)) return { message: 'Geothermal needs a vent tile.' };
  if (!canAfford(ctx.coreLuxMilli, info.costLux, data.balance.core.minLeftAfterSpendLux)) return { message: `Not enough lux: ${building} costs ${info.costLux}.` };
  return { command: building === 'tower' ? { t: 'build', building, tileX, tileZ, attack } : { t: 'build', building, tileX, tileZ } };
}

/**
 * What a tap does, as a command to send or a message to show. Pure: no DOM, no network.
 * A tap on the open map (a hero order, not a selection) carries `deselect`: the caller clears the selected
 * building and group, so the panel closes.
 *
 * @typedef {{ command: import('../../sim/commands.js').Command, deselect?: true } | { message: string } | { select: number | null } | { selectGroup: number } | { addWaypoint: number[] } | { ghost: { tileX: number, tileZ: number }, message?: string }} TapResult
 *
 * @param {{
 *   ground: { x: number, z: number },
 *   entities: readonly import('../../sim/state.js').Entity[],
 *   viewerTeam: number,
 *   building: string | null,        // selected in the palette, or null
 *   attack: string,                 // tower attack type chosen in the palette
 *   coreLuxMilli: number,
 *   data: { buildings: any, balance: any, mapgen: any },
 *   vents: readonly { team: number, tileX: number, tileZ: number }[],
 *   mode?: 'path' | 'merge' | null, // path mode adds waypoints, merge mode picks the group to join
 *   selectedGroup?: number | null,
 *   pathCount?: number,             // waypoints already placed in path mode
 *   ability?: number | null,        // 1 (ranged) or 2 (area) while the next tap aims that ability
 *   item?: number | null,           // the id of an aimed item (Energy Boost or Sluggish) while the next tap aims it
 * }} ctx `data` also carries `items` (data/items.json) when an item is aimed
 * @returns {TapResult}
 */
export function resolveTap(ctx) {
  const { ground, entities, viewerTeam, building, attack, data } = ctx;
  const tileX = Math.floor(ground.x);
  const tileZ = Math.floor(ground.z);

  if (ctx.ability === 1) {
    const target = pickEntity(entities, ground);
    if (target && target.kind !== KIND.PROJECTILE && (target.kind === KIND.BLOCKER || (target.team >= 0 && target.team !== viewerTeam))) {
      return { command: { t: 'castAbility', slot: 1, targetId: target.id } };
    }
    return { message: 'Tap an enemy to hit.' };
  }
  if (ctx.ability === 2) {
    return { command: { t: 'castAbility', slot: 2, x: Math.round(ground.x * UNITS_PER_TILE), z: Math.round(ground.z * UNITS_PER_TILE) } };
  }

  if (ctx.item !== undefined && ctx.item !== null) {
    const aim = ITEM_AIM[/** @type {any} */ (data).items.list[ctx.item]?.target];
    const target = pickEntity(entities, ground);
    if (aim === 'ally') {
      if (target && target.owner === viewerTeam && (target.kind === KIND.HERO || BUILDING_KINDS.has(target.kind))) {
        return { command: { t: 'useItem', inventorySlot: ctx.item, targetId: target.id } };
      }
      return { message: 'Tap your hero or one of your buildings.' };
    }
    if (target && target.team >= 0 && target.team !== viewerTeam && (target.kind === KIND.HERO || target.kind === KIND.CREEP)) {
      return { command: { t: 'useItem', inventorySlot: ctx.item, targetId: target.id } };
    }
    return { message: 'Tap an enemy hero or creep.' };
  }

  if (building) {
    // A tap in build mode only sets the ghost; the Place button sends the command (GDD 11.5). The message says why the ghost is red.
    const check = placement({ tileX, tileZ, entities, viewerTeam, building, attack, coreLuxMilli: ctx.coreLuxMilli, data, vents: ctx.vents });
    return 'message' in check ? { ghost: { tileX, tileZ }, message: check.message } : { ghost: { tileX, tileZ } };
  }

  if (ctx.mode === 'path') {
    if ((ctx.pathCount ?? 0) >= data.balance.creep.maxWaypoints) return { message: `A path holds at most ${data.balance.creep.maxWaypoints} waypoints.` };
    return { addWaypoint: [Math.round(ground.x * UNITS_PER_TILE), Math.round(ground.z * UNITS_PER_TILE)] };
  }

  const picked = pickEntity(entities, ground);
  if (ctx.mode === 'merge') {
    if (picked && picked.kind === KIND.CREEP && picked.owner === viewerTeam && picked.groupId !== ctx.selectedGroup) {
      return { command: { t: 'mergeGroups', intoGroupId: /** @type {number} */ (ctx.selectedGroup), fromGroupId: picked.groupId } };
    }
    return { message: 'Tap one of your other groups to merge.' };
  }
  const hero = entities.find((e) => e.kind === KIND.HERO && e.owner === viewerTeam);
  if (picked && (picked.kind === KIND.GROUND_ITEM || picked.kind === KIND.LOOT_BAG)) {
    return hero ? { command: { t: 'pickUp', groundItemId: picked.id }, deselect: true } : { message: 'You need a hero to pick that up.' };
  }
  if (picked && BUILDING_KINDS.has(picked.kind) && picked.owner === viewerTeam) return { select: picked.id };
  if (picked && picked.kind === KIND.CREEP && picked.owner === viewerTeam) return { selectGroup: picked.groupId };
  if (picked && hero && picked.id !== hero.id && picked.team !== viewerTeam) return { command: { t: 'heroAttack', targetId: picked.id }, deselect: true };
  if (hero) return { command: { t: 'heroMove', x: Math.round(ground.x * UNITS_PER_TILE), z: Math.round(ground.z * UNITS_PER_TILE) }, deselect: true };
  return { select: null };
}

/**
 * Actions the panel offers for a selected own building.
 * @param {import('../../sim/state.js').Entity} e
 * @param {any} towerData data/buildings.json `tower`
 * @returns {{ id: string, label: string, command: import('../../sim/commands.js').Command, costLux?: number }[]}
 */
export function actionsFor(e, towerData) {
  /** @type {{ id: string, label: string, command: import('../../sim/commands.js').Command, costLux?: number }[]} */
  const out = [];
  if (e.kind === KIND.TOWER && e.recycle === 0) {
    for (const track of /** @type {const} */ (['power', 'shell'])) {
      const level = track === 'power' ? e.powerLevel : e.shellLevel;
      const next = towerData.upgrades[track][level];
      if (!next) continue;
      out.push({ id: track, label: `${track === 'power' ? 'Power' : 'Shell'} ${level + 1}/${towerData.upgrades[track].length}`, command: { t: 'upgrade', towerId: e.id, track }, costLux: next.costLux });
    }
  }
  out.push(e.recycle > 0
    ? { id: 'cancel', label: 'Cancel Recycle', command: { t: 'cancelRecycle', buildingId: e.id } }
    : { id: 'recycle', label: 'Recycle', command: { t: 'recycle', buildingId: e.id } });
  return out;
}

/**
 * The creep auto spawn toggle of a barracks panel (GDD 9.4). The label never changes, `on` says whether
 * the barracks repeats its creep orders, and the command sends the opposite state.
 * @param {import('../../sim/state.js').Entity} e  a barracks
 * @returns {{ label: string, on: boolean, command: import('../../sim/commands.js').Command }}
 */
export function autoSpawnToggle(e) {
  const on = e.autoSpawn === 1;
  return { label: 'Creep auto spawn', on, command: { t: 'setAutoSpawn', barracksId: e.id, on: !on } };
}

/**
 * Whether a cancel (a right click, GDD 11.1) has anything to clear: a building picked in the palette or
 * its ghost, an ability or an item waiting for a target, the path or merge mode, or a selected building
 * or creep group. A client passes -1 or null for what is off.
 * @param {{ building?: string | null, ghost?: boolean, ability?: number | null, item?: number | null,
 *   mode?: string | null, selected?: number | null, selectedGroup?: number | null }} state
 * @returns {{ cancelled: boolean }}
 */
export function cancelAction(state) {
  const cancelled = Boolean(state.building) || state.ghost === true
    || (state.ability ?? -1) >= 0 || (state.item ?? -1) >= 0 || Boolean(state.mode)
    || (state.selected ?? -1) >= 0 || (state.selectedGroup ?? -1) >= 0;
  return { cancelled };
}

/**
 * Builds the controls inside `root` and returns the hooks the page calls.
 * @param {{
 *   root: HTMLElement,
 *   view: import('../../shared/world-view.js').WorldView,
 *   viewerTeam: number,
 *   spectator: boolean,
 *   tickHz: number,
 *   data: { buildings: any, balance: any, mapgen: any, heroes: any, abilities: any, items: any },
 *   send: (cmd: import('../../sim/commands.js').Command) => Promise<{ accepted: boolean, reason?: string }>,
 *   camera?: { isFollowing: () => boolean, setFollow: (on: boolean) => void },
 *   groundAt?: (clientX: number, clientY: number) => { x: number, z: number } | null,  // ground point in tiles under a screen point, for hold-to-aim
 * }} opts
 */
export function createControls({ root, view, viewerTeam, spectator, tickHz, data, send, camera, groundAt }) {
  /** @type {string | null} */
  let building = null;
  let attack = 'ranged';
  /** @type {number | null} */
  let selected = null;
  /** @type {number | null} */
  let selectedGroup = null;
  /** @type {'path' | 'merge' | null} */
  let mode = null;
  /** The orders window, for a player (a spectator has none). @type {ReturnType<typeof createOrderWindow> | null} */
  let orderWindow = null;
  /** The tile chosen for the building in the palette; the Place button sends it (GDD 11.5). @type {{ tileX: number, tileZ: number } | null} */
  let ghost = null;
  /** Where a held ability would land, in tiles, while the finger drags from its button. @type {{ x: number, z: number } | null} */
  let aimPoint = null;
  /** @type {{ type: 'group' | 'barracks', id: number } | null} */
  let pathTarget = null;
  /** @type {number[][]} */
  let pathPoints = [];
  /** @type {number[][]} */
  let lastPath = [];
  let orderCount = data.balance.creep.groupMax;
  let orderType = 'mixed';
  /** The slot (1 ranged, 2 area) whose target the next tap chooses, or null. */
  let ability = /** @type {number | null} */ (null);
  /** The id of the item (Boost or Sluggish) whose target the next tap chooses, or null. */
  let itemAim = /** @type {number | null} */ (null);
  /** Label of the chosen hero allocation, one of `heroLuxChoices`. */
  let heroAlloc = '50%';
  let toastTimer = 0;
  const minLeft = data.balance.core.minLeftAfterSpendLux;
  const roster = /** @type {{ id: number, name: string, primary: string }[]} */ (data.heroes.roster);
  const heroNames = roster.map((r) => r.name);
  const itemList = /** @type {{ id: number, name: string, costLux: number, target: string, effect: { kind: string } }[]} */ (data.items.list);
  const itemNames = itemList.map((i) => i.name);
  let keyBindings = defaultKeyBindings();

  root.replaceChildren();
  const toast = el('div', 'toast');
  keyBindings = loadKeyBindings(say);
  const panel = el('div', 'panel');
  const heroBar = el('div', 'hero-bar');
  const palette = el('div', 'palette');
  const keySettingsButton = /** @type {HTMLButtonElement} */ (el('button', 'key-settings-toggle', 'Keys'));
  keySettingsButton.type = 'button';
  keySettingsButton.title = 'Configure ability and item keys';
  keySettingsButton.hidden = spectator;
  root.append(keySettingsButton, toast, panel, heroBar, palette);
  heroBar.hidden = true;
  if (spectator) {
    palette.hidden = true;
    panel.hidden = true;
  }
  // A tap on the hero's name recenters the camera and resumes follow (GDD 11.1, the hero portrait).
  const heroName = el('button', 'hero-name');
  heroName.addEventListener('click', () => {
    camera?.setFollow(true);
    render();
  });
  const abilityRow = el('div', 'ability-row');
  const itemRow = el('div', 'ability-row item-row');
  // The camera follows the hero while this is on. Dragging the map turns it off.
  const followButton = /** @type {HTMLButtonElement} */ (el('button', 'follow', 'Follow'));
  followButton.addEventListener('click', () => {
    camera?.setFollow(!camera.isFollowing());
    render();
  });
  followButton.hidden = !camera;
  heroBar.append(heroName, followButton, abilityRow, itemRow);
  /** A drag from an ability button ends with a click on it that must not count. */
  let suppressClick = false;
  /** @type {HTMLButtonElement[]} */
  const abilityButtons = ABILITY_SLOTS.map(({ slot, type, letter }) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'ability', letter));
    b.dataset.slot = String(slot);
    b.title = type;
    // A click aims in two taps (the button, then the map). A press that drags off the button aims in one move.
    b.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      castFromBar(slot);
    });
    if (aimed(slot)) holdToAim(b, slot);
    abilityRow.append(b);
    return b;
  });

  /** @type {HTMLButtonElement[]} */
  const itemButtons = itemList.map((item) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'ability item', itemShortName(item.name)));
    b.dataset.item = String(item.id);
    b.title = item.name;
    b.addEventListener('click', () => useFromBar(item.id));
    itemRow.append(b);
    return b;
  });

  const keySettings = /** @type {HTMLDialogElement} */ (el('dialog', 'key-settings'));
  const keySettingsContent = el('div', 'key-settings-content');
  keySettingsContent.append(el('h2', '', 'Keyboard Controls'));
  keySettingsContent.append(el('p', '', 'Select a slot, then press an unused letter or number. Changes are saved on this device.'));
  const keyBindingButtons = { abilities: /** @type {HTMLButtonElement[]} */ ([]), items: /** @type {HTMLButtonElement[]} */ ([]) };
  let keyCapture = /** @type {{ kind: 'abilities' | 'items', slot: number } | null */ (null);

  /**
   * @param {'abilities' | 'items'} kind
   * @param {number} slot
   * @param {string} label
   */
  function addKeyBindingRow(kind, slot, label) {
    const row = el('div', 'key-binding-row');
    row.append(el('span', '', label));
    const bindingButton = /** @type {HTMLButtonElement} */ (el('button', 'key-binding', keyLabel(keyBindings[kind][slot])));
    bindingButton.type = 'button';
    bindingButton.addEventListener('click', () => {
      keyCapture = { kind, slot };
      bindingButton.textContent = 'Press a key';
    });
    keyBindingButtons[kind][slot] = bindingButton;
    row.append(bindingButton);
    keySettingsContent.append(row);
  }

  keySettingsContent.append(el('h3', '', 'Abilities'));
  for (const { slot, type } of ABILITY_SLOTS) addKeyBindingRow('abilities', slot, type);
  keySettingsContent.append(el('h3', '', 'Inventory Slots'));
  itemList.forEach((item, slot) => addKeyBindingRow('items', slot, `${slot + 1}. ${item.name}`));

  const keySettingsMessage = el('p', 'key-settings-message', '');
  const keySettingsActions = el('div', 'key-settings-actions');
  const resetKeysButton = /** @type {HTMLButtonElement} */ (el('button', '', 'Reset defaults'));
  resetKeysButton.type = 'button';
  resetKeysButton.addEventListener('click', () => {
    keyBindings = defaultKeyBindings();
    keyCapture = null;
    keySettingsMessage.textContent = '';
    saveKeyBindings(keyBindings, say);
    refreshKeyBindingLabels();
  });
  const closeKeySettingsButton = /** @type {HTMLButtonElement} */ (el('button', '', 'Close'));
  closeKeySettingsButton.type = 'button';
  closeKeySettingsButton.addEventListener('click', () => {
    keyCapture = null;
    refreshKeyBindingLabels();
    keySettings.close();
  });
  keySettingsActions.append(resetKeysButton, closeKeySettingsButton);
  keySettingsContent.append(keySettingsMessage, keySettingsActions);
  keySettings.append(keySettingsContent);
  root.append(keySettings);
  keySettingsButton.addEventListener('click', () => {
    keySettingsMessage.textContent = '';
    keySettings.showModal();
  });

  function refreshKeyBindingLabels() {
    ABILITY_SLOTS.forEach(({ slot, type }) => {
      keyBindingButtons.abilities[slot].textContent = keyLabel(keyBindings.abilities[slot]);
      abilityButtons[slot].title = `${type} (${keyLabel(keyBindings.abilities[slot])})`;
    });
    itemList.forEach((item, slot) => {
      keyBindingButtons.items[slot].textContent = keyLabel(keyBindings.items[slot]);
      itemButtons[slot].title = `${item.name} (${keyLabel(keyBindings.items[slot])})`;
    });
  }

  refreshKeyBindingLabels();

  /** @param {KeyboardEvent} event */
  function handleKeyDown(event) {
    if (keyCapture) {
      if (event.code === 'Escape') {
        keyCapture = null;
        refreshKeyBindingLabels();
        keySettingsMessage.textContent = 'Key assignment cancelled.';
        event.preventDefault();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || !/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) {
        keySettingsMessage.textContent = 'Choose a letter or number without a modifier.';
        event.preventDefault();
        return;
      }
      const occupied = keyBindings.abilities.some((key, slot) => key === event.code && (keyCapture?.kind !== 'abilities' || keyCapture.slot !== slot))
        || keyBindings.items.some((key, slot) => key === event.code && (keyCapture?.kind !== 'items' || keyCapture.slot !== slot));
      if (occupied) {
        keySettingsMessage.textContent = 'That key is already assigned to another slot.';
        event.preventDefault();
        return;
      }
      keyBindings[keyCapture.kind][keyCapture.slot] = event.code;
      keyCapture = null;
      keySettingsMessage.textContent = '';
      saveKeyBindings(keyBindings, say);
      refreshKeyBindingLabels();
      event.preventDefault();
      return;
    }
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || keySettings.open || isTextEntry(event.target)) return;
    if (spectator || !myHero()) return;
    const action = actionForKey(keyBindings, event.code);
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'ability') castFromBar(action.slot);
    else {
      const item = itemList[action.slot];
      if (item) useFromBar(item.id);
    }
  }
  window.addEventListener('keydown', handleKeyDown);

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  for (const item of PALETTE) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'tool'));
    b.dataset.building = item.key;
    b.append(el('span', 'tool-name', item.label), el('span', 'tool-cost', String(data.buildings[item.key].costLux)));
    b.addEventListener('click', () => {
      building = building === item.key ? null : item.key;
      ghost = null;
      ability = null;
      itemAim = null;
      selected = null;
      selectedGroup = null;
      mode = null;
      render();
    });
    buttons.set(item.key, b);
    palette.append(b);
  }
  const attackRow = el('div', 'attack-row');
  for (const type of ATTACK_TYPES) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'segment', type.charAt(0).toUpperCase() + type.slice(1)));
    b.dataset.attack = type;
    b.addEventListener('click', () => {
      attack = type;
      render();
    });
    attackRow.append(b);
  }
  palette.append(attackRow);

  /** @param {string} text */
  function say(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2500);
  }

  /**
   * Sends a command. A barracks order shows in the queue at once, as a dim row.
   * @param {import('../../sim/commands.js').Command} command
   */
  async function issue(command) {
    const text = pendingLine(command, heroNames, itemNames);
    const barracksId = /** @type {{ barracksId?: number }} */ (command).barracksId;
    const mark = text && barracksId !== undefined ? {
      id: ++pendingSeq,
      barracksId,
      text,
      // The real orders of this barracks plus the dim rows already waiting: the order is in a snapshot once the real count passes it.
      base: view.orders().filter((o) => o.barracksId === barracksId).length + pending.filter((p) => p.barracksId === barracksId).length,
      expires: Infinity,
    } : undefined;
    if (mark) {
      pending.push(mark);
      render();
    }
    try {
      const ack = await send(command);
      if (!ack.accepted) {
        drop(mark);
        say(ack.reason ?? 'The server refused the command.');
      } else {
        if (mark) mark.expires = performance.now() + PENDING_MS;
        if (command.t === 'cancelQueue') orderWindow?.noteCancelled(/** @type {{ orderId: number }} */ (command).orderId);
      }
    } catch (err) {
      drop(mark);
      say(`Command failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** @param {{ id: number } | undefined} mark */
  function drop(mark) {
    if (!mark) return;
    pending = pending.filter((p) => p.id !== mark.id);
    render();
  }

  function render() {
    if (!building) ghost = null;
    const now = performance.now();
    pending = pending.filter((p) => pendingKept(p.base, p.expires, view.orders().filter((o) => o.barracksId === p.barracksId).length, now));
    const lux = view.team(viewerTeam).coreLux;
    for (const [key, b] of buttons) {
      b.classList.toggle('active', building === key);
      b.classList.toggle('poor', !canAfford(lux, data.buildings[key].costLux, minLeft));
    }
    attackRow.hidden = building !== 'tower';
    for (const b of attackRow.children) b.classList.toggle('active', /** @type {HTMLElement} */ (b).dataset.attack === attack);
    renderPanel();
    renderHeroBar();
    orderWindow?.update();
  }

  /** The viewer's living hero, if any. */
  function myHero() {
    return spectator ? undefined : view.entities().find((e) => e.kind === KIND.HERO && e.owner === viewerTeam && e.hp > 0);
  }

  /** The ability buttons: letter and cost, or the seconds until ready; the aimed one is highlighted. */
  function renderHeroBar() {
    const hero = myHero();
    if (!hero) {
      heroBar.hidden = true;
      ability = null;
      return;
    }
    heroBar.hidden = false;
    followButton.classList.toggle('active', camera?.isFollowing() === true);
    const text = entityText(hero, data.balance.hpFactor, heroNames, itemNames) ?? 'Hero';
    if (heroName.textContent !== text) heroName.textContent = text;
    const states = abilityStates(hero, data.abilities, view.team(viewerTeam).coreLux, minLeft, tickHz);
    for (const st of states) {
      const b = abilityButtons[st.slot];
      if (b.textContent !== st.text) b.textContent = st.text;
      b.classList.toggle('poor', !st.ready || st.poor);
      b.classList.toggle('active', ability === st.slot);
    }
    const mine = view.players().find((p) => p.id === viewerTeam);
    for (const st of itemStates(itemList, mine?.items ?? [], mine?.funnelLux ?? 0)) {
      const b = itemButtons[st.id];
      if (b.textContent !== st.text) b.textContent = st.text;
      b.classList.toggle('poor', !st.ready);
      b.classList.toggle('active', st.active || itemAim === st.id);
    }
  }

  /**
   * An item button: self items apply at once, the others wait for a tap on the target.
   * @param {number} id
   */
  function useFromBar(id) {
    const hero = myHero();
    if (!hero) return;
    const mine = view.players().find((p) => p.id === viewerTeam);
    const st = itemStates(itemList, mine?.items ?? [], mine?.funnelLux ?? 0)[id];
    if (!st.ready) return say(st.active ? 'Energy Grab is running.' : `You hold no ${itemNames[id]}.`);
    const use = immediateUse(id, itemList);
    ability = null;
    if (use) {
      itemAim = null;
      issue(use);
    } else if (itemAim === id) {
      itemAim = null;
    } else {
      itemAim = id;
      building = null;
      selected = null;
      selectedGroup = null;
      mode = null;
      say(st.aim === 'ally' ? 'Tap your hero or a building.' : 'Tap an enemy hero or creep.');
    }
    render();
  }

  /** Whether an ability needs a target or a point, which is when a drag from its button can aim it. @param {number} slot */
  function aimed(slot) {
    return ABILITY_SLOTS[slot].aim !== 'none';
  }

  /**
   * Hold-to-aim: press the button of an aimed ability, drag onto the map and lift to cast there. Lifting
   * back over the button cancels. A press that stays on the button is a plain click (`holdAimRelease`).
   * @param {HTMLButtonElement} b @param {number} slot
   */
  function holdToAim(b, slot) {
    /** @type {{ id: number, x: number, y: number, aiming: boolean } | null} */
    let hold = null;
    b.addEventListener('pointerdown', (e) => {
      if (hold || !groundAt || !myHero()) return;
      hold = { id: e.pointerId, x: e.clientX, y: e.clientY, aiming: false };
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener('pointermove', (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      if (!hold.aiming) {
        if (holdAimPhase(Math.hypot(e.clientX - hold.x, e.clientY - hold.y)) !== 'aiming') return;
        const hero = myHero();
        const st = hero && abilityStates(hero, data.abilities, view.team(viewerTeam).coreLux, minLeft, tickHz)[slot];
        if (!st || !st.ready) {
          hold = null; // not ready: the release is a plain click, which says why
          return;
        }
        hold.aiming = true;
        ability = slot;
        itemAim = null;
        building = null;
        selected = null;
        selectedGroup = null;
        mode = null;
      }
      aimPoint = overButton(b, e) ? null : (groundAt?.(e.clientX, e.clientY) ?? null);
      render();
    });
    const end = (/** @type {PointerEvent} */ e, cancelled) => {
      if (!hold || e.pointerId !== hold.id) return;
      const { aiming } = hold;
      hold = null;
      aimPoint = null;
      if (!aiming) return;
      suppressClick = true; // the browser still sends a click to the button after the drag
      const what = cancelled ? 'cancel' : holdAimRelease(true, overButton(b, e));
      const ground = what === 'cast' ? groundAt?.(e.clientX, e.clientY) : null;
      if (what === 'cast' && ground) api.tap(ground);
      // A refused cast (no enemy under the finger) ends the aim too: the drag was the whole gesture.
      if (ability === slot) ability = null;
      render();
    };
    b.addEventListener('pointerup', (e) => end(e, false));
    b.addEventListener('pointercancel', (e) => end(e, true));
  }

  /** @param {number} slot */
  function castFromBar(slot) {
    const hero = myHero();
    if (!hero) return;
    const st = abilityStates(hero, data.abilities, view.team(viewerTeam).coreLux, minLeft, tickHz)[slot];
    if (!st.ready) return say(`${st.letter} is not ready: ${st.text.slice(2)}.`);
    const cast = immediateCast(slot, hero);
    if (cast) {
      ability = null;
      issue(cast);
    } else if (ability === slot) {
      ability = null;
    } else {
      ability = slot;
      itemAim = null;
      building = null;
      selected = null;
      selectedGroup = null;
      mode = null;
      say(slot === 1 ? 'Tap an enemy to hit.' : 'Tap the ground to strike.');
    }
    render();
  }

  // The panel holds one section at a time: path mode, a selected group, or a selected building.
  const panelTitle = el('div', 'panel-title');
  const panelRow = el('div', 'panel-row');
  const orderRow = el('div', 'panel-row order-row');
  const heroRow = el('div', 'panel-row hero-row');
  const shopRow = el('div', 'panel-row shop-row');
  // The queue is not here: the orders window keeps it, so a new order never moves a button of this panel.
  panel.append(panelTitle, panelRow, orderRow, heroRow, shopRow);
  let panelKey = '';
  let orderKey = '';
  let heroKey = '';
  let shopKey = '';
  /** Orders sent and not yet in a snapshot; `expires` is Infinity until the server has answered. */
  let pending = /** @type {{ id: number, barracksId: number, text: string, base: number, expires: number }[]} */ ([]);
  let pendingSeq = 0;
  /** @type {HTMLButtonElement | undefined} */
  let orderButton;
  /** The hero lux choices of the latest render, which the Pick Hero button reads when pressed. */
  let heroChoices = /** @type {{ label: string, lux: number }[]} */ ([]);
  let heroSelected = -1;
  /** @type {HTMLElement | undefined} */
  let heroNote;
  /** @type {HTMLSelectElement | undefined} */
  let heroSelect;
  /** @type {HTMLSelectElement | undefined} */
  let heroPowerSelect;
  /** @type {HTMLButtonElement | undefined} */
  let heroPickButton;
  /** @type {Map<number, HTMLElement>} */
  const shopButtons = new Map();

  /**
   * @param {string} label @param {() => void} onClick @param {string} [className]
   */
  function button(label, onClick, className = 'action') {
    const b = /** @type {HTMLButtonElement} */ (el('button', className, label));
    b.addEventListener('click', onClick);
    return b;
  }

  function leavePathMode() {
    mode = null;
    pathTarget = null;
    pathPoints = [];
  }

  /** Updates texts every call and rebuilds buttons only when their set changes, so a click never lands on a replaced button. */
  function renderPanel() {
    if (mode === 'path') return renderPathBar();
    if (building && ghost) return renderGhostPanel();
    const group = selectedGroup === null ? undefined : view.groups().find((g) => g.id === selectedGroup);
    if (selectedGroup !== null && !group) {
      selectedGroup = null;
      if (mode === 'merge') mode = null;
    }
    if (group) return renderGroupPanel(group);
    const e = selected === null ? undefined : view.entities().find((x) => x.id === selected);
    if (!e) {
      selected = null;
      panelKey = orderKey = heroKey = shopKey = '';
      shopRow.replaceChildren();
      panel.hidden = true;
      return;
    }
    renderBuildingPanel(e);
  }

  /** The placement check for the ghost tile with the lux of now. */
  function ghostCheck() {
    return placement({
      tileX: ghost?.tileX ?? 0,
      tileZ: ghost?.tileZ ?? 0,
      entities: view.entities(),
      viewerTeam,
      building: building ?? '',
      attack,
      coreLuxMilli: view.team(viewerTeam).coreLux,
      data,
      vents: view.map().vents,
    });
  }

  /** @type {HTMLButtonElement | undefined} */
  let placeButton;

  /** The Place and Cancel buttons for the ghost, and why the ghost is red when it is. */
  function renderGhostPanel() {
    panel.hidden = false;
    orderRow.replaceChildren();
    heroRow.replaceChildren();
    shopRow.replaceChildren();
    orderKey = heroKey = shopKey = '';
    const check = ghostCheck();
    const label = PALETTE.find((p) => p.key === building)?.label ?? String(building);
    const title = `${label} at ${ghost?.tileX}, ${ghost?.tileZ}${'message' in check ? `: ${check.message}` : ''}`;
    if (panelTitle.textContent !== title) panelTitle.textContent = title;
    const key = `ghost|${building}`;
    if (key !== panelKey || !placeButton) {
      panelKey = key;
      placeButton = button('Place', () => {
        const now = ghostCheck();
        if ('message' in now) return say(now.message);
        building = null; // a placed building ends build mode at once, so a second tap cannot place a second one
        ghost = null;
        render();
        issue(now.command);
      }, 'action place');
      placeButton.append(el('span', 'tool-cost', String(data.buildings[building ?? ''].costLux)));
      panelRow.replaceChildren(placeButton, button('Cancel', () => { ghost = null; render(); }, 'action cancel-ghost'));
    }
    placeButton.classList.toggle('poor', 'message' in check);
  }

  /** @param {number} sizeNow */
  function pathTitle(sizeNow) {
    return `Path: ${sizeNow}/${data.balance.creep.maxWaypoints} waypoints. Tap the map to add one.`;
  }

  function renderPathBar() {
    panel.hidden = false;
    orderRow.replaceChildren();
    heroRow.replaceChildren();
    shopRow.replaceChildren();
    orderKey = heroKey = shopKey = '';
    panelTitle.textContent = pathTitle(pathPoints.length);
    const key = `path|${pathPoints.length}|${lastPath.length}`;
    if (key === panelKey) return;
    panelKey = key;
    panelRow.replaceChildren(
      button('Undo', () => { pathPoints.pop(); render(); }),
      button('Go', () => {
        const target = pathTarget;
        if (!target) return;
        lastPath = pathPoints.map((p) => [p[0], p[1]]);
        issue(target.type === 'group'
          ? { t: 'setGroupPath', groupId: target.id, waypoints: pathPoints }
          : { t: 'setBarracksPath', barracksId: target.id, waypoints: pathPoints });
        leavePathMode();
        render();
      }),
      button('Cancel', () => { leavePathMode(); render(); }),
      ...(lastPath.length > 0 ? [button('Reuse Last', () => { pathPoints = lastPath.map((p) => [p[0], p[1]]); render(); })] : []),
    );
  }

  /** @param {import('../../sim/state.js').Group} group */
  function renderGroupPanel(group) {
    panel.hidden = false;
    orderRow.replaceChildren();
    heroRow.replaceChildren();
    shopRow.replaceChildren();
    orderKey = heroKey = shopKey = '';
    const size = groupSize(view.entities(), group.id);
    panelTitle.textContent = mode === 'merge'
      ? `Group of ${size}: tap another of your groups to merge.`
      : `Group of ${size}, ${group.custom ? 'custom path' : 'lane route'}`;
    const actions = groupActions(size, group.custom === 1);
    const key = `group|${group.id}|${mode}|${actions.map((a) => a.id).join(',')}`;
    if (key === panelKey) return;
    panelKey = key;
    panelRow.replaceChildren(...actions.map((a) => button(a.label, () => {
      if (a.id === 'path') {
        mode = 'path';
        pathTarget = { type: 'group', id: group.id };
        pathPoints = [];
      } else if (a.id === 'merge') {
        mode = mode === 'merge' ? null : 'merge';
      } else if (a.id === 'split') {
        issue({ t: 'splitGroup', groupId: group.id });
      } else {
        issue({ t: 'setGroupPath', groupId: group.id, waypoints: [] });
      }
      render();
    }, mode === 'merge' && a.id === 'merge' ? 'action active' : 'action')));
  }

  /** @param {import('../../sim/state.js').Entity} e */
  function renderBuildingPanel(e) {
    panel.hidden = false;
    panelTitle.textContent = `${entityText(e, data.balance.hpFactor) ?? 'Entity'}${e.kind === KIND.TOWER ? ` (${ATTACK_NAMES[e.attack] ?? '?'})` : ''}`;
    const lux = view.team(viewerTeam).coreLux;
    const actions = actionsFor(e, data.buildings.tower).map((action) => ({
      ...action,
      poor: action.costLux !== undefined && !canAfford(lux, action.costLux, minLeft),
    }));
    // The key holds the action ids only: affordability follows the lux, and a button replaced between press and release loses the click.
    const key = `${e.id}|${actions.map((a) => a.id).join(',')}`;
    if (key !== panelKey) {
      panelKey = key;
      panelRow.replaceChildren(...(e.kind === KIND.BARRACKS && e.recycle === 0 ? [] : actions).map((action) => {
        const b = button(action.label, () => issue(action.command));
        if (action.costLux !== undefined) b.append(el('span', 'tool-cost', String(action.costLux)));
        return b;
      }));
    }
    actions.forEach((action, i) => panelRow.children[i]?.classList.toggle('poor', action.poor));
    if (e.kind === KIND.BARRACKS && e.recycle === 0) renderBarracks(e, lux, actions);
    else {
      orderRow.replaceChildren();
      heroRow.replaceChildren();
      shopRow.replaceChildren();
      orderKey = heroKey = shopKey = '';
    }
  }

  /**
   * Order controls and the queue of a barracks. A control is built once and then updated in place:
   * lux changes every tick, and a button replaced between a press and its release loses the click.
   * @param {import('../../sim/state.js').Entity} e @param {number} lux
   * @param {ReturnType<typeof actionsFor>} actions
   */
  function renderBarracks(e, lux, actions) {
    const cost = orderCount * data.balance.creep.costLux; // whole lux: the data files are not converted
    const poor = !canAfford(lux, cost, minLeft);
    const key = `${e.id}|${orderCount}|${orderType}|${e.waypoints.length}|${e.autoSpawn}|${actions.map((a) => a.id).join(',')}`;
    if (key !== orderKey) {
      orderKey = key;
      const counts = /** @type {HTMLSelectElement} */ (el('select', 'barracks-select creep-count'));
      counts.setAttribute('aria-label', 'Creep count');
      counts.dataset.creepCount = '';
      for (let n = data.balance.creep.groupMin; n <= data.balance.creep.groupMax; n++) {
        const option = document.createElement('option');
        option.value = String(n);
        option.textContent = String(n);
        counts.append(option);
      }
      counts.value = String(orderCount);
      counts.addEventListener('change', () => {
        orderCount = Number(counts.value);
        render();
      });
      const types = /** @type {HTMLSelectElement} */ (el('select', 'barracks-select creep-type'));
      types.setAttribute('aria-label', 'Creep type');
      types.dataset.orderType = '';
      for (const t of ORDER_TYPES) {
        const option = document.createElement('option');
        option.value = t;
        option.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        types.append(option);
      }
      types.value = orderType;
      types.addEventListener('change', () => {
        orderType = types.value;
        render();
      });
      const mix = mixFor(orderCount, orderType);
      orderButton = button(`Order ${orderCount}`, () => issue({ t: 'orderCreeps', barracksId: e.id, mix }), 'action order');
      orderButton.append(el('span', 'tool-cost', String(cost)));
      const actionsRow = el('div', 'barracks-actions');
      const recycle = actions.find((action) => action.id === 'recycle');
      if (recycle) actionsRow.append(button(recycle.label, () => issue(recycle.command), 'action barracks-recycle'));
      const path = button(e.waypoints.length > 0 ? 'Default Path' : 'Set Default Path', () => {
        mode = 'path';
        pathTarget = { type: 'barracks', id: e.id };
        pathPoints = [];
        render();
      }, 'action barracks-path');
      actionsRow.append(path, orderButton);
      const choicesRow = el('div', 'barracks-options');
      choicesRow.append(counts, types);
      const auto = autoSpawnToggle(e);
      const autoButton = button(auto.label, () => issue(auto.command), 'action barracks-auto');
      autoButton.dataset.autoSpawn = auto.on ? 'on' : 'off';
      autoButton.setAttribute('aria-pressed', auto.on ? 'true' : 'false');
      autoButton.classList.toggle('on', auto.on);
      const rows = [choicesRow, actionsRow, autoButton];
      if (e.waypoints.length > 0) rows.push(button('Clear Path', () => issue({ t: 'setBarracksPath', barracksId: e.id, waypoints: [] })));
      orderRow.replaceChildren(...rows);
    }
    orderButton?.classList.toggle('poor', poor);
    renderHeroPicks(e, lux);
    renderShop(e, lux);
  }

  /**
   * The hero part of a barracks panel (GDD 7.1): the lux to allocate and a dropdown roster, with locked heroes
   * and the death cooldown shown.
   * @param {import('../../sim/state.js').Entity} e @param {number} lux
   */
  function renderHeroPicks(e, lux) {
    const pickState = heroPickState({
      player: view.players().find((p) => p.id === viewerTeam),
      heroAlive: view.entities().some((x) => x.kind === KIND.HERO && x.owner === viewerTeam && x.hp > 0),
      heroQueued: view.orders().some((o) => o.owner === viewerTeam && o.type === HERO_ORDER),
      roster,
      tickHz,
    });
    heroChoices = heroLuxChoices(lux, minLeft);
    const chosen = heroChoices.find((c) => c.label === heroAlloc) ?? heroChoices[0];
    // The amounts change with the Core's lux, so the key holds the labels only and the texts follow in place.
    const key = `${e.id}|${heroChoices.map((c) => c.label).join(',')}|${pickState.options.map((o) => `${o.id}${o.locked ? 'L' : ''}${o.enabled ? 'E' : ''}`).join(',')}`;
    if (key !== heroKey) {
      heroKey = key;
      const controls = el('div', 'hero-controls');
      heroNote = el('div', 'hero-note');
      heroPowerSelect = /** @type {HTMLSelectElement} */ (el('select', 'barracks-select hero-power'));
      heroPowerSelect.setAttribute('aria-label', 'Hero power');
      heroPowerSelect.dataset.alloc = '';
      for (const c of heroChoices) {
        const item = document.createElement('option');
        item.value = c.label;
        item.textContent = `${c.label} ${c.lux}`;
        heroPowerSelect.append(item);
      }
      heroPowerSelect.addEventListener('change', () => {
        heroAlloc = heroPowerSelect?.value ?? heroAlloc;
        render();
      });
      heroSelect = /** @type {HTMLSelectElement} */ (el('select', 'barracks-select hero-pick'));
      heroSelect.setAttribute('aria-label', 'Hero to select');
      for (const option of pickState.options) {
        const item = document.createElement('option');
        item.value = String(option.id);
        item.dataset.hero = String(option.id);
        item.textContent = `${option.name} ${option.primary.charAt(0).toUpperCase()}${option.locked ? ' (locked)' : ''}`;
        item.disabled = !option.enabled;
        heroSelect.append(item);
      }
      const selectedOption = pickState.options.find((option) => option.id === heroSelected && option.enabled)
        ?? pickState.options.find((option) => option.enabled)
        ?? pickState.options[0];
      heroSelected = selectedOption?.id ?? -1;
      if (selectedOption) heroSelect.value = String(selectedOption.id);
      heroSelect.dataset.hero = String(heroSelected);
      heroSelect.addEventListener('change', () => {
        heroSelected = Number(heroSelect?.value ?? -1);
        if (heroSelect) heroSelect.dataset.hero = String(heroSelected);
      });
      heroPickButton = button('Pick Hero', () => {
        const option = pickState.options.find((entry) => entry.id === heroSelected);
        const now = heroChoices.find((choice) => choice.label === heroAlloc) ?? heroChoices[0];
        if (!option?.enabled) return;
        if (!now) return say('Not enough lux for a hero.');
        issue({ t: 'pickHero', heroId: option.id, lux: now.lux, barracksId: e.id });
      }, 'action hero-confirm');
      heroPickButton.disabled = !selectedOption?.enabled || heroChoices.length === 0;
      controls.append(heroPickButton, heroSelect, heroPowerSelect);
      heroRow.replaceChildren(heroNote, controls);
    }
    const note = pickState.note ? `Hero: ${pickState.note}` : 'Hero: pick one, with the lux below';
    if (heroNote && heroNote.textContent !== note) heroNote.textContent = note;
    for (const [index, c] of heroChoices.entries()) {
      const item = heroPowerSelect?.options[index];
      if (item && item.textContent !== `${c.label} ${c.lux}`) item.textContent = `${c.label} ${c.lux}`;
    }
    if (chosen && heroPowerSelect) heroPowerSelect.value = chosen.label;
    if (heroPowerSelect) heroPowerSelect.disabled = heroChoices.length === 0;
  }

  /**
   * The item part of a barracks panel (GDD 8.1): one button per item with its price. A bought item
   * waits in the queue and reaches the hero's inventory when it is built.
   * @param {import('../../sim/state.js').Entity} e @param {number} lux
   */
  function renderShop(e, lux) {
    const shop = shopStates(itemList, lux, minLeft);
    const key = `${e.id}|${shop.map((s) => s.id).join(',')}`;
    if (key !== shopKey) {
      shopKey = key;
      shopButtons.clear();
      const buttonsRow = el('div', 'segments');
      for (const s of shop) {
        const b = button(s.name, () => issue({ t: 'orderItem', barracksId: e.id, itemId: s.id }), 'segment shop-item');
        b.dataset.shopItem = String(s.id);
        b.append(el('span', 'tool-cost', String(s.costLux)));
        shopButtons.set(s.id, b);
        buttonsRow.append(b);
      }
      shopRow.replaceChildren(el('div', 'hero-note', 'Items: bought here, carried by your hero'), buttonsRow);
    }
    for (const s of shop) shopButtons.get(s.id)?.classList.toggle('poor', s.poor);
  }

  /** Paths to draw: the selected group's remaining route, a barracks default path, and the path being drawn. */
  function overlay() {
    /** @type {{ points: number[][], color: number }[]} */
    const paths = [];
    const tiles = (/** @type {number[][]} */ list) => list.map((p) => [p[0] / UNITS_PER_TILE, p[1] / UNITS_PER_TILE]);
    const group = selectedGroup === null ? undefined : view.groups().find((g) => g.id === selectedGroup);
    if (group) {
      const leader = view.entities().find((e) => e.kind === KIND.CREEP && e.groupId === group.id);
      const from = leader ? [[leader.x, leader.z]] : [];
      paths.push({ points: tiles([...from, ...group.waypoints.slice(group.wpIndex)]), color: 0xffd76a });
    }
    const e = selected === null ? undefined : view.entities().find((x) => x.id === selected);
    if (e && e.kind === KIND.BARRACKS && e.waypoints.length > 0) paths.push({ points: tiles([[e.x, e.z], ...e.waypoints]), color: 0xffd76a });
    if (mode === 'path') paths.push({ points: tiles(pathPoints), color: 0xffffff });
    return paths;
  }

  if (!spectator) {
    orderWindow = createOrderWindow({
      parent: root.parentElement ?? root,
      view,
      viewerTeam,
      tickHz,
      heroNames,
      itemNames,
      pending: () => pending,
      cancel: (order) => void issue({ t: 'cancelQueue', barracksId: order.barracksId, orderId: order.id }),
    });
  }

  const api = {
    /** Called for every tap on the ground canvas. @param {{ x: number, z: number }} ground */
    async tap(ground) {
      if (spectator) return;
      const result = resolveTap({
        ground,
        entities: view.entities(),
        viewerTeam,
        building,
        attack,
        coreLuxMilli: view.team(viewerTeam).coreLux,
        data,
        vents: view.map().vents,
        mode,
        selectedGroup,
        pathCount: pathPoints.length,
        ability,
        item: itemAim,
      });
      if ('command' in result) {
        ability = null;
        itemAim = null;
        // A placed building ends build mode at once, so a second tap cannot place a second one.
        if (endsBuildMode(result.command)) {
          building = null;
          render();
        }
        if (result.deselect) {
          selected = null;
          selectedGroup = null;
        }
        await issue(result.command);
        if (mode === 'merge') mode = null;
      } else if ('ghost' in result) {
        ghost = result.ghost;
        if (result.message) say(result.message);
      } else if ('message' in result) say(result.message);
      else if ('addWaypoint' in result) pathPoints.push(result.addWaypoint);
      else if ('selectGroup' in result) {
        selectedGroup = result.selectGroup;
        selected = null;
        mode = null;
      } else if ('select' in result) {
        selected = result.select;
        selectedGroup = null;
      }
      render();
    },
    /** A right click on the map cancels the current action (GDD 11.1) and leaves nothing selected. */
    cancel() {
      if (spectator) return;
      if (!cancelAction({ building, ghost: ghost !== null, ability, item: itemAim, mode, selected, selectedGroup }).cancelled) return;
      building = null;
      ghost = null;
      ability = null;
      itemAim = null;
      mode = null;
      pathTarget = null;
      pathPoints = [];
      selected = null;
      selectedGroup = null;
      say('Cancelled.');
      render();
    },
    /** Selects a creep group by id, as a tap on one of its creeps does. @param {number} id */
    selectGroup(id) {
      selectedGroup = id;
      selected = null;
      mode = null;
      render();
    },
    /** Called once per frame; refreshes affordability and the panel. */
    update: render,
    overlay,
    say,
    /** The build ghost to draw: its tile and whether the building could go there now, or null. */
    ghost() {
      if (!building || !ghost) return null;
      return { tileX: ghost.tileX, tileZ: ghost.tileZ, valid: !('message' in ghostCheck()) };
    },
    /** Where a held ability would land, in tiles, or null when no aim drag is going. */
    aim: () => aimPoint,
  };
  return api;
}

/** Whether a pointer event lies over an element. @param {HTMLElement} node @param {PointerEvent} e */
function overButton(node, e) {
  const r = node.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

/**
 * @param {string} tag @param {string} className @param {string} [text]
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {(message: string) => void} say */
function loadKeyBindings(say) {
  let saved;
  try {
    saved = window.localStorage.getItem(KEY_BINDINGS_STORAGE_KEY);
  } catch {
    say('Could not read saved key assignments; using defaults.');
    return defaultKeyBindings();
  }
  if (saved === null) return defaultKeyBindings();
  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch {
    say('Saved key assignments are invalid; using defaults.');
    return defaultKeyBindings();
  }
  const bindings = normalizeKeyBindings(parsed);
  if (JSON.stringify(bindings) !== JSON.stringify(parsed)) say('Saved key assignments are invalid; using defaults.');
  return bindings;
}

/** @param {{ abilities: string[], items: string[] }} bindings @param {(message: string) => void} say */
function saveKeyBindings(bindings, say) {
  try {
    window.localStorage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    say('Could not save key assignments on this device.');
  }
}

/** @param {EventTarget | null} target */
function isTextEntry(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}
