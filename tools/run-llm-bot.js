// A language model plays a headless match against the scripted bot.
//
// Usage: node tools/run-llm-bot.js [options]
//
//   --endpoint <url>   Ollama server, http://localhost:11434 by default
//   --model <name>     model to play with, qwen2.5:3b by default
//   --seed <n>         map and RNG seed, 1234567 by default
//   --ticks <n>        tick limit, 2000 by default (100 seconds of match time)
//   --every <ticks>    ticks between two questions to the model, 40 by default
//   --timeout <ms>     milliseconds one question may take, 20000 by default
//   --vs llm           let the model play both sides instead of the scripted bot
//   --free             do not wait for the model: ticks run on while it thinks
//   --quiet            print the result only
//
// The run waits for every answer by default, so the model decides on every turn
// and the match plays as if it answered instantly. With --free the match runs at
// full speed and the model sees a state that has moved on, which is what a live
// server does.
//
// The model's commands are ordinary commands, so the sim stays the authority.
// This tool prints what the model answered, which commands survived the filter
// in src/llm/actions.js, and how the match ended.

import { loadData } from '../test/helpers/load-data.js';
import { KIND, createState, hashState, step } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createBot } from '../src/bot/bot.js';
import { createLlmBot, createOllamaClient } from '../src/llm/index.js';

const { config } = loadData();
const args = process.argv.slice(2);
/** @param {string} name @param {string} [fallback] */
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (/** @type {string} */ name) => args.includes(`--${name}`);

const endpoint = opt('endpoint', 'http://localhost:11434') ?? '';
const model = opt('model', 'qwen2.5:3b') ?? '';
const seed = Number(opt('seed', '1234567'));
const ticks = Number(opt('ticks', '2000'));
const every = Number(opt('every', '40'));
const timeoutMs = Number(opt('timeout', '20000'));
const bothLlm = opt('vs', 'bot') === 'llm';
const lockstep = !flag('free');
const quiet = flag('quiet');

const probe = await createOllamaClient({ endpoint, model, timeoutMs }).listModels();
if (!probe.ok) {
  console.error(`No Ollama server answers at ${endpoint}: ${probe.error ?? 'unknown reason'}`);
  console.error('Start one with "ollama serve", or pass --endpoint http://host:11434.');
  process.exit(1);
}
if (!probe.models.includes(model)) {
  console.error(`${endpoint} holds [${probe.models.join(', ') || 'no model'}] and not ${model}. Pull it with "ollama pull ${model}".`);
  process.exit(1);
}

const players = [
  { id: 0, team: 0, kind: /** @type {const} */ ('bot') },
  { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
];
const state = createState({ seed, players, config });
const views = players.map((p) => localWorldView(state, p.team));

/** @param {number} id @param {number} team */
const llmFor = (id, team) =>
  createLlmBot({
    playerId: id,
    team,
    config,
    seed,
    endpoint,
    model,
    thinkEveryTicks: every,
    timeoutMs,
    onEvent: (event) => {
      if (quiet) return;
      const where = `tick ${String(event.tick).padStart(5)} team ${team}`;
      if (event.type === 'plan') console.log(`${where}  plan in ${event.ms} ms, ${event.commands} commands: ${event.note || event.text}`);
      if (event.type === 'failure') console.log(`${where}  the scripted bot takes over: ${event.error}`);
    },
  });

const bots = [llmFor(0, 0), bothLlm ? llmFor(1, 1) : createBot({ playerId: 1, team: 1, config, seed })];

console.log(`${model} at ${endpoint} plays team 0 against ${bothLlm ? `${model} on team 1` : 'the scripted bot'}, seed ${seed}, up to ${ticks} ticks.`);
const startedAt = Date.now();
while (state.tick < ticks && !state.outcome) {
  const cmds = bots.flatMap((bot, i) => bot.think(views[i]));
  step(state, cmds);
  if (lockstep) {
    for (const bot of bots) await (/** @type {any} */ (bot).pending?.() ?? null);
  } else {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
// A plan may still travel when the match ends.
for (const bot of bots) await (/** @type {any} */ (bot).pending?.() ?? null);

/** @param {number} team */
const owned = (team) => {
  /** @type {Record<string, number>} */
  const out = {};
  const names = { [KIND.SOLAR]: 'solar', [KIND.WIND]: 'wind', [KIND.GEOTHERMAL]: 'geothermal', [KIND.NUCLEAR]: 'nuclear', [KIND.BARRACKS]: 'barracks', [KIND.TOWER]: 'tower', [KIND.CREEP]: 'creeps', [KIND.HERO]: 'hero' };
  for (const e of state.entities) if (e.team === team && names[e.kind]) out[names[e.kind]] = (out[names[e.kind]] ?? 0) + 1;
  return JSON.stringify(out);
};

const outcome = state.outcome ? ('winnerTeam' in state.outcome ? `team ${state.outcome.winnerTeam} won` : 'a draw') : 'undecided at the tick limit';
console.log('');
console.log(`Tick ${state.tick} after ${((Date.now() - startedAt) / 1000).toFixed(1)} s of wall clock: ${outcome}.`);
console.log(`Hash ${hashState(state)}`);
for (const [i, bot] of bots.entries()) {
  const stats = /** @type {any} */ (bot).stats?.();
  const who = stats ? `${model}` : 'scripted bot';
  console.log(`Team ${i} (${who}): core ${Math.floor(state.teams[i].coreLux / 1000)} lux, owns ${owned(i)}`);
  if (stats) {
    console.log(`  asks ${stats.asks}, plans ${stats.plans}, failures ${stats.failures}, commands ${stats.commands}, dropped actions ${stats.dropped}, last answer ${stats.lastMs} ms`);
    if (stats.lastError) console.log(`  last failure: ${stats.lastError}`);
    if (stats.lastNote) console.log(`  last note: ${stats.lastNote}`);
  }
}
