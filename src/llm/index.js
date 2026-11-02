// @ts-check
/**
 * Public API of the LLM bot driver. Code outside `src/llm` imports from here.
 *
 * The driver is an independent part: the sim does not know it exists, and the
 * match runner reaches it only through `createLlmBot`, which answers like the
 * scripted bot of `src/bot/bot.js`. `docs/LLM_BOT.md` holds the design and the
 * safety rules.
 */

export { createLlmBot, DEFAULT_THINK_EVERY_TICKS } from './llm-bot.js';
export { createOllamaClient, normalizeEndpoint, DEFAULT_ENDPOINT, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, MAX_REPLY_BYTES } from './ollama.js';
export { ACTION_DOC, MAX_ACTIONS, extractJson, parsePlan, readAction, toCommand } from './actions.js';
export { observe, freeTiles, BUILDINGS, KIND_NAMES } from './observation.js';
export { HISTORY_TURNS, buildMessages, historyLine, pushTurn, systemPrompt, turnMessage } from './prompt.js';
