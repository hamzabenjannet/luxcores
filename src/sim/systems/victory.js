// @ts-check
/**
 * System: victory (pipeline step 15)
 * A team whose Core has 0 lux loses. If every team lost on the same tick, the
 * match is a draw. The timed-mode buzzer comes with a mode setting in a later
 * milestone. GDD 2.
 */

/** @param {import('../state.js').SimState} state */
export function run(state) {
  const alive = [];
  state.teams.forEach((team, t) => {
    if (team.coreLux > 0) alive.push(t);
  });
  if (alive.length === state.teams.length) return;
  if (alive.length === 0) state.outcome = { draw: true };
  else if (alive.length === 1) state.outcome = { winnerTeam: alive[0] };
}
