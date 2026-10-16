# Handover

Status as of 2026-10-16. Read `CLAUDE.md` first for the working rules.

## Where things stand

Design is settled for the MVP: `docs/GAME_DESIGN.md` v0.9.1 has no blocking open questions. Every number marked *(default)* is a playtest tuning point and already lives in `data/`.

Milestone M1 (map generation) is done. The scaffold and M1 are green:

| Area | State |
|---|---|
| Integer math (`fixed.js`, `sin-table.js`) | Done, tested against BigInt and exact quarter turns |
| RNG (`rng.js`) | Done, tested against the reference Mulberry32 |
| State, config normalization | Done (`state.js`, `config.js`); `createState` spawns the 2 Cores and 12 blockers; teams are minimal |
| Map generation (`mapgen.js`) | Done (M1): 3 lanes, 2 vents, 6 blockers and 2 item spawns per team from the seed, point-mirrored, flood-fill checked; stored on `state.map` |
| Tick pipeline (`step.js`) | Done; every system in `systems/` is a stub |
| Commands (`commands.js`) | Schema, ordering and dispatch done; `HANDLERS` is empty, so every command is dropped |
| Hash (`hash.js`) | Done; canonical layout documented in the file header; `state.map` is not hashed |
| Replay (`replay.js`) | Record and playback done, mismatch detection tested; the golden replay `replays/golden/seed-1234567.json` (2 400 ticks) plays back in `test/golden.test.js` |
| Headless runner | `npm run headless`: 12 000 ticks in about 15 ms with empty systems; a third argument saves the run as a replay |
| Purity guard | `test/sim-boundary.test.js` blocks bare imports, Math.random, wall clock, approximated Math, `**`, DOM, timers, key iteration |
| Client | Renders the 96 × 112 map, both Cores, the generated lanes, vents, item spawns and blockers (placeholder shapes), the HUD and a one-finger pan; runs the sim at 20 Hz |
| Prose gate | `tools/check_style.py` labels hits `deny` or `ask`, supports `--register informal`, reads `.js` files through their comments and checks the whole repo with `npm run lint:prose:all`; `test/prose.test.js` fails `npm test` on any `deny` hit |
| Godot project (`vone/`) | Created by the owners (Godot 4.6, GL Compatibility renderer, for web, mobile and PC); other agents build the game there from this MVP's logic and playtest feedback |
| Cross-runtime check | `npm run test:e2e` loads the page in Chromium inside the Playwright container and compares its tick-120 hash with Node's; seed 1234567 gives `a3dbf89c` in both |

`npm test`: 37 pass, 0 todo. `npm run headless` prints hash `e626db0e` for seed 1234567 at 12 000 ticks, on both of two consecutive runs.

### Browser Smoke Test

Start `npm run serve`, then run `npm run test:e2e`. The test reads `PW_WS_ENDPOINT` (default `ws://localhost:42944/`) and `APP_URL` (default `http://host.docker.internal:5173/`, the host as the container sees it). It skips with exit code 0 when nothing listens on the endpoint, fails on any console or page error, and saves `test/e2e/__screenshots__/smoke.png`. The script uses the glob `test/e2e/*.e2e.js` because Node 22.15.1 reads `node --test test/e2e/` as a module path and fails.

## Next Task: M2 (Economy)

Implement the economy per `docs/GAME_DESIGN.md` sections 3 to 5: collectors, day/night, the pending buffer, the spend rule (the Core keeps 1 lux), placement rules, the recycle channel, entropy, meltdown and victory. The systems live in `economy.js`, `recycle.js`, `entropy.js`, `meltdown.js` and `victory.js`. Add the `build`, `recycle` and `cancelRecycle` handlers to `HANDLERS` in `commands.js`.

M1 leaves these starting points:

- The Cores are entities 1 (team 0) and 2 (team 1). Their `hp` equals `coreLux`, both in milli units. The economy must keep the two equal, because Core HP is its lux (GDD 3.1). A Core's `maxHp` starts at its starting lux and rises to match `hp` whenever `hp` exceeds it (GDD 3.1, owners' decision).
- Placement must refuse tiles that hold a blocker (`KIND.BLOCKER` entities, ids 3 to 14), and tiles in the DMZ.
- A geothermal collector needs a vent tile. `state.map.vents` lists them as tile coordinates, 2 per team.

Acceptance:

- Unit tests drive each rule through commands and `step()`. They cover the 2 s buffer, the 60% recycle refund, recycle cancel, meltdown at 2 400 ticks, refusal below 1 lux, and a draw on a same-tick Core death.
- The golden replay re-recorded in the same commit with `node tools/run-headless.js 1234567 2400 replays/golden/seed-1234567.json`. `SPEC_VERSION` stays at 0.10.0 while the MVP is built (`CLAUDE.md`, simulation rule 8).

## Milestones After M2

From `docs/TECH_ARCHITECTURE.md` section 14. Each milestone ends with tests green and a short demo on a phone.

| # | Scope | Done when |
|---|---|---|
| M3 | Combat and physics: `grid2d.js`, A* (fixed neighbor order, throttled to 8 repaths per tick), towers with the Dota targeting override, attack types and procs, simultaneous damage, visibility bitsets | Two units killing each other on one tick both die; tower switches to an enemy hero that attacks a friendly hero |
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

## Known Gaps

- Mobile testing needs the page served over the LAN (`npm run serve`, then `http://<mac-ip>:5173` on the phone). Three.js loads from jsDelivr, so the phone needs internet access.
- `src/client/input/pan.js` maps screen y to world z 1:1, ignoring the camera tilt. Fine for now; M8 should ray-cast to the ground plane instead.
- `state.map` stays outside the hash (owners, for now). The hash covers blockers but not lanes, vents or item spawns. A change that moves only those passes the golden replay, `npm run test:e2e` and any future Godot parity check that compares hashes. Placement draws blockers after vents, so most generator changes also move a blocker and get caught; an edit to the item spawn rows or to lane jitter alone may not. The gap closes as systems consume the data. Geothermal collectors read vents (M2), creeps follow lane polylines (M4) and map spawns create ground items (M6), so each puts its result into hashed entities. Until then, a Godot port must compare `generateMap` output directly, for example the layout of seed 1234567. Hashing a digest of `state.map` would close the gap for good and changes the hash layout.
- No CI yet. A GitHub Actions job running `npm test` on Node 22 is a five-line addition when the repo goes to GitHub.
