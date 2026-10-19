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
const PENDING_MS = 3000;

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

/** Initial of an attack code, as the queue text shows it: M, R or A. */
const ATTACK_INITIAL = /** @type {Record<number, string>} */ ({ 1: 'M', 2: 'R', 3: 'A' });

/** Order type codes of a hero pick and an item in `Order.type` (`ORDER_TYPE` in src/sim/creeps.js). */
const HERO_ORDER = 2;
const ITEM_ORDER = 3;

/**
 * Seconds as the UI writes them, rounded up to a tenth, with integer math only: 99 ticks at 20 Hz is "5.0s".
 * @param {number} ticks
 * @param {number} tickHz
 */
export function secondsText(ticks, tickHz) {
  const tenths = Math.floor((Math.max(0, ticks) * 10 + tickHz - 1) / tickHz);
  return `${Math.floor(tenths / 10)}.${tenths % 10}s`;
}

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
    text: o.type === HERO_ORDER
      ? `Hero ${heroNames[o.mix[0]] ?? '?'} ${o.mix[1]} lux ${secondsText(o.ticksLeft, tickHz)}`
      : o.type === ITEM_ORDER
        ? `Item ${itemNames[o.mix[0]] ?? '?'} ${o.held ? 'HELD' : secondsText(o.ticksLeft, tickHz)}`
        : `Group of ${o.mix.length} ${o.mix.map((c) => ATTACK_INITIAL[c] ?? '?').join('')} ${o.held ? 'HELD' : `${(Math.max(0, o.ticksLeft) / tickHz).toFixed(1)}s`}`,
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
 * What a tap does, as a command to send or a message to show. Pure: no DOM, no network.
 * A tap on the open map (a hero order, not a selection) carries `deselect`: the caller clears the selected
 * building and group, so the panel closes.
 *
 * @typedef {{ command: import('../../sim/commands.js').Command, deselect?: true } | { message: string } | { select: number | null } | { selectGroup: number } | { addWaypoint: number[] }} TapResult
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
    const zone = buildZoneOf({ mapgen: data.mapgen }, viewerTeam);
    if (tileZ < zone.z0 || tileZ > zone.z1 || tileX < 0 || tileX >= data.mapgen.width) return { message: 'Build inside your own zone.' };
    const taken = entities.some((e) => e.kind <= KIND.BLOCKER && Math.floor(e.x / UNITS_PER_TILE) === tileX && Math.floor(e.z / UNITS_PER_TILE) === tileZ);
    if (taken) return { message: 'That tile is taken.' };
    const info = data.buildings[building];
    if (info.requiresVent && !ctx.vents.some((v) => v.team === viewerTeam && v.tileX === tileX && v.tileZ === tileZ)) return { message: 'Geothermal needs a vent tile.' };
    if (!canAfford(ctx.coreLuxMilli, info.costLux, data.balance.core.minLeftAfterSpendLux)) return { message: `Not enough lux: ${building} costs ${info.costLux}.` };
    return { command: building === 'tower' ? { t: 'build', building, tileX, tileZ, attack } : { t: 'build', building, tileX, tileZ } };
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
 * }} opts
 */
export function createControls({ root, view, viewerTeam, spectator, tickHz, data, send, camera }) {
  /** @type {string | null} */
  let building = null;
  let attack = 'ranged';
  /** @type {number | null} */
  let selected = null;
  /** @type {number | null} */
  let selectedGroup = null;
  /** @type {'path' | 'merge' | null} */
  let mode = null;
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

  root.replaceChildren();
  const toast = el('div', 'toast');
  const panel = el('div', 'panel');
  const heroBar = el('div', 'hero-bar');
  const palette = el('div', 'palette');
  root.append(toast, panel, heroBar, palette);
  heroBar.hidden = true;
  if (spectator) {
    palette.hidden = true;
    panel.hidden = true;
  }
  const heroName = el('div', 'hero-name');
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
  /** @type {HTMLButtonElement[]} */
  const abilityButtons = ABILITY_SLOTS.map(({ slot, type, letter }) => {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'ability', letter));
    b.dataset.slot = String(slot);
    b.title = type;
    b.addEventListener('click', () => castFromBar(slot));
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

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  for (const item of PALETTE) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'tool'));
    b.dataset.building = item.key;
    b.append(el('span', 'tool-name', item.label), el('span', 'tool-cost', String(data.buildings[item.key].costLux)));
    b.addEventListener('click', () => {
      building = building === item.key ? null : item.key;
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
   * @param {import('../../sim/commands.js').Command} command
   * @param {{ barracksId: number, text: string }} [queued]  a barracks order: it shows in the queue at once, as a dim row
   */
  async function issue(command, queued) {
    const mark = queued && {
      id: ++pendingSeq,
      barracksId: queued.barracksId,
      text: queued.text,
      // The real orders of this barracks plus the dim rows already waiting: the order is in a snapshot once the real count passes it.
      base: view.orders().filter((o) => o.barracksId === queued.barracksId).length + pending.filter((p) => p.barracksId === queued.barracksId).length,
      expires: Infinity,
    };
    if (mark) {
      pending.push(mark);
      render();
    }
    try {
      const ack = await send(command);
      if (!ack.accepted) {
        drop(mark);
        say(ack.reason ?? 'The server refused the command.');
      } else if (mark) mark.expires = performance.now() + PENDING_MS;
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
    const now = performance.now();
    pending = pending.filter((p) => p.expires > now && view.orders().filter((o) => o.barracksId === p.barracksId).length <= p.base);
    const lux = view.team(viewerTeam).coreLux;
    for (const [key, b] of buttons) {
      b.classList.toggle('active', building === key);
      b.classList.toggle('poor', !canAfford(lux, data.buildings[key].costLux, minLeft));
    }
    attackRow.hidden = building !== 'tower';
    for (const b of attackRow.children) b.classList.toggle('active', /** @type {HTMLElement} */ (b).dataset.attack === attack);
    renderPanel();
    renderHeroBar();
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
  const queueList = el('div', 'queue');
  // The queue sits right under the actions (Recycle) and above the order controls. The panel hugs the
  // bottom of the screen, so a new queue row grows it upward and the buttons below stay where they are.
  panel.append(panelTitle, panelRow, queueList, orderRow, heroRow, shopRow);
  let panelKey = '';
  let orderKey = '';
  let heroKey = '';
  let shopKey = '';
  let queueKey = '';
  /** @type {Map<number, HTMLElement>} */
  const queueStatus = new Map();
  /** Orders sent and not yet in a snapshot; `expires` is Infinity until the server has answered. */
  let pending = /** @type {{ id: number, barracksId: number, text: string, base: number, expires: number }[]} */ ([]);
  let pendingSeq = 0;
  /** @type {HTMLButtonElement | undefined} */
  let orderButton;
  /** The hero lux choices of the latest render, which a hero button reads when it is pressed. */
  let heroChoices = /** @type {{ label: string, lux: number }[]} */ ([]);
  /** @type {HTMLElement | undefined} */
  let heroNote;
  /** @type {Map<string, HTMLElement>} */
  const heroAllocButtons = new Map();
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
    const group = selectedGroup === null ? undefined : view.groups().find((g) => g.id === selectedGroup);
    if (selectedGroup !== null && !group) {
      selectedGroup = null;
      if (mode === 'merge') mode = null;
    }
    if (group) return renderGroupPanel(group);
    const e = selected === null ? undefined : view.entities().find((x) => x.id === selected);
    if (!e) {
      selected = null;
      panelKey = orderKey = heroKey = shopKey = queueKey = '';
      shopRow.replaceChildren();
      panel.hidden = true;
      return;
    }
    renderBuildingPanel(e);
  }

  /** @param {number} sizeNow */
  function pathTitle(sizeNow) {
    return `Path: ${sizeNow}/${data.balance.creep.maxWaypoints} waypoints. Tap the map to add one.`;
  }

  function renderPathBar() {
    panel.hidden = false;
    orderRow.replaceChildren();
    heroRow.replaceChildren();
    queueList.replaceChildren();
    shopRow.replaceChildren();
    orderKey = heroKey = shopKey = queueKey = '';
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
    queueList.replaceChildren();
    shopRow.replaceChildren();
    orderKey = heroKey = shopKey = queueKey = '';
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
    const key = `${e.id}|${actions.map((a) => `${a.id}:${a.poor}`).join(',')}`;
    if (key !== panelKey) {
      panelKey = key;
      panelRow.replaceChildren(...actions.map((action) => {
        const b = button(action.label, () => issue(action.command));
        if (action.costLux !== undefined) b.append(el('span', 'tool-cost', String(action.costLux)));
        b.classList.toggle('poor', action.poor);
        return b;
      }));
    }
    if (e.kind === KIND.BARRACKS && e.recycle === 0) renderBarracks(e, lux);
    else {
      orderRow.replaceChildren();
      heroRow.replaceChildren();
      queueList.replaceChildren();
      shopRow.replaceChildren();
    orderKey = heroKey = shopKey = queueKey = '';
    }
  }

  /**
   * Order controls and the queue of a barracks. A control is built once and then updated in place:
   * lux changes every tick, and a button replaced between a press and its release loses the click.
   * @param {import('../../sim/state.js').Entity} e @param {number} lux
   */
  function renderBarracks(e, lux) {
    const cost = orderCount * data.balance.creep.costLux; // whole lux: the data files are not converted
    const poor = !canAfford(lux, cost, minLeft);
    const key = `${e.id}|${orderCount}|${orderType}|${e.waypoints.length}`;
    if (key !== orderKey) {
      orderKey = key;
      const counts = el('div', 'segments');
      for (let n = data.balance.creep.groupMin; n <= data.balance.creep.groupMax; n++) {
        const b = button(String(n), () => { orderCount = n; render(); }, n === orderCount ? 'segment active' : 'segment');
        b.dataset.count = String(n);
        counts.append(b);
      }
      const types = el('div', 'segments');
      for (const t of ORDER_TYPES) {
        const b = button(t.charAt(0).toUpperCase() + t.slice(1), () => { orderType = t; render(); }, t === orderType ? 'segment active' : 'segment');
        b.dataset.orderType = t;
        types.append(b);
      }
      const mix = mixFor(orderCount, orderType);
      orderButton = button(`Order ${orderCount}`, () => issue({ t: 'orderCreeps', barracksId: e.id, mix }, { barracksId: e.id, text: pendingLine({ t: 'orderCreeps', mix }) }), 'action order');
      orderButton.append(el('span', 'tool-cost', String(cost)));
      const path = button(e.waypoints.length > 0 ? 'Default Path' : 'Set Default Path', () => {
        mode = 'path';
        pathTarget = { type: 'barracks', id: e.id };
        pathPoints = [];
        render();
      });
      const rows = [counts, types, orderButton, path];
      if (e.waypoints.length > 0) rows.push(button('Clear Path', () => issue({ t: 'setBarracksPath', barracksId: e.id, waypoints: [] })));
      orderRow.replaceChildren(...rows);
    }
    orderButton?.classList.toggle('poor', poor);
    renderHeroPicks(e, lux);
    renderShop(e, lux);
    renderQueue(e);
  }

  /**
   * The queue of a barracks, above the order controls so a new row never moves them. Orders just sent
   * show at once as dim rows and give way to the real rows when the next snapshot has them.
   * @param {import('../../sim/state.js').Entity} e
   */
  function renderQueue(e) {
    const lines = queueLines(view.orders(), e.id, tickHz, heroNames, itemNames);
    const waiting = pending.filter((p) => p.barracksId === e.id);
    const lineKey = `${e.id}|${view.orders().filter((o) => o.barracksId === e.id).map((o) => `${o.id}:${o.held}`).join(',')}|${waiting.map((p) => p.id).join(',')}`;
    if (lineKey !== queueKey) {
      queueKey = lineKey;
      queueStatus.clear();
      queueList.replaceChildren(
        ...lines.map((line) => {
          const row = el('div', 'queue-row');
          const text = el('span', 'queue-text', line.text);
          queueStatus.set(line.index, text);
          row.append(text, button('✕', () => issue({ t: 'cancelQueue', barracksId: e.id, orderId: line.orderId }), 'action cancel'));
          return row;
        }),
        ...waiting.map((p) => {
          const row = el('div', 'queue-row pending');
          const cancel = /** @type {HTMLButtonElement} */ (button('✕', () => {}, 'action cancel'));
          cancel.disabled = true;
          row.append(el('span', 'queue-text', p.text), cancel);
          return row;
        }),
      );
    } else {
      for (const line of lines) {
        const node = queueStatus.get(line.index);
        if (node && node.textContent !== line.text) node.textContent = line.text;
      }
    }
  }

  /**
   * The hero part of a barracks panel (GDD 7.1): the lux to allocate and the roster, with locked heroes
   * and the death cooldown shown. A tap on a hero picks it at this barracks.
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
      heroAllocButtons.clear();
      const allocation = el('div', 'segments');
      for (const c of heroChoices) {
        const b = button('', () => { heroAlloc = c.label; render(); }, 'segment');
        b.dataset.alloc = c.label;
        heroAllocButtons.set(c.label, b);
        allocation.append(b);
      }
      const heroes = el('div', 'segments');
      for (const o of pickState.options) {
        const b = button(`${o.name} ${o.primary.charAt(0).toUpperCase()}`, () => {
          const now = heroChoices.find((c) => c.label === heroAlloc) ?? heroChoices[0];
          if (!now) return say('Not enough lux for a hero.');
          issue({ t: 'pickHero', heroId: o.id, lux: now.lux, barracksId: e.id }, { barracksId: e.id, text: pendingLine({ t: 'pickHero', heroId: o.id, lux: now.lux }, heroNames) });
        }, o.enabled ? 'segment hero-pick' : 'segment hero-pick poor');
        b.dataset.hero = String(o.id);
        if (o.locked) b.title = 'Locked until the other heroes were picked';
        heroes.append(b);
      }
      heroNote = el('div', 'hero-note');
      heroRow.replaceChildren(heroNote, allocation, heroes);
    }
    const note = pickState.note ? `Hero: ${pickState.note}` : 'Hero: pick one, with the lux below';
    if (heroNote && heroNote.textContent !== note) heroNote.textContent = note;
    for (const c of heroChoices) {
      const b = heroAllocButtons.get(c.label);
      if (!b) continue;
      const text = `${c.label} ${c.lux}`;
      if (b.textContent !== text) b.textContent = text;
      b.classList.toggle('active', c === chosen);
    }
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
        const b = button(s.name, () => issue({ t: 'orderItem', barracksId: e.id, itemId: s.id }, { barracksId: e.id, text: pendingLine({ t: 'orderItem', itemId: s.id }, heroNames, itemNames) }), 'segment shop-item');
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

  return {
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
  };
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
