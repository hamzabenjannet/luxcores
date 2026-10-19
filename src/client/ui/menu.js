// @ts-check
/**
 * The start menu: pick a name and a way to play. It resolves with the choice,
 * and the page then joins or opens the match on the server. URL parameters skip
 * the menu (see main.js), so tests and shared links go straight in.
 */

import { entropyFromText, entropyText, tickCapFromText } from '../entity-text.js';

/**
 * @typedef {Object} MenuChoice
 * @property {string} name
 * @property {string} matchId  'new' or an existing id
 * @property {boolean} vsBot
 * @property {boolean} botVsBot
 * @property {number | undefined} seed
 * @property {number | undefined} maxTicks  tick limit of a match this player creates, 0 for unlimited; undefined keeps the server's limit
 * @property {number | undefined} entropy  entropy rate in tenths of a percent of the maximum HP per second, for a match this player creates; undefined keeps the default
 */

const NAME_KEY = 'luxcores.playerName';

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
 * @param {HTMLElement} root
 * @param {{ server: string, error?: string, entropyDefault?: number, capDefault?: number, lastMatch?: string }} opts  `lastMatch` is the id of the match this browser was in last, offered as a rejoin;  `entropyDefault` is the rate of data/balance.json, in tenths of a percent per second; `capDefault` is the tick limit it suggests for a capped match
 * @returns {Promise<MenuChoice>}
 */
export function showMenu(root, { server, error, entropyDefault = 1, capDefault = 10000, lastMatch }) {
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
    const problem = div('error');
    problem.hidden = true;
    card.append(label('Name', name), label('Seed', seed), label('Match type', matchType), capLabel, problem, label('Entropy % per second', entropy));

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
