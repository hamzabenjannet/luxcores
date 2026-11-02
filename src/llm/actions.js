// @ts-check
/**
 * The vocabulary a language model may speak, and the translation into sim
 * commands.
 *
 * A model answers with `{"actions": [...], "note": "..."}`. Every action names
 * whole tiles and whole lux, which `toCommand` converts into the units of
 * `src/sim/commands.js`. An action this file does not know, or one with a field
 * of the wrong type, is dropped with a reason that the driver logs.
 *
 * This translation is a filter, never an authority: the sim validates each
 * command again and drops what the rules refuse (`validateAndApply`). The
 * filter exists so a wild answer cannot reach the sim as a storm of commands,
 * and so the driver can tell the owners what the model got wrong.
 */

import { UNITS_PER_TILE } from '../sim/index.js';
import { BUILDINGS } from './observation.js';

/** Attack types of a tower and of a creep. */
const ATTACKS = /** @type {const} */ (['melee', 'ranged', 'area']);
/** Creeps one order may hold (`creep.groupMax` in data/balance.json is 5). */
const MAX_MIX = 5;
/** Waypoints one path may hold (`creep.maxWaypoints`). */
const MAX_WAYPOINTS = 10;
/** Actions the driver keeps from one answer. The rest is dropped. */
export const MAX_ACTIONS = 4;

/**
 * The vocabulary, as the system prompt states it. One line per action, because
 * a small model follows a list better than a paragraph.
 */
export const ACTION_DOC = `build      {"action":"build","building":"solar|wind|geothermal|nuclear|barracks|tower","tile":[x,z],"attack":"melee|ranged|area"}  attack is for a tower only
upgrade    {"action":"upgrade","towerId":12,"track":"power|shell"}
recycle    {"action":"recycle","buildingId":12}
creeps     {"action":"creeps","barracksId":9,"mix":["melee","ranged","area"]}  one to five creeps
groupPath  {"action":"groupPath","groupId":3,"tiles":[[x,z],[x,z]]}  up to ten tiles
pickHero   {"action":"pickHero","heroId":0,"lux":40,"barracksId":9}
heroMove   {"action":"heroMove","tile":[x,z]}
heroAttack {"action":"heroAttack","targetId":31}
ability    {"action":"ability","slot":0,"targetId":31,"tile":[x,z]}  slot 0 melee, 1 ranged, 2 area, 3 shield; targetId or tile as the slot needs
wait       {"action":"wait"}`;

/**
 * @typedef {Object} ParsedPlan
 * @property {Record<string, unknown>[]} actions
 * @property {string} note      what the model said about its plan, trimmed
 * @property {string} [error]   set when the answer was no usable plan
 */

/**
 * Reads the model's answer. It accepts the documented object, a bare array, and
 * a single action object, because small models return all three. Text around
 * the JSON is cut away.
 * @param {string} text
 * @returns {ParsedPlan}
 */
export function parsePlan(text) {
  const json = extractJson(text);
  if (json === null) return { actions: [], note: '', error: 'the answer holds no JSON' };
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { actions: [], note: '', error: `the JSON does not parse (${err instanceof Error ? err.message : String(err)})` };
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.actions) ? data.actions : data?.action !== undefined ? [data] : null;
  if (!list) return { actions: [], note: '', error: 'the answer holds no actions array' };
  const actions = list.filter((/** @type {unknown} */ a) => a !== null && typeof a === 'object' && !Array.isArray(a)).slice(0, MAX_ACTIONS);
  const note = typeof data?.note === 'string' ? data.note.slice(0, 200) : '';
  return { actions, note };
}

/**
 * The first JSON object or array in a text, or null. A model that wraps its
 * answer in a code fence or in a sentence still gets read.
 * @param {string} text
 * @returns {string | null}
 */
export function extractJson(text) {
  const trimmed = String(text).replace(/```[a-z]*\n?/gi, '').trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) return null;
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return trimmed.slice(start, i + 1);
  }
  return null;
}

/** The action names the model may use, with the field a bare value fills in. */
const BARE_FIELD = /** @type {Record<string, string>} */ ({
  build: 'building',
  upgrade: 'towerId',
  recycle: 'buildingId',
  creeps: 'barracksId',
  orderCreeps: 'barracksId',
  groupPath: 'groupId',
  setGroupPath: 'groupId',
  pickHero: 'heroId',
  heroMove: 'tile',
  heroAttack: 'targetId',
  ability: 'slot',
  castAbility: 'slot',
  wait: 'wait',
  none: 'none',
  pass: 'pass',
});

/**
 * The action name and its fields. A model that writes `{"action": "build", ...}`
 * is read as it stands. One that writes the name as the key instead, such as
 * `{"build": "barracks"}`, is read the same way: the name comes from the key and
 * its value fills the field that name expects. Small models write both.
 * @param {Record<string, unknown>} action
 * @returns {{ name: string, fields: Record<string, unknown> }}
 */
export function readAction(action) {
  for (const key of ['action', 't', 'type', 'name']) {
    const value = action[key];
    if (typeof value === 'string' && value !== '') return { name: value, fields: action };
  }
  for (const key of Object.keys(action)) {
    const field = BARE_FIELD[key];
    if (field === undefined) continue;
    const value = action[key];
    const fields = { ...action };
    if (field !== key && fields[field] === undefined && (typeof value === 'string' || typeof value === 'number' || Array.isArray(value))) {
      fields[field] = value;
    }
    return { name: key, fields };
  }
  return { name: '', fields: action };
}

/**
 * One action as a sim command, or the reason it was dropped. `ctx` holds what
 * the action is checked against: the player's own entity ids and the map size.
 * @param {Record<string, unknown>} action
 * @param {{ ownIds: ReadonlySet<number>, groupIds: ReadonlySet<number>, mapWidth: number, mapHeight: number }} ctx
 * @returns {{ ok: true, cmd: import('../sim/commands.js').Command } | { ok: false, reason: string }}
 */
export function toCommand(action, ctx) {
  const { name, fields } = readAction(action);
  switch (name) {
    case 'wait':
    case 'none':
    case 'pass':
      return { ok: false, reason: 'wait' };
    case 'build': {
      const building = String(fields.building ?? '');
      if (!BUILDINGS.includes(/** @type {any} */ (building))) return { ok: false, reason: `build names no building (${building})` };
      const tile = tileOf(fields.tile, ctx);
      if (!tile) return { ok: false, reason: 'build needs a tile [x, z] inside the map' };
      const attack = String(fields.attack ?? 'ranged');
      return {
        ok: true,
        cmd: {
          t: 'build',
          building,
          tileX: tile[0],
          tileZ: tile[1],
          ...(building === 'tower' ? { attack: ATTACKS.includes(/** @type {any} */ (attack)) ? attack : 'ranged' } : {}),
        },
      };
    }
    case 'upgrade': {
      const towerId = idOf(fields.towerId ?? fields.id, ctx);
      if (towerId === null) return { ok: false, reason: 'upgrade names no tower of this player' };
      const track = fields.track === 'shell' ? 'shell' : 'power';
      return { ok: true, cmd: { t: 'upgrade', towerId, track } };
    }
    case 'recycle': {
      const buildingId = idOf(fields.buildingId ?? fields.id, ctx);
      if (buildingId === null) return { ok: false, reason: 'recycle names no building of this player' };
      return { ok: true, cmd: { t: 'recycle', buildingId } };
    }
    case 'creeps':
    case 'orderCreeps': {
      const barracksId = idOf(fields.barracksId ?? fields.id, ctx);
      if (barracksId === null) return { ok: false, reason: 'creeps names no barracks of this player' };
      const raw = Array.isArray(fields.mix) ? fields.mix : [];
      const mix = raw.map((m) => String(m)).filter((m) => ATTACKS.includes(/** @type {any} */ (m))).slice(0, MAX_MIX);
      if (mix.length === 0) return { ok: false, reason: 'creeps needs a mix of melee, ranged or area' };
      return { ok: true, cmd: { t: 'orderCreeps', barracksId, mix: /** @type {('melee'|'ranged'|'area')[]} */ (mix) } };
    }
    case 'groupPath':
    case 'setGroupPath': {
      const groupId = Number(fields.groupId);
      if (!ctx.groupIds.has(groupId)) return { ok: false, reason: 'groupPath names no group of this player' };
      const tiles = Array.isArray(fields.tiles) ? fields.tiles : Array.isArray(fields.waypoints) ? fields.waypoints : [];
      const waypoints = tiles
        .map((/** @type {unknown} */ t) => tileOf(t, ctx))
        .filter((/** @type {number[] | null} */ t) => t !== null)
        .slice(0, MAX_WAYPOINTS)
        .map((/** @type {number[]} */ t) => [t[0] * UNITS_PER_TILE + UNITS_PER_TILE / 2, t[1] * UNITS_PER_TILE + UNITS_PER_TILE / 2]);
      if (waypoints.length === 0) return { ok: false, reason: 'groupPath needs tiles inside the map' };
      return { ok: true, cmd: { t: 'setGroupPath', groupId, waypoints } };
    }
    case 'pickHero': {
      const barracksId = idOf(fields.barracksId ?? fields.id, ctx);
      if (barracksId === null) return { ok: false, reason: 'pickHero names no barracks of this player' };
      const heroId = Number(fields.heroId);
      const lux = Number(fields.lux);
      if (!Number.isInteger(heroId) || heroId < 0) return { ok: false, reason: 'pickHero needs a whole heroId' };
      if (!Number.isInteger(lux) || lux < 1) return { ok: false, reason: 'pickHero needs the whole lux to spend' };
      return { ok: true, cmd: { t: 'pickHero', heroId, lux, barracksId } };
    }
    case 'heroMove': {
      const tile = tileOf(fields.tile, ctx);
      if (!tile) return { ok: false, reason: 'heroMove needs a tile [x, z] inside the map' };
      return { ok: true, cmd: { t: 'heroMove', x: tile[0] * UNITS_PER_TILE + UNITS_PER_TILE / 2, z: tile[1] * UNITS_PER_TILE + UNITS_PER_TILE / 2 } };
    }
    case 'heroAttack': {
      const targetId = Number(fields.targetId ?? fields.id);
      if (!Number.isInteger(targetId) || targetId <= 0) return { ok: false, reason: 'heroAttack needs a targetId' };
      return { ok: true, cmd: { t: 'heroAttack', targetId } };
    }
    case 'ability':
    case 'castAbility': {
      const slot = Number(fields.slot);
      if (![0, 1, 2, 3].includes(slot)) return { ok: false, reason: 'ability needs a slot from 0 to 3' };
      const targetId = Number(fields.targetId);
      const tile = tileOf(fields.tile, ctx);
      return {
        ok: true,
        cmd: {
          t: 'castAbility',
          slot: /** @type {0|1|2|3} */ (slot),
          ...(Number.isInteger(targetId) && targetId > 0 ? { targetId } : {}),
          ...(tile ? { x: tile[0] * UNITS_PER_TILE + UNITS_PER_TILE / 2, z: tile[1] * UNITS_PER_TILE + UNITS_PER_TILE / 2 } : {}),
        },
      };
    }
    default:
      return { ok: false, reason: `unknown action ${name || '(none)'}` };
  }
}

/**
 * A tile pair the map holds, as `[x, z]`. It accepts `[x, z]` and
 * `{ x, z }`, because models write both.
 * @param {unknown} value
 * @param {{ mapWidth: number, mapHeight: number }} ctx
 * @returns {number[] | null}
 */
function tileOf(value, ctx) {
  const pair = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object'
      ? [/** @type {any} */ (value).x, /** @type {any} */ (value).z ?? /** @type {any} */ (value).y]
      : null;
  if (!pair || pair.length < 2) return null;
  const x = Math.floor(Number(pair[0]));
  const z = Math.floor(Number(pair[1]));
  if (!Number.isInteger(x) || !Number.isInteger(z)) return null;
  if (x < 0 || z < 0 || x >= ctx.mapWidth || z >= ctx.mapHeight) return null;
  return [x, z];
}

/**
 * An entity id the player owns, or null. It keeps the model from commanding an
 * enemy building, which the sim would refuse anyway.
 * @param {unknown} value
 * @param {{ ownIds: ReadonlySet<number> }} ctx
 */
function idOf(value, ctx) {
  const id = Number(value);
  return Number.isInteger(id) && ctx.ownIds.has(id) ? id : null;
}
