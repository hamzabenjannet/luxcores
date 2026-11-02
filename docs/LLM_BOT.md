# The Language Model Bot

This file describes the bot that an Ollama model drives: what it is, how it is
plugged into the server, and which rules keep it from breaking the simulation.
The reader is an agent or an owner who works on this repo and has read
`CLAUDE.md`. A player who only wants to switch it on needs the first section.

## What It Is

Luxcores ships two bots. The scripted bot of `src/bot/bot.js` follows the GDD
12.1 rotation and never changes its mind. The language model bot of `src/llm/`
asks a model what to do: every two seconds it sends the state of its own side to
an Ollama server and turns the answer into the same commands a human taps.

The driver is off everywhere until somebody turns it on. Both clients show an
unticked switch in their start menu, with the endpoint and the model beside it.
A match created without that switch plays the scripted bot, as every match did
before this feature existed.

Switch it on from the start menu of either client, or from the address of the web
client: `?match=new&vsBot=1&llm=1&llmEndpoint=http://localhost:11434&llmModel=qwen2.5:3b`.
The test hub at `/tests` lists two ready-made links.

The model drives the bot of a `vsBot` match, and team 1 of a `botVsBot` match, so
a watcher sees the model against the scripted baseline. `llm.bothSides` in the
create call gives it both bots of a bot match.

## The Parts

Each file does one thing, and nothing above it knows how the one below works.

| File | What it does |
|---|---|
| `src/llm/ollama.js` | One `POST {endpoint}/api/chat` with `stream: false`, and `GET /api/tags` for the model list. It never throws: every failure is a reason. |
| `src/llm/observation.js` | The `WorldView` of one player as a small JSON object, in whole lux, whole tiles and seconds. |
| `src/llm/actions.js` | The vocabulary the model may speak, and the translation of one action into a sim command. It drops what it cannot read and says why. |
| `src/llm/prompt.js` | The standing instruction, the turn message and the bounded history. |
| `src/llm/llm-bot.js` | The driver: it asks in the background, spends the answer over the ticks that follow, and hands the turn to the scripted bot when the model fails. |
| `backend/nodejs/src/llm/` | The server's policy: whether this server offers a model at all, and which endpoint and model a match may name. No game knowledge. |
| `tools/run-llm-bot.js` | A headless match of the model against the scripted bot, which prints every plan. |

The sim imports none of it, and `src/llm/` imports no sim internals: it reads
`src/sim/index.js` and `WorldView` like the scripted bot and the clients do.

## What the Model Sees and Says

One turn sends the system prompt, at most two remembered turns and this tick's
observation, and the model answers one JSON object:

```json
{"actions": [{"action": "build", "building": "solar", "tile": [48, 98]}], "note": "economy first"}
```

`src/llm/actions.js` holds the whole list: `build`, `upgrade`, `recycle`,
`creeps`, `groupPath`, `pickHero`, `heroMove`, `heroAttack`, `ability` and
`wait`. The driver keeps four actions per turn and spends them one every five
ticks.

The observation names the player's own lux, buildings, creeps, hero and queue,
the ten nearest enemy entities, the cost of everything, and three free tiles
near the Core and three at the front, which a `build` action may use as its tile.
It holds nothing a human player could not see, because it is built from the same
`WorldView` the scripted bot reads.

The filter in `actions.js` is a filter and not an authority. It drops an unknown
action, a tile outside the map and an id the player does not own, and the sim
then validates every command it passes on, as it does for a human's commands.

## The Three Rules That Keep It Safe

**A tick never waits for a model.** A tick lasts 50 ms and a 3 billion parameter
model answers in one to ten seconds. `think` therefore starts one request in the
background and returns at once, and the answer is spent over the ticks that
follow. At most one request is in flight per bot.

**A model that fails costs nothing.** Until the first plan arrives, and after any
failure, the scripted bot plays that bot's turns. An unreachable server, a
timeout, an answer that is no JSON, an answer whose every action is refused: each
one is a logged reason and a turn handed back, never a stalled match. The soak,
the golden replays and every other bot run are untouched, because they create the
scripted bot as before.

**A match a model played cannot be replayed from its seed.** The same question
does not give the same answer twice, so the sim's determinism rules (`CLAUDE.md`,
Simulation Rules) hold only for the commands, not for their source. Three things
follow:

- The model's commands go into the match log and the replay like a human's, so a
  rebuild from the log reproduces the match exactly.
- `SimBot.deterministic` is false for such a bot. A rebuild never asks it to
  think again and compares nothing; the logged commands carry the match.
- The replay is stored with `reproducible: false`, so nobody verifies it from the
  seed and finds a mismatch.

A running match therefore resumes from its newest checkpoint plus its logged
commands, as a match under changed rules does. The driver's code stays out of
`codeHash` for the same reason: a model's answers were never part of the
fingerprint.

The sim, the hashes and `SPEC_VERSION` do not change. This feature adds no rule
to the game.

## The Server's Policy

The server, and not the player's browser, makes the request to the model, so the
address a client sends is checked before anything calls it
(`backend/nodejs/src/llm/llm-endpoint.ts`):

- The scheme is `http` or `https`, and the address carries no user name, no
  password, no query and no path other than `/` or `/api`.
- The host stands in `LLM_ALLOWED_HOSTS`, which holds `localhost`, `127.0.0.1`
  and `::1` by default. A single `*` allows every host, which an owner sets on
  purpose and which lets a client choose where the server sends requests.
- The model name matches the characters an Ollama tag uses.

A match that asks for something the server refuses fails with the reason, which
the menu shows, instead of starting with a silent bot. `LLM_BOT=off` turns the
feature off for the whole server, which is the default in production, and
`GET /api/game/spec` then reports `llm.available: false` and both clients hide
the switch.

The answer is bounded as well: `LLM_TIMEOUT_MS` (20 s) ends a slow request,
`MAX_REPLY_BYTES` (256 KiB) caps what the driver reads, `LLM_MAX_TOKENS` caps
what the model may write, and the four actions per turn cap what one answer can
do to a match.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `LLM_BOT` | `on` outside production | Whether a match may ask a model to drive its bot |
| `LLM_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Hosts an endpoint may name; `*` allows every host |
| `LLM_ENDPOINT` | `http://localhost:11434` | What the menus prefill |
| `LLM_MODEL` | `qwen2.5:3b` | What the menus prefill |
| `LLM_TIMEOUT_MS` | `20000` | Milliseconds one question may take |
| `LLM_THINK_EVERY_TICKS` | `40` | Ticks between two questions, 40 being 2 s |
| `LLM_MAX_TOKENS` | `512` | Tokens the model may answer with |
| `LLM_TEMPERATURE` | `0` | 0 keeps the answers as repeatable as a model allows |

## Trying It

```bash
ollama serve                       # in another terminal
ollama pull qwen2.5:3b
node tools/run-llm-bot.js          # the model plays team 0 against the scripted bot
node tools/run-llm-bot.js --vs llm --ticks 1200 --model qwen2.5:3b
npm test                           # test/llm-bot.test.js drives a stub model, with no network
```

The tool waits for every answer, so the model decides on every turn and the
match plays as if it answered instantly. `--free` lets the ticks run on while it
thinks, which is what the live server does.

## What Was Measured

Measured on 2026-11-02 on an Apple M2 Pro with Ollama and `qwen2.5:3b`:
`node tools/run-llm-bot.js --ticks 600` asked 15 times and got 10 usable plans,
31 commands and 5 turns handed to the scripted bot (a timeout and four answers
that held no JSON). Answers took 1.5 s to 9.7 s. The model built two collectors
and a barracks, fielded a hero and ordered ten creeps; the scripted bot on the
other side built a tower as well and held more lux.

A 3 billion parameter model plays weakly and loses its JSON about one turn in
three. That is what the fallback is for. A larger model, or a tool-call
vocabulary instead of free JSON, is the next thing to try. `[UNVERIFIED]`: no
other model has been tried, and no owner has played against the driver yet.
