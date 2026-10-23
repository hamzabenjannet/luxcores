extends Control
## Shows the arena and entity locations and lets players move the RTS camera.

const GameLogic = preload("res://scripts/game_logic.gd")

const MAP_SIZE := Vector2(125.0, 125.0)
const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")

var _world_root: Node3D
var _layout: Dictionary = {}
var _snapshot: Dictionary = {}
var _camera_target := Vector3.ZERO
var _map_width := 96
var _map_height := 112

func _ready() -> void:
	custom_minimum_size = MAP_SIZE
	size = MAP_SIZE
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE
	visible = false

func set_world_root(world: Node3D) -> void:
	_world_root = world

func set_map_data(layout: Dictionary, snapshot: Dictionary, camera_target: Vector3) -> void:
	_layout = layout
	_snapshot = snapshot
	_map_width = maxi(1, int(layout.get("width", 96)))
	_map_height = maxi(1, int(layout.get("height", 112)))
	_camera_target = camera_target
	queue_redraw()

func set_camera_target(camera_target: Vector3) -> void:
	if camera_target == _camera_target:
		return
	_camera_target = camera_target
	queue_redraw()

func _draw() -> void:
	if _layout.is_empty():
		return
	draw_rect(Rect2(Vector2.ZERO, size), Color("#101923"))
	var bounds := _map_rect()
	draw_rect(bounds, Color("#263442"))
	var band_height := bounds.size.y / 7.0
	draw_rect(Rect2(bounds.position, Vector2(bounds.size.x, band_height * 3.0)), Color(TEAM_RED.r, TEAM_RED.g, TEAM_RED.b, 0.34))
	draw_rect(Rect2(Vector2(bounds.position.x, bounds.position.y + band_height * 3.0), Vector2(bounds.size.x, band_height)), Color("#9aa7b5"))
	draw_rect(Rect2(Vector2(bounds.position.x, bounds.position.y + band_height * 4.0), Vector2(bounds.size.x, band_height * 3.0)), Color(TEAM_BLUE.r, TEAM_BLUE.g, TEAM_BLUE.b, 0.34))
	_draw_lanes(bounds)
	_draw_markers(bounds, "vents", Color("#4cf3c5"))
	_draw_markers(bounds, "itemSpawns", Color("#f7dc69"))
	_draw_entities(bounds)
	var camera_point := _map_point(Vector2(
		_camera_target.x + float(_map_width) * 0.5,
		_camera_target.z + float(_map_height) * 0.5
	), bounds)
	draw_circle(camera_point, 5.0, Color("#ffe66d"))
	draw_arc(camera_point, 7.0, 0.0, TAU, 24, Color("#17212b"), 1.5)
	draw_rect(bounds, Color("#d5e0ea"), false, 2.0)
	draw_rect(Rect2(Vector2.ZERO, size), Color("#7e91a3"), false, 1.0)

func _draw_lanes(bounds: Rect2) -> void:
	for lane in _layout.get("lanes", []):
		if not lane is Dictionary:
			continue
		var team := int(lane.get("team", -1))
		var tint := TEAM_BLUE if team == 0 else TEAM_RED
		for tile_value in lane.get("tiles", []):
			var tile_index := int(tile_value)
			var tile_x := tile_index % _map_width
			@warning_ignore("integer_division")
			var tile_z := tile_index / _map_width
			var center := _map_point(Vector2(float(tile_x) + 0.5, float(tile_z) + 0.5), bounds)
			var tile_size := Vector2(
				maxf(1.0, bounds.size.x / float(_map_width) * 0.7),
				maxf(1.0, bounds.size.y / float(_map_height) * 0.7)
			)
			draw_rect(Rect2(center - tile_size * 0.5, tile_size), Color(tint.r, tint.g, tint.b, 0.78))

func _draw_markers(bounds: Rect2, key: String, tint: Color) -> void:
	for marker in _layout.get(key, []):
		if not marker is Dictionary:
			continue
		var point := _map_point(Vector2(
			float(marker.get("tileX", 0)) + 0.5,
			float(marker.get("tileZ", 0)) + 0.5
		), bounds)
		draw_circle(point, 2.5, tint)

func _draw_entities(bounds: Rect2) -> void:
	for entity in _snapshot.get("entities", []):
		if not entity is Dictionary:
			continue
		var point := _map_point(Vector2(
			float(entity.get("x", 0)) / GameLogic.UNITS_PER_TILE,
			float(entity.get("z", 0)) / GameLogic.UNITS_PER_TILE
		), bounds)
		var team := int(entity.get("team", entity.get("owner", -1)))
		var tint := TEAM_BLUE if team == 0 else TEAM_RED if team == 1 else Color("#e6edf3")
		var radius := 3.5 if int(entity.get("kind", 0)) == GameLogic.KIND_CORE else 2.0
		draw_circle(point, radius, tint)

func _map_rect() -> Rect2:
	return Rect2(Vector2.ZERO, size)

func _map_point(tile: Vector2, bounds: Rect2) -> Vector2:
	return bounds.position + Vector2(
		tile.x / float(_map_width) * bounds.size.x,
		tile.y / float(_map_height) * bounds.size.y
	)

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		if _map_rect().has_point(event.position):
			_handle_map_click(event.position)
			accept_event()

func _handle_map_click(local_position: Vector2) -> void:
	if not is_instance_valid(_world_root) or _layout.is_empty():
		return
	var bounds := _map_rect()
	if not bounds.has_point(local_position):
		return
	var map_position := Vector2(
		(local_position.x - bounds.position.x) / bounds.size.x * float(_map_width),
		(local_position.y - bounds.position.y) / bounds.size.y * float(_map_height)
	)
	_world_root.call("jump_camera_to_map_position", map_position)
