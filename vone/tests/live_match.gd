extends SceneTree
## Drives the real main scene against a running backend: connect, start a match,
## build, upgrade, recycle, then watch two bots. It checks the whole Godot path
## (sign-in, server rules, snapshots, shared tap rules, panel, drawing).
##
##   Godot --headless --path vone --script res://tests/live_match.gd -- --server=http://127.0.0.1:3000
##
## The backend must run with MATCH_MAX_TICKS of at least 1200 (so the human match outlasts
## the checks) and a rate limit that allows a few sign-ins. The exit code is the number of
## failed checks, so 0 means everything passed.

const GameLogic = preload("res://scripts/game_logic.gd")
const SECONDS_PER_WAIT := 40.0

var _failures := 0
var _checks := 0
var _main: Control

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var server := _argument("server", "http://127.0.0.1:3000")
	_main = load("res://scenes/main.tscn").instantiate()
	root.add_child(_main)
	await process_frame

	# Part 1: a human plays a bot through the real UI methods.
	_main._server_input.text = server
	_main._name_input.text = "GodotTester"
	_main._mode_selector.select(0)
	_main._seed_input.value = 1234567
	await _main._connect_match()
	_check("connected as a player", _main._role == "player" and _main._game.visible, true)
	_check("the server rules loaded", _main._data.has("buildings") and _main._data.has("mapgen"), true)
	await _main._start_match()
	var started: bool = await _until(func(): return _entities().size() > 0)
	_check("the first snapshot arrived", started, true)
	_check("the arena drew the map", _main._arena.draw_count > 0, true)

	var solar_tile := _free_tile(0)
	_main._select_building("solar")
	_check("the solar description shows the data cost", _main._build_description.text.contains("costs 20 lux"), true)
	await _main._on_arena_tapped(Vector2(solar_tile.x + 0.5, solar_tile.y + 0.5))
	_check("a solar plant appears", await _until(func(): return _find(GameLogic.KIND_SOLAR, 0).size() > 0), true)

	# Build mode stays on after a placement, like the web client. A refused tap explains itself and sends nothing.
	await _main._on_arena_tapped(Vector2(48.5, 56.5))
	_check("a build in the DMZ is refused with a reason", _main._status_label.text, "Build inside your own zone.")
	_main._select_building("solar") # toggles build mode off

	var tower_tile := _free_tile(3)
	_main._tower_attack_selector.select(2)
	_main._select_building("tower")
	await _main._on_arena_tapped(Vector2(tower_tile.x + 0.5, tower_tile.y + 0.5))
	var tower_ok: bool = await _until(func(): return _find(GameLogic.KIND_TOWER, 0).filter(func(e): return int(e.attack) == 3).size() > 0)
	_check("an area tower appears", tower_ok, true)
	_check("the bot builds too", await _until(func(): return _find(GameLogic.KIND_SOLAR, 1).size() > 0), true)

	# Select the tower and upgrade its power from the panel.
	_main._select_building("tower") # toggles build mode off
	await _main._on_arena_tapped(Vector2(tower_tile.x + 0.5, tower_tile.y + 0.5))
	_check("the panel shows for the tower", _main._panel.visible, true)
	_check("the panel offers a power upgrade first", _main._panel_row.get_child(0).text.begins_with("Power 1/3"), true)
	_main._panel_row.get_child(0).pressed.emit()
	_check("the tower reaches power 1", await _until(func(): return _find(GameLogic.KIND_TOWER, 0).filter(func(e): return int(e.powerLevel) == 1).size() > 0), true)
	_check("the label carries the upgrade", GameLogic.entity_text(_find(GameLogic.KIND_TOWER, 0)[0], _main._data.balance.hpFactor).begins_with("Tower A P1"), true)

	# Recycle the solar plant: the channel starts, then the plant is gone.
	await _main._on_arena_tapped(Vector2(solar_tile.x + 0.5, solar_tile.y + 0.5))
	_check("the panel shows for the plant", _main._panel.visible, true)
	_main._panel_row.get_child(_main._panel_row.get_child_count() - 1).pressed.emit()
	_check("the recycle channel starts", await _until(func(): return _find(GameLogic.KIND_SOLAR, 0).filter(func(e): return int(e.recycle) > 0).size() > 0), true)
	_check("the plant is recycled", await _until(func(): return _find(GameLogic.KIND_SOLAR, 0).size() == 0), true)
	_check("the HUD shows both Cores and the clock", _main._world_label.text.contains("Core") and _main._world_label.text.contains("Enemy") and _main._world_label.text.contains(":"), true)
	_main._leave_match()

	# Part 2: two bots play, and this client only watches.
	_main._mode_selector.select(1)
	_main._match_input.text = ""
	await _main._connect_match()
	_check("connected as a spectator", _main._role == "spectator", true)
	_check("a spectator has no build palette", _main._palette.visible, false)
	await _main._start_match()
	var both: bool = await _until(func(): return _find(GameLogic.KIND_TOWER, 0).size() > 0 and _find(GameLogic.KIND_TOWER, 1).size() > 0)
	_check("both bots build towers", both, true)
	_check("the spectator HUD names the sides", _main._world_label.text.contains("Blue") and _main._world_label.text.contains("Red"), true)
	var match_id: String = _main._backend.get_match_id()
	_main._leave_match()

	# Part 3: a second client joins the bot match by id and watches it.
	_main._match_input.text = match_id
	await _main._connect_match()
	_check("joining a bot match by id spectates", _main._role == "spectator", true)

	print("%d checks, %d failed" % [_checks, _failures])
	quit(_failures)

func _entities() -> Array:
	return _main._current_snapshot.get("entities", [])

func _find(kind: int, team: int) -> Array:
	return _entities().filter(func(e): return int(e.kind) == kind and int(e.team) == team)

## A free tile (not a vent) in team 0's build zone near the middle, the n-th by distance.
func _free_tile(n: int) -> Vector2i:
	var taken := {}
	for e in _entities():
		if int(e.kind) <= GameLogic.KIND_BLOCKER:
			taken["%d,%d" % [int(e.x) / 1000, int(e.z) / 1000]] = true
	for vent in _main._current_map.vents:
		taken["%d,%d" % [int(vent.tileX), int(vent.tileZ)]] = true
	var free: Array = []
	for z in range(70, 110):
		for x in range(4, 92, 2):
			if not taken.has("%d,%d" % [x, z]):
				free.append({"d": (x - 44) * (x - 44) + (z - 90) * (z - 90), "x": x, "z": z})
	free.sort_custom(func(a, b): return a.d < b.d or (a.d == b.d and a.z < b.z))
	return Vector2i(int(free[n].x), int(free[n].z))

## Polls once per frame until the condition holds or the time runs out.
func _until(condition: Callable) -> bool:
	var deadline := Time.get_ticks_msec() + int(SECONDS_PER_WAIT * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await process_frame
	return false

func _check(name: String, actual: Variant, expected: Variant) -> void:
	_checks += 1
	if actual == expected:
		return
	_failures += 1
	printerr("FAIL %s\n  actual:   %s\n  expected: %s" % [name, str(actual), str(expected)])

func _argument(key: String, fallback: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--%s=" % key):
			return argument.substr(key.length() + 3)
	return fallback
