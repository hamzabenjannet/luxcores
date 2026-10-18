# Handover

Status as of 2026-10-18, after M4 (creeps) in the sim, the bot and both clients. Read `CLAUDE.md` first for the working rules.

## Where things stand

Design is settled for M1 to M3: `docs/GAME_DESIGN.md` v0.9.5 records the owner-approved tower attack-type rule, unit collider radius and one-tick ranged projectile delay. v0.9.6 adds the M4 rules (section 9.3) that still await owner approval. Every number marked *(default)* lives in `data/`.

Milestones M1 (map generation), M2 (economy), M3 (combat and physics) and M4 (creeps) are done:

| Area | State |
|---|---|
| Integer math (`fixed.js`, `sin-table.js`) | Done, tested against BigInt and exact quarter turns |
| RNG (`rng.js`) | Done, tested against the reference Mulberry32 |
| State, config normalization | Done (`state.js`, `config.js`); `createState` spawns the 2 Cores and 12 blockers; teams are minimal |
| Map generation (`mapgen.js`) | Done (M1): 3 lanes, 2 vents, 6 blockers and 2 item spawns per team from the seed, point-mirrored, flood-fill checked; stored on `state.map` |
| Economy and tower upgrades (M2/M3) | Done: collectors, day/night, income buffer, spending, placement, recycling, entropy, meltdown, victory and tower upgrades |
| Tick pipeline (`step.js`) | Economy, production (barracks queues), behavior (towers, creep targeting and steering, routes), movement and collisions, combat (towers, heroes, creeps) and stun timers, recycle, entropy, meltdown, cleanup, victory and visibility run; hero lifecycle, effects and item systems remain for later milestones |
| Commands (`commands.js`) | Build, upgrade, recycle, cancelRecycle, orderCreeps, cancelQueue, setBarracksPath, setGroupPath, mergeGroups, splitGroup, heroAttack and heroMove use authoritative handlers; hero pick, ability and item commands remain for later milestones |
| Hash (`hash.js`) | Canonical layout documented in the file header; all gameplay state, including projectiles, upgrades, entropy remainder, creep groups, barracks queues and waypoints, is hashed; `state.map` stays derived and excluded by owner decision |
| Replay (`replay.js`) | Record and playback done, mismatch detection tested; the golden replay `replays/golden/seed-1234567.json` (2 400 ticks) plays back in `test/golden.test.js` |
| Headless runner | `npm run headless`: 12 000 ticks in about 15 ms with empty systems; a third argument saves the run as a replay |
| Purity guard | `test/sim-boundary.test.js` blocks bare imports, Math.random, wall clock, approximated Math, `**`, DOM, timers, key iteration |
| Web client | Plays only through the server: a start menu (bot, bots to watch, two humans), a lobby card, a build palette, a selection panel (tower upgrades, recycle), hero orders and a result banner. It draws the map, every entity with its name and lux count, tower attack types, aim lines and projectiles, picks tiles by ray-casting, and pans by drag. It never steps the sim |
| Backend (`backend/nodejs/`) | NestJS 12 multiplayer server: guest auth with JWT guards, players, lobbies, a server-authoritative match runner at 20 Hz, Socket.IO `/game` namespace, replays with server-side verify, static routes for the game files, Swagger at `/api/docs`, JSON file database with MongoDB and PostgreSQL adapters, RabbitMQ events with an in-process fallback. See `backend/nodejs/README.md` |
| Bots | `src/bot/bot.js` follows the GDD 12.1 rotation (collector, barracks, tower, creep group of 5) and upgrades towers; the server runs it for a `vsBot` or `botVsBot` lobby, and its commands go into the replay. Heroes arrive with M5. `node tools/run-bots.js --soak 100` plays 100 seeds twice and compares the hashes. Golden replays `bots-seed-777` (5 000 ticks) and `bots-seed-3-victory` (a creep rush that ends the match at tick 2142) pin bot matches |
| Spectators | Any signed-in player may join the room of a `botVsBot` match and receives every event, with no commands. A human match stays closed to strangers |
| Entity labels | Every entity and map marker shows its name and, for entities, its lux count under it (`render/labels.js`) |
| Project memory (`docs/prompts/`) | Tracked in git: prompt history, handovers, progress and knowledge notes; see its README |
| Prose gate | `tools/check_style.py` labels hits `deny` or `ask`, supports `--register informal`, reads `.js` files through their comments and checks the whole repo with `npm run lint:prose:all`; `test/prose.test.js` fails `npm test` on any `deny` hit |
| Godot project (`vone/`) | Godot 4.6, GL Compatibility renderer, a thin client at M4 (see Client Alignment below): spec check, server data, build, upgrade, recycle, creep orders, queue, groups, merge, split, paths, hero orders, combat visuals, bot and spectator modes |
| Cross-runtime check | `determinism.html` plays the sim inside Chromium. The idle hash at tick 120 (`173b2eec`, seed 1234567) and the bot hash at tick 5000 (`8c7b7b76`, seed 777, with creeps, A* and collisions) equal the Node values |
| M4 validation (2026-10-18) | `npm test`: 153 passed; `npm run headless`: 12 000 ticks, hash `d548a8fa`; backend `npm test`: 38 passed and 12 skipped without services; backend `npm run test:e2e`: 59 passed and 4 skipped; root `npm run test:e2e`: 10 passed (Chromium, Godot parity 63 checks, Godot live 41 checks); `node tools/run-bots.js --soak 30 6000`: ok |

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

- **Protocol.** Snapshots carry the combat fields (`attack`, `recycle`, `stunTicks`, `targetId`, `powerLevel`, `shellLevel`, `roll`, `arrivalTick`), and `GET /api/game/spec` lists the entity `kinds`. Both clients read costs, upgrades, the build zone and the HP factor from `data/*.json` served by the backend.
- **Parity cases.** `test/fixtures/client-parity.json` holds the cases for label text, affordability, tap resolution and panel actions. `test/client-parity.test.js` runs them in JavaScript and `vone/tests/run_tests.gd` in GDScript. The JavaScript test also reads `GameLogic.SPEC_VERSION` from the `.gd` file and fails when it differs from the sim.
- **Workflow.** A change to a UI decision goes into `src/client/entity-text.js` or `src/client/ui/controls.js`, into `vone/scripts/game_logic.gd` and into the fixture, in one commit. A rule change goes into `src/sim/` and the GDD. Then both clients grow with the milestone: M4 adds creep orders to both.
- **Hero controls.** No hero exists before M5, because nothing in the sim spawns one. Both clients wire hero move and attack, and the parity cases cover them. No live match has exercised them yet. The owners test heroes in M5.
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

Creep production, groups and pathing were M4 and are done (see M4 below). Hero production and abilities belong to M5; item effects belong to M6.

## M4 (Creeps)

Done on 2026-10-18. `src/sim/creeps.js` holds the commands, the lane route and the spawn rule, `systems/production.js` the queues, and `systems/behavior.js` the creep targeting and steering. GDD 9.3 states the rules that the GDD left open, and they await owner approval. The acceptance checks are tests in `test/creeps.test.js`:

- Queue skip-ahead: with 26 creeps alive, a group of 5 is held, a later group of 3 spawns first, and the held group spawns the tick after four creeps die.
- A split of 7 gives 4 and 3, the odd creep stays, and a group of 1 does not split.
- Paths take at most 10 whole-unit waypoints inside the map. Groups walk them in order and then head for the enemy Core, and a barracks default path is copied into new groups only.
- Creeps walk the lane across the map and destroy an undefended Core. They fight what they meet and reach as far as their attack type says (melee 1 tile, area 3, ranged 4).
- Cancelling by `orderId` hits the named order even after the queue shifted, because a stale index would hit the wrong one.

Open for the owners:

- **Bots win fast.** Two bots end most matches by creep rush, between about 1 500 and 3 300 ticks (seeds 1 to 10 of `tools/run-bots.js`; seeds 4 and 10 reach 8 000 without a winner). The bot spends on towers and creeps together and builds no defense against groups. I read this as a balance question for the creep and tower numbers in `data/`, not a bug. `[UNVERIFIED]` as a design judgment.
- **Held groups after a recycle.** Recycling a barracks refunds its queued orders and loses its held groups. The GDD says only that a destroyed barracks loses them.
- **Creep labels.** Each creep shows its own name and lux count, which crowds the screen at 30 creeps. M7 plans instancing and a calmer layout.

## Next Milestone: M5

From `docs/TECH_ARCHITECTURE.md` section 14. Each milestone ends with tests green and a short demo on a phone. Both clients grow together: put every UI decision in `src/client/ui/controls.js` and `vone/scripts/game_logic.gd`, and add parity cases.

From `docs/TECH_ARCHITECTURE.md` section 14. Each milestone ends with tests green and a short demo on a phone.

| # | Scope | Done when |
|---|---|---|
| M5 | Hero: roster of 5, rotation lock, HP allocation, 5 s production, 5 s respawn cooldown, 4 abilities from data, shield targets | Rotation lock test across 6 picks |
| M6 | Items: inventory (50), barracks orders waiting for a hero, drops, map spawns, loot bags (owner can reclaim), the 4 starter items | Energy Boost refused on the Core; Energy Grab funnels exactly 50 lux then is consumed |
| M7 | Client: instanced rendering, interpolation, camera follow on the selected hero, a small lux count beside every unit and building (no glow-as-health, GDD 13.1), end-of-match stats | 60 creeps on screen at 60 fps on a mid-range Android phone |
| M8 | Touch controls per GDD 11: tap select, hero move and attack, ability targeting, path mode with Undo/Go/Cancel and Reuse last path, build ghost, quick slots, pinch zoom | A full match playable by touch |
| M9 | Bot per GDD 12.1, hot-seat toggle, bot-vs-bot soak over 1 000 seeds in Node | Soak finishes with no crash and no non-integer values |
| M10 | Cross-browser determinism page (Chrome Android, iOS Safari vs Node), performance pass | Identical final hashes on all three |

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
- **Entropy:** HP leaves once per second (cumulative `floor(maxHp x pct x seconds / 6000)`), exact over a minute. It assumes a constant max HP, so the shell upgrade of M3 or later must change that formula.
- **Day and night:** derived from the tick (`tick % 1200 < 800` is day), so they need no state. The match starts at dawn.
- **Build rules:** a refused build costs nothing. The sim refuses a tile outside the team's build zone, off the map, or under a Core, building or blocker. It also refuses an unknown building or player, a tower without a valid attack type, any other building with one, and a geothermal collector off the team's vents. A tower is an ordinary building until M3 gives it a behavior.
- **Hash layout:** entities carry four more fields (`born`, `roll`, `recycle`, `attack`) and the pending pool is hashed entry by entry. `SPEC_VERSION` stays at 0.10.0, so both golden replays were re-recorded.
- **Not in M2:** the timed-mode buzzer needs a mode setting in `createState` and in the replay format. The server still ends a match at `MATCH_MAX_TICKS` as a draw.

## Accepted M2 Balance Decision

A nuclear plant earns 5 lux/s. It earns 600 lux in the 120 s before it melts down and deals 400 damage. The owner chose to preserve these values; changing the Core threat requires a later balance decision.

## Known Gaps

- The backend sends full snapshots with every entity, uses guest sign-in only, has no rate limiting, and keeps a running match in the memory of one process. `backend/nodejs/README.md` lists these limits with the planned fixes.
- The web controls are the M8 minimum: tap to build, select and order, with no build ghost, path mode, quick slots or pinch zoom. Buildings and units draw as placeholder boxes. A tap on the map takes effect at once, so a stray tap builds.
- The camera stays north-up for team 1, so its base appears at the top.
- Projectiles live one tick and snapshots arrive every second tick, so clients draw an aim line from `targetId` to show each shot. Delta snapshots and interpolation belong to M7.
- The client compares the sim spec version with the server but not the data hash, because `crypto.subtle` needs a secure context and a LAN address is not one.

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
