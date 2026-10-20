# Handover

Status as of 2026-10-20, after M9 (touch controls and the 1 000-seed bot soak), the playtest fixes and the latest client controls. M10 phone testing remains next. Read `CLAUDE.md` first for the working rules.

## Where things stand

Design is settled for M1 to M3: `docs/GAME_DESIGN.md` v0.9.5 records the owner-approved tower attack-type rule, unit collider radius and one-tick ranged projectile delay. v0.9.7 records the M4 rules (section 9.3, approved on 2026-10-18), unit spacing, the melee gap and the stalemate limit. Every number marked *(default)* lives in `data/`.

Milestones M1 (map generation), M2 (economy), M3 (combat and physics) and M4 (creeps) are done:

| Area | State |
|---|---|
| Integer math (`fixed.js`, `sin-table.js`) | Done, tested against BigInt and exact quarter turns |
| RNG (`rng.js`) | Done, tested against the reference Mulberry32 |
| State, config normalization | Done (`state.js`, `config.js`); `createState` spawns the 2 Cores and 12 blockers; teams are minimal |
| Map generation (`mapgen.js`) | Done (M1): 3 lanes, 2 vents, 6 blockers and 2 item spawns per team from the seed, point-mirrored, flood-fill checked; stored on `state.map` |
| Economy and tower upgrades (M2/M3) | Done: collectors, day/night, income buffer, spending, placement, recycling, entropy, meltdown, victory and tower upgrades |
| Tick pipeline (`step.js`) | Economy, production (barracks queues), behavior (towers, creep targeting and steering, routes), movement and collisions, combat (towers, heroes, creeps) and stun timers, recycle, entropy, meltdown, cleanup, victory and visibility run, with the hero lifecycle (picks, rotation lock, death cooldown) and the effects system (shields, ability cooldowns); the item systems remain for M6 |
| Commands (`commands.js`) | Build, upgrade, recycle, cancelRecycle, orderCreeps, cancelQueue, setBarracksPath, setGroupPath, mergeGroups, splitGroup, heroAttack, heroMove, pickHero and castAbility use authoritative handlers; the item commands (`orderItem`, `useItem`, `pickUp`) remain for M6 |
| Hash (`hash.js`) | Canonical layout documented in the file header; all gameplay state, including projectiles, upgrades, entropy remainder, creep groups, barracks queues and waypoints, hero types, shields, ability cooldowns, item fields, loot bag contents, each player's rotation lock, pick cooldown, Energy Grab budget and inventory, and each team's end-of-match counters, is hashed; `state.map` stays derived and excluded by owner decision |
| Replay (`replay.js`) | Record and playback done, mismatch detection tested; the golden replay `replays/golden/seed-1234567.json` (2 400 ticks) plays back in `test/golden.test.js` |
| Headless runner | `npm run headless`: 12 000 ticks in about 15 ms with empty systems; a third argument saves the run as a replay |
| Purity guard | `test/sim-boundary.test.js` blocks bare imports, Math.random, wall clock, approximated Math, `**`, DOM, timers, key iteration |
| Web client | Plays only through the server: a start menu (bot, bots to watch, two humans, with an Unlimited or Capped match type and the tick limit), a lobby card that shows the entropy rate and the tick limit, a build palette (a placement frees the selection), a selection panel (tower upgrades, recycle), hero picks, an item shop and an item bar, a hero bar with the four abilities and a Follow button, an end-of-match table and a result banner. The canvas fills the window at the full pixel ratio on a desktop. Creeps, shots and blockers are instanced and positions are interpolated. It draws the map, every entity with its name and lux count, tower attack types, aim lines and projectiles, picks tiles by ray-casting, and pans by drag. It never steps the sim |
| Backend (`backend/nodejs/`) | NestJS 12 multiplayer server: guest auth with JWT guards, players, lobbies, a server-authoritative match runner at 20 Hz, Socket.IO `/game` namespace, replays with server-side verify, static routes for the game files, Swagger at `/api/docs`, JSON file database with MongoDB and PostgreSQL adapters, RabbitMQ events with an in-process fallback. See `backend/nodejs/README.md` |
| Bots | `src/bot/bot.js` follows the GDD 12.1 rotation (collector, barracks, tower, creep group of 5) and upgrades towers; the server runs it for a `vsBot` or `botVsBot` lobby, and its commands go into the replay. It also fields heroes (GDD 12.1): the roster in order, half of the Core's lux, walking the lane and attacking what it meets, with no abilities. `node tools/run-bots.js --soak 100` plays 100 seeds twice and compares the hashes. Golden replays `bots-seed-777` (1 000 ticks), `bots-seed-7-victory` (tick 3 632, team 0 wins) and `bots-seed-4-stalemate` (no winner, plays the 5 000 test ticks) pin bot matches, and `heroes-seed-515151` pins a scripted match of two human heroes (`node tools/record-hero-golden.js`). A match nobody has won ends as a draw at `match.stalemateTicks` (10 000); `MATCH_MAX_TICKS` raises it for the server and the tools |
| Match log and resume | Every running match has a write-ahead log (`backend/nodejs/src/matchlog`): seed, every command, a hash every 20 ticks and a checkpoint every 400. The log goes to a Redis Stream, MongoDB or files, whichever works. The server rebuilds running matches from it at start-up, after a crash, a graceful stop (`MATCH_ON_SHUTDOWN`) or a change of the rules. Clients rejoin by themselves and continue their command count (`nextSeq`). See `backend/nodejs/README.md`, Match Log and Resume |
| Several servers | Redis leases say which server runs a match, and RabbitMQ holds one command queue per match, so a client on one server plays a match on another and a dead server's matches are adopted. See `backend/nodejs/README.md`, Running Several Servers |
| Spectators | Any signed-in player may join the room of a `botVsBot` match and receives every event, with no commands. A human match stays closed to strangers |
| Entity labels | Every entity and map marker shows its name and, for entities, its lux count under it (`render/labels.js`) |
| Project memory (`docs/prompts/`) | Tracked in git: prompt history, handovers, progress and knowledge notes; see its README |
| Prose gate | `tools/check_style.py` labels hits `deny` or `ask`, supports `--register informal`, reads `.js` files through their comments and checks the whole repo with `npm run lint:prose:all`; `test/prose.test.js` fails `npm test` on any `deny` hit |
| Godot project (`vone/`) | Godot 4.6, GL Compatibility renderer, a thin client at M7 (see Client Alignment below): spec check, server data, build, upgrade, recycle, creep orders, queue, groups, merge, split, paths, hero picks and abilities, hero orders, items, combat visuals, bot and spectator modes |
| Cross-runtime check | `determinism.html` plays the sim inside Chromium. The idle hash at tick 120 (`be35e5ef`, seed 1234567) and the bot hash at tick 1 200 (`d480339c`, seed 777, with creeps, heroes, A* and collisions) equal the Node values |
| Latest validation (2026-10-19, M9) | `npm test`: 257 passed; `node tools/run-bots.js --soak 1000 5000`: 1 000 seeds of 5 000 ticks, twice each, identical hashes, no crash, no non-integer value (648 s on 9 workers); backend `npm test`: 96 passed and 42 skipped without services; backend `npm run test:e2e`: 89 passed and 13 skipped without services; root `npm run test:e2e`: 21 of 21 passed, with Godot parity, Godot live (131 checks) and Chromium equal to Node. The MongoDB, Redis, RabbitMQ and PostgreSQL tests were not rerun. Nothing was tried on a phone `[UNVERIFIED]` |

### Browser and Godot Tests

Build the backend once (`npm run serve:install`, then `npm --prefix backend/nodejs run build`) and start the Playwright container (`docker start container-playwright-env09`, port 42944). Then run `npm run test:e2e`. The tests start their own throwaway backend on a free port, so no server needs to run. They read `PW_WS_ENDPOINT` (default `ws://localhost:42944/`) and `BACKEND_HOST_FOR_BROWSER` (default `host.docker.internal`, the host as the container sees it), and the shared set-up is `test/e2e/helpers/backend.js`. Each test skips when its prerequisite is missing: the Playwright server, the built backend or Godot 4 (`GODOT_BIN`, `godot` or the macOS app). The files run one at a time (`--test-concurrency=1`), because Godot and Chromium at once starved each other and made timing checks flaky. The script uses the glob `test/e2e/*.e2e.js` because Node 22.15.1 reads `node --test test/e2e/` as a module path and fails.

| File | Covers |
|---|---|
| `smoke.e2e.js` | Chromium and Node agree on the idle and the bot hash; the page loads and shows the menu |
| `network.e2e.js` | Two browsers play one match and receive the sim hashes; device sign-in and recovery |
| `play.e2e.js` | A human builds, upgrades and recycles through the controls; a spectator watches two bots; the menu and lobby by hand |
| `godot.e2e.js` | The Godot game logic against the shared cases; the Godot client against a live backend |

## Client Alignment

Three programs now share one rule engine and one protocol. `src/sim/` runs only in the backend (and in `determinism.html` and the headless tools). The web client and the Godot client are thin clients of the backend, so a rule changes in one place.

- **Protocol.** Snapshots carry the combat fields (`attack`, `recycle`, `stunTicks`, `targetId`, `powerLevel`, `shellLevel`, `roll`, `arrivalTick`), the hero fields (`heroType`, `shieldHp`, `shieldTicks`, `cd0` to `cd3`) and a `players` list with each player's rotation lock and pick cooldown, and `GET /api/game/spec` lists the entity `kinds`. Both clients read costs, upgrades, the build zone and the HP factor from `data/*.json` served by the backend.
- **Parity cases.** `test/fixtures/client-parity.json` holds the cases for label text, affordability, tap resolution and panel actions. `test/client-parity.test.js` runs them in JavaScript and `vone/tests/run_tests.gd` in GDScript. The JavaScript test also reads `GameLogic.SPEC_VERSION` from the `.gd` file and fails when it differs from the sim.
- **Workflow.** A change to a UI decision goes into `src/client/entity-text.js` or `src/client/ui/controls.js`, into `vone/scripts/game_logic.gd` and into the fixture, in one commit. A rule change goes into `src/sim/` and the GDD. Then both clients grow with the milestone: M4 added creep orders to both, and M5 added heroes.
- **Hero controls.** Both clients pick a hero at a barracks, show the hero bar with the four abilities, aim ranged and area abilities with a tap, and move or attack with taps. The web browser test and the Godot live test drive each of those through the controls. No human has played a full match with a hero yet.
- **Not verified.** A real phone, a Godot export for web, Android or iOS, and a Godot match between two humans (the protocol is the same as the covered bot match). `[UNVERIFIED]`

## M1 to M3 Closure

M1 map generation and M2 economy had no remaining implementation work. The owner confirmed that the existing nuclear meltdown balance stays unchanged. `state.map` stays outside the hash by owner decision; the map generator has seeded count, spacing, symmetry, connectivity and retry tests.

M3 now includes tower targeting and upgrades, hero basic attacks, one-tick ranged projectiles, attack procs, simultaneous damage, deterministic A*, hero movement, collision physics, knockback and visibility. Tower Power bonuses use the upgrade data, shell upgrades raise current and maximum HP, and future entropy uses the upgraded maximum. Stun timers expire on units and buildings.

M3 acceptance checks:

- Two units die when they land lethal attacks on the same tick.
- Towers switch to a hero that attacks a friendly hero and hold that target for 3 s after its last attack.
- Ranged attacks damage their target one tick after launch; projectiles fizzle if the target dies in flight.
- Tower upgrades enforce owner, cost and level limits; Power adds 25% per level, and Power spending contributes to recycling refunds.
- A shell upgrade changes future entropy without charging the increased maximum HP for time before the upgrade.
- Hero movement rejects blocked or out-of-map destinations and follows deterministic routes around blockers.
- Physics resolves unit-to-unit and unit-to-building collisions; a 0.5-tile knockback lands exactly over five linearly weighted ticks.
- Visibility updates every five ticks. Gameplay rules run through commands and `step()`.

Creep production, groups and pathing were M4 and hero production and abilities were M5, and both are done (see below). Item effects belong to M6.

## M4 (Creeps)

Done on 2026-10-18. `src/sim/creeps.js` holds the commands, the lane route and the spawn rule, `systems/production.js` the queues, and `systems/behavior.js` the creep targeting and steering. GDD 9.3 states the rules that the GDD left open, and the owners approved them on 2026-10-18. The acceptance checks are tests in `test/creeps.test.js`:

- Queue skip-ahead: with 26 creeps alive, a group of 5 is held, a later group of 3 spawns first, and the held group spawns the tick after four creeps die.
- A split of 7 gives 4 and 3, the odd creep stays, and a group of 1 does not split.
- Paths take at most 10 whole-unit waypoints inside the map. Groups walk them in order and then head for the enemy Core, and a barracks default path is copied into new groups only.
- Creeps walk the lane across the map and destroy an undefended Core. They fight what they meet and reach as far as their attack type says (melee 1 tile, area 3, ranged 4).
- Cancelling by `orderId` hits the named order even after the queue shifted, because a stale index would hit the wrong one.

Open for the owners:

- **Bots win fast.** With the spacing and collision fixes, seeds 1 to 10 of `tools/run-bots.js` end between tick 1 644 and 9 493, and seeds 1, 4 and 10 hit the 10 000-tick stalemate limit. Most wins are creep rushes. The bot builds no defense against groups. I read this as a balance question for the creep and tower numbers in `data/`, not a bug. `[UNVERIFIED]` as a design judgment.
- **Creep labels.** Done in M7: one label per creep group (GDD 13.1).

## M5 (Heroes)

Done on 2026-10-18 in the sim, the bot, the server, the web client and the Godot client. `src/sim/heroes.js` holds the pick, the rotation lock, the abilities and the shield; `damage.js` applies damage so a shield absorbs every source; `systems/hero.js`, `effects.js` and `cleanup.js` run the cooldowns and the death wait. GDD 7.7 states the rules that the GDD left open, and Hamza confirmed its four open choices on 2026-10-18 (`SPEC_VERSION` stays 0.10.0, so the golden replays were re-recorded and `heroes-seed-515151` was added). The acceptance checks are tests in `test/heroes.test.js`:

- The rotation lock across six picks: a picked hero stays locked until the other four were picked, the fifth pick unlocks the whole roster, and the sixth pick may be the first hero again.
- A pick pays its lux at once, builds for 5 seconds and puts a hero with ten HP per lux next to the barracks. Cancelling refunds in full, and a barracks that dies with the order in its queue loses the lux.
- After a death the player waits exactly 100 ticks before the next pick, and the hero is on the field 100 ticks after that.
- Each ability: melee (60 damage, guaranteed stun, Corona's dash), ranged (60 damage, 6 tiles, Prism 8), area (40 damage in 1.5 tiles, Flare larger), shield (150 absorbed, Halo 250). A refused cast costs nothing, and a cooldown lasts 100 ticks counting the cast tick.
- A shield absorbs damage before HP from abilities, and the rest of a blow goes through. A hero told to attack walks into reach and stops when the target dies.
- A checkpoint from before heroes existed still loads (`importState` fills new fields), and a bot memory from before heroes loads too.

The bot fields heroes as GDD 12.1 says. It found two bugs while I tested: the minimum Core lux was multiplied by 1000 twice, so it never picked, and the first lane vertex lies under the Core, which `heroMove` refuses, so a hero never left. The bot now skips vertices under buildings.

Open for the owners:

- **Hama's review of GDD 7.7.** Hamza confirmed the rotation lock at spawn, instant abilities, the Area ability hitting buildings and the Lumen Core, and no casting while stunned. Hama has not yet judged how the abilities feel.
- **Bots and balance.** Of seeds 1 to 6 of `tools/run-bots.js`, five now end in a victory between ticks 1 034 and 5 413, and seed 4 reaches the 10 000-tick limit. The bot spends half of its Core on a hero as soon as it has a barracks, so its first tower comes at tick 248 in seed 11 and later than before `[UNVERIFIED]`: I did not measure the older timing. Whether that is the balance the owners want is their judgment.
- **Hero roster.** Names and kits are still the placeholders in `data/heroes.json` until Hama designs them.
- **No portrait lock and no hold-to-aim.** Both came in M8. Camera follow came in M7.

## M6 (Items)

Done on 2026-10-18 in the sim, the server snapshot, the web client and the Godot client. `src/sim/items.js` holds the shop, the inventory, the four effects, the loot bag and the pickup; `systems/items.js` runs the map spawns, the despawn and the pickup; `systems/combat.js` funnels lux for Energy Grab and applies Haste and Sluggish to the attack interval; `systems/cleanup.js` drops the loot bag and rolls the creep drops. GDD 8.4 states the rules that the GDD left open, and Hamza confirmed them on 2026-10-19 (`SPEC_VERSION` stays 0.10.0, so every golden replay was re-recorded and `items-seed-616161` was added). The acceptance checks are tests in `test/items.test.js`:

- Energy Boost is refused on the Lumen Core, on an enemy and out of reach, and keeps the item. On an own hero or building it adds 150 HP to the HP and the maximum HP.
- Energy Grab funnels exactly 50 lux into the pending pool and then ends, a second use is refused while it runs, damage taken by a shield funnels nothing, and the effect ends with the hero.
- Haste turns one hit per second into about four for 300 ticks and then wears off. Sluggish slows an enemy hero or creep and is refused on own units, buildings and far targets.
- A purchase pays at once, builds for 20 ticks and waits (held) for a hero and a free slot. A barracks that dies loses what it holds, and cancelling refunds in full. The inventory stops at 50 items.
- A dead hero leaves its inventory as a loot bag that any hero can take, up to its free slots. Bags and ground items despawn after 600 ticks, and a map item appears at tick 1 200 and every 1 200 ticks after.
- A creep death drops an item about one time in ten from the seeded generator, and a checkpoint taken in the middle of item play resumes to the same hashes. An older checkpoint without item fields still loads.

Both clients show the item bar (one button per item with its count), a shop row in the barracks panel with the price, the queue lines of item orders, labels for ground items and bags, and a tap on a ground item or bag that sends the hero to take it. Energy Boost and Sluggish wait for a tap on the target. The shared decisions are `itemStates`, `immediateUse`, `shopStates` and the new `resolveTap` branches, with cases in `test/fixtures/client-parity.json`. The browser test buys two items before any hero exists, gets them with the hero, uses Haste and aims Energy Boost. The Godot live test does the same.

Open for the owners:

- **GDD 8.4.** Hamza confirmed its open choices on 2026-10-19: inventory as a count, replace on a second Haste or Sluggish, a hidden inventory, drops from every creep death, Energy Grab ending with the hero, Boost raising the maximum HP, and a stun blocking item use.
- **Hama's review of the item interface.** The item bar sits under the ability buttons and the shop row sits in the barracks panel. The ground items are small gems with a name label; Hama may want models and a different place for the quick slots.
- **No bot items.** GDD 12.1 gives the bot no items. A bot hero picks up what it walks over, which changes the balance a little `[UNVERIFIED]`.

## M7 (Client Rendering and the Owners' Requests of 2026-10-19)

Done on 2026-10-19. Hamza asked for four things before M7, and all of them are built:

- **Decisions.** Every loose point of GDD 8.4 went to Hamza as a question and is recorded there. A stun blocks item use. The inventory and the Energy Grab budget reach only a player's own team: the room snapshot no longer carries them, and a `match:private` event goes to the team's own sockets (Socket.IO room per team, plain WebSocket by connection, and the Redis relay carries the team).
- **Test ticks.** `tools/run-bots.js`, `run-headless.js` and the tests stop at 5 000 ticks. The game's own limit stays 10 000. The stalemate golden replay plays 5 000 ticks.
- **Entropy rate.** `normalizeData(raw, options)` takes a per-match rate, the replay header, the `started` log event and the match record keep it, and the server applies it to the sim, the bots, a resume and the replay verify. The unit is tenths of a percent of max HP per second (2026-10-19, before that it was whole percent per minute). The host types percent per second with one decimal in the start menu (web and Godot, URL parameter `entropy`, for example `0.5`), and the lobby shows it to the guest.
- **Resolution.** The web canvas fills the window and follows every resize, at the full device pixel ratio on a desktop and at most 2 on a touch device (`render/pixel-ratio.js`). The Godot window opens maximized and stretches with the window, and the width and height inputs are gone.

M7 itself, with the four parts that Hamza chose:

- **End-of-match stats.** Six counters per team in the sim (GDD 13.2), hashed, in the result of the match (`result.stats`). Both clients show a table with the duration and both sides (`matchSummary` and `match_summary`, parity cases).
- **Group labels.** One label per creep group in both clients (`creepGroupLabels`, `creep_group_labels`).
- **Instancing and interpolation (web).** Creeps (one mesh per team), shots and blockers are instanced meshes, so a destroyed blocker now leaves the screen. Positions are blended two ticks behind the newest snapshot (`render/interpolation.js`, six unit tests).
- **Camera follow.** A Follow button in the hero bar of both clients eases the camera toward the hero, and dragging the map turns it off.

Checks: `test/stats.test.js` (7), `test/options.test.js` (3), `test/interpolation.test.js` (6), `test/pixel-ratio.test.js` (3), the socket tests for private state and entropy, and browser tests for the canvas size, the instances and the follow button.

Open for the owners:

- **Hama's review of the new interface:** the Follow button, the group label text (`Creeps x5 50`), the end-of-match table and the entropy field in the menu.
- **60 creeps at 60 fps on the reference device is not measured** `[UNVERIFIED]`. The browser test counts instances and checks the blend, but the container renders in software, so it says nothing about frame rate.
- **Godot has no interpolation or instancing.** Hamza chose the web client for those, so the Godot arenas still rebuild their nodes on every snapshot.
- **A stalemate at 5 000 ticks is a test setting.** A match whose host chose no limit ends at the server limit, 10 000 by default. The menus of both clients create matches with the choice Unlimited (`maxTicks` 0) or Capped (1 to 1 000 000), so a played match no longer ends in a draw by default (2026-10-19).

### Playtest Fixes of 2026-10-19 (Second Round: Leave and the Godot Layout)

After Hamza measured 59 to 60 fps on the wide tablet, he asked for a Leave button in the web client and for the Godot layout to use the whole window.

- **Leave (both clients).** `POST /matches/:id/quit` leaves a running match: a forfeit in a match for two humans (a win for the other team, end reason `forfeit`, counted on the leaderboard), a stop as a draw against a bot or alone. The web client has a Leave button in the lobby and in the HUD, with a second press in the forfeit case. The Godot LEAVE button used to only close its socket and now calls the server too. The pure rules are `leaveCall` and `leaveNeedsConfirm` (parity cases).
- **Abandoned matches.** The server stops a running match that no client has been connected to for `MATCH_ABANDON_SECONDS` (120), as a draw with its replay. This matters because Unlimited is the default match type: without it a closed tab left a match running for good.
- **Godot layout.** The arena is now the whole window, and the controls float over it in translucent panels: the match information and the LEAVE, COPY and START buttons at the top, the palette and the selection, hero and item panels at the bottom, the end-of-match table in the middle. The start card is centered, no wider than the window and scrolls when the window is small. The project base is a 1280 × 720 desktop window; the 600 × 1200 portrait base and its window override are gone. A phone build will get its own scenes later (Hamza's plan).
- **Default view.** A wide window shows at least 28 tiles top to bottom, so a landscape view is wider than 32 tiles, and it starts 8 tiles nearer the base so the Core is not under the bottom panel. Both clients do the same.

### Fourth Round: the Orders Window and the Bot Without an Offset

- **Orders window (both clients).** The queue is out of the barracks panel. A floating window at the top right (`order-window.js`; `_build_orders_window` in Godot) is collapsed by default, logs every order the player made, shows live timers and a cancel button for queued ones, and is three rows high before it scrolls. The log is built from the snapshots (`updateOrderLog`, `logRows`, `clockText`, `orderLabel`, `orderWait`; parity cases `orderLog`, `logRows`, `clockText`, `orderText`), so it needs no new server message; an order made before the page joined is not in it. Browser and Godot tests check that a new order moves nothing in the panel.
- **No tick offset between the bots.** Both decide on the same ticks. That alone left team 0 at 44 percent of the decided matches over 900 seeds, and the cause was a second asymmetry in `pickTile`: it scanned the build zone in ascending order, so a tie between equally scored tiles gave team 1 the mirror image of the wrong tile. Team 1 now scans in the mirrored order: 357 wins for team 0 and 368 for team 1 over 900 seeds. The bot goldens were recorded again (`bots-seed-7-victory`, tick 3 632).
- **A small first-mover effect remains in the sim.** In a scripted match where both sides send the same commands, team 0 wins by about one tick of damage, because the sim applies the commands of one tick by player id (`compareEnvelopes`) and effects resolve in id order. It does not show in the bot soak.
- **Creeps can overlap a little at a tower (open).** In some bot matches (seeds 4, 17, 61) creeps pressed between a tower and another creep overlap by up to 8 units (0.008 tile) near z 64, where the first towers stand. The spacing test uses seed 7, where it holds. This is a physics edge case, not something I changed `[UNVERIFIED]` as to the cause.
- **The Godot MCP addon.** It was not connected in this session (no tools, no resources), so the Godot checks used a screenshot script. `vone/.mcp.json` is in the repo: start Claude Code from `vone/` with the editor open to use it.

### Third Round: the Bot Asymmetry, Back to Menu and Rejoin

- **The asymmetry was the bot's tower placement.** `pickTile` used the same absolute columns (16, 48, 80) for both teams, so both bots put their first tower on the left. Team 1's tower then sat on the lane team 0 attacks through, while team 1's own attack lane (the right one) had no tower. Mirroring the columns for team 1 (`width - 1 - column`) made a 200-seed soak 79 to 72 (151 decided matches), from 87 to 648. The fourth round removed the 7 tick offset and a second tie-break asymmetry (see above).
- **Goldens re-recorded.** The bot changed, so `bots-seed-777`, `bots-seed-4-stalemate` and a new `bots-seed-17-victory` (tick 3 823, team 0 wins; it replaces `bots-seed-3-victory`, which ends at tick 1 173 now) were recorded again. The upgrade test uses seed 6, where both bases finish their upgrades.
- **Back to Menu** in the end-of-match table of both clients, next to Close.
- **Rejoin.** `joinCall` decides whether a join by id needs the `join` call: a match the player already belongs to, and a bot-versus-bot match, do not. The web menu and the Godot start screen offer **Rejoin Last Match** while this device remembers a match (localStorage, and `user://luxcores.cfg`); leaving or finishing forgets it.
- **GDScript warnings.** `call` (a parameter and a local) shadowed `Object.call` and `free` (in a test) shadowed `Object.free`; both are renamed.

Checks: `backend/nodejs/test/leave.e2e-spec.ts` (quit against a bot, forfeit with a verified replay and the leaderboard, refusals, the watchdog stopping an abandoned match and sparing a watched one), a browser test of Leave in the three cases, and Godot live checks for the layout rectangles, Leave on the server and the return to the start screen.

## M8 (Touch Controls)

Done on 2026-10-19 in both clients, with the owners' answers of that day (GDD v0.9.13, section 11). Hot seat was deferred.

- **Build ghost (GDD 11.5).** A tap in build mode sets a translucent ghost on the tile, green or red, and the panel shows Place and Cancel. `placement()` holds the checks (zone, taken tile, vent, lux) and `resolveTap` returns `{ ghost, message? }` for a build tap. The parity cases are `placement` and the changed `resolveTap` cases.
- **Hold-to-aim (GDD 11.2).** Press the ranged or area button, drag 14 pixels off it and lift over the map to cast there; lifting back over the button cancels. The tap-then-tap way stays. The pure rules are `holdAimPhase` and `holdAimRelease`.
- **Pinch and wheel zoom.** Two fingers, the mouse wheel and a trackpad pinch zoom between 0.6 and 2.2 times the default view (`clampZoom`, `pinchZoom`). The web client had no zoom before. Godot keeps its plus and minus buttons.
- **Hero name.** A tap on the hero's name resumes camera follow.
- **Portrait.** The page tries `screen.orientation.lock('portrait')` and shows a prompt in landscape on a phone; `src/client/manifest.webmanifest` asks for portrait and full screen when the page is installed. The Godot project already had the portrait setting.
- **Godot camera.** The Godot camera now opens on the viewer's three rows at 32 tiles across, like the web client (before it showed the whole map), so one zoom value means the same in both. The zoom limits are the shared ones.

Checks: unit tests for `placement`, the gestures and the portrait lock, parity cases for all of them, browser tests for the ghost, pinch (synthetic pointer events), hold-to-aim and the hero name, and Godot live checks for the ghost, hold-to-aim, pinch, wheel and the hero name.

Open for the owners:

- **Hama's review of the touch feel.** Ghost colors, the 14-pixel aim threshold, the zoom limits and the rotate prompt are first guesses.
- **Not tried on a phone** `[UNVERIFIED]`. The browser tests drive pointer events in Chromium, and the Godot tests drive the handlers with synthetic events. Real fingers, the lock on Android and Godot's touch emulation on a device are untested. Godot may send both a touch and an emulated mouse event for one finger; the handlers are written to ignore the second.
- **Item aiming.** Energy Boost and Sluggish still aim with two taps. Hold-to-aim covers abilities only, as the owners asked.

## M9 (Bot and Soak)

Done on 2026-10-19 except hot seat, which the owners deferred. The bot of M4 and M5 already followed GDD 12.1. The soak is `node tools/run-bots.js --soak 1000 5000`: it spreads the seeds over worker threads, plays each seed twice, compares the two hashes, scans the whole final state for a non-integer value (`tools/non-integer.js`, with a unit test) and reports how the matches ended.

Result of 1 000 seeds of 5 000 ticks, twice each, on 9 workers (648 s): 0 crashes, 0 disagreeing runs, 0 non-integer states. 735 matches ended in a victory (earliest tick 971, median 1 198, latest 4 979) and 265 had no winner at the 5 000-tick test limit.

Open for the owners:

- **Team 1 wins far more often.** Of the 735 victories, team 1 won 648 and team 0 won 87, with the same bot on both sides and a point-mirrored map. Hamza suspects the bot logic and will look at it with human-versus-bot runs; I did not look for the cause (2026-10-19). A bot-versus-bot soak would show the same split, so it is a bot or sim question, not a soak problem `[UNVERIFIED]`.
- **No CI.** The repo has no CI configuration, so "soak in CI" is a command to run, not a pipeline. Adding a workflow is an infrastructure choice for Hamza.
- **Hot seat (GDD 12.2).** Deferred. The design stays in the GDD: a server match type that gives both teams to the host, commands that carry a side and a Side button.

## Client Controls (2026-10-20)

- **Godot camera.** The start menu selects Camera 1 (RTS) by default and offers Camera 2 (orthographic Camera3D) for debugging. Camera 1 supports edge scrolling on all four borders and does not pan on left-click drag; Camera 2 keeps left-drag panning. The selected camera handles map picking, zoom and orbit controls. `vone/tests/main3d_scene.gd` checks both modes.
- **Barracks (web and Godot).** Dropdowns choose the creep group size, creep type and hero. A separate Pick Hero button confirms the choice. Recycle, Set Default Path and Order Creeps share one row. The existing command payloads remain unchanged.
- **Hero keyboard slots (web and Godot).** Q/W/E/R call melee, ranged, area and shield in ability-slot order. Keys 1–4 call inventory slots 1–4, which hold Energy Boost, Energy Grab, Haste and Sluggish. Clicks still use the same actions.
- **Key settings.** The KEYS button opens a remapping panel in each client. Each of the eight slots accepts a unique letter or digit. The web client saves to local storage; Godot saves to `user://luxcores.cfg`. These settings stay local to each client.
- **Validation.** `npm test` passed 259 tests. `npm run headless -- 1 1000` produced hash `389877c6`. Godot parity, live-match and main-scene tests passed 251, 135 and 33 checks. The full `npm run test:e2e` run passed 19 of 21 tests. The item shortcut test passed. The hero test passed its remapping and hotkey assertions before a later panel-visibility timeout. The creep-order test timed out while its cancel row changed.

## Next Milestone: M10 (Cross-Browser Determinism and the Performance Pass)

From `docs/TECH_ARCHITECTURE.md` section 14. Done when Node, Chrome on Android and Safari on iOS print identical hashes, and the performance numbers of the reference device are recorded here. Hamza's answers of 2026-10-19: the reference device is a Galaxy Wide class phone or a similar wide device, and the web client already plays comfortably on a Galaxy Tab Active3 (a wide tablet), so no tuning is due before the first numbers. The portrait lock is optional: the prompt in landscape now has a Play anyway button. The Godot UI adapts to wide screens later, when its interface gets its next pass.

### Already Built for M10 (2026-10-19)

- **`determinism.html?suite=1`.** Plays every golden replay of `replays/golden/` in the browser and compares each recorded hash, so one tap shows PASS or the first tick that differs. The backend serves the replays at `/replays/golden/`, `src/client/determinism-suite.js` holds the list (a test checks it against the directory), and a Chromium test passes it. In the test container Chromium plays 7 replays at about 1 760 ticks per second, and the game needs 20.
- **`?perf=1`.** Adds the frame meter (`src/client/perf.js`) to the game page: frames per second, the average, 95th percentile and worst frame time of the last 120 frames, the JavaScript time per frame, draw calls, triangles, entities, pixel ratio and canvas size. `window.__luxTest.perf()` returns the same numbers. In the container (software rendering) the page's own JavaScript took about 3 ms per frame with 40 draw calls; the frame rate there says nothing about a phone.

### The Phone Runbook

0. **The test hub.** Open `/tests` on the server (the Swagger page at `/api/docs` links to it). It lists the LAN addresses of the server, ready-made links for every check below (play, watch, host, frame meter, the determinism suite), a form for each page that takes URL parameters, and the API and golden-replay links. Open it on the phone itself to start from there, or pick a LAN address on the computer and copy a link to the phone. `GET /api/dev/links` returns the same list as JSON, and `TEST_HUB=false` (the default in production) turns both off.
1. Start the server with `npm run serve`. The phone and the computer must share a network. Plain `http://` works for everything the page uses.
2. On each phone (Chrome on Android, Safari on iOS) open the determinism suite link of the hub, `http://<address>:3000/determinism.html?suite=1`. Expected: a green `PASS: all 7 replays match Node`. Send a screenshot, and for a failure the JSON under the list, which names the first tick that differs.
3. Open the frame-meter link of the hub (`/?perf=1` with a match) and play a full match against the bot (Play Against Bot, Unlimited). Note the meter at three moments: the first minute, the middle of a creep fight and the end. A bot-versus-bot match (Watch Bot Against Bot, any seed) reaches 60 creeps too, with no tapping.
4. Record per phone: model, browser version, fps, p95 frame time, JavaScript ms, draw calls and anything that stutters (a tap that lags, a frozen frame while the camera pans).

### Targets (a first proposal, for the owners to change)

| Measure | Target |
|---|---|
| Hashes | Identical on all three engines for all 7 golden replays |
| Frame rate with 60 creeps | 60 fps if the phone allows it, never below 30 fps |
| 95th percentile frame time | At most 33 ms |
| JavaScript per frame | At most 8 ms |

### If the Numbers Miss

In the order I would try, each one measured with the meter before and after: lower the pixel ratio cap on touch from 2 to 1.5 (`render/pixel-ratio.js`); turn bloom off or to a quarter of the resolution (`render/scene.js`); cut the label work for far or crowded entities (`render/labels.js`); merge more instanced meshes (`render/entity-meshes.js`). A difference in hashes is a sim bug (P0): find the first tick with the suite, then the field with `hashState`.

### Risks

- Safari needs an import map (16.4 or newer) and the page loads `three` and `socket.io-client` from jsDelivr, so an offline phone cannot play.
- `screen.orientation.lock` is unsupported on iOS, where the rotate prompt does the work.
- Float math: the sim uses integers and tables only, so a hash difference should not happen; the first real test of that claim on a phone is this milestone `[UNVERIFIED]`.

Question for the owners: are the targets above right for the reference device?

## Interpretations Made in the Scaffold

Check with Hamza or Hama if any of these feel wrong:

- Team 0 is the player at the bottom (blue), team 1 the top (red). The z axis grows downward on the map, so team 0's Core sits at tile (48, 96).
- The bot is player 1 on team 1 in the default 1v1.
- `balance.json` stores the starting Core as `startPerPlayerLux: 100` and team start lux is 100 × players on the team.
- Placeholder hero kits in `heroes.json` (Halo, Prism, Flare, Aurora, Corona) are working names until Hama designs the roster.

## Interpretations Made in M1

Two came from the owners during the session; the rest fill gaps in the docs.

- **Item spawns (owners):** 2 per team, 4 in total, as in GDD 10.2. `itemSpawnsPerTeam` in `mapgen.json` was 1 and is now 2. Team 0's spawns go in rows 56 to 63, one per side column, and the mirror puts the other two in rows 48 to 55.
- **Black hole (owners):** removed from the design, the data and the client. Layouts and hashes did not change, so `SPEC_VERSION` stays 0.10.0 and the golden replay still plays back.
- **Distances:** "within N tiles" means the larger of the two axis differences (Chebyshev) is at most N. The `between` spacing is also checked against the mirror images of placed elements, so the finished layout meets it across the DMZ.
- **Relaxation:** when the 50 tries run out, `between` shrinks by `relaxStep` for that element only, down to a floor of 1 tile. If it still fails, the whole attempt fails and the next seed runs.
- **Seed limit:** `maxSeedAttempts` (64 in `mapgen.json`) bounds the retry loop. Exhausting it throws.
- **Lane jitter:** sideways only (x), one draw per inner control point. Outside the Core row (z below 80), x is clamped so the stamped lane stays inside its column.
- **Lane tiles:** each Bresenham tile on a polyline is stamped as a square of `laneWidth` tiles. Team 1's tiles are the mirrored tiles of team 0, not a second rasterization, so the symmetry is exact.
- **Zones:** vents and blockers go in rows 64 to 111, the build zone of team 0, and the mirror covers rows 0 to 47. Vents take 2 distinct columns chosen by the seed.
- **HP units:** HP is stored in milli units, like lux, so a Core's `hp` equals its `coreLux`. A blocker's 200 HP from `buildings.json` becomes 200 000 in state.
- **Core `maxHp` (owners):** starts at the starting lux and rises with the Core's HP (GDD 3.1). `createState` sets only the start; the M2 economy applies the rise. The glow-as-health formula is gone, so nothing divides by `maxHp` for display.
- **Entity ids:** Cores are 1 and 2, then team 0's 6 blockers (3 to 8) in placement order, then team 1's mirrored 6 (9 to 14). Cores and blockers have `owner` -1.
- **Replay metadata:** `mapgen.version` stays 1, because no earlier generator existed. Bump it when a data or code change alters layouts for the same seed.
- **Spec and GDD (owners):** `SPEC_VERSION` is 0.10.0 and stays there while the MVP is built, so a rule change re-records the golden replay instead of bumping the version. The GDD is v0.9.3, with changelog rows for the black hole removal, lane width, connectivity, spacing, and tower attack types.

## Interpretations Made in M2

The GDD was silent or ambiguous on these. Its v0.9.2 changelog records the ones that change a rule, and the owners approve them.

- **Recycle refund:** it goes into the Core at once, not through the 2 s buffer, and only the owner of a building can recycle it.
- **Meltdown targets:** Cores, buildings, creeps and heroes within 3 tiles, not neutral blockers. Damage to a Core comes out of its lux. The timer counts ticks since the last spend, and the plants explode at the end of the 2 400th tick.
- **Vents:** only a geothermal collector needs a vent tile. Other buildings may stand on one.
- **Wind:** a plant rolls its output when it is built and again every 200 ticks, from `state.rng`, in id order.
- **Income rounding:** each source pays `rate / 20` per tick with integer math that adds up to exactly `rate` over 20 ticks, so there is no drift.
- **Entropy:** HP leaves once per second (`maxHp x tenths / 1000` plus a carried remainder, in tenths of a percent per second; the default is 1). A shell upgrade changes only future entropy, because the remainder carries.
- **Day and night:** derived from the tick (`tick % 1200 < 800` is day), so they need no state. The match starts at dawn.
- **Build rules:** a refused build costs nothing. The sim refuses a tile outside the team's build zone, off the map, or under a Core, building or blocker. It also refuses an unknown building or player, a tower without a valid attack type, any other building with one, and a geothermal collector off the team's vents. A tower is an ordinary building until M3 gives it a behavior.
- **Hash layout:** entities carry four more fields (`born`, `roll`, `recycle`, `attack`) and the pending pool is hashed entry by entry. `SPEC_VERSION` stays at 0.10.0, so both golden replays were re-recorded.
- **Not in M2:** the timed-mode buzzer needs a mode setting in `createState` and in the replay format. The server still ends a match at `MATCH_MAX_TICKS` as a draw.

## Accepted M2 Balance Decision

A nuclear plant earns 5 lux/s. It earns 600 lux in the 120 s before it melts down and deals 400 damage. The owner chose to preserve these values; changing the Core threat requires a later balance decision.

## Known Gaps

- The backend sends full snapshots with every entity and uses guest sign-in only. A running match lives in the memory of one process, and the match log lets another start rebuild it. `backend/nodejs/README.md` lists these limits with the planned fixes.
- Buildings and units still draw as placeholder boxes. The web camera stays north-up for team 1, so its base appears at the top. Godot supports camera orbit and elevation controls.
- Projectiles live one tick and snapshots arrive every second tick, so clients draw an aim line from `targetId` to show each shot. Interpolation came in M7. Delta snapshots stay deferred (Hamza).
- The client compares the sim spec version with the server but not the data hash, because `crypto.subtle` needs a secure context and a LAN address is not one.

## Server Architecture

Decided with the owners on 2026-10-18 and built the same day. The server stays the only endpoint that clients talk to (Socket.IO and plain WebSocket). Behind it, each service is optional. A service that is down as the server starts stays off until the next restart, and the database falls back to a JSON file, so the server always runs alone. Details and the settings are in `backend/nodejs/README.md` (Storage, Match Log and Resume, Running Several Servers).

| Layer | Used when available | Fallback |
|---|---|---|
| Commands for a match that another server runs | RabbitMQ queue `luxcores.match.<id>.commands`, with a direct reply-to | a local match takes commands by a direct call, which is also the fast path with a broker |
| Event log (commands, hashes, lifecycle, checkpoints) | Redis Stream per match, moved in the background to MongoDB (`match_events`, indexed by match, with a TTL) | NDJSON file per match, and a file copy of every write while Redis has no MongoDB behind it |
| Main storage | MongoDB | JSON file, which mirrors players and matches while MongoDB works and is copied back afterwards |
| Relational data later (profiles, teams, guilds) | PostgreSQL, tried at start-up and otherwise untouched | skipped |
| Who runs a match | Redis lease per match, so several servers share the matches and a dead server's matches are adopted | the one server owns every match |
| Room events between servers | Redis Pub/Sub, one channel per match, only while another server follows the room | the one server |

Decisions:

- A running match resumes automatically after a restart, and also after a change of the data files or the code, from its newest checkpoint. The replay of such a match is marked `reproducible: false`.
- Redis Pub/Sub carries room events between servers, not the Socket.IO Redis Streams adapter, because it also serves the plain WebSocket gateway and needs no extra dependency. Pub/Sub keeps no history, which suits snapshots.
- Events are commands, hashes and lifecycle, and snapshots stay live-only. A checkpoint is state, saved beside the events.
- Mongo holds one events collection indexed by match, not a collection per match.
- When MongoDB fails during the run, the server switches to the JSON file until the next restart and does not switch back by itself, so the two stores never diverge while the server runs.
- The only new dependency is `@redis/client` 6.3.0. Hamza approved the Redis layer on 2026-10-18.

| Phase | Scope | State |
|---|---|---|
| A | The `EventLog` port and its file implementation, the runner writes the log, `SimService.rebuild`, automatic resume, `nextSeq` for rejoining clients (web and Godot), a volume in the production stack | Done and verified |
| B | MongoDB as main store with the fallback to the JSON file, `ResilientStore`, the `auto` driver, the PostgreSQL probe | Done and verified |
| C | Redis Stream buffer, the Mongo flusher, `match_events`, outage tests | Done and verified |
| D | RabbitMQ per-match command queues, queue lifecycle, broker-outage fallback | Done and verified |
| E | Match leases, adoption of orphaned matches, cross-server join, command, stop and room events | Done and verified for two servers. Not built: placement by load, delta snapshots |
| Checkpoints | Sim state and bot memory saved at tick 20 and every 400 ticks, resume across a change of rules | Done and verified |

How it was checked:

- Unit and end-to-end tests on real containers (MongoDB 7.0, Redis 7, RabbitMQ 3.13, PostgreSQL 16) cover every sink, the planner, the leases, the relay and the bus. Outages were made with a TCP proxy that cuts and restores a service while events flow.
- A resume after an edit of a data file and of the bot code keeps the match running with the human's buildings.
- In the production Compose stack with two API containers: a client on one container played a match run by the other, `docker kill` of the owner handed the match to the other container within about ten seconds, `docker stop` of MongoDB left the match running on the JSON file, and the restart afterwards copied the changes back. See `backend/nodejs/deploy/README.md`, What Is Verified.
- Earlier, phase A passed a `SIGKILL` of the real server with a browser page that rejoined, twice in a row.

Not verified `[UNVERIFIED]`: three or more servers, a Linux host, a managed Redis or MongoDB, a network partition between a server and Redis, and any load beyond the benchmark below.

### Capacity

The owners' target is about 100 simultaneous 5v5 matches per node. A measured 1v1 bot match (seed 4, up to 50 creeps, two bots) costs 0.86 ms per tick on average (p99 1.2 ms, worst 10 ms) and 0.08 ms per snapshot, which is about 18 ms of CPU per second per match. One Node process uses one core, so one process runs roughly 33 such matches at 60% load. Snapshots weigh about 19.5 KB each, 10 per second per client. Checkpoints add little: about 70 KB of JSON every 400 ticks per match, and a copy of the state in memory.

Extrapolating to 5v5 `[UNVERIFIED]`, because the sim has no teams of 5 or heroes yet: five times the units would cost about 5 ms per tick (the targeting loops grow with the square of the unit count) and about 100 KB per snapshot. That is 100 ms of CPU per second per match, so one core carries 6 or 7 matches, and 100 matches need 15 or more cores. Ten clients per match at 100 KB and 10 snapshots per second is 10 MB/s per match, far too much.

What the architecture now offers: one server process per core (`docker compose up -d --scale api=N`), sharing the matches through Redis and RabbitMQ, which was tested with two. Two things are still missing before 5v5 at that scale: delta, fog-filtered and compact snapshots (`docs/TECH_ARCHITECTURE.md` section 13.1), which change the protocol of both clients and need parity cases; and placement by load, because a new match runs on whichever server received the start request. Both are for the owners to schedule.

## Queued by the Owners

Decided on 2026-10-16 (`docs/prompts/2026-10-16-backend-decisions.md`). Do them in this order:

1. Done: a plain WebSocket gateway at `/ws` (`backend/nodejs/README.md`, Plain WebSocket Protocol).
2. Done: a device guest with a recovery code, plus rate limits on the sign-in routes.
3. Done: a Dockerfile and a compose stack with Postgres, RabbitMQ and a TLS reverse proxy for one VPS (`backend/nodejs/deploy/`). Verified through local TLS only.
4. Done: M2 (economy). The next game task is M4 above.

## More Gaps
- Backend adapter and event tests for MongoDB, PostgreSQL and RabbitMQ pass on real containers (Postgres 16, MongoDB 7.0, RabbitMQ 3.13 on a local Docker Desktop) but skip in a plain `npm test`. No CI runs them yet.

- Mobile testing needs the backend reachable over the LAN (`npm run serve`, then `http://<mac-ip>:3000` on the phone). Three.js loads from jsDelivr, so the phone needs internet access.
- Dragging holds the ground point under the finger, and taps ray-cast to the ground plane (`src/client/input/pointer.js`). Pinch zoom is M8.
- `README.md.bak` sits in the repo root and is tracked. It looks like a stray editor backup; the owners should delete it or say why it stays.
- `state.map` stays outside the hash (owners, for now). The hash covers blockers but not lanes, vents or item spawns. A change that moves only those passes the golden replay, `npm run test:e2e` and any future Godot parity check that compares hashes. Placement draws blockers after vents, so most generator changes also move a blocker and get caught; an edit to the item spawn rows or to lane jitter alone may not. The gap closes as systems consume the data. Geothermal collectors read vents (M2), creeps follow lane polylines (M4) and map spawns create ground items (M6), so each puts its result into hashed entities. Until then, a Godot port must compare `generateMap` output directly, for example the layout of seed 1234567. Hashing a digest of `state.map` would close the gap for good and changes the hash layout.
- No CI yet. A GitHub Actions job running `npm test` on Node 22 is a five-line addition when the repo goes to GitHub.
