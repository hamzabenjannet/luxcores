// @ts-check
/**
 * The start menu: pick a name and a way to play. It resolves with the choice,
 * and the page then joins or opens the match on the server. URL parameters skip
 * the menu (see main.js), so tests and shared links go straight in.
 */

/**
 * @typedef {Object} MenuChoice
 * @property {string} name
 * @property {string} matchId  'new' or an existing id
 * @property {boolean} vsBot
 * @property {boolean} botVsBot
 * @property {number | undefined} seed
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
 * @param {{ server: string, error?: string }} opts
 * @returns {Promise<MenuChoice>}
 */
export function showMenu(root, { server, error }) {
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
    const matchId = /** @type {HTMLInputElement} */ (document.createElement('input'));
    matchId.placeholder = 'Match id to join';
    card.append(label('Name', name), label('Seed', seed));

    /** @param {Partial<MenuChoice>} part */
    const choose = (part) => {
      const chosen = name.value.trim() || 'Guest';
      remember(chosen);
      const seedValue = Number(seed.value);
      root.hidden = true;
      resolve({ name: chosen, matchId: 'new', vsBot: false, botVsBot: false, seed: seed.value.trim() !== '' && Number.isSafeInteger(seedValue) ? seedValue : undefined, ...part });
    };

    card.append(
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
