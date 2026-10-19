// @ts-check
/**
 * What the Leave button does, as pure decisions that the Godot client answers the same way
 * (test/fixtures/client-parity.json). The server owns the consequences: leaving an open lobby cancels it
 * or frees the seat, and leaving a running match stops it or forfeits it (`POST /matches/{id}/quit`).
 */

/**
 * Which server call a player's Leave needs.
 * @param {{ status: string, role: 'player' | 'spectator', isHost: boolean }} ctx
 *   `status` is the match's status, `role` is how the client joined, `isHost` whether it opened the match.
 *   A bot-versus-bot match has its host as a spectator.
 * @returns {'leave' | 'quit' | 'none'} `leave` frees a lobby seat or cancels the lobby, `quit` leaves a running match,
 *   and `none` only closes the connection (a spectator who does not own the match, or a match that is over)
 */
export function leaveCall({ status, role, isHost }) {
  const mine = role === 'player' || isHost;
  if (!mine) return 'none';
  if (status === 'lobby') return 'leave';
  if (status === 'running') return 'quit';
  return 'none';
}

/**
 * Whether Leave asks for a second tap first: only in a running match for two humans, where leaving forfeits.
 * @param {{ status: string, role: 'player' | 'spectator', humans: number }} ctx  `humans` counts the human players of the match
 */
export function leaveNeedsConfirm({ status, role, humans }) {
  return status === 'running' && role === 'player' && humans >= 2;
}
