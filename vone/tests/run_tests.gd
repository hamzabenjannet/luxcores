extends SceneTree
## Headless checks of the pure game logic against the cases the web client also
## runs (test/fixtures/client-parity.json). Run from the repo root:
##
##   Godot --headless --path vone --script res://tests/run_tests.gd
##
## The exit code is the number of failed checks, so 0 means every case passed.

const GameLogic = preload("res://scripts/game_logic.gd")

var _checks := 0
var _failures := 0

func _init() -> void:
	var root := ProjectSettings.globalize_path("res://").path_join("..").simplify_path()
	var fixture: Dictionary = _read_json(root.path_join("test/fixtures/client-parity.json"))
	var data := {
		"heroes": _read_json(root.path_join("data/heroes.json")),
		"buildings": _read_json(root.path_join("data/buildings.json")),
		"balance": _read_json(root.path_join("data/balance.json")),
		"mapgen": _read_json(root.path_join("data/mapgen.json")),
		"items": _read_json(root.path_join("data/items.json")),
	}
	if fixture.is_empty() or data.buildings.is_empty():
		push_error("Could not read the fixture or the data files under %s" % root)
		quit(1)
		return

	_check("kind codes match the fixture", _normalize({
		"CORE": GameLogic.KIND_CORE, "SOLAR": GameLogic.KIND_SOLAR, "WIND": GameLogic.KIND_WIND,
		"GEOTHERMAL": GameLogic.KIND_GEOTHERMAL, "NUCLEAR": GameLogic.KIND_NUCLEAR,
		"BARRACKS": GameLogic.KIND_BARRACKS, "TOWER": GameLogic.KIND_TOWER, "BLOCKER": GameLogic.KIND_BLOCKER,
		"CREEP": GameLogic.KIND_CREEP, "HERO": GameLogic.KIND_HERO, "PROJECTILE": GameLogic.KIND_PROJECTILE,
		"GROUND_ITEM": GameLogic.KIND_GROUND_ITEM, "LOOT_BAG": GameLogic.KIND_LOOT_BAG,
	}), _normalize(fixture.kinds))
	_check("the fixture HP factor matches the balance data", _normalize(fixture.hpFactor), _normalize(data.balance.hpFactor))

	var hero_names: Array = fixture.heroNames
	var roster: Array = fixture.roster
	_check("the fixture hero names match the roster", _normalize(hero_names), _normalize(_names_of(roster)))
	_check("the fixture roster matches data/heroes.json", _normalize(roster), _normalize(_roster_of(data.heroes)))
	var item_names: Array = fixture.itemNames
	_check("the fixture item names match the item data", _normalize(item_names), _normalize(_item_names_of(data.items)))
	_check("the fixture items match data/items.json", _normalize(fixture.items), _normalize(_items_of(data.items)))
	for c in fixture.entityText:
		var expected := "" if c.expect == null else String(c.expect)
		_check("entity text %s" % JSON.stringify(c.entity), GameLogic.entity_text(c.entity, fixture.hpFactor, hero_names, item_names), expected)
	for c in fixture.creepGroupLabels:
		_check("creep group labels: %s" % String(c.name), _normalize(GameLogic.creep_group_labels(c.entities, fixture.hpFactor)), _normalize(c.expect))
	for c in fixture.entropyFromText:
		_check("entropy from text %s" % JSON.stringify(c.text), GameLogic.entropy_from_text(String(c.text)), int(c.expect))
	for c in fixture.entropyText:
		_check("entropy text %s" % JSON.stringify(c.tenths), GameLogic.entropy_text(int(c.tenths)), String(c.expect))
	for c in fixture.secondsText:
		_check("seconds text %s" % JSON.stringify(c), GameLogic.seconds_text(int(c.ticks), int(c.tickHz)), String(c.expect))
	for c in fixture.abilityStates:
		_check("ability buttons: %s" % String(c.name), _normalize(GameLogic.ability_states(c.hero, fixture.abilities, int(c.coreLuxMilli), int(c.minLeftLux), int(c.tickHz))), _normalize(c.expect))
	for c in fixture.itemStates:
		_check("item buttons: %s" % String(c.name), _normalize(GameLogic.item_states(fixture.items, c.counts, int(c.funnelLux))), _normalize(c.expect))
	for c in fixture.immediateUse:
		var use := GameLogic.immediate_use(int(c.id), fixture.items)
		_check("immediate use %s" % JSON.stringify(c), _normalize(use if not use.is_empty() else null), _normalize(c.expect))
	for c in fixture.shopStates:
		_check("item shop: %s" % String(c.name), _normalize(GameLogic.shop_states(fixture.items, int(c.coreLuxMilli), int(c.minLeftLux))), _normalize(c.expect))
	for c in fixture.matchSummary:
		_check("summary: %s" % String(c.name), _normalize(GameLogic.match_summary(c.result, int(c.viewerTeam), bool(c.spectator), int(c.endedTick), int(c.tickHz))), _normalize(c.expect))
	for c in fixture.endsBuildMode:
		_check("ends build mode %s" % JSON.stringify(c.command), GameLogic.ends_build_mode(c.command), bool(c.expect))
	for c in fixture.immediateCast:
		var cast := GameLogic.immediate_cast(int(c.slot), c.hero)
		_check("immediate cast %s" % JSON.stringify(c), _normalize(cast if not cast.is_empty() else null), _normalize(c.expect))
	for c in fixture.heroPickState:
		var state := GameLogic.hero_pick_state({
			"player": c.player if c.player != null else {}, "hero_alive": bool(c.heroAlive), "hero_queued": bool(c.heroQueued),
			"roster": roster, "tick_hz": int(c.tickHz),
		})
		_check("hero pick: %s" % String(c.name), _normalize(state), _normalize(c.expect))
	for c in fixture.heroLuxChoices:
		_check("hero lux %s" % JSON.stringify(c), _normalize(GameLogic.hero_lux_choices(int(c.coreLuxMilli), int(c.minLeftLux))), _normalize(c.expect))
	for c in fixture.isDay:
		_check("day at tick %d" % int(c.tick), GameLogic.is_day(int(c.tick), fixture.dayNight), bool(c.expect))
	for c in fixture.canAfford:
		_check("can afford %s" % JSON.stringify(c), GameLogic.can_afford(int(c.coreLuxMilli), int(c.costLux), int(c.minLeftLux)), bool(c.expect))
	for c in fixture.actionsFor:
		_check("actions for %s" % JSON.stringify(c.entity), _normalize(GameLogic.actions_for(c.entity, data.buildings.tower)), _normalize(c.expect))
	for c in fixture.mixFor:
		_check("order mix %s" % JSON.stringify(c), _normalize(GameLogic.mix_for(int(c.count), String(c.type))), _normalize(c.expect))
	for c in fixture.queueLines:
		_check("queue lines for barracks %d" % int(c.barracksId), _normalize(GameLogic.queue_lines(c.orders, int(c.barracksId), int(c.tickHz), fixture.heroNames, item_names)), _normalize(c.expect))
	for c in fixture.groupActions:
		var ids: Array = []
		for action in GameLogic.group_actions(int(c.size), bool(c.custom)):
			ids.append(action.id)
		_check("group actions %s" % JSON.stringify(c), ids, _normalize(c.expect))
	for c in fixture.resolveTap:
		var ctx: Dictionary = c.ctx
		var result := GameLogic.resolve_tap({
			"ground": Vector2(float(ctx.ground[0]), float(ctx.ground[1])),
			"entities": ctx.get("entities", []),
			"viewer_team": int(ctx.viewerTeam),
			"building": String(ctx.get("building", "")),
			"attack": String(ctx.get("attack", "ranged")),
			"core_lux_milli": int(ctx.get("coreLuxMilli", 100000)),
			"data": data,
			"vents": ctx.get("vents", []),
			"mode": String(ctx.get("mode", "")),
			"selected_group": int(ctx.get("selectedGroup", -1)) if ctx.get("selectedGroup") != null else -1,
			"path_count": int(ctx.get("pathCount", 0)),
			"ability": int(ctx.get("ability", -1)) if ctx.get("ability") != null else -1,
			"item": int(ctx.get("item", -1)) if ctx.get("item") != null else -1,
		})
		_check("tap: %s" % String(c.name), _normalize(result), _normalize(c.expect))

	_check("the build zone of team 0 is rows 64 to 111", GameLogic.build_zone(data.mapgen, 0), Vector2i(64, 111))
	_check("the build zone of team 1 is rows 0 to 47", GameLogic.build_zone(data.mapgen, 1), Vector2i(0, 47))

	print("%d checks, %d failed" % [_checks, _failures])
	quit(_failures)

func _check(name: String, actual: Variant, expected: Variant) -> void:
	_checks += 1
	if typeof(actual) == TYPE_STRING or typeof(actual) == TYPE_BOOL or typeof(actual) == TYPE_VECTOR2I:
		if actual == expected:
			return
	elif JSON.stringify(actual, "", true) == JSON.stringify(expected, "", true):
		return
	_failures += 1
	printerr("FAIL %s\n  actual:   %s\n  expected: %s" % [name, JSON.stringify(actual) if typeof(actual) != TYPE_VECTOR2I else str(actual), JSON.stringify(expected) if typeof(expected) != TYPE_VECTOR2I else str(expected)])

func _names_of(roster: Array) -> Array:
	var out: Array = []
	for entry in roster:
		out.append(String(entry.name))
	return out

func _item_names_of(items: Dictionary) -> Array:
	var out: Array = []
	for entry in items.get("list", []):
		out.append(String(entry.name))
	return out

func _items_of(items: Dictionary) -> Array:
	var out: Array = []
	for entry in items.get("list", []):
		out.append({"id": int(entry.id), "name": String(entry.name), "costLux": int(entry.costLux), "target": String(entry.target), "effect": {"kind": String(entry.effect.kind)}})
	return out

func _roster_of(heroes: Dictionary) -> Array:
	var out: Array = []
	for entry in heroes.get("roster", []):
		out.append({"id": int(entry.id), "name": String(entry.name), "primary": String(entry.primary)})
	return out

func _read_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Dictionary else {}

## JSON numbers arrive as floats; whole ones become ints so 20.0 and 20 compare equal.
func _normalize(value: Variant) -> Variant:
	if value is Dictionary:
		var out := {}
		for key in value:
			out[key] = _normalize(value[key])
		return out
	if value is Array:
		var out: Array = []
		for item in value:
			out.append(_normalize(item))
		return out
	if value is float and is_equal_approx(value, round(value)):
		return int(value)
	return value
