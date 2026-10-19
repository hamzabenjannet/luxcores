// @ts-check
/**
 * Joining a match by id, and coming back to one. The server lets a player into an open lobby (`join`), but a
 * match the player already belongs to needs no join at all: the client just connects to it again. A
 * bot-versus-bot match has no seat, so it is watched. The Godot client answers the same cases
 * (test/fixtures/client-parity.json).
 */

/**
 * Which server call a join by id needs.
 * @param {{ botVsBot: boolean, mine: boolean }} ctx  `mine` is whether the signed-in player is already in the match's player list
 * @returns {'join' | 'none'} `join` takes a seat in an open lobby; `none` connects to the match as it is (a rejoin, or a watch)
 */
export function joinCall({ botVsBot, mine }) {
  return botVsBot || mine ? 'none' : 'join';
}

const KEY = 'luxcores.lastMatch';

/**
 * Remembers the match this page is in, so the menu can offer to rejoin it after a closed tab or a crash.
 * @param {string} server
 * @param {string} id
 */
export function rememberMatch(server, id) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ server, id }));
  } catch {
    // Storage can be blocked; the menu then simply offers no rejoin.
  }
}

/** Forgets the remembered match: the player left it, or it is over. */
export function forgetMatch() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/**
 * The remembered match id for a server, or undefined.
 * @param {string} server
 * @returns {string | undefined}
 */
export function recallMatch(server) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return saved && saved.server === server && typeof saved.id === 'string' ? saved.id : undefined;
  } catch {
    return undefined;
  }
}
