// @ts-check
/**
 * Player controls of the web client: a build palette, a panel for the selected
 * building (recycle, tower upgrades) and hero orders. Every action becomes a
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
 *
 * @typedef {{ command: import('../../sim/commands.js').Command } | { message: string } | { select: number | null } | { building: string | null }} TapResult
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
 * }} ctx
 * @returns {TapResult}
 */
export function resolveTap(ctx) {
  const { ground, entities, viewerTeam, building, attack, data } = ctx;
  const tileX = Math.floor(ground.x);
  const tileZ = Math.floor(ground.z);

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

  const picked = pickEntity(entities, ground);
  const hero = entities.find((e) => e.kind === KIND.HERO && e.owner === viewerTeam);
  if (picked && BUILDING_KINDS.has(picked.kind) && picked.owner === viewerTeam) return { select: picked.id };
  if (picked && hero && picked.id !== hero.id && picked.team !== viewerTeam) return { command: { t: 'heroAttack', targetId: picked.id } };
  if (hero) return { command: { t: 'heroMove', x: Math.round(ground.x * UNITS_PER_TILE), z: Math.round(ground.z * UNITS_PER_TILE) } };
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
 *   data: { buildings: any, balance: any, mapgen: any },
 *   send: (cmd: import('../../sim/commands.js').Command) => Promise<{ accepted: boolean, reason?: string }>,
 * }} opts
 */
export function createControls({ root, view, viewerTeam, spectator, data, send }) {
  /** @type {string | null} */
  let building = null;
  let attack = 'ranged';
  /** @type {number | null} */
  let selected = null;
  let toastTimer = 0;

  root.replaceChildren();
  const toast = el('div', 'toast');
  const panel = el('div', 'panel');
  const palette = el('div', 'palette');
  root.append(toast, panel, palette);
  if (spectator) {
    palette.hidden = true;
    panel.hidden = true;
  }

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  for (const item of PALETTE) {
    const b = /** @type {HTMLButtonElement} */ (el('button', 'tool'));
    b.dataset.building = item.key;
    b.append(el('span', 'tool-name', item.label), el('span', 'tool-cost', String(data.buildings[item.key].costLux)));
    b.addEventListener('click', () => {
      building = building === item.key ? null : item.key;
      selected = null;
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

  /** @param {import('../../sim/commands.js').Command} command */
  async function issue(command) {
    try {
      const ack = await send(command);
      if (!ack.accepted) say(ack.reason ?? 'The server refused the command.');
    } catch (err) {
      say(`Command failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function render() {
    const lux = view.team(viewerTeam).coreLux;
    for (const [key, b] of buttons) {
      b.classList.toggle('active', building === key);
      b.classList.toggle('poor', !canAfford(lux, data.buildings[key].costLux, data.balance.core.minLeftAfterSpendLux));
    }
    attackRow.hidden = building !== 'tower';
    for (const b of attackRow.children) b.classList.toggle('active', /** @type {HTMLElement} */ (b).dataset.attack === attack);
    renderPanel();
  }

  const panelTitle = el('div', 'panel-title');
  const panelRow = el('div', 'panel-row');
  panel.append(panelTitle, panelRow);
  let panelKey = '';

  /** Updates the title every call, and rebuilds the buttons only when they change, so a click never lands on a replaced button. */
  function renderPanel() {
    const e = selected === null ? undefined : view.entities().find((x) => x.id === selected);
    if (!e) {
      selected = null;
      panelKey = '';
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panelTitle.textContent = `${entityText(e, data.balance.hpFactor) ?? 'Entity'}${e.kind === KIND.TOWER ? ` (${ATTACK_NAMES[e.attack] ?? '?'})` : ''}`;
    const lux = view.team(viewerTeam).coreLux;
    const actions = actionsFor(e, data.buildings.tower).map((action) => ({
      ...action,
      poor: action.costLux !== undefined && !canAfford(lux, action.costLux, data.balance.core.minLeftAfterSpendLux),
    }));
    const key = `${e.id}|${actions.map((a) => `${a.id}:${a.poor}`).join(',')}`;
    if (key === panelKey) return;
    panelKey = key;
    panelRow.replaceChildren(...actions.map((action) => {
      const b = /** @type {HTMLButtonElement} */ (el('button', 'action', action.label));
      if (action.costLux !== undefined) b.append(el('span', 'tool-cost', String(action.costLux)));
      b.classList.toggle('poor', action.poor);
      b.addEventListener('click', () => issue(action.command));
      return b;
    }));
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
      });
      if ('command' in result) await issue(result.command);
      else if ('message' in result) say(result.message);
      else if ('select' in result) selected = result.select;
      render();
    },
    /** Called once per frame; refreshes affordability and the panel. */
    update: render,
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
