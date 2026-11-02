// @ts-check
/**
 * A bot that a language model drives.
 *
 * It offers the same interface as the scripted bot of `src/bot/bot.js`
 * (`think`, `saveState`, `loadState`), so the match runner, the tools and the
 * checkpoints treat both the same way. Everything it decides leaves as an
 * ordinary `CommandEnvelope`, which the sim validates like a human's command.
 *
 * Three properties keep it safe to plug into a live match:
 *
 * 1. `think` never waits. A model answers in hundreds of milliseconds and a
 *    tick lasts 50 ms, so the driver asks in the background and spends the
 *    answer over the ticks that follow. At most one request is in flight.
 * 2. A model that is unreachable, slow or wrong costs nothing. Until the first
 *    plan arrives, and after any failure, the scripted bot plays instead, so
 *    the match never stalls on an empty answer.
 * 3. The sim stays deterministic. A model's commands are logged like any
 *    other, but they cannot be regenerated from the seed, so a match with an
 *    LLM bot resumes from its newest checkpoint and its replay is flagged as
 *    not reproducible (see `docs/LLM_BOT.md`).
 */

import { createBot } from '../bot/bot.js';
import { MAX_ACTIONS, parsePlan, toCommand } from './actions.js';
import { createOllamaClient } from './ollama.js';
import { observe } from './observation.js';
import { buildMessages, historyLine, pushTurn, systemPrompt, turnMessage } from './prompt.js';

/** Ticks between two questions to the model (2 s at 20 Hz). */
export const DEFAULT_THINK_EVERY_TICKS = 40;
/** A plan spends one command every this many ticks, so it never arrives as a burst. */
const SPEND_EVERY_TICKS = 5;

/**
 * @param {{
 *   playerId: number,
 *   team: number,
 *   config: import('../sim/config.js').SimConfig,
 *   seed: number,
 *   endpoint?: string,
 *   model?: string,
 *   thinkEveryTicks?: number,
 *   timeoutMs?: number,
 *   temperature?: number,
 *   maxTokens?: number,
 *   historyTurns?: number,
 *   fetchImpl?: typeof fetch,
 *   onEvent?: (event: { type: 'ask' | 'plan' | 'failure', tick: number, text?: string, error?: string, note?: string, ms?: number, commands?: number }) => void,
 * }} opts
 */
export function createLlmBot(opts) {
  const { playerId, team, config, seed } = opts;
  const thinkEvery = Math.max(1, opts.thinkEveryTicks ?? DEFAULT_THINK_EVERY_TICKS);
  const client = createOllamaClient({
    ...(opts.endpoint === undefined ? {} : { endpoint: opts.endpoint }),
    ...(opts.model === undefined ? {} : { model: opts.model }),
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
    ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
  });
  const onEvent = opts.onEvent ?? (() => {});
  const system = systemPrompt({ team, model: client.model });
  /** The scripted bot, which plays while the model is silent. */
  const scripted = createBot({ playerId, team, config, seed });

  let seq = 0;
  let lastAskTick = -thinkEvery;
  let lastSpendTick = -SPEND_EVERY_TICKS;
  let inFlight = false;
  /** The request in flight, which a tool may wait for while the live server never does. @type {Promise<void> | null} */
  let pending = null;
  /** @type {import('./ollama.js').ChatMessage[]} */
  let history = [];
  /** Commands of the newest plan, waiting for their tick. @type {import('../sim/commands.js').Command[]} */
  let queue = [];
  /** The model drives once it has answered with a usable plan, and the scripted bot drives before and after a failure. */
  let driver = /** @type {'scripted' | 'model'} */ ('scripted');
  const stats = { asks: 0, plans: 0, failures: 0, commands: 0, dropped: 0, lastMs: 0, lastNote: '', lastError: '' };

  return {
    playerId,
    model: client.model,
    endpoint: client.endpoint,

    /**
     * One tick: the commands of the plan in hand, or the scripted bot's command
     * while the model has none.
     * @param {import('../shared/world-view.js').WorldView} view
     * @returns {import('../sim/commands.js').CommandEnvelope[]}
     */
    think(view) {
      const tick = view.tick();
      if (!inFlight && tick - lastAskTick >= thinkEvery) {
        lastAskTick = tick;
        ask(view, tick);
      }
      if (queue.length > 0 && tick - lastSpendTick >= SPEND_EVERY_TICKS) {
        lastSpendTick = tick;
        const cmd = /** @type {import('../sim/commands.js').Command} */ (queue.shift());
        stats.commands++;
        return [{ tick, playerId, seq: seq++, cmd }];
      }
      if (driver === 'scripted') {
        // The scripted bot numbers its own commands, and this bot owns the sequence, so they are renumbered.
        return scripted.think(view).map((e) => ({ tick: e.tick, playerId, seq: seq++, cmd: e.cmd }));
      }
      return [];
    },

    /**
     * The request in flight, or null. A tool that wants the model to decide
     * every turn awaits it, and the match runner never does, because a tick may
     * not wait for a model (see the file header).
     */
    pending: () => pending,

    /** What the driver has done so far, for the tools and the server log. */
    stats() {
      return { ...stats, driver, queued: queue.length, inFlight };
    },

    /** The bot's own memory as plain data, for a checkpoint. */
    saveState() {
      return { scripted: scripted.saveState(), seq, lastAskTick, lastSpendTick, driver, history, queue };
    },

    /**
     * Restores what `saveState` returned. A memory from a scripted bot (a match
     * that ran without a model) loads too, so a match may gain an LLM bot on a
     * resume.
     * @param {any} saved
     */
    loadState(saved) {
      if (!saved) return;
      if (saved.scripted) scripted.loadState(saved.scripted);
      else scripted.loadState(saved); // a memory written by the scripted bot alone
      seq = saved.seq ?? 0;
      lastAskTick = saved.lastAskTick ?? -thinkEvery;
      lastSpendTick = saved.lastSpendTick ?? -SPEND_EVERY_TICKS;
      driver = saved.driver === 'model' ? 'model' : 'scripted';
      history = Array.isArray(saved.history) ? saved.history : [];
      queue = Array.isArray(saved.queue) ? saved.queue : [];
      inFlight = false;
      pending = null;
    },
  };

  /**
   * Asks the model about the state of this tick. The observation is built now,
   * because the state moves on while the request travels.
   * @param {import('../shared/world-view.js').WorldView} view
   * @param {number} tick
   */
  function ask(view, tick) {
    const observation = observe(view, { playerId, team, config });
    const ownIds = new Set(view.entities().filter((e) => e.owner === playerId).map((e) => e.id));
    const groupIds = new Set(view.groups().filter((g) => g.owner === playerId).map((g) => g.id));
    const map = view.map();
    const user = turnMessage(observation);
    inFlight = true;
    stats.asks++;
    onEvent({ type: 'ask', tick });
    pending = client
      .chat(buildMessages({ system, history, user }))
      .then((answer) => {
        inFlight = false;
        stats.lastMs = answer.ms;
        if (!answer.ok) {
          fail(tick, answer.error ?? 'the model did not answer');
          return;
        }
        const plan = parsePlan(answer.content);
        if (plan.error) {
          fail(tick, plan.error);
          return;
        }
        /** @type {import('../sim/commands.js').Command[]} */
        const commands = [];
        /** @type {string[]} */
        const dropped = [];
        for (const action of plan.actions.slice(0, MAX_ACTIONS)) {
          const result = toCommand(action, { ownIds, groupIds, mapWidth: map.width, mapHeight: map.height });
          if (result.ok) commands.push(result.cmd);
          else if (result.reason !== 'wait') dropped.push(result.reason);
        }
        stats.dropped += dropped.length;
        if (commands.length === 0 && dropped.length > 0) {
          fail(tick, `no action survived: ${dropped.join('; ')}`);
          return;
        }
        // A plan the driver can act on, a deliberate wait included.
        driver = 'model';
        stats.plans++;
        stats.lastNote = plan.note;
        stats.lastError = '';
        queue = commands;
        history = pushTurn(history, historyLine(observation), JSON.stringify({ actions: plan.actions, note: plan.note }), opts.historyTurns);
        onEvent({ type: 'plan', tick, note: plan.note, ms: answer.ms, commands: commands.length, text: answer.content.slice(0, 400) });
      })
      .catch((err) => {
        inFlight = false;
        fail(tick, err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        pending = null;
      });
  }

  /**
   * A turn the model lost. The scripted bot takes over until the next plan
   * arrives, and the turn stays out of the history so one bad answer does not
   * teach the model to repeat it.
   * @param {number} tick
   * @param {string} error
   */
  function fail(tick, error) {
    stats.failures++;
    stats.lastError = error;
    driver = 'scripted';
    queue = [];
    onEvent({ type: 'failure', tick, error });
  }
}
