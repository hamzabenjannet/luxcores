// @ts-check
/**
 * The start menu: pick a name and a way to play. It resolves with the choice,
 * and the page then joins or opens the match on the server. URL parameters skip
 * the menu (see main.js), so tests and shared links go straight in.
 */

import { creepCapFromText, entropyFromText, entropyText, llmBotState, tickCapFromText } from '../entity-text.js';

/**
 * @typedef {Object} MenuChoice
 * @property {string} name
 * @property {string} matchId  'new' or an existing id
 * @property {boolean} vsBot
 * @property {boolean} botVsBot
 * @property {number | undefined} seed
 * @property {number | undefined} maxTicks  tick limit of a match this player creates, 0 for unlimited; undefined keeps the server's limit
 * @property {number | undefined} entropy  entropy rate in tenths of a percent of the maximum HP per second, for a match this player creates; undefined keeps the default
 * @property {number | undefined} creepCap  creeps alive per player, for a match this player creates; undefined keeps the default
 * @property {{ endpoint: string, model: string } | undefined} llm  the Ollama model that drives the bot of this match; undefined leaves the scripted bot, which is the default
 */

const NAME_KEY = 'luxcores.playerName';
/** The language model switch and its fields, remembered per browser. */
const LLM_KEY = 'luxcores.llmBot';

/** localStorage can be missing or blocked, so every access is guarded. */
function remembered() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** @param {string} name */
function remember(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // The menu simply starts empty next time.
  }
}

/**
 * The language model switch as this browser last left it. It starts off, so a
 * player who never turned it on plays the scripted bot.
 * @param {{ defaultEndpoint: string, defaultModel: string }} defaults
 * @returns {{ on: boolean, endpoint: string, model: string }}
 */
function rememberedLlm(defaults) {
  const blank = { on: false, endpoint: defaults.defaultEndpoint, model: defaults.defaultModel };
  try {
    const saved = JSON.parse(localStorage.getItem(LLM_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return blank;
    return { on: saved.on === true, endpoint: typeof saved.endpoint === 'string' && saved.endpoint !== '' ? saved.endpoint : blank.endpoint, model: typeof saved.model === 'string' && saved.model !== '' ? saved.model : blank.model };
  } catch {
    return blank;
  }
}

/** @param {{ on: boolean, endpoint: string, model: string }} settings */
function rememberLlm(settings) {
  try {
    localStorage.setItem(LLM_KEY, JSON.stringify(settings));
  } catch {
    // The switch simply starts off next time.
  }
}

/**
 * @param {HTMLElement} root
 * @param {{ server: string, error?: string, entropyDefault?: number, capDefault?: number, creepCapDefault?: number, lastMatch?: string, llm?: { available: boolean, defaultEndpoint: string, defaultModel: string, allowedHosts?: string[] } }} opts  `lastMatch` is the id of the match this browser was in last, offered as a rejoin;  `entropyDefault` is the rate of data/balance.json, in tenths of a percent per second; `capDefault` is the tick limit it suggests for a capped match; `creepCapDefault` is the creep cap of data/balance.json; `llm` is the language model block of `GET /api/game/spec`
 * @returns {Promise<MenuChoice>}
 */
export function showMenu(root, { server, error, entropyDefault = 1, capDefault = 10000, creepCapDefault = 120, lastMatch, llm }) {
  root.hidden = false;
  root.replaceChildren();
  return new Promise((resolve) => {
    const card = div('card');
    card.append(div('title', 'Luxcores'), div('subtitle', `Server ${server}`));
    if (error) card.append(div('error', error));

    const name = /** @type {HTMLInputElement} */ (document.createElement('input'));
    name.placeholder = 'Your name';
    name.maxLength = 24;
    name.value = remembered();
    const seed = /** @type {HTMLInputElement} */ (document.createElement('input'));
    seed.placeholder = 'Map seed (optional)';
    seed.inputMode = 'numeric';
    const entropy = /** @type {HTMLInputElement} */ (document.createElement('input'));
    entropy.inputMode = 'decimal';
    entropy.placeholder = `${entropyText(entropyDefault)} (default)`;
    entropy.title = 'Percent of the maximum HP that buildings, creeps and heroes lose per second, 0 to 100 with one decimal. The host of a match sets it.';
    const creepCap = /** @type {HTMLInputElement} */ (document.createElement('input'));
    creepCap.inputMode = 'numeric';
    creepCap.dataset.creepCap = '';
    creepCap.placeholder = `${creepCapDefault} (default)`;
    creepCap.title = 'Creeps a player may have alive at once, 1 to 1000. A high cap costs frame rate. The host of a match sets it.';
    const matchId = /** @type {HTMLInputElement} */ (document.createElement('input'));
    matchId.placeholder = 'Match id to join';
    const matchType = /** @type {HTMLSelectElement} */ (document.createElement('select'));
    matchType.title = 'Unlimited runs until a Core falls. Capped ends as a draw at the tick limit. The host of a match sets it.';
    matchType.append(new Option('Unlimited', 'unlimited'), new Option('Capped', 'capped'));
    const cap = /** @type {HTMLInputElement} */ (document.createElement('input'));
    cap.inputMode = 'numeric';
    cap.placeholder = `${capDefault} (ticks, 20 per second)`;
    cap.title = 'Ticks after which an undecided match ends as a draw, 1 to 1000000.';
    const capLabel = label('Tick limit', cap);
    capLabel.hidden = true;
    matchType.addEventListener('change', () => {
      capLabel.hidden = matchType.value !== 'capped';
      if (!capLabel.hidden) cap.focus();
    });
    // The language model bot: off until the player turns it on, and hidden on a server that runs none.
    const llmDefaults = { defaultEndpoint: llm?.defaultEndpoint ?? 'http://localhost:11434', defaultModel: llm?.defaultModel ?? 'qwen2.5:3b' };
    const savedLlm = rememberedLlm(llmDefaults);
    const llmSwitch = /** @type {HTMLInputElement} */ (document.createElement('input'));
    llmSwitch.type = 'checkbox';
    llmSwitch.dataset.llm = '';
    llmSwitch.checked = savedLlm.on;
    const llmEndpoint = /** @type {HTMLInputElement} */ (document.createElement('input'));
    llmEndpoint.dataset.llmEndpoint = '';
    llmEndpoint.placeholder = llmDefaults.defaultEndpoint;
    llmEndpoint.value = savedLlm.endpoint;
    llmEndpoint.title = `The Ollama server the backend asks, such as ${llmDefaults.defaultEndpoint}. This server calls the hosts ${(llm?.allowedHosts ?? ['localhost']).join(', ')} only.`;
    const llmModel = /** @type {HTMLInputElement} */ (document.createElement('input'));
    llmModel.dataset.llmModel = '';
    llmModel.placeholder = llmDefaults.defaultModel;
    llmModel.value = savedLlm.model;
    llmModel.title = 'The model as Ollama names it, such as qwen2.5:3b.';
    const llmNote = div('subtitle');
    const llmBox = div('llm');
    llmBox.append(label('Let a language model drive the bot', llmSwitch), label('Model endpoint', llmEndpoint), label('Model', llmModel), llmNote);
    const refreshLlm = () => {
      const state = llmBotState({ available: Boolean(llm?.available), on: llmSwitch.checked, endpoint: llmEndpoint.value, model: llmModel.value });
      llmEndpoint.hidden = !state.on;
      llmModel.hidden = !state.on;
      /** @type {HTMLElement} */ (llmEndpoint.parentElement).hidden = !state.on;
      /** @type {HTMLElement} */ (llmModel.parentElement).hidden = !state.on;
      llmNote.textContent = state.problem || state.note;
    };
    llmBox.hidden = !llm?.available;
    for (const control of [llmSwitch, llmEndpoint, llmModel]) control.addEventListener('change', refreshLlm);
    llmEndpoint.addEventListener('input', refreshLlm);
    llmModel.addEventListener('input', refreshLlm);
    refreshLlm();

    const problem = div('error');
    problem.hidden = true;
    card.append(label('Name', name), label('Seed', seed), label('Match type', matchType), capLabel, problem, label('Entropy % per second', entropy), label('Creep cap per player', creepCap), llmBox);

    /** @param {Partial<MenuChoice>} part */
    const choose = (part) => {
      const capped = matchType.value === 'capped';
      const capValue = tickCapFromText(cap.value.trim() === '' ? String(capDefault) : cap.value);
      if (capped && capValue < 0 && !part.matchId) {
        problem.textContent = 'The tick limit is a whole number from 1 to 1000000.';
        problem.hidden = false;
        cap.focus();
        return;
      }
      if (creepCap.value.trim() !== '' && creepCapFromText(creepCap.value) < 0 && !part.matchId) {
        problem.textContent = 'The creep cap is a whole number from 1 to 1000.';
        problem.hidden = false;
        creepCap.focus();
        return;
      }
      // A match against a bot may ask a model to drive it. The server refuses an endpoint it may not call.
      const llmState = llmBotState({ available: Boolean(llm?.available), on: llmSwitch.checked, endpoint: llmEndpoint.value, model: llmModel.value });
      const wantsBot = part.vsBot === true || part.botVsBot === true;
      if (llmState.on && llmState.problem !== '' && wantsBot) {
        problem.textContent = llmState.problem;
        problem.hidden = false;
        llmEndpoint.focus();
        return;
      }
      rememberLlm({ on: llmSwitch.checked, endpoint: llmEndpoint.value.trim(), model: llmModel.value.trim() });
      const chosen = name.value.trim() || 'Guest';
      remember(chosen);
      const seedValue = Number(seed.value);
      const entropyValue = entropyFromText(entropy.value);
      root.hidden = true;
      resolve({
        name: chosen,
        matchId: 'new',
        vsBot: false,
        botVsBot: false,
        seed: seed.value.trim() !== '' && Number.isSafeInteger(seedValue) ? seedValue : undefined,
        maxTicks: capped ? capValue : 0,
        entropy: entropyValue >= 0 ? entropyValue : undefined,
        creepCap: creepCapFromText(creepCap.value) >= 0 ? creepCapFromText(creepCap.value) : undefined,
        llm: llmState.on && llmState.problem === '' && wantsBot ? { endpoint: llmState.endpoint, model: llmState.model } : undefined,
        ...part,
      });
    };

    card.append(
      ...(lastMatch ? [button('Rejoin Last Match', () => choose({ matchId: lastMatch }))] : []),
      button('Play Against Bot', () => choose({ vsBot: true })),
      button('Watch Bot Against Bot', () => choose({ botVsBot: true })),
      button('Host a Match for Two', () => choose({})),
      matchId,
      button('Join Match', () => {
        if (matchId.value.trim()) choose({ matchId: matchId.value.trim() });
      }),
    );
    root.append(card);
  });
}

/** @param {string} className @param {string} [text] */
function div(className, text) {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} text @param {() => void} onClick */
function button(text, onClick) {
  const node = document.createElement('button');
  node.textContent = text;
  node.addEventListener('click', onClick);
  return node;
}

/** @param {string} text @param {HTMLElement} input */
function label(text, input) {
  const node = document.createElement('label');
  node.append(text, input);
  return node;
}
