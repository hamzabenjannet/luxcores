// @ts-check
// The LLM bot driver (`src/llm/`). Every case drives a stub model through
// `fetchImpl`, so the suite needs no Ollama server and no network. The commands
// the driver produces go through `step()` like a human's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from './helpers/load-data.js';
import { KIND, MILLI, createState, step } from '../src/sim/index.js';
import { localWorldView } from '../src/shared/world-view.js';
import { createLlmBot, createOllamaClient, extractJson, observe, parsePlan, readAction, toCommand } from '../src/llm/index.js';

const { config } = loadData();
const PLAYERS = [
  { id: 0, team: 0, kind: /** @type {const} */ ('bot') },
  { id: 1, team: 1, kind: /** @type {const} */ ('bot') },
];

/** A fresh match and the view of team 0. */
function match(seed = 1234567) {
  const state = createState({ seed, players: PLAYERS, config });
  return { state, view: localWorldView(state, 0) };
}

/**
 * A fetch that answers every chat request with `content`, counts the calls and
 * remembers the last body. `content` may be a function of the call count.
 * @param {string | ((call: number) => string)} content
 * @param {{ status?: number, delayMs?: number }} [opts]
 */
function stubFetch(content, opts = {}) {
  const calls = /** @type {any[]} */ ([]);
  /** @type {any} */
  const impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (opts.delayMs) {
      // A real fetch rejects when the caller aborts, and the timeout case needs that.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, opts.delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('This operation was aborted'));
        });
      });
    }
    const text = typeof content === 'function' ? content(calls.length) : content;
    return {
      ok: (opts.status ?? 200) < 400,
      status: opts.status ?? 200,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return { impl, calls };
}

/** The Ollama envelope around one assistant message. */
const reply = (/** @type {string} */ content) => JSON.stringify({ model: 'test', message: { role: 'assistant', content } });

test('the JSON finder reads a plan out of prose, a code fence and nesting', () => {
  assert.equal(extractJson('Here you go: {"actions": []} and that is all'), '{"actions": []}');
  assert.equal(extractJson('```json\n{"a": {"b": 1}}\n```'), '{"a": {"b": 1}}');
  assert.equal(extractJson('[{"action":"wait"}]'), '[{"action":"wait"}]');
  assert.equal(extractJson('{"note": "a } inside a string"}'), '{"note": "a } inside a string"}');
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"unterminated": '), null);
});

test('a plan is read from the documented object, a bare array and a single action', () => {
  assert.deepEqual(parsePlan('{"actions":[{"action":"wait"}],"note":"save"}'), { actions: [{ action: 'wait' }], note: 'save' });
  assert.deepEqual(parsePlan('[{"action":"wait"}]').actions, [{ action: 'wait' }]);
  assert.deepEqual(parsePlan('{"action":"wait"}').actions, [{ action: 'wait' }]);
  assert.match(String(parsePlan('I will build a tower.').error), /no JSON/);
  assert.match(String(parsePlan('{"plan": "build"}').error), /no actions array/);
  assert.equal(parsePlan('{"actions":[{"action":"wait"},{"action":"wait"},{"action":"wait"},{"action":"wait"},{"action":"wait"},{"action":"wait"}]}').actions.length, 4);
});

test('an action names itself in a field or as its key', () => {
  assert.deepEqual(readAction({ action: 'build', building: 'solar' }), { name: 'build', fields: { action: 'build', building: 'solar' } });
  assert.deepEqual(readAction({ build: 'solar', tile: [1, 2] }), { name: 'build', fields: { build: 'solar', tile: [1, 2], building: 'solar' } });
  assert.deepEqual(readAction({ heroAttack: 31 }).fields.targetId, 31);
  assert.equal(readAction({ mood: 'brave' }).name, '');
});

test('the action filter translates what it knows and names what it drops', () => {
  const ctx = { ownIds: new Set([9, 12]), groupIds: new Set([3]), mapWidth: 96, mapHeight: 192 };
  assert.deepEqual(toCommand({ action: 'build', building: 'tower', tile: [10, 100], attack: 'area' }, ctx), {
    ok: true,
    cmd: { t: 'build', building: 'tower', tileX: 10, tileZ: 100, attack: 'area' },
  });
  // A collector takes no attack type, and a tower with a wrong one falls back to ranged.
  assert.deepEqual(toCommand({ action: 'build', building: 'solar', tile: [10, 100], attack: 'area' }, ctx).cmd, { t: 'build', building: 'solar', tileX: 10, tileZ: 100 });
  assert.deepEqual(toCommand({ action: 'build', building: 'tower', tile: [10, 100], attack: 'laser' }, ctx).cmd, { t: 'build', building: 'tower', tileX: 10, tileZ: 100, attack: 'ranged' });
  assert.deepEqual(toCommand({ action: 'upgrade', towerId: 12, track: 'shell' }, ctx).cmd, { t: 'upgrade', towerId: 12, track: 'shell' });
  assert.deepEqual(toCommand({ action: 'recycle', buildingId: 9 }, ctx).cmd, { t: 'recycle', buildingId: 9 });
  assert.deepEqual(toCommand({ action: 'creeps', barracksId: 9, mix: ['melee', 'ranged'] }, ctx).cmd, { t: 'orderCreeps', barracksId: 9, mix: ['melee', 'ranged'] });
  assert.deepEqual(toCommand({ action: 'pickHero', heroId: 2, lux: 40, barracksId: 9 }, ctx).cmd, { t: 'pickHero', heroId: 2, lux: 40, barracksId: 9 });
  // Tiles become unit positions at the tile centre, as a tap in the clients does.
  assert.deepEqual(toCommand({ action: 'heroMove', tile: [4, 5] }, ctx).cmd, { t: 'heroMove', x: 4500, z: 5500 });
  assert.deepEqual(toCommand({ action: 'heroMove', tile: { x: 4, z: 5 } }, ctx).cmd, { t: 'heroMove', x: 4500, z: 5500 });
  assert.deepEqual(toCommand({ action: 'groupPath', groupId: 3, tiles: [[4, 5]] }, ctx).cmd, { t: 'setGroupPath', groupId: 3, waypoints: [[4500, 5500]] });
  assert.deepEqual(toCommand({ action: 'ability', slot: 1, targetId: 31 }, ctx).cmd, { t: 'castAbility', slot: 1, targetId: 31 });
  assert.deepEqual(toCommand({ action: 'ability', slot: 2, tile: [4, 5] }, ctx).cmd, { t: 'castAbility', slot: 2, x: 4500, z: 5500 });

  assert.equal(toCommand({ action: 'wait' }, ctx).ok, false);
  assert.match(String(/** @type {any} */ (toCommand({ action: 'build', building: 'castle', tile: [1, 1] }, ctx)).reason), /names no building/);
  assert.match(String(/** @type {any} */ (toCommand({ action: 'build', building: 'solar', tile: [1, 9999] }, ctx)).reason), /inside the map/);
  assert.match(String(/** @type {any} */ (toCommand({ action: 'upgrade', towerId: 77 }, ctx)).reason), /no tower of this player/);
  assert.match(String(/** @type {any} */ (toCommand({ action: 'creeps', barracksId: 9, mix: ['dragon'] }, ctx)).reason), /melee, ranged or area/);
  assert.match(String(/** @type {any} */ (toCommand({ action: 'groupPath', groupId: 8, tiles: [[1, 1]] }, ctx)).reason), /no group of this player/);
  assert.match(String(/** @type {any} */ (toCommand({ action: 'nuke', targetId: 1 }, ctx)).reason), /unknown action nuke/);
});

test('an order of five creeps is the longest mix the filter passes on', () => {
  const ctx = { ownIds: new Set([9]), groupIds: new Set(), mapWidth: 96, mapHeight: 192 };
  const mix = ['melee', 'melee', 'melee', 'melee', 'melee', 'melee', 'melee'];
  assert.equal(/** @type {any} */ (toCommand({ action: 'creeps', barracksId: 9, mix }, ctx)).cmd.mix.length, 5);
});

test('the observation states whole lux, whole tiles and the costs a player can compare', () => {
  const { state, view } = match();
  const observation = observe(view, { playerId: 0, team: 0, config });
  assert.equal(observation.tick, 0);
  assert.equal(observation.team, 0);
  assert.equal(observation.coreLux, Math.floor(state.teams[0].coreLux / MILLI));
  assert.equal(observation.costLux.solar, config.buildings.solar.costLux / MILLI);
  assert.equal(observation.costLux.creep, config.balance.creep.costLux / MILLI);
  assert.equal(observation.phase, 'day');
  assert.deepEqual(observation.myBuildings, []);
  assert.equal(observation.myHero, null);
  assert.ok(observation.myCore && observation.enemyCore, 'both Cores are in sight');
  // It shows the enemy Core and no blocker, and every tile is a whole number.
  assert.ok(observation.enemies.every((e) => e.kind !== 'blocker'));
  for (const [x, z] of [...observation.freeTiles.base, ...observation.freeTiles.front]) {
    assert.ok(Number.isInteger(x) && Number.isInteger(z), 'tiles are whole');
  }
});

test('a build on a suggested tile is a command the sim accepts', () => {
  const { state, view } = match();
  const observation = observe(view, { playerId: 0, team: 0, config });
  const result = toCommand({ action: 'build', building: 'solar', tile: observation.freeTiles.base[0] }, {
    ownIds: new Set(),
    groupIds: new Set(),
    mapWidth: state.map.width,
    mapHeight: state.map.height,
  });
  assert.equal(result.ok, true);
  step(state, [{ tick: 0, playerId: 0, seq: 0, cmd: /** @type {any} */ (result).cmd }]);
  const built = state.entities.find((e) => e.kind === KIND.SOLAR && e.owner === 0);
  assert.ok(built, 'the collector stands on the suggested tile');
  assert.deepEqual([Math.floor(built.x / 1000), Math.floor(built.z / 1000)], observation.freeTiles.base[0]);
});

test('the transport posts one chat request and reads the message back', async () => {
  const stub = stubFetch(reply('{"actions":[{"action":"wait"}]}'));
  const client = createOllamaClient({ endpoint: 'http://model.test:11434/', model: 'qwen2.5:3b', fetchImpl: stub.impl });
  const answer = await client.chat([{ role: 'user', content: 'hello' }]);
  assert.equal(answer.ok, true);
  assert.equal(answer.content, '{"actions":[{"action":"wait"}]}');
  assert.equal(stub.calls[0].url, 'http://model.test:11434/api/chat');
  assert.equal(stub.calls[0].body.stream, false, 'the driver never streams');
  assert.equal(stub.calls[0].body.model, 'qwen2.5:3b');
  assert.equal(stub.calls[0].body.format, 'json');
  assert.deepEqual(stub.calls[0].body.messages, [{ role: 'user', content: 'hello' }]);
});

test('every failure of the transport comes back as a reason and never as a throw', async () => {
  const refused = createOllamaClient({ fetchImpl: stubFetch('nope', { status: 500 }).impl });
  assert.match(String((await refused.chat([])).error), /answered 500/);

  const html = createOllamaClient({ fetchImpl: stubFetch('<html>not ollama</html>').impl });
  assert.match(String((await html.chat([])).error), /no JSON envelope/);

  const empty = createOllamaClient({ fetchImpl: stubFetch(reply('   ')).impl });
  assert.match(String((await empty.chat([])).error), /empty message/);

  const huge = createOllamaClient({ maxReplyBytes: 32, fetchImpl: stubFetch(reply('x'.repeat(100))).impl });
  assert.match(String((await huge.chat([])).error), /longer than 32 bytes/);

  const slow = createOllamaClient({ timeoutMs: 10, fetchImpl: stubFetch(reply('{}'), { delayMs: 60 }).impl });
  assert.match(String((await slow.chat([])).error), /within 10 ms/);

  const broken = createOllamaClient({ fetchImpl: /** @type {any} */ (async () => { throw new Error('connect ECONNREFUSED'); }) });
  assert.match(String((await broken.chat([])).error), /ECONNREFUSED/);

  // A runtime without fetch says so instead of throwing. No case here touches the network.
  const none = createOllamaClient({ fetchImpl: /** @type {any} */ ('no fetch in this runtime') });
  assert.match(String((await none.chat([])).error), /has no fetch/);
});

test('an endpoint keeps working with a trailing slash or a pasted /api', async () => {
  for (const endpoint of ['http://localhost:11434', 'http://localhost:11434/', 'http://localhost:11434/api']) {
    const stub = stubFetch(reply('{"actions":[]}'));
    await createOllamaClient({ endpoint, fetchImpl: stub.impl }).chat([]);
    assert.equal(stub.calls[0].url, 'http://localhost:11434/api/chat');
  }
});

/**
 * Plays `ticks` ticks with one LLM bot on team 0, waiting for every answer so
 * the stub model decides on every turn.
 * @param {{ fetchImpl: any, ticks?: number, thinkEveryTicks?: number, seed?: number }} opts
 */
async function playWithModel({ fetchImpl, ticks = 60, thinkEveryTicks = 20, seed = 1234567 }) {
  const { state, view } = match(seed);
  const bot = createLlmBot({ playerId: 0, team: 0, config, seed, thinkEveryTicks, fetchImpl });
  /** @type {import('../src/sim/commands.js').CommandEnvelope[]} */
  const issued = [];
  while (state.tick < ticks && !state.outcome) {
    const cmds = bot.think(view);
    issued.push(...cmds);
    step(state, cmds);
    await bot.pending();
  }
  return { state, bot, issued };
}

test('a plan from the model reaches the sim as ordinary commands', async () => {
  const { state, view } = match();
  const observation = observe(view, { playerId: 0, team: 0, config });
  const tile = observation.freeTiles.base[0];
  const stub = stubFetch(reply(JSON.stringify({ actions: [{ action: 'build', building: 'solar', tile }], note: 'economy first' })));
  const played = await playWithModel({ fetchImpl: stub.impl, ticks: 30 });
  assert.ok(played.issued.some((e) => e.cmd.t === 'build' && /** @type {any} */ (e.cmd).building === 'solar'), 'the build command was issued');
  assert.ok(played.state.entities.some((e) => e.kind === KIND.SOLAR && e.owner === 0), 'the collector stands');
  assert.equal(played.bot.stats().driver, 'model');
  assert.equal(played.bot.stats().lastNote, 'economy first');
  assert.equal(played.bot.stats().failures, 0);
  // Every command carries a rising sequence number, as the sim and the replay expect.
  const seqs = played.issued.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
});

test('a model that answers nothing usable hands the match to the scripted bot', async () => {
  const played = await playWithModel({ fetchImpl: stubFetch('<html>no model here</html>', { status: 502 }).impl, ticks: 80 });
  assert.equal(played.bot.stats().driver, 'scripted');
  assert.ok(played.bot.stats().failures >= 2, 'every turn failed');
  assert.ok(played.issued.length > 0, 'the scripted bot kept playing');
  assert.ok(played.state.entities.some((e) => e.owner === 0 && e.kind >= KIND.SOLAR && e.kind <= KIND.TOWER), 'it built something');
});

test('a model that loses its server mid-match gives the scripted bot the turn back', async () => {
  const { state, view } = match();
  const tile = observe(view, { playerId: 0, team: 0, config }).freeTiles.base[0];
  const good = reply(JSON.stringify({ actions: [{ action: 'build', building: 'solar', tile }], note: 'ok' }));
  const stub = stubFetch((call) => (call === 1 ? good : 'gone'), {});
  const bot = createLlmBot({ playerId: 0, team: 0, config, seed: 1234567, thinkEveryTicks: 20, fetchImpl: stub.impl });
  const drivers = [];
  while (state.tick < 80 && !state.outcome) {
    step(state, bot.think(view));
    await bot.pending();
    drivers.push(bot.stats().driver);
  }
  assert.equal(drivers[0], 'model');
  assert.equal(bot.stats().driver, 'scripted');
  assert.ok(bot.stats().plans >= 1 && bot.stats().failures >= 1);
});

test('an action the filter refuses costs the turn and never reaches the sim', async () => {
  const stub = stubFetch(reply('{"actions":[{"action":"build","building":"fortress","tile":[0,0]}]}'));
  const played = await playWithModel({ fetchImpl: stub.impl, ticks: 40 });
  assert.equal(played.bot.stats().plans, 0);
  assert.ok(played.bot.stats().dropped >= 1);
  assert.ok(!played.issued.some((e) => /** @type {any} */ (e.cmd).building === 'fortress'));
});

test('a deliberate wait is a plan, so the model keeps the turn', async () => {
  const played = await playWithModel({ fetchImpl: stubFetch(reply('{"actions":[{"action":"wait"}],"note":"saving"}')).impl, ticks: 40 });
  assert.equal(played.bot.stats().driver, 'model');
  // The scripted bot decides on tick 0, before the first answer lands. After that the model holds the turn,
  // and its waits issue nothing.
  assert.ok(played.issued.every((e) => e.tick === 0), 'no command after the first plan');
});

test('the driver asks once per think interval and never twice at a time', async () => {
  const stub = stubFetch(reply('{"actions":[{"action":"wait"}]}'), { delayMs: 5 });
  const { state, view } = match();
  const bot = createLlmBot({ playerId: 0, team: 0, config, seed: 1, thinkEveryTicks: 20, fetchImpl: stub.impl });
  while (state.tick < 100) {
    step(state, bot.think(view));
    await bot.pending();
  }
  assert.equal(stub.calls.length, 5, '100 ticks at one question every 20 ticks');
});

test('the memory of the driver is plain data, and a scripted memory still loads', async () => {
  const { state, view } = match();
  const tile = observe(view, { playerId: 0, team: 0, config }).freeTiles.base[0];
  const stub = stubFetch(reply(JSON.stringify({ actions: [{ action: 'build', building: 'solar', tile }, { action: 'wait' }], note: 'ok' })));
  const bot = createLlmBot({ playerId: 0, team: 0, config, seed: 7, thinkEveryTicks: 20, fetchImpl: stub.impl });
  step(state, bot.think(view));
  await bot.pending();
  const memory = bot.saveState();
  assert.deepEqual(memory, JSON.parse(JSON.stringify(memory)), 'the memory survives JSON, as a checkpoint needs');

  const resumed = createLlmBot({ playerId: 0, team: 0, config, seed: 7, thinkEveryTicks: 20, fetchImpl: stub.impl });
  resumed.loadState(memory);
  assert.equal(resumed.stats().driver, 'model');
  assert.deepEqual(resumed.saveState(), memory);

  // A match that ran with the scripted bot alone wrote its memory; the driver takes it.
  const scriptedMemory = { rng: 123, seq: 4, rotation: 2, heroWp: 1 };
  const fromScripted = createLlmBot({ playerId: 0, team: 0, config, seed: 7, fetchImpl: stub.impl });
  fromScripted.loadState(scriptedMemory);
  assert.equal(fromScripted.stats().driver, 'scripted');
  assert.deepEqual(/** @type {any} */ (fromScripted.saveState()).scripted, scriptedMemory);
});

test('the request carries the system prompt, the observation and a bounded history', async () => {
  const stub = stubFetch(reply('{"actions":[{"action":"wait"}],"note":"hold"}'));
  const { state, view } = match();
  const bot = createLlmBot({ playerId: 0, team: 0, config, seed: 1, thinkEveryTicks: 20, fetchImpl: stub.impl });
  while (state.tick < 200) {
    step(state, bot.think(view));
    await bot.pending();
  }
  const first = stub.calls[0].body.messages;
  assert.equal(first[0].role, 'system');
  assert.match(first[0].content, /Luxcores/);
  assert.match(first[0].content, /"action":"build"/);
  assert.equal(first.length, 2, 'the first request carries no history');
  const last = stub.calls[stub.calls.length - 1].body.messages;
  assert.equal(last.length, 6, 'the system prompt and two remembered turns');
  assert.match(last[1].content, /^Turn at second/, 'a past turn is one line, not a whole observation');
  assert.equal(last[2].role, 'assistant');
  assert.match(last[last.length - 1].content, /Observation:/);
});
