# Luxcores Godot Client

The Godot client renders match maps and server snapshots. Match simulation, command validation, and updates run on the backend through its plain WebSocket API (`/ws`). The client stands at milestone M4 of the web reference and matches the web client rule for rule. It covers the economy, buildings, tower upgrades, creep orders and groups, combat visuals and hero orders.

## Run

Open `vone/project.godot` in Godot 4.6 and run the project. The window defaults to 600 × 1200. Set its width and height on the connection screen, then select Apply Size. Godot scales the interface uniformly as the window changes size and keeps its portrait proportions. Start the backend from the repo root with `npm run serve:install` (once) and `npm run serve`, then enter its HTTP address on the connection screen. Use `http://127.0.0.1:3000` when both processes run on one computer. A phone must use the computer's LAN address.

Choose a player name and a mode:

- **Play against bot:** a solo match against the server's test bot.
- **Watch bot against bot:** two bots play and the client only watches, with no build controls.
- **Host a match for two:** share the displayed match ID for another player to join. The host starts the match.

A Match ID in the field joins that match instead. An ID of a bot match joins as a spectator. The first guest sign-in stores a device secret in Godot's user data. Later launches reuse that secret through the backend's device sign-in route.

## What the Client Does

- Checks the server's spec version against `GameLogic.SPEC_VERSION` and refuses a server on another spec.
- Loads `data/buildings.json`, `data/balance.json` and `data/mapgen.json` from the server, so costs, upgrades and the build zone never live in two places.
- Draws the map, lanes, vents, item spawns and every entity with its name and lux count (GDD 13.1), like the web client.
- Shows tower attack types (a colored cap), upgrade levels (`P2 S1`), stuns, recycle progress, aim lines from towers and heroes to their targets, and projectiles.
- Builds all six buildings with a tower attack type, upgrades towers (power and shell), recycles and cancels a recycle.
- Orders creeps from a barracks: 1 to 5 creeps, melee, ranged, area or mixed, with the queue listed and a cancel button per order (by order id).
- Selects a creep group by tapping one of its creeps, then offers Path, Merge, Split and Lane Route. Path mode takes up to 10 waypoints with Undo, Go, Cancel and Reuse Last, and a barracks keeps a default path for new groups. The arena draws the selected group's route.
- Resolves taps through `scripts/game_logic.gd`. A tap builds, selects an own building or creep group, adds a waypoint in path mode or picks the group to join in merge mode. Once a hero exists, a tap moves it or attacks an enemy. Heroes appear in M5, so fixtures test those two orders and no live match has run them yet.

## Staying in Step with the Web Client

`scripts/game_logic.gd` holds the pure decisions: label text, affordability, tap resolution and the actions of a selected building. The web client implements the same functions in `src/client/entity-text.js` and `src/client/ui/controls.js`. `test/fixtures/client-parity.json` holds the cases both must answer alike. When you change a decision, change both clients and the fixture in one commit. Both test runs fail when only one side moves.

`GameLogic.SPEC_VERSION` must equal `SPEC_VERSION` in `src/sim/config.js`. Bump it only after porting the rule change that bumped the sim.

## Tests

Run these from the repo root. Each needs Godot 4.6 (`GODOT_BIN`, `godot` on the PATH, or the macOS app).

```bash
# Pure game logic against the shared fixtures: 63 checks, no server needed.
Godot --headless --path vone --script res://tests/run_tests.gd

# The real main scene against a running backend: 41 checks.
Godot --headless --path vone --script res://tests/live_match.gd -- --server=http://127.0.0.1:3000

# Both, with a throwaway backend, as part of the browser tests.
npm run test:e2e
```

`tests/screenshot_fixture.gd` draws a hand-made snapshot with every M3 entity and saves a PNG. It needs a window, so it runs without `--headless`. See the script header for the command.

## Two Humans From a Built Package

To test a match between two people with an exported game, run one backend and give both clients its address:

1. On the host computer, run `npm run serve:install` once and `npm run serve` from the repo root. The backend listens on every network interface (`HOST` defaults to `0.0.0.0`) at port 3000. Find the computer's LAN address, for example `192.168.1.20`.
2. In Godot, open Project, Export. Add the platform presets you need and install the export templates when the editor asks. Godot 4.6 needs templates that match its exact version. Export a build for each tester.
3. Start the build on both devices. Enter `http://192.168.1.20:3000` as the Backend URL, then a player name. A web build needs the page and the backend on the same origin or `CORS_ORIGIN` set on the backend (see `backend/nodejs/README.md`).
4. The first player picks **Host a match for two**, connects, and shares the Match ID shown on screen (the Copy button helps). The second player pastes it into the Match ID field and connects, and then the host starts the match.

An Android or iOS build can reach the backend only over the LAN address, and a plain `http://` address needs cleartext traffic allowed in the export preset. `[UNVERIFIED]`: I have not exported or run a package; only the editor and headless runs are tested.

## Not Done Yet

Hero production and abilities, items (M5 and M6), rendering polish, instancing, and mobile touch gestures such as pinch zoom and path mode (M7 and M8) remain future work. The web client and `src/sim/` stay the executable reference for the rules.
