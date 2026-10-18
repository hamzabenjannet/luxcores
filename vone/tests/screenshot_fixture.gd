extends SceneTree
## Draws a hand-made snapshot with every M3 entity (towers of each attack type,
## aim lines, a projectile, a stun, a recycle channel, a hero and a creep) and saves
## a screenshot. No creep or hero exists in a live match before M4 and M5, so this is
## how the combat drawing gets checked. It needs a window, so do not pass --headless:
##
##   Godot --path vone --script res://tests/screenshot_fixture.gd -- --map=/tmp/map.json --out=/tmp/fixture.png
##
## --map is the JSON of GET /api/game/maps/1234567 (the file only supplies lanes and vents).

const GameLogic = preload("res://scripts/game_logic.gd")
const ArenaScript = preload("res://scripts/arena.gd")

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var map_text := FileAccess.get_file_as_string(_argument("map", "/tmp/map.json"))
	var map_data: Dictionary = JSON.parse_string(map_text)
	var arena = ArenaScript.new()
	arena.size = Vector2(600, 1000)
	root.add_child(arena)
	root.size = Vector2i(600, 1000)
	arena.size = Vector2(600, 1000)

	var entities: Array = [
		_entity(1, 1, 0, -1, 48500, 96500, 94000, 94000),
		_entity(2, 1, 1, -1, 47500, 15500, 100000, 100000),
		_entity(20, 7, 0, 0, 44500, 80500, 180000, 200000, {"attack": 2, "powerLevel": 2, "shellLevel": 1, "targetId": 40}),
		_entity(21, 7, 0, 0, 52500, 80500, 200000, 200000, {"attack": 1, "stunTicks": 6}),
		_entity(22, 7, 0, 0, 48500, 86500, 200000, 200000, {"attack": 3, "recycle": 30}),
		_entity(23, 2, 0, 0, 40500, 90500, 200000, 200000),
		_entity(24, 6, 0, 0, 56500, 90500, 400000, 400000),
		_entity(30, 10, 0, 0, 48500, 76500, 500000, 500000, {"targetId": 41}),
		_entity(40, 9, 1, 1, 44500, 72500, 100000, 100000),
		_entity(41, 7, 1, 1, 52500, 72500, 200000, 200000, {"attack": 2}),
		_entity(50, 11, 0, 0, 44500, 80500, 1, 1, {"targetId": 40, "arrivalTick": 100}),
	]
	arena.set_balance({"hpFactor": {"core": 1, "default": 10}, "economy": {"recycleChannelTicks": 60}})
	arena.set_world(map_data, {"tick": 100, "entities": entities}, 0)
	await process_frame
	arena._zoom = 3.0
	var tile_size: float = minf((arena.size.x - 24.0) / 96.0, (arena.size.y - 24.0) / 112.0) * arena._zoom
	arena._pan_offset = arena.size * 0.5 - Vector2(48, 84) * tile_size - (arena.size - Vector2(96, 112) * tile_size) * 0.5
	arena.queue_redraw()
	await process_frame
	await process_frame
	var image := root.get_texture().get_image()
	var path := _argument("out", "/tmp/fixture.png")
	image.save_png(path)
	print("saved %s (%d redraws)" % [path, arena.draw_count])
	quit(0)

func _entity(id: int, kind: int, team: int, owner: int, x: int, z: int, hp: int, max_hp: int, extra := {}) -> Dictionary:
	var entity := {"id": id, "kind": kind, "team": team, "owner": owner, "x": x, "z": z, "hp": hp, "maxHp": max_hp,
		"attack": 0, "recycle": 0, "stunTicks": 0, "targetId": 0, "powerLevel": 0, "shellLevel": 0}
	entity.merge(extra, true)
	return entity

func _argument(key: String, fallback: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--%s=" % key):
			return argument.substr(key.length() + 3)
	return fallback
