# Luxcores Godot Client

The Godot client renders match maps and server snapshots. Match simulation, command validation, and updates run on the backend through its plain WebSocket API (`/ws`). The client stands at milestone M3 of the web reference and matches the web client rule for rule. It covers the economy, buildings, tower upgrades, combat visuals and hero orders.

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
- Resolves taps through `scripts/game_logic.gd`: a tap builds, selects an own building, or, once a hero exists, moves it or attacks an enemy. Heroes appear in M5, so those two orders are tested with fixtures and not yet with a live match.

## Staying in Step with the Web Client

`scripts/game_logic.gd` holds the pure decisions: label text, affordability, tap resolution and the actions of a selected building. The web client implements the same functions in `src/client/entity-text.js` and `src/client/ui/controls.js`. `test/fixtures/client-parity.json` holds the cases both must answer alike. When you change a decision, change both clients and the fixture in one commit. Both test runs fail when only one side moves.

`GameLogic.SPEC_VERSION` must equal `SPEC_VERSION` in `src/sim/config.js`. Bump it only after porting the rule change that bumped the sim.

## Tests

Run these from the repo root. Each needs Godot 4.6 (`GODOT_BIN`, `godot` on the PATH, or the macOS app).

```bash
# Pure game logic against the shared fixtures: 44 checks, no server needed.
Godot --headless --path vone --script res://tests/run_tests.gd

# The real main scene against a running backend: 22 checks.
Godot --headless --path vone --script res://tests/live_match.gd -- --server=http://127.0.0.1:3000

# Both, with a throwaway backend, as part of the browser tests.
npm run test:e2e
```

`tests/screenshot_fixture.gd` draws a hand-made snapshot with every M3 entity and saves a PNG. It needs a window, so it runs without `--headless`. See the script header for the command.

## Not Done Yet

Creep orders, hero production and abilities (M4 to M6), rendering polish, instancing, and mobile touch gestures such as pinch zoom and path mode (M7 and M8) remain future work. The web client and `src/sim/` stay the executable reference for the rules.
