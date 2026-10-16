# Handover

Status as of 2026-10-16. Read `CLAUDE.md` first for the working rules.

## Where things stand

Design is settled for the MVP: `docs/GAME_DESIGN.md` v0.9.1 has no blocking open questions. Every number marked *(default)* is a playtest tuning point and already lives in `data/`.

Milestones M1 (map generation) and M2 (economy) are done. The scaffold, M1 and M2 are green:

| Area | State |
|---|---|
| Integer math (`fixed.js`, `sin-table.js`) | Done, tested against BigInt and exact quarter turns |
| RNG (`rng.js`) | Done, tested against the reference Mulberry32 |
| State, config normalization | Done (`state.js`, `config.js`); `createState` spawns the 2 Cores and 12 blockers; teams are minimal |
| Map generation (`mapgen.js`) | Done (M1): 3 lanes, 2 vents, 6 blockers and 2 item spawns per team from the seed, point-mirrored, flood-fill checked; stored on `state.map` |
| Economy (M2) | Done: collectors (solar, wind, geothermal, nuclear), day/night, the 2 s income buffer, the spend rule, placement, recycle channel, entropy, meltdown and victory, through the `build`, `recycle` and `cancelRecycle` commands. Two golden replays cover it |
| Tick pipeline (`step.js`) | Economy, recycle, entropy, meltdown, cleanup and victory run; behavior, movement, combat, effects, production, hero and items are stubs |
| Commands (`commands.js`) | Schema, ordering and dispatch done; `HANDLERS` is empty, so every command is dropped |
| Hash (`hash.js`) | Done; canonical layout documented in the file header; `state.map` is not hashed |
| Replay (`replay.js`) | Record and playback done, mismatch detection tested; the golden replay `replays/golden/seed-1234567.json` (2 400 ticks) plays back in `test/golden.test.js` |
| Headless runner | `npm run headless`: 12 000 ticks in about 15 ms with empty systems; a third argument saves the run as a replay |
| Purity guard | `test/sim-boundary.test.js` blocks bare imports, Math.random, wall clock, approximated Math, `**`, DOM, timers, key iteration |
| Client | Renders the 96 × 112 map, both Cores, the generated lanes, vents, item spawns and blockers (placeholder shapes), the HUD and a one-finger pan; runs the sim at 20 Hz |
| Backend (`backend/nodejs/`) | NestJS 12 multiplayer server: guest auth with JWT guards, players, lobbies, a server-authoritative match runner at 20 Hz, Socket.IO `/game` namespace, replays with server-side verify, static routes for the game files, Swagger at `/api/docs`, JSON file database with MongoDB and PostgreSQL adapters, RabbitMQ events with an in-process fallback. See `backend/nodejs/README.md` |
| Networked client | `?server=` mode: the web client signs in, opens or joins a match, and renders server snapshots through `networkWorldView`. `npm run test:e2e` plays a match between two Chromium pages and checks their hashes against the sim |
| Entity labels | Every entity and map marker shows its name and, for entities, its lux count under it (`render/labels.js`) |
| Project memory (`docs/prompts/`) | Tracked in git: prompt history, handovers, progress and knowledge notes; see its README |
| Prose gate | `tools/check_style.py` labels hits `deny` or `ask`, supports `--register informal`, reads `.js` files through their comments and checks the whole repo with `npm run lint:prose:all`; `test/prose.test.js` fails `npm test` on any `deny` hit |
| Godot project (`vone/`) | Created by the owners (Godot 4.6, GL Compatibility renderer, for web, mobile and PC); other agents build the game there from this MVP's logic and playtest feedback |
| Cross-runtime check | `npm run test:e2e` loads the page in Chromium inside the Playwright container and compares its tick-120 hash with Node's; seed 1234567 gives `a3dbf89c` in both |

`npm test`: 72 pass, 0 todo. `npm run headless` prints hash `1790fc9a` for seed 1234567 at 12 000 ticks.

### Browser Smoke Test

Start `npm run serve`, then run `npm run test:e2e`. The test reads `PW_WS_ENDPOINT` (default `ws://localhost:42944/`) and `APP_URL` (default `http://host.docker.internal:5173/`, the host as the container sees it). It skips with exit code 0 when nothing listens on the endpoint, fails on any console or page error, and saves `test/e2e/__screenshots__/smoke.png`. The script uses the glob `test/e2e/*.e2e.js` because Node 22.15.1 reads `node --test test/e2e/` as a module path and fails.

## Next Task: M3 (Combat and Physics)

Implement combat per `docs/GAME_DESIGN.md` sections 5.0, 7.4 and 3.5. Add the physics and pathfinding of `docs/TECH_ARCHITECTURE.md` section 6: `grid2d.js`, and A* with a fixed neighbor order, throttled to 8 repaths per tick. The scope also holds towers with the targeting override, attack types and procs, simultaneous damage, and the visibility bitsets. Systems to fill in: `behavior.js`, `movement.js`, `combat.js`, `effects.js` and `visibility.js`. The grid code goes in `physics/`.

M2 leaves these starting points:

- `tower` entities exist (built through the `build` command) with `attack` set to 1 (melee), 2 (ranged) or 3 (area) from `ATTACK_CODE` in `buildings.js`. They do nothing yet.
- Damage resolution (pipeline step 10) is a stub. The meltdown already deals damage directly (`systems/meltdown.js`) and the cleanup system removes entities at 0 HP, so combat can reuse both. A Core takes damage through `damageCore` in `lux.js`, which keeps its `hp` equal to its lux.
- Nothing can empty a Core yet. A nuclear plant earns about 600 lux before a meltdown and deals 400, so combat is the first rule that can end a match by a Core's death. The victory system is ready for it.
- Creeps and heroes do not exist yet, but entropy and the meltdown already treat their kinds (`KIND.CREEP`, `KIND.HERO`) like buildings.

Acceptance:

- Two units that kill each other on one tick both die.
- A tower switches to an enemy hero that attacks a friendly hero, for 3 s after the last such attack.
- Unit tests drive each rule through commands and `step()`. Golden replays are re-recorded in the same commit (`SPEC_VERSION` stays at 0.10.0, `CLAUDE.md` rule 8).

## Milestones After M3

From `docs/TECH_ARCHITECTURE.md` section 14. Each milestone ends with tests green and a short demo on a phone.

| # | Scope | Done when |
|---|---|---|
| M4 | Creeps: barracks queue, groups of 1 to 5, cap 30 with held groups skipping ahead, merge and split (odd creep stays), default and custom paths (max 10 waypoints), lane following | Queue skip-ahead test; split 7 gives 4 + 3 |
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
- **Spec and GDD (owners):** `SPEC_VERSION` is 0.10.0 and stays there while the MVP is built, so a rule change re-records the golden replay instead of bumping the version. The GDD is v0.9.1, with a changelog row for the black hole removal, lane width, connectivity and spacing rules.

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

## Open Design Question

A nuclear plant earns 5 lux/s. It earns 600 lux in the 120 s before it melts down and deals only 400 damage. A meltdown therefore cannot kill a Core by itself, even next to it. If the meltdown should be a real risk to the owner, the damage or the timer needs tuning (`data/balance.json`, `meltdown`).

## Known Gaps

- The backend sends full snapshots with every entity, uses guest sign-in only, has no rate limiting, and keeps a running match in the memory of one process. `backend/nodejs/README.md` lists these limits with the planned fixes.
- The client has no way to build or recycle yet: commands can only be sent from code or the test hook (M8 adds touch controls). Buildings draw as placeholder boxes.
- The networked client has no lobby screen and no controls yet. A host starts a match through `?autostart=1` or the test hook, and commands can only be sent from code. The camera stays north-up for team 1, so its base appears at the top.
- The client compares the sim spec version with the server but not the data hash, because `crypto.subtle` needs a secure context and a LAN address is not one.

## Queued by the Owners

Decided on 2026-10-16 (`docs/prompts/2026-10-16-backend-decisions.md`). Do them in this order:

1. Done: a plain WebSocket gateway at `/ws` (`backend/nodejs/README.md`, Plain WebSocket Protocol).
2. Done: a device guest with a recovery code, plus rate limits on the sign-in routes.
3. A Dockerfile and a compose service with Postgres and RabbitMQ, plus a reverse proxy with TLS, for one VPS.
4. Done: M2 (economy). The next game task is M3 above.

## More Gaps
- Backend adapter and event tests for MongoDB, PostgreSQL and RabbitMQ pass on real containers (Postgres 16, MongoDB 7.0, RabbitMQ 3.13 on a local Docker Desktop) but skip in a plain `npm test`. No CI runs them yet.

- Mobile testing needs the page served over the LAN (`npm run serve`, then `http://<mac-ip>:5173` on the phone). Three.js loads from jsDelivr, so the phone needs internet access.
- `src/client/input/pan.js` maps screen y to world z 1:1, ignoring the camera tilt. Fine for now; M8 should ray-cast to the ground plane instead.
- `state.map` stays outside the hash (owners, for now). The hash covers blockers but not lanes, vents or item spawns. A change that moves only those passes the golden replay, `npm run test:e2e` and any future Godot parity check that compares hashes. Placement draws blockers after vents, so most generator changes also move a blocker and get caught; an edit to the item spawn rows or to lane jitter alone may not. The gap closes as systems consume the data. Geothermal collectors read vents (M2), creeps follow lane polylines (M4) and map spawns create ground items (M6), so each puts its result into hashed entities. Until then, a Godot port must compare `generateMap` output directly, for example the layout of seed 1234567. Hashing a digest of `state.map` would close the gap for good and changes the hash layout.
- No CI yet. A GitHub Actions job running `npm test` on Node 22 is a five-line addition when the repo goes to GitHub.
