// @ts-check
/**
 * The messages the driver sends to `/api/chat`, and the bounded history it
 * keeps between turns.
 *
 * The history is what makes the model play rather than react. Each turn adds the
 * observation it saw and the plan it answered, so it remembers that the barracks
 * is already ordered. Only the last `HISTORY_TURNS` turns are kept: a 3 billion
 * parameter model loses the thread in a long transcript, and the context window
 * is the budget that matters at 20 ticks per second.
 */

import { ACTION_DOC, MAX_ACTIONS } from './actions.js';

/** Turns of history the driver keeps, each a user message and the model's answer. */
export const HISTORY_TURNS = 2;

/**
 * The standing instruction. It names the reader (a model that outputs JSON),
 * the goal, the vocabulary and the units.
 * @param {{ team: number, model: string }} ctx
 * @returns {string}
 */
export function systemPrompt({ team }) {
  return `You play Luxcores, a lane strategy game, as team ${team}. Everything is made of light energy (lux), which is both money and health: a building or unit that loses lux dies, and lux spent is lux gone from your Lumen Core.

You win when the enemy Lumen Core falls, and you lose when yours does.

How to play well:
- Collectors (solar, wind, geothermal, nuclear) earn lux every second. Build them first, near your Core.
- A barracks lets you order creeps and pick a hero. Build one early.
- Towers defend. Put them at the front, toward the enemy, and upgrade power and shell.
- Creep groups walk the lane to the enemy Core. Order them often.
- A hero costs the lux you give it, which becomes its health. Pick one once a barracks stands.
- Keep some lux in the Core. Spending everything leaves you defenceless.

You act once every turn. Answer with JSON only, in this shape:
{"actions": [ ... ], "note": "one short line on your plan"}

At most ${MAX_ACTIONS} actions per turn. The actions you may use:
${ACTION_DOC}

Every action object carries an "action" field. An example of a whole answer:
{"actions":[{"action":"build","building":"solar","tile":[48,98]},{"action":"creeps","barracksId":9,"mix":["melee","melee","ranged"]}],"note":"economy first, then pressure"}

Rules for your answer:
- Every action needs its "action" field, spelled as the list above spells it.
- Use only ids and tiles the observation gives you. Tiles are whole numbers, lux is whole lux.
- costLux tells you what each building costs. Order nothing you cannot pay for.
- Build only on a tile from freeTiles, or on a free tile you can see in your build zone.
- Answer {"actions": [{"action": "wait"}]} when saving lux is the better move.
- Never write anything outside the JSON object.`;
}

/**
 * The turn message: the observation, as compact JSON.
 * @param {import('./observation.js').Observation} observation
 * @returns {string}
 */
export function turnMessage(observation) {
  return `Observation:\n${JSON.stringify(observation)}\n\nYour actions as JSON:`;
}

/**
 * The one line a past turn leaves in the history. A whole observation costs
 * about 500 tokens, and a model that carries three of them answers slower every
 * turn until it misses its deadline. Only what the model must remember stays:
 * when the turn was and what it had.
 * @param {import('./observation.js').Observation} observation
 * @returns {string}
 */
export function historyLine(observation) {
  const buildings = observation.myBuildings.reduce((/** @type {Record<string, number>} */ counts, b) => ({ ...counts, [b.kind]: (counts[b.kind] ?? 0) + 1 }), {});
  return `Turn at second ${observation.second}: ${observation.coreLux} lux, buildings ${JSON.stringify(buildings)}, creeps ${observation.myArmy.creeps}, hero ${observation.myHero ? observation.myHero.name : 'none'}.`;
}

/**
 * What the driver remembers of one finished turn: the observation it sent and
 * the plan the model answered. The assistant message is the plan the driver
 * actually accepted, so the model sees its own effective moves and not the
 * parts that were dropped.
 * @param {readonly import('./ollama.js').ChatMessage[]} history
 * @param {string} userContent
 * @param {string} assistantContent
 * @param {number} [turns]
 * @returns {import('./ollama.js').ChatMessage[]}
 */
export function pushTurn(history, userContent, assistantContent, turns = HISTORY_TURNS) {
  const next = [...history, { role: /** @type {const} */ ('user'), content: userContent }, { role: /** @type {const} */ ('assistant'), content: assistantContent }];
  return next.slice(-2 * turns);
}

/**
 * The messages of one request: the standing instruction, the remembered turns
 * and this turn's observation.
 * @param {{ system: string, history: readonly import('./ollama.js').ChatMessage[], user: string }} parts
 * @returns {import('./ollama.js').ChatMessage[]}
 */
export function buildMessages({ system, history, user }) {
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: user }];
}
