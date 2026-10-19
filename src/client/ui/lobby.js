// @ts-check
/**
 * The lobby card, shown from the moment a player joins until the first
 * snapshot arrives: the match id, who is in, and the Start button for the host.
 */

import { entropyText } from '../entity-text.js';

/**
 * @param {HTMLElement} root
 * @param {import('../net/server-session.js').ServerSession} session
 * @param {{ shareLink: string, entropyDefault?: number }} opts  `entropyDefault` is the rate of data/balance.json in tenths of a percent per second, shown when the host chose none
 */
export function showLobby(root, session, { shareLink, entropyDefault = 1 }) {
  root.hidden = false;
  const card = document.createElement('div');
  card.className = 'card';
  const title = div('title', 'Lobby');
  const idLine = div('subtitle', `Match ${session.matchId}`);
  const players = div('players');
  const rules = div('subtitle');
  const status = div('status');
  const copy = document.createElement('button');
  copy.textContent = 'Copy Invite Link';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      copy.textContent = 'Link Copied';
    } catch {
      copy.textContent = shareLink; // no clipboard on plain http: show the link to copy by hand
    }
  });
  const start = document.createElement('button');
  start.textContent = 'Start Match';
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      await session.start();
    } catch (err) {
      start.disabled = false;
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  });
  card.append(title, idLine, players, rules, status, copy, start);
  root.replaceChildren(card);

  function update() {
    const match = session.getMatch();
    const names = match.botVsBot ? ['Bot Blue', 'Bot Red'] : match.players.map((/** @type {any} */ p) => p.name);
    if (match.vsBot) names.push('Bot');
    rules.textContent = `Entropy ${entropyText(match.entropyPermillePerSecond ?? entropyDefault)}% per second${session.isHost ? '' : ' (set by the host)'}`;
    players.replaceChildren(...names.map((/** @type {string} */ n) => div('player', n)));
    const ready = match.botVsBot || match.vsBot || match.players.length >= 2;
    start.hidden = !session.isHost;
    start.disabled = !ready;
    if (!status.textContent || ['Waiting for a second player.', 'Waiting for the host to start.', ''].includes(status.textContent)) {
      status.textContent = !ready ? 'Waiting for a second player.' : session.isHost ? '' : 'Waiting for the host to start.';
    }
    title.textContent = session.role === 'spectator' ? 'Watching Bots' : 'Lobby';
  }
  update();
  session.onChange(update);
  return { hide: () => { root.hidden = true; }, update };
}

/** @param {string} className @param {string} [text] */
function div(className, text) {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
