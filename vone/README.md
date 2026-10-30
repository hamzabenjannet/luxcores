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
- Builds that mesh from noise (`scripts/procedural_terrain.gd`): hills, valleys and mountain ranges cover the whole map, and the lanes cut a road through them instead of flattening the middle.
- Scatters scenery over the whole map from one seed (`scripts/terrain_scatter.gd`), when the start menu switch **Toggle auto terrain generation** is on. It is off by default, and then the map keeps the bare plane. About 90 forest, pond and rock props land on a grid of 5 tile cells. They keep clear of the lanes, the build zones, the Cores and the markers, and per-prop gaps hold one kind out of the cell next door. The props also define the ground height. Buildings, creeps, heroes, labels, the build ghost and the aim ring sit on it.
- Orbits the directional sun around the arena from dawn through sunset, following the snapshot's day/night tick with changing height, direction, brightness and shadows.
- Shows every entity's name and lux count (GDD 13.1), tower attack types, upgrade levels (`P2 S1`), stuns, recycle progress, aim lines and projectiles.
- Keeps server-driven game rules and controls. A tap on the 3D terrain uses `scripts/game_logic.gd` to build, select or send an order.
- Has a LEAVE button (M9): it frees a lobby seat, stops a match against a bot, or forfeits a match for two humans after a second press, tells the server so nothing keeps running, and returns to the start screen.
- Offers Camera 1 (RTS) by default and Camera 2 (orthographic Camera3D) for debugging in the start menu. Camera 1 shows a 125 × 125 px minimap flush with the top-left corner. Click a point to jump the view there. It supports arrow-key movement, edge scrolling at all four borders, middle-button orbit, and wheel zoom. Left-click dragging pans only in Camera 2. Trackpad scrolling rotates the view; pinching zooms.
- Builds all six buildings with a tower attack type. A tap in build mode sets a ghost on the tile (green when the building can go there, red when not) with Place and Cancel buttons (M8, GDD 11.5), and Place frees the palette selection at once, so a second tap cannot place a second one. It also upgrades towers (power and shell), recycles and cancels a recycle.
- Picks a hero at a barracks (M5): the panel lists the roster, greys out locked heroes and says why no pick is possible (a hero on the field, in production or the 5 second wait after a death), and offers 25%, 50%, 75% or the most the Core can spare as the lux to allocate. A hero bar then shows M R A S with each cost or cooldown: melee and shield cast at once, ranged and area wait for a tap or aim by drag: press the button, drag onto the map and lift to cast there (lifting back over the button cancels). A shield draws as a cyan ring and a SHIELD tag.
- Press Q/W/E/R for melee, ranged, area and shield. Press 1–4 for inventory slots 1–4. Open KEYS to remap either set; Godot saves changes on this device.
- Buys items at a barracks (M6): the panel sells the four starter items with their prices, a bought item waits in the queue (HELD without a hero) and reaches the hero's inventory when it is built. An item bar under the abilities shows the count of each; Haste and Energy Grab apply at once, Energy Boost and Sluggish wait for a tap on their target. A tap on a ground item or a loot bag sends the hero to take it.
- Shows the end-of-match table (M7, GDD 13.2) under the hero bar: the duration and the six counters of both sides. A Follow button in the hero bar eases the 3D camera toward the hero, a tap on the hero's name resumes it, and dragging the map turns it off. A creep group has one label with its count and lux (`Creeps x5 50`).
- Orders creeps from group size and type dropdowns on one row. Recycle, Set Default Path, and Order Creeps share another row. Pick Hero, the hero roster, and the hero power dropdown share one row. The queue sits in a small floating window at the top right, collapsed by default. It logs creep groups, hero picks, and items. It shows queued timers with a cancel button per order and scrolls after three rows. The queue stays outside the barracks panel, so new orders do not move its buttons.
- Selects a creep group by tapping one of its creeps, then offers Path, Merge, Split and Lane Route. Path mode takes up to 10 waypoints with Undo, Go, Cancel and Reuse Last, and a barracks keeps a default path for new groups. The arena draws the selected group's route.
- Resolves taps through `scripts/game_logic.gd`. A tap builds, selects an own building or creep group, adds a waypoint in path mode or picks the group to join in merge mode. Once a hero exists, a tap moves it or attacks an enemy, and a hero told to attack walks into reach first. With an ability aimed, a tap casts it.

## Staying in Step with the Web Client

`scripts/game_logic.gd` holds the pure decisions: label text, affordability, tap resolution and the actions of a selected building. The web client implements the same functions in `src/client/entity-text.js` and `src/client/ui/controls.js`. `test/fixtures/client-parity.json` holds the cases both must answer alike. When you change a decision, change both clients and the fixture in one commit. Both test runs fail when only one side moves.

## Procedural Ground

`scripts/procedural_terrain.gd` builds the `Terrain` mesh of each map, and `shaders/terrain.gdshader` colors it. The method comes from `examples/yt-example-projects/terrain`: a `PlaneMesh` gives the grid, the CPU lifts every vertex by noise, and central differences of the same height function give the normal and the tangent. A gradient in the shader then colors each fragment by its model-space height, over a tiling seamless noise normal map. This replaced the flat `pb_mesh.gd` plane the node carried before, and `main3d.gd` no longer scales the node: the mesh is built in tiles.

Three noise layers stack, all seeded from the map's own `usedSeed`, so one seed always builds one terrain:

- **Hills** (fractal FBM at `HILL_FREQUENCY`): the rolling base. It swings both ways, so it also cuts the valleys, which `VALLEY_SCALE` shallows.
- **Ranges** (one low-frequency layer): where mountains may stand. `smoothstep` cuts it off below `RANGE_FLOOR`, which gathers the peaks into a few ranges instead of spreading them evenly. The last `EDGE_RANGE` tiles before the map edge always count as range, so the arena sits in a bowl.
- **Ridges** (fractal ridged at `RIDGE_FREQUENCY`): the mountains themselves, squared to sharpen the peaks and multiplied by the range mask.

The map structure stays the server's, and the lanes cut through the terrain rather than levelling it. `configure` stamps the lane tiles, the Cores and the markers into a mask, and two chamfer passes measure each tile's distance to it. `height_at` then blends the ground toward the **floor height** over `CUT_FALLOFF` tiles. The floor is the hill layer alone, shrunk by `FLOOR_SCALE` and carrying no ridge. A lane therefore rolls gently and never climbs a mountain: a range in its way becomes a pass, banked on each side. Nothing is stamped for the build rows or the DMZ, so the middle of the map keeps its own relief.

Nothing reads y = 0 as the ground any more. `main3d.gd` seats buildings, creeps, heroes, labels, the ghost and the aim ring on `height_at`. It drapes the lane and zone overlays on the same surface, as one quad per tile with each corner on the ground. A zone tint fades out between `ZONE_FADE_START` and `ZONE_FADE_END` tiles of height. It therefore marks the low ground a player fights over, and leaves the mountains their own color. Taps go through `ground_point`. It marches the camera ray down through the height band the terrain can reach, then halves the step that crosses the surface. A tap on a slope therefore reads the tile the player sees.

Two exports tune it in the editor. `peak_height` is the tallest peak in tiles (10 by default, and the shader gradient spans twice it), and `cells_per_tile` is the vertex density. The heights are measured once into a grid, and each vertex takes its normal from its neighbors there, so a map costs one `height_at` call per vertex. One cell per tile builds the default map in 33 ms, as 10,961 vertices. Two cells take 110 ms for 43,425, and four take 415 ms for 172,865. All three were measured headless on an Apple M2 Pro. The map is rebuilt only when the layout changes, so the cost is paid once per match.

`tests/terrain_shot.gd` saves a screenshot of one map's ground, which is how a change to the layers or the gradient gets looked at. Its `--cells` argument sets the vertex density, and the script header holds the command.

## Terrain Scenery

The tiling is optional and off by default. A switch in the start menu turns it on, **Toggle auto terrain generation**. `main.gd` saves it in `user://luxcores.cfg` under `terrain/auto_generation` and pushes to `main3d.gd` through `set_auto_terrain_enabled`. Off, `_scatter_terrain` plans nothing, the prop node stays empty and `_ground_height` returns 0 everywhere, so the map renders as it did before the tiling existed. The switch redraws the map at once, so it also works during a match.

`scripts/terrain_scatter.gd` tiles the map with scenery and `ModelLibrary.TERRAIN_MODELS` names the six glTF files in `assets/3d/terrain/procedural/`. The script runs from `_configure_map` in `main3d.gd`, after the zone bands, the lanes and the markers, so it knows where it may not stand. It lays a grid of 5 tile cells over the map and gives one prop to every cell that gameplay does not claim. Each prop is drawn by weight from the six models, on a seed taken from the map's own `usedSeed`.

The props rest on the procedural ground: `build` takes a height function from `main3d.gd` and seats every copy on it, and `_ground_height` adds the prop's own mound to the ground below it.

The files are photogrammetry scans, not a height map: they share no ground plane and carry no collision shape. Each prop therefore declares a mound, a height and a radius measured by hand, and `height_at` returns the highest mound over a point. Clearance keeps every mound away from the lanes, the build zones, the Cores, the vents, the item spawns and the blockers. The ground is therefore flat at 0 wherever a building or a creep can be, and a hero that walks into the scenery is the only thing that climbs. Taps still read the flat plane at y = 0 through `arena_3d.gd`, which is why no mound passes 1 tile.

Each scan arrives as hundreds or thousands of separate little meshes. `_merged_mesh` therefore merges a prop once into one mesh with one surface per material, and every copy of that prop draws from one `MultiMeshInstance3D`. A tiled map therefore costs five or six nodes and about 60 draw calls whatever the number of copies, and the merge is cached for the rest of the session. The first map of a session pays about 1.5 seconds for that merge, later maps about 70 ms.

Triangles are the real cost, and they are a desktop figure. A tiled map draws 3 to 7 million triangles, because the open ground of a 96 by 112 tile map is large and the scans are dense. One copy of `forest_in_the_mountains` is 19 k triangles, the next four are 102 k to 257 k, and `rocks_formation_02` alone is 1.96 M. Lower `TRIANGLE_BUDGET` first on a slow device, and decimate `rocks_formation_02` before anything else.

Tune the tiling in two places. `PROP_RULES` in `terrain_scatter.gd` holds the footprint, the mound, the weight, the cap, the same-kind gap and the triangle count of each prop. The constants above it hold the cell size, the jitter, the seed salt, the clearances and the budget. `ModelLibrary.TERRAIN_MODELS` holds the file, the scale and the pivot, and a replacement file needs those two numbers measured again.

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

`tests/terrain_shot.gd` saves a top-down screenshot of one map's procedural ground, at the vertex density `--cells` names. It needs a window, and its header holds the command.

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
