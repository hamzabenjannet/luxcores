# Luxcores Godot Client

The Godot client renders match maps and server snapshots. Match simulation, command validation, and updates run on the backend through its plain WebSocket API (`/ws`). The client stands at milestone M6 of the web reference and matches the web client rule for rule. It covers the economy, buildings, tower upgrades, creep orders and groups, combat visuals, and heroes with their picks and abilities, and items with a shop, an item bar and loot.

## Run

Open `vone/project.godot` in Godot 4.6 and run the project. It starts in `scenes/main3d.tscn`, with the configure/connect menu over the 3D arena. On a desktop the window opens maximized and follows every resize: the interface scales with the window (project setting `canvas_items` with the `expand` aspect) and the 3D view fills it, so there is no size to enter. The project base is a 1280 × 720 desktop window (landscape); a phone build gets its own scenes later. The map (the arena) is the whole window, and the start card, the match panel at the top and the build and hero controls at the bottom float over it in translucent panels sized to the window, so a small window shrinks them and the start card scrolls. The smallest window is 480 × 360. Start the backend from the repo root with `npm run serve:install` (once) and `npm run serve`, then enter its HTTP address on the connection screen. Use `http://127.0.0.1:3000` when both processes run on one computer. A phone must use the computer's LAN address.

Choose a player name and a mode. The entropy field sets the rate of a match you create (percent of max HP per second, 0 to 100 with one decimal, empty for the default):

- **Play against bot:** a solo match against the server's test bot.
- **Watch bot against bot:** two bots play and the client only watches, with no build controls.
- **Host a match for two:** share the displayed match ID for another player to join. The host starts the match.

A Match ID in the field joins that match instead. An ID of a bot match joins as a spectator. The first guest sign-in stores a device secret in Godot's user data. Later launches reuse that secret through the backend's device sign-in route.

## What the Client Does

- Checks the server's spec version against `GameLogic.SPEC_VERSION` and refuses a server on another spec.
- Loads `data/buildings.json`, `data/balance.json` and `data/mapgen.json` from the server, so costs, upgrades and the build zone never live in two places.
- Draws the arena on the `Terrain` mesh, with colored team zones, lanes, vents, item spawns and every entity kind in 3D.
- Shows every entity's name and lux count (GDD 13.1), tower attack types, upgrade levels (`P2 S1`), stuns, recycle progress, aim lines and projectiles.
- Keeps server-driven game rules and controls. A tap on the 3D terrain uses `scripts/game_logic.gd` to build, select or send an order.
- Has a LEAVE button (M9): it frees a lobby seat, stops a match against a bot, or forfeits a match for two humans after a second press, tells the server so nothing keeps running, and returns to the start screen.
- Pans the view by dragging. The arrow keys adjust elevation and orbit the camera smoothly. Vertical mouse-wheel scrolling adjusts elevation, and horizontal scrolling orbits. Trackpad scrolling also rotates the view. Two-finger and trackpad pinch gestures zoom, and `+` and `−` buttons remain on the arena overlay. Zoom runs from 0.6 to 2.2 times the default view of 32 tiles across, as in the web client (M8).
- Builds all six buildings with a tower attack type. A tap in build mode sets a ghost on the tile (green when the building can go there, red when not) with Place and Cancel buttons (M8, GDD 11.5), and Place frees the palette selection at once, so a second tap cannot place a second one. It also upgrades towers (power and shell), recycles and cancels a recycle.
- Picks a hero at a barracks (M5): the panel lists the roster, greys out locked heroes and says why no pick is possible (a hero on the field, in production or the 5 second wait after a death), and offers 25%, 50%, 75% or the most the Core can spare as the lux to allocate. A hero bar then shows M R A S with each cost or cooldown: melee and shield cast at once, ranged and area wait for a tap or aim by drag: press the button, drag onto the map and lift to cast there (lifting back over the button cancels). A shield draws as a cyan ring and a SHIELD tag.
- Buys items at a barracks (M6): the panel sells the four starter items with their prices, a bought item waits in the queue (HELD without a hero) and reaches the hero's inventory when it is built. An item bar under the abilities shows the count of each; Haste and Energy Grab apply at once, Energy Boost and Sluggish wait for a tap on their target. A tap on a ground item or a loot bag sends the hero to take it.
- Shows the end-of-match table (M7, GDD 13.2) under the hero bar: the duration and the six counters of both sides. A Follow button in the hero bar eases the 3D camera toward the hero, a tap on the hero's name resumes it, and dragging the map turns it off. A creep group has one label with its count and lux (`Creeps x5 50`).
- Orders creeps from group size and type dropdowns on one row. Recycle, Set Default Path, and Order Creeps share another row. Pick Hero, the hero roster, and the hero power dropdown share one row. The queue sits in a small floating window at the top right, collapsed by default. It logs creep groups, hero picks, and items. It shows queued timers with a cancel button per order and scrolls after three rows. The queue stays outside the barracks panel, so new orders do not move its buttons.
- Selects a creep group by tapping one of its creeps, then offers Path, Merge, Split and Lane Route. Path mode takes up to 10 waypoints with Undo, Go, Cancel and Reuse Last, and a barracks keeps a default path for new groups. The arena draws the selected group's route.
- Resolves taps through `scripts/game_logic.gd`. A tap builds, selects an own building or creep group, adds a waypoint in path mode or picks the group to join in merge mode. Once a hero exists, a tap moves it or attacks an enemy, and a hero told to attack walks into reach first. With an ability aimed, a tap casts it.

## Staying in Step with the Web Client

`scripts/game_logic.gd` holds the pure decisions: label text, affordability, tap resolution and the actions of a selected building. The web client implements the same functions in `src/client/entity-text.js` and `src/client/ui/controls.js`. `test/fixtures/client-parity.json` holds the cases both must answer alike. When you change a decision, change both clients and the fixture in one commit. Both test runs fail when only one side moves.

`GameLogic.SPEC_VERSION` must equal `SPEC_VERSION` in `src/sim/config.js`. Bump it only after porting the rule change that bumped the sim.

## Tests

Run these from the repo root. Each needs Godot 4.6 (`GODOT_BIN`, `godot` on the PATH, or the macOS app).

```bash
# Pure game logic against the shared fixtures: 141 checks, no server needed.
Godot --headless --path vone --script res://tests/run_tests.gd

# Main 3D scene, detailed melee creep rendering and camera controls, no server needed.
Godot --headless --path vone --script res://tests/main3d_scene.gd

# The real main scene against a running backend: 90 checks.
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

Rendering polish, interpolation and instancing (the owners kept those for the web client), hot seat (deferred) and a trial on a real phone remain future work. The web client and `src/sim/` stay the executable reference for the rules.
