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
	var server := _argument("server", "https://luxcores.webrit.cloud")
	# The main scene is the 3D world; its overlay layer holds the interface the checks drive.
	var world: Node = load("res://scenes/main3d.tscn").instantiate()
	root.add_child(world)
	await process_frame
	for child in world.get_children():
		if child is CanvasLayer:
			_main = child.get_child(0) as Control
			break
	if _main == null:
		printerr("FAIL the main scene has no interface layer")
		quit(1)
		return

	# Part 1: a human plays a bot through the real UI methods.
	_main._server_input.text = server
	_main._name_input.text = "GodotTester"
	_main._mode_selector.select(0)
	_main._seed_input.value = 1234567
	_main._entropy_input.text = "5"
	await _main._connect_match()
	_check("the host's entropy rate reaches the match", int(_main._current_match.get("entropyPctPerMinute", -1)), 5)
	_check("the lobby says the entropy rate", _main._status_label.text.contains("Entropy 5% per minute."), true)
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
	_check("a placement frees the palette", _main._building, "")

	# Two buildings never share a tile, but a neighbour is fine even right next to an existing building.
	_main._select_building("solar")
	await _main._on_arena_tapped(Vector2(solar_tile.x + 0.5, solar_tile.y + 0.5))
	_check("a second building on the same tile is refused", _main._status_label.text, "That tile is taken.")
	_main._select_building("wind")
	var wind_tile := Vector2i(solar_tile.x + 1, solar_tile.y)
	# The tap on the neighbour tile must not snap onto the solar plant beside it.
	await _main._on_arena_tapped(Vector2(wind_tile.x + 0.5, wind_tile.y + 0.5))
	_check("a wind plant fits on the tile beside the solar plant", await _until(func(): return _find(GameLogic.KIND_WIND, 0).size() == 1), true)
	_check("the second placement frees the palette too", _main._building, "")
	_main._select_building("solar")

	# A refused tap explains itself, sends nothing and keeps build mode on.
	await _main._on_arena_tapped(Vector2(48.5, 56.5))
	_check("a build in the DMZ is refused with a reason", _main._status_label.text, "Build inside your own zone.")
	_check("a refused tap keeps the building selected", _main._building, "solar")
	_main._select_building("solar") # toggles build mode off

	var tower_tile := _free_tile(3)
	_main._tower_attack_selector.select(2)
	_main._select_building("tower")
	await _main._on_arena_tapped(Vector2(tower_tile.x + 0.5, tower_tile.y + 0.5))
	var tower_ok: bool = await _until(func(): return _find(GameLogic.KIND_TOWER, 0).filter(func(e): return int(e.attack) == 3).size() > 0)
	_check("an area tower appears", tower_ok, true)
	_check("the bot builds too", await _until(func(): return _find(GameLogic.KIND_SOLAR, 1).size() > 0), true)

	# Select the tower and upgrade its power from the panel.
	_check("the tower placement freed the palette", _main._building, "")
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
	# A dropped connection: close the socket under the client. It must reconnect, rejoin the room and keep playing.
	_main._backend._socket.close()
	_check("the client reconnects after a drop", await _until(func(): return _main._backend._socket.get_ready_state() == WebSocketPeer.STATE_OPEN and not _main._backend._reconnecting), true)
	var tick_after_drop: int = int(_main._current_snapshot.get("tick", 0))
	_check("snapshots flow again after the rejoin", await _until(func(): return int(_main._current_snapshot.get("tick", 0)) > tick_after_drop + 10), true)
	var wind_ack: Dictionary = await _main._backend.send_command({"t": "build", "building": "wind", "tileX": solar_tile.x + 3, "tileZ": solar_tile.y})
	_check("a command after the rejoin is accepted: the count continued", wind_ack.get("accepted", false), true)
	_main._leave_match()

	# Part 1b: creeps. A fresh match against the bot: order groups, cancel, split, merge and send one.
	_main._mode_selector.select(0)
	await _main._connect_match()
	await _main._start_match()
	_check("part 1b starts", await _until(func(): return _entities().size() > 0), true)
	var barracks_tile := _free_tile(0)
	_main._select_building("barracks")
	await _main._on_arena_tapped(Vector2(barracks_tile.x + 0.5, barracks_tile.y + 0.5))
	_check("a barracks appears", await _until(func(): return _find(GameLogic.KIND_BARRACKS, 0).size() == 1), true)
	var barracks_id: int = int(_find(GameLogic.KIND_BARRACKS, 0)[0].id)
	_check("the barracks placement freed the palette", _main._building, "")
	await _main._on_arena_tapped(Vector2(barracks_tile.x + 0.5, barracks_tile.y + 0.5))
	_check("the barracks panel shows the order controls", _main._panel.visible and _main._order_box.get_child_count() >= 3, true)

	# One group through the panel buttons: 2 ranged creeps.
	_main._set_order_count(2)
	_main._set_order_type("ranged")
	_main._order_box.get_child(2).pressed.emit()
	_check("the queue lists the order", await _until(func(): return _main._queue_box.get_child_count() == 1 and _main._queue_labels[0].text.begins_with("Group of 2 RR")), true)
	# A group of 5 and three of 1 go in at once; the panel cancels the last.
	for mix in [["melee", "ranged", "area", "melee", "ranged"], ["melee"], ["melee"], ["melee"]]:
		await _main._backend.send_command({"t": "orderCreeps", "barracksId": barracks_id, "mix": mix})
	_check("the queue holds five orders", await _until(func(): return _main._queue_box.get_child_count() == 5), true)
	var lux_before: int = int(_main._viewer_core_lux_milli())
	_main._queue_box.get_child(4).get_child(1).pressed.emit()
	_check("cancelling by order id refunds the last order", await _until(func(): return _main._viewer_core_lux_milli() >= lux_before + 5000 and _main._queue_box.get_child_count() == 4), true)

	_check("four groups spawn with the lane route", await _until(func(): return _main._current_snapshot.get("groups", []).size() == 4), true)
	var groups: Array = _main._current_snapshot.groups
	var ids: Array = groups.map(func(g): return int(g.id))
	var sizes: Array = ids.map(func(id): return GameLogic.group_size(_entities(), int(id)))
	_check("the groups hold 2, 5, 1 and 1 creeps", sizes, [2, 5, 1, 1])
	_check("every group walks the lane route", groups.all(func(g): return int(g.custom) == 0 and g.waypoints.size() >= 8), true)

	# Tap a creep of the 5-group: its panel opens. Split it into 3 and 2.
	var five: Dictionary = _creep_of(int(ids[1]))
	await _main._on_arena_tapped(Vector2(float(five.x) / 1000.0, float(five.z) / 1000.0))
	_check("tapping a creep selects its group", _main._selected_group == int(ids[1]) and _main._panel_title.text.begins_with("Group of 5"), true)
	_main._panel_row.get_child(2).pressed.emit() # Path, Merge, Split
	_check("the split makes five groups", await _until(func(): return _main._current_snapshot.groups.size() == 5), true)
	_check("the original group keeps the odd creep", GameLogic.group_size(_entities(), int(ids[1])), 3)

	# Merge: the 3-group joins the single creep's group with Merge, then a tap on that creep.
	_main._selected_group = int(ids[1])
	_main._group_action("merge", int(ids[1]))
	_check("merge mode asks for another group", _main._panel_title.text.contains("tap another of your groups"), true)
	var single: Dictionary = _creep_of(int(ids[2]))
	await _main._on_arena_tapped(Vector2(float(single.x) / 1000.0, float(single.z) / 1000.0))
	_check("the merge leaves four groups", await _until(func(): return _main._current_snapshot.groups.size() == 4), true)
	_check("B joined A", GameLogic.group_size(_entities(), int(ids[1])), 4)

	# Path mode: two waypoints, Go.
	_main._selected_group = int(ids[1])
	_main._group_action("path", int(ids[1]))
	await _main._on_arena_tapped(Vector2(40.5, 84.5))
	await _main._on_arena_tapped(Vector2(44.5, 80.5))
	_check("path mode counts two waypoints", _main._path_points.size() == 2 and _main._panel_title.text.contains("2/10"), true)
	_main._path_go()
	_check("the group takes the custom path", await _until(func(): return _main._current_snapshot.groups.any(func(g): return int(g.id) == int(ids[1]) and int(g.custom) == 1 and g.waypoints.size() == 2)), true)
	_main._leave_match()

	# Part 1c: heroes. Pick one at a barracks through the panel, shield it, aim the area ability.
	_main._mode_selector.select(0)
	_main._match_input.text = ""
	await _main._connect_match()
	await _main._start_match()
	_check("part 1c starts", await _until(func(): return _entities().size() > 0), true)
	var hero_tile := _free_tile(0)
	_main._select_building("barracks")
	await _main._on_arena_tapped(Vector2(hero_tile.x + 0.5, hero_tile.y + 0.5))
	_check("the hero barracks appears", await _until(func(): return _find(GameLogic.KIND_BARRACKS, 0).size() == 1), true)
	_check("the barracks placement freed the palette", _main._building, "")
	await _main._on_arena_tapped(Vector2(hero_tile.x + 0.5, hero_tile.y + 0.5))
	_check("the barracks panel offers the whole roster", _main._hero_box.get_child_count() == 3 and _main._hero_box.get_child(2).get_child_count() == 5, true)
	_check("no hero, no hero bar", _main._hero_bar.visible, false)
	_main._hero_box.get_child(2).get_child(1).pressed.emit() # Prism, with the default allocation
	_check("the queue lists the hero pick", await _until(func(): return _main._queue_box.get_child_count() == 1 and _main._queue_labels[0].text.begins_with("Hero Prism")), true)
	_check("the hero stands next to its barracks", await _until(func(): return _find(GameLogic.KIND_HERO, 0).size() == 1), true)
	var hero: Dictionary = _find(GameLogic.KIND_HERO, 0)[0]
	_check("the hero is Prism with its allocated HP", int(hero.heroType) == 2 and int(hero.hp) >= 290000, true)
	_check("the hero bar shows", await _until(func(): return _main._hero_bar.visible and _main._hero_name_label.text.begins_with("Prism")), true)
	_check("Prism is locked in the rotation", int(_main._viewer_player().get("heroLock", 0)), 2)
	_check("the roster says a hero is on the field", await _until(func(): return _main._hero_box.get_child_count() > 0 and _main._hero_box.get_child(0).text == "Hero: Your hero is on the field."), true)
	_main._ability_buttons[3].pressed.emit() # shield on the hero
	_check("the shield covers the hero", await _until(func(): return int(_find(GameLogic.KIND_HERO, 0)[0].get("shieldHp", 0)) > 0), true)
	_check("the label shows the shield", _main._hero_name_label.text.ends_with("SHIELD"), true)
	_main._ability_buttons[2].pressed.emit() # area: aim
	_check("aiming the area ability waits for a tap", _main._ability, 2)
	await _main._on_arena_tapped(Vector2(float(hero.x) / 1000.0, float(hero.z) / 1000.0 - 3.0))
	_check("the area ability starts its cooldown", await _until(func(): return int(_find(GameLogic.KIND_HERO, 0)[0].get("cd2", 0)) > 0), true)
	_check("the aim ended with the cast", _main._ability, -1)
	_main._leave_match()

	# Part 1d: items. Buy two before any hero exists, get them with the hero, use Haste and aim Energy Boost.
	_main._mode_selector.select(0)
	_main._match_input.text = ""
	await _main._connect_match()
	await _main._start_match()
	_check("part 1d starts", await _until(func(): return _entities().size() > 0), true)
	var shop_tile := _free_tile(0)
	_main._select_building("barracks")
	await _main._on_arena_tapped(Vector2(shop_tile.x + 0.5, shop_tile.y + 0.5))
	_check("the shop barracks appears", await _until(func(): return _find(GameLogic.KIND_BARRACKS, 0).size() == 1), true)
	await _main._on_arena_tapped(Vector2(shop_tile.x + 0.5, shop_tile.y + 0.5))
	_check("the barracks panel sells the four items", _main._shop_box.get_child_count() == 2 and _main._shop_box.get_child(1).get_child_count() == 4, true)
	_check("the shop shows the price", _main._shop_box.get_child(1).get_child(2).text, "Haste 20")
	_main._shop_box.get_child(1).get_child(2).pressed.emit() # Haste
	_main._shop_box.get_child(1).get_child(0).pressed.emit() # Energy Boost
	var held: bool = await _until(func(): return _main._current_snapshot.orders.filter(func(o): return int(o.type) == GameLogic.ITEM_ORDER and int(o.held) == 1).size() == 2)
	_check("both items wait in the barracks without a hero", held, true)
	_check("the queue says an item is held", _main._queue_labels.values().any(func(label): return label.text == "Item Haste HELD"), true)
	_check("no hero, no item bar", _main._item_bar.visible, false)
	_main._set_hero_alloc("25%")
	_main._hero_box.get_child(2).get_child(1).pressed.emit() # Prism, with 25% of the Core
	_check("the hero stands on the map", await _until(func(): return _find(GameLogic.KIND_HERO, 0).size() == 1), true)
	_check("the items arrive with the hero", await _until(func(): return _main._viewer_player().get("items", [0, 0, 0, 0]).map(func(n): return int(n)) == [1, 0, 1, 0]), true)
	_check("the item bar shows the counts", await _until(func(): return _main._item_bar.visible and _main._item_buttons[2].text == "Haste 1" and _main._item_buttons[0].text == "Boost 1"), true)
	_main._use_from_bar(2)
	_check("Haste applies at once", await _until(func(): return int(_find(GameLogic.KIND_HERO, 0)[0].get("speedMod", 0)) == 300), true)
	_check("the Haste count drops", await _until(func(): return _main._item_buttons[2].text == "Haste 0"), true)
	var boosted: Dictionary = _find(GameLogic.KIND_HERO, 0)[0]
	_main._use_from_bar(0)
	_check("aiming Energy Boost waits for a tap", _main._item_aim, 0)
	await _main._on_arena_tapped(Vector2(10.0, 10.0))
	_check("empty ground is refused with a reason", _main._status_label.text, "Tap your hero or one of your buildings.")
	await _main._on_arena_tapped(Vector2(float(boosted.x) / 1000.0, float(boosted.z) / 1000.0))
	_check("Energy Boost adds 15 lux of HP", await _until(func(): return int(_find(GameLogic.KIND_HERO, 0)[0].maxHp) == int(boosted.maxHp) + 150000), true)
	_check("the aim ended with the use", _main._item_aim, -1)
	_main._leave_match()

	# The end-of-match screen reads the counters of the result.
	_main._viewer_team = 0
	_main._on_match_ended({"winnerTeam": 0, "draw": false, "reason": "victory", "endedTick": 3573, "stats": [
		{"team": 0, "collected": 123456, "spent": 98000, "drained": 45678, "funneled": 9930, "recycled": 12000, "entropy": 2999},
		{"team": 1, "collected": 88000, "spent": 120500, "drained": 1000, "funneled": 0, "recycled": 0, "entropy": 4123}]})
	_check("the end screen shows", _main._summary_box.visible, true)
	_check("the end screen names the outcome and the duration", _main._summary_box.get_child(0).text.begins_with("Victory") and _main._summary_box.get_child(0).text.ends_with("2:58"), true)
	_check("the end screen has a row per counter", _main._summary_box.get_child(1).get_child_count(), 3 + 6 * 3)
	_main._leave_match()
	_check("leaving hides the end screen", _main._summary_box.visible, false)

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

func _creep_of(group_id: int) -> Dictionary:
	for e in _entities():
		if int(e.kind) == GameLogic.KIND_CREEP and int(e.get("groupId", 0)) == group_id:
			return e
	return {}

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
