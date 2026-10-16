# Handover

Status as of 2026-10-16. Read `CLAUDE.md` first for the working rules.

## Where things stand

Design is settled for the MVP: `docs/GAME_DESIGN.md` v0.9 has no blocking open questions. Every number marked *(default)* is a playtest tuning point and already lives in `data/`.

The scaffold is in place and green:

| Area | State |
|---|---|
| Integer math (`fixed.js`, `sin-table.js`) | Done, tested against BigInt and exact quarter turns |
| RNG (`rng.js`) | Done, tested against the reference Mulberry32 |
| State, config normalization | Done (`state.js`, `config.js`); entities and teams are minimal |
| Tick pipeline (`step.js`) | Done; every system in `systems/` is a stub |
| Commands (`commands.js`) | Schema, ordering and dispatch done; `HANDLERS` is empty, so every command is dropped |
| Hash (`hash.js`) | Done; canonical layout documented in the file header |
| Replay (`replay.js`) | Record and playback done, mismatch detection tested |
| Headless runner | `npm run headless`: 12 000 ticks in about 30 ms with empty systems |
| Purity guard | `test/sim-boundary.test.js` blocks bare imports, Math.random, wall clock, approximated Math, `**`, DOM, timers, key iteration |
| Client | Renders the 96 × 112 map, both Cores, the black hole, HUD and a one-finger pan; runs the sim at 20 Hz |
| Cross-runtime check | Chromium and Node produced the same hashes at ticks 80 and 120 (seed 1234567) |

`npm test`: 19 pass, 3 todo (the mapgen tests below).

## Next task: finish M1 (map generation)

Implement `generateMap(seed, mapgen)` in `src/sim/mapgen.js` per GDD section 10.2 and `data/mapgen.json`.

Requirements:

1. Use a separate RNG created from the match seed (for example `createRng(seed ^ 0x9e3779b9)`), never `state.rng`, so map generation does not shift the gameplay stream.
2. Generate team 0 (bottom half, rows 56 to 111), then point-mirror onto team 1: tile `(x, z)` becomes `(95 - x, 111 - z)`.
3. Lanes: start from the templates in `mapgen.json`, apply a seeded sideways jitter of up to ±3 tiles to inner control points, keep each lane inside its own column outside the Core row. The first point (the Core) and the last point (the DMZ edge) don't move.
4. Rasterize each lane polyline to tiles (lane width 3 tiles is a reasonable default; add `laneWidth` to `mapgen.json`).
5. Place 2 vents (in 2 different columns), 6 blockers (2 per column) and 1 item spawn (DMZ, side columns) per team, respecting `spacing`. Retry up to 50 times per element, then relax `between` by 1 and continue.
6. Connectivity: flood fill over walkable tiles (not blocker, not Core, not black-hole radius). If any lane tile is cut off from either Core, retry with `seed + 1`, and so on. Return the seed that passed as `usedSeed`.
7. Spawn the generated entities into state: wire `generateMap` into `createState` (Cores at their tiles with HP = start lux, blockers with 200 HP as `NEUTRAL`). Vents and item spawns are map data, not entities; store them on `state.map`.

Acceptance:

- Replace the 3 `test.todo` entries in `test/determinism.test.js` with real tests: same seed gives a deep-equal layout; the layout is point-symmetric; every lane connects both Cores for 1 000 seeds.
- `npm run headless` still runs 12 000 ticks; the hash changes (new entities) and stays stable across two runs.
- Render the generated lanes, vents and blockers in `scene.js` as placeholder shapes so the layout can be eyeballed on a phone.
- Record one golden replay into `replays/golden/` and add a test that plays every golden replay and expects `ok: true`.

## Milestones after M1

From `docs/TECH_ARCHITECTURE.md` section 14. Each milestone ends with tests green and a short demo on a phone.

| # | Scope | Done when |
|---|---|---|
| M2 | Economy: collectors, day/night, pending buffer, spend rule (Core keeps 1 lux), placement rules, recycle channel, entropy, meltdown, victory | Unit tests for: 2 s buffer, 60% recycle, recycle cancel, meltdown at 2 400 ticks, refusal below 1 lux, draw on same-tick Core death |
| M3 | Combat and physics: `grid2d.js`, A* (fixed neighbor order, throttled to 8 repaths per tick), towers with the Dota targeting override, attack types and procs, simultaneous damage, visibility bitsets | Two units killing each other on one tick both die; tower switches to an enemy hero that attacks a friendly hero |
| M4 | Creeps: barracks queue, groups of 1 to 5, cap 30 with held groups skipping ahead, merge and split (odd creep stays), default and custom paths (max 10 waypoints), lane following | Queue skip-ahead test; split 7 gives 4 + 3 |
| M5 | Hero: roster of 5, rotation lock, HP allocation, 5 s production, 5 s respawn cooldown, 4 abilities from data, shield targets | Rotation lock test across 6 picks |
| M6 | Items: inventory (50), barracks orders waiting for a hero, drops, map spawns, loot bags (owner can reclaim), the 4 starter items | Energy Boost refused on the Core; Energy Grab funnels exactly 50 lux then is consumed |
| M7 | Client: instanced rendering, interpolation, camera follow on the selected hero, glow-as-health, end-of-match stats | 60 creeps on screen at 60 fps on a mid-range Android phone |
| M8 | Touch controls per GDD 11: tap select, hero move and attack, ability targeting, path mode with Undo/Go/Cancel and Reuse last path, build ghost, quick slots, pinch zoom | A full match playable by touch |
| M9 | Bot per GDD 12.1, hot-seat toggle, bot-vs-bot soak over 1 000 seeds in Node | Soak finishes with no crash and no non-integer values |
| M10 | Cross-browser determinism page (Chrome Android, iOS Safari vs Node), performance pass | Identical final hashes on all three |

## Interpretations made in the scaffold

Check with Hamza or Hama if any of these feel wrong:

- Team 0 is the player at the bottom (blue), team 1 the top (red). The z axis grows downward on the map, so team 0's Core sits at tile (48, 96).
- The bot is player 1 on team 1 in the default 1v1.
- `balance.json` stores the starting Core as `startPerPlayerLux: 100` and team start lux is 100 × players on the team.
- Placeholder hero kits in `heroes.json` (Halo, Prism, Flare, Aurora, Corona) are working names until Hama designs the roster.

## Known gaps

- Mobile testing needs the page served over the LAN (`npm run serve`, then `http://<mac-ip>:5173` on the phone). Three.js loads from jsDelivr, so the phone needs internet access.
- `src/client/input/pan.js` maps screen y to world z 1:1, ignoring the camera tilt. Fine for now; M8 should ray-cast to the ground plane instead.
- No CI yet. A GitHub Actions job running `npm test` on Node 22 is a five-line addition when the repo goes to GitHub.
