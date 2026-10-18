# Handover

Status as of 2026-10-18. Read `CLAUDE.md` first for the working rules.

## Where things stand

Design is settled for M1 to M3: `docs/GAME_DESIGN.md` v0.9.5 records the owner-approved tower attack-type rule, unit collider radius and one-tick ranged projectile delay. Every number marked *(default)* lives in `data/`.

Milestones M1 (map generation), M2 (economy) and M3 (combat and physics) are done:

| Area | State |
|---|---|
| Integer math (`fixed.js`, `sin-table.js`) | Done, tested against BigInt and exact quarter turns |
| RNG (`rng.js`) | Done, tested against the reference Mulberry32 |
| State, config normalization | Done (`state.js`, `config.js`); `createState` spawns the 2 Cores and 12 blockers; teams are minimal |
| Map generation (`mapgen.js`) | Done (M1): 3 lanes, 2 vents, 6 blockers and 2 item spawns per team from the seed, point-mirrored, flood-fill checked; stored on `state.map` |
| Economy and tower upgrades (M2/M3) | Done: collectors, day/night, income buffer, spending, placement, recycling, entropy, meltdown, victory and tower upgrades |
| Tick pipeline (`step.js`) | Economy, behavior, hero movement and collisions, combat and stun timers, entropy, meltdown, cleanup, victory and visibility run; production, hero lifecycle and item systems remain for later milestones |
| Commands (`commands.js`) | Build, upgrade, recycle, cancelRecycle, heroAttack and heroMove use authoritative handlers; production, ability and item commands remain for later milestones |
| Hash (`hash.js`) | Canonical layout documented in the file header; all gameplay state, including projectiles, upgrades and entropy remainder, is hashed; `state.map` stays derived and excluded by owner decision |
| Replay (`replay.js`) | Record and playback done, mismatch detection tested; the golden replay `replays/golden/seed-1234567.json` (2 400 ticks) plays back in `test/golden.test.js` |
| Headless runner | `npm run headless`: 12 000 ticks in about 15 ms with empty systems; a third argument saves the run as a replay |
| Purity guard | `test/sim-boundary.test.js` blocks bare imports, Math.random, wall clock, approximated Math, `**`, DOM, timers, key iteration |
| Client | Renders the 96 × 112 map, both Cores, the generated lanes, vents, item spawns and blockers (placeholder shapes), the HUD and a one-finger pan; runs the sim at 20 Hz |
| Backend (`backend/nodejs/`) | NestJS 12 multiplayer server: guest auth with JWT guards, players, lobbies, a server-authoritative match runner at 20 Hz, Socket.IO `/game` namespace, replays with server-side verify, static routes for the game files, Swagger at `/api/docs`, JSON file database with MongoDB and PostgreSQL adapters, RabbitMQ events with an in-process fallback. See `backend/nodejs/README.md` |
| Networked client | `?server=` mode: the web client signs in, opens or joins a match, and renders server snapshots through `networkWorldView`. `npm run test:e2e` plays a match between two Chromium pages and checks their hashes against the sim |
| Entity labels | Every entity and map marker shows its name and, for entities, its lux count under it (`render/labels.js`) |
| Project memory (`docs/prompts/`) | Tracked in git: prompt history, handovers, progress and knowledge notes; see its README |
| Prose gate | `tools/check_style.py` labels hits `deny` or `ask`, supports `--register informal`, reads `.js` files through their comments and checks the whole repo with `npm run lint:prose:all`; `test/prose.test.js` fails `npm test` on any `deny` hit |
| Godot project (`vone/`) | Godot 4.6, GL Compatibility renderer; the map supports zoom and drag panning for touch selection |
| Cross-runtime check | `npm run test:e2e` loads the page in Chromium inside the Playwright container and compares its tick-120 hash with Node's; seed 1234567 gives `4cefa32c` in both |
| M1 to M3 closure validation | `npm test`: 95 passed; `npm run headless`: 12 000 ticks, hash `16bfd4ba`; `npm run test:e2e`: 3 passed |

### Browser Smoke Test

Start `npm run serve`, then run `npm run test:e2e`. The test reads `PW_WS_ENDPOINT` (default `ws://localhost:42944/`) and `APP_URL` (default `http://host.docker.internal:5173/`, the host as the container sees it). It skips with exit code 0 when nothing listens on the endpoint, fails on any console or page error, and saves `test/e2e/__screenshots__/smoke.png`. The script uses the glob `test/e2e/*.e2e.js` because Node 22.15.1 reads `node --test test/e2e/` as a module path and fails.

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

The remaining production, group movement and pathing work belongs to M4. Hero production and abilities belong to M5; item effects belong to M6.

## Next Milestone: M4

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
- The client has no way to build or recycle yet: commands can only be sent from code or the test hook (M8 adds touch controls). Buildings draw as placeholder boxes.
- The networked client has no lobby screen and no controls yet. A host starts a match through `?autostart=1` or the test hook, and commands can only be sent from code. The camera stays north-up for team 1, so its base appears at the top.
- The client compares the sim spec version with the server but not the data hash, because `crypto.subtle` needs a secure context and a LAN address is not one.

## Queued by the Owners

Decided on 2026-10-16 (`docs/prompts/2026-10-16-backend-decisions.md`). Do them in this order:

1. Done: a plain WebSocket gateway at `/ws` (`backend/nodejs/README.md`, Plain WebSocket Protocol).
2. Done: a device guest with a recovery code, plus rate limits on the sign-in routes.
3. A Dockerfile and a compose service with Postgres and RabbitMQ, plus a reverse proxy with TLS, for one VPS.
4. Done: M2 (economy). The next game task is M4 above.

## More Gaps
- Backend adapter and event tests for MongoDB, PostgreSQL and RabbitMQ pass on real containers (Postgres 16, MongoDB 7.0, RabbitMQ 3.13 on a local Docker Desktop) but skip in a plain `npm test`. No CI runs them yet.

- Mobile testing needs the page served over the LAN (`npm run serve`, then `http://<mac-ip>:5173` on the phone). Three.js loads from jsDelivr, so the phone needs internet access.
- `src/client/input/pan.js` maps screen y to world z 1:1, ignoring the camera tilt. Fine for now; M8 should ray-cast to the ground plane instead.
- `state.map` stays outside the hash (owners, for now). The hash covers blockers but not lanes, vents or item spawns. A change that moves only those passes the golden replay, `npm run test:e2e` and any future Godot parity check that compares hashes. Placement draws blockers after vents, so most generator changes also move a blocker and get caught; an edit to the item spawn rows or to lane jitter alone may not. The gap closes as systems consume the data. Geothermal collectors read vents (M2), creeps follow lane polylines (M4) and map spawns create ground items (M6), so each puts its result into hashed entities. Until then, a Godot port must compare `generateMap` output directly, for example the layout of seed 1234567. Hashing a digest of `state.map` would close the gap for good and changes the hash layout.
- No CI yet. A GitHub Actions job running `npm test` on Node 22 is a five-line addition when the repo goes to GitHub.
