extends Control
## Draws the map and the server snapshot in 2D and reports taps. Decisions about
## what a tap means live in game_logic.gd, shared with the tests.

## A tap on the map, in tile coordinates (fractions inside a tile). The main
## script resolves it with GameLogic.resolve_tap.
signal tapped(ground: Vector2)

const GameLogic = preload("res://scripts/game_logic.gd")
const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")
const KIND_CORE := GameLogic.KIND_CORE
const KIND_BLOCKER := GameLogic.KIND_BLOCKER
const KIND_CREEP := GameLogic.KIND_CREEP
const KIND_HERO := GameLogic.KIND_HERO
const KIND_PROJECTILE := GameLogic.KIND_PROJECTILE
const KIND_GROUND_ITEM := GameLogic.KIND_GROUND_ITEM
const KIND_LOOT_BAG := GameLogic.KIND_LOOT_BAG
## Cap color by tower attack code: melee orange, ranged cyan, area purple (the web client uses the same).
const ATTACK_COLORS := {1: Color("#ff9f43"), 2: Color("#2de2e6"), 3: Color("#b26bff")}
## A tap lands on the nearest entity within this many screen pixels, so a finger can hit a 6 px tile.
const TOUCH_RADIUS_PIXELS := 18.0

## Counts redraws; the headless live test checks that drawing ran without errors.
var draw_count := 0
var map_data: Dictionary = {}
var snapshot: Dictionary = {}
var viewer_team := 0
var hp_factor := {"core": 1, "default": 10}
## Ticks of the recycle channel, from the server's balance data (economy.recycleChannelTicks).
var recycle_channel_ticks := 60
var selected_building := ""
## Paths to draw: [{points: Array of Vector2 in tiles, color: Color}]. The main script decides what to show.
var paths: Array = []
var selected_entity_id := -1
var _bounds := Rect2()
var _tile_size := Vector2.ONE
var _zoom := 1.0
var _pan_offset := Vector2.ZERO
var _dragging := false
var _pointer_moved := false
var _last_pointer := Vector2.ZERO
var _press_position := Vector2.ZERO

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true
	custom_minimum_size = Vector2(300, 460)
	queue_redraw()

func set_world(layout: Dictionary, world_snapshot: Dictionary, team: int) -> void:
	map_data = layout
	snapshot = world_snapshot
	viewer_team = team
	queue_redraw()

## Takes the numbers the drawing needs from the server's balance data.
func set_balance(balance: Dictionary) -> void:
	hp_factor = balance.hpFactor
	recycle_channel_ticks = int(balance.economy.recycleChannelTicks)
	queue_redraw()

## Screen pixels to tile coordinates, for the tap and the tests.
func ground_at(position: Vector2) -> Vector2:
	return (position - _bounds.position) / _tile_size

func set_paths(new_paths: Array) -> void:
	paths = new_paths
	queue_redraw()

func set_selection(building: String, entity_id := -1) -> void:
	selected_building = building
	selected_entity_id = entity_id
	queue_redraw()

func _draw() -> void:
	draw_count += 1
	draw_rect(Rect2(Vector2.ZERO, size), Color("#09111d"))
	if map_data.is_empty():
		draw_string(ThemeDB.fallback_font, Vector2(24, 40), "Waiting for the server map...", HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("#b9c8dc"))
		return

	var width := int(map_data.get("width", 96))
	var height := int(map_data.get("height", 112))
	var margin := 12.0
	var scale := minf((size.x - margin * 2.0) / width, (size.y - margin * 2.0) / height) * _zoom
	_tile_size = Vector2(scale, scale)
	var map_size := Vector2(width * scale, height * scale)
	_bounds = Rect2((size - map_size) * 0.5 + _pan_offset, map_size)
	draw_rect(_bounds, Color("#101d2a"))

	_draw_zones(height)
	_draw_lanes()
	_draw_markers(map_data.get("vents", []), Color("#4cf3c5"), 2.4, "VENT")
	_draw_markers(map_data.get("itemSpawns", []), Color("#f7dc69"), 1.8, "ITEM SPAWN")
	_draw_paths()
	_draw_entities(snapshot.get("entities", []))
	_draw_selection_hint()
	_draw_zoom_controls()

func _draw_zones(height: int) -> void:
	var zone_height := height / 7.0
	draw_rect(Rect2(_bounds.position, Vector2(_bounds.size.x, zone_height * 2.0)), Color("#381b2b"))
	draw_rect(Rect2(_bounds.position + Vector2(0, zone_height * 2.0), Vector2(_bounds.size.x, zone_height)), Color("#18202d"))
	draw_rect(Rect2(_bounds.position + Vector2(0, zone_height * 3.0), Vector2(_bounds.size.x, zone_height)), Color("#1a2d45"))
	draw_rect(Rect2(_bounds.position + Vector2(0, zone_height * 4.0), Vector2(_bounds.size.x, zone_height)), Color("#1b2231"))
	draw_rect(Rect2(_bounds.position + Vector2(0, zone_height * 5.0), Vector2(_bounds.size.x, zone_height * 2.0)), Color("#142b43"))

func _draw_lanes() -> void:
	for lane in map_data.get("lanes", []):
		var team := int(lane.get("team", 0))
		var tint := TEAM_BLUE if team == 0 else TEAM_RED
		var lane_color := Color(tint.r, tint.g, tint.b, 0.14)
		for tile_index in lane.get("tiles", []):
			var index := int(tile_index)
			var tile_x := index % int(map_data.get("width", 96))
			var tile_z := int(index / int(map_data.get("width", 96)))
			draw_rect(_tile_rect(tile_x, tile_z), lane_color)
		var points: Array = lane.get("points", [])
		for point_index in range(points.size() - 1):
			var start: Array = points[point_index]
			var finish: Array = points[point_index + 1]
			draw_line(_tile_center(int(start[0]), int(start[1])), _tile_center(int(finish[0]), int(finish[1])), Color(tint.r, tint.g, tint.b, 0.32), maxf(1.0, _tile_size.x * 0.32), true)

func _draw_markers(markers: Array, color: Color, radius_factor: float, label: String) -> void:
	for marker in markers:
		var position := _tile_center(int(marker.get("tileX", 0)), int(marker.get("tileZ", 0)))
		draw_circle(position, maxf(1.5, _tile_size.x * radius_factor), color)
		_draw_map_label(label, position, color)

func _draw_entities(entities: Array) -> void:
	var by_id := {}
	for entity in entities:
		if entity is Dictionary:
			by_id[int(entity.get("id", -1))] = entity
	# Aim lines first, so shapes cover their ends. A projectile lives for one tick and a
	# snapshot arrives every second tick, so the aim line is what shows every shot.
	for entity in entities:
		if not entity is Dictionary:
			continue
		var kind := int(entity.get("kind", 0))
		var target_id := int(entity.get("targetId", 0))
		if target_id == 0 or (kind != GameLogic.KIND_TOWER and kind != KIND_HERO) or not by_id.has(target_id):
			continue
		var aim_tint := TEAM_BLUE if int(entity.get("team", -1)) == 0 else TEAM_RED
		draw_line(_world_center(entity), _world_center(by_id[target_id]), Color(aim_tint.r, aim_tint.g, aim_tint.b, 0.8), maxf(1.0, _tile_size.x * 0.18), true)

	for entity in entities:
		if not entity is Dictionary:
			continue
		var kind := int(entity.get("kind", 0))
		var center := _world_center(entity)
		var team := int(entity.get("team", -1))
		var tint := TEAM_BLUE if team == 0 else TEAM_RED
		if team < 0:
			tint = Color("#778493")
		if kind == KIND_PROJECTILE:
			var target: Dictionary = by_id.get(int(entity.get("targetId", 0)), {})
			var at := center if target.is_empty() else center.lerp(_world_center(target), 0.5)
			draw_circle(at, maxf(2.0, _tile_size.x * 0.22), Color.WHITE)
			continue
		var radius := maxf(2.2, _tile_size.x * 0.28)
		if kind == KIND_CORE:
			radius = maxf(4.0, _tile_size.x * 0.72)
			_draw_diamond(center, radius, tint)
		elif kind == KIND_BLOCKER:
			draw_rect(Rect2(center - Vector2(radius, radius), Vector2(radius * 2.0, radius * 2.0)), Color("#8391a0"))
		elif kind == KIND_HERO:
			radius *= 0.8
			draw_circle(center, radius, tint.lightened(0.24))
			draw_arc(center, radius + 1.8, 0.0, TAU, 16, Color.WHITE, 1.2)
		elif kind == KIND_CREEP:
			draw_circle(center, radius * 0.64, tint)
		elif kind == KIND_GROUND_ITEM or kind == KIND_LOOT_BAG:
			draw_circle(center, radius * 0.55, Color("#f5dc6b"))
		else:
			draw_rect(Rect2(center - Vector2(radius, radius), Vector2(radius * 2.0, radius * 2.0)), tint)
		if kind == GameLogic.KIND_TOWER:
			draw_circle(center + Vector2(0, -radius - 2.0), maxf(1.6, _tile_size.x * 0.2), ATTACK_COLORS.get(int(entity.get("attack", 0)), Color.WHITE))
		if int(entity.get("stunTicks", 0)) > 0:
			draw_arc(center, radius + 2.4, 0.0, TAU, 16, Color("#fff27a"), 1.6)
		var recycle := int(entity.get("recycle", 0))
		if recycle > 0:
			var done := 1.0 - float(recycle) / recycle_channel_ticks
			draw_arc(center, radius + 4.0, -PI / 2.0, -PI / 2.0 + TAU * done, 20, Color("#ffd76a"), 2.0)
		if int(entity.get("id", -1)) == selected_entity_id:
			draw_arc(center, radius + 3.0, 0.0, TAU, 20, Color("#fff2a8"), 1.5)
		var text := GameLogic.entity_text(entity, hp_factor)
		if not text.is_empty():
			_draw_map_label(text, center, tint.lightened(0.18))

## Waypoint paths: a line through the points and a dot on every point after the first.
func _draw_paths() -> void:
	for path in paths:
		var points: Array = path.points
		var color: Color = path.color
		for i in range(1, points.size()):
			var from: Vector2 = _bounds.position + points[i - 1] * _tile_size
			var to: Vector2 = _bounds.position + points[i] * _tile_size
			draw_line(from, to, Color(color.r, color.g, color.b, 0.85), maxf(1.0, _tile_size.x * 0.16), true)
			draw_circle(to, maxf(2.0, _tile_size.x * 0.3), color)

func _world_center(entity: Dictionary) -> Vector2:
	return _tile_center(float(entity.get("x", 0)) / GameLogic.UNITS_PER_TILE - 0.5, float(entity.get("z", 0)) / GameLogic.UNITS_PER_TILE - 0.5)

func _draw_map_label(text: String, center: Vector2, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var font_size := clampi(roundi(_tile_size.x * 2.0), 10, 18)
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	var label_size := text_size + Vector2(8, 4)
	var label_position := center + Vector2(-label_size.x * 0.5, _tile_size.y * 0.35)
	label_position.x = clampf(label_position.x, _bounds.position.x + 2.0, _bounds.end.x - label_size.x - 2.0)
	label_position.y = clampf(label_position.y, _bounds.position.y + 2.0, _bounds.end.y - label_size.y - 2.0)
	draw_rect(Rect2(label_position, label_size), Color("#09111d"))
	draw_string(font, label_position + Vector2(4, text_size.y + 2), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)

func _draw_selection_hint() -> void:
	if not selected_building.is_empty():
		var team_color := TEAM_BLUE if viewer_team == 0 else TEAM_RED
		draw_string(ThemeDB.fallback_font, Vector2(8, 18), "Tap a tile in your build zone", HORIZONTAL_ALIGNMENT_LEFT, -1, 13, team_color)

func _draw_zoom_controls() -> void:
	var origin := Vector2(size.x - 84, 8)
	for index in range(2):
		var rect := Rect2(origin + Vector2(index * 38, 0), Vector2(34, 34))
		draw_rect(rect, Color("#15263a"))
		draw_rect(rect, Color("#8ca9c8"), false, 1.0)
		draw_string(ThemeDB.fallback_font, rect.position + Vector2(11, 24), "+" if index == 0 else "−", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color.WHITE)

func _draw_diamond(center: Vector2, radius: float, color: Color) -> void:
	var points := PackedVector2Array([
		center + Vector2(0, -radius),
		center + Vector2(radius, 0),
		center + Vector2(0, radius),
		center + Vector2(-radius, 0),
	])
	draw_colored_polygon(points, color)

func _tile_rect(tile_x: int, tile_z: int) -> Rect2:
	return Rect2(_bounds.position + Vector2(tile_x, tile_z) * _tile_size, _tile_size)

func _tile_center(tile_x: float, tile_z: float) -> Vector2:
	return _bounds.position + (Vector2(tile_x, tile_z) + Vector2(0.5, 0.5)) * _tile_size

func _gui_input(event: InputEvent) -> void:
	var position: Vector2
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		position = event.position
		if _handle_zoom_control(position):
			accept_event()
			return
		_dragging = true
		_pointer_moved = false
		_last_pointer = position
		_press_position = position
		return
	elif event is InputEventMouseButton and not event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_dragging = false
		if not _pointer_moved:
			_handle_map_tap(event.position)
		return
	elif event is InputEventMouseMotion and _dragging and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		var delta: Vector2 = event.position - _last_pointer
		if _press_position.distance_squared_to(event.position) > 25.0:
			_pointer_moved = true
		if _pointer_moved:
			_pan_offset += delta
		_last_pointer = event.position
		queue_redraw()
		accept_event()
		return
	elif event is InputEventScreenTouch and event.pressed:
		position = event.position
		if _handle_zoom_control(position):
			accept_event()
			return
		_dragging = true
		_pointer_moved = false
		_last_pointer = position
		_press_position = position
		return
	elif event is InputEventScreenTouch and not event.pressed:
		_dragging = false
		if not _pointer_moved:
			_handle_map_tap(event.position)
		return
	elif event is InputEventScreenDrag and _dragging:
		var delta: Vector2 = event.position - _last_pointer
		if _press_position.distance_squared_to(event.position) > 25.0:
			_pointer_moved = true
		if _pointer_moved:
			_pan_offset += delta
		_last_pointer = event.position
		queue_redraw()
		accept_event()
		return
	else:
		return

func _handle_map_tap(position: Vector2) -> void:
	if not _bounds.has_point(position):
		return
	var ground := ground_at(position)
	# A finger is wider than a 6 px tile. Outside build mode, snap a tap near an entity onto it,
	# so the shared tap rules see the entity at the pick radius they know.
	# In build mode the tap is a tile choice, so it never snaps: a building goes exactly where the finger lands.
	var near := _entity_near(position) if selected_building.is_empty() else {}
	if not near.is_empty():
		ground = Vector2(float(near.get("x", 0)) / GameLogic.UNITS_PER_TILE, float(near.get("z", 0)) / GameLogic.UNITS_PER_TILE)
	tapped.emit(ground)

func _handle_zoom_control(position: Vector2) -> bool:
	var origin := Vector2(size.x - 84, 8)
	var plus_rect := Rect2(origin, Vector2(34, 34))
	var minus_rect := Rect2(origin + Vector2(38, 0), Vector2(34, 34))
	if plus_rect.has_point(position):
		_set_zoom(_zoom * 1.25)
		return true
	if minus_rect.has_point(position):
		_set_zoom(_zoom / 1.25)
		return true
	return false

func _set_zoom(value: float) -> void:
	var next_zoom := clampf(value, 1.0, 4.0)
	if is_equal_approx(next_zoom, _zoom):
		return
	var center := size * 0.5
	var tile_under_center := (center - _bounds.position) / _tile_size
	_zoom = next_zoom
	if is_equal_approx(_zoom, 1.0):
		_pan_offset = Vector2.ZERO
	else:
		var width := float(map_data.get("width", 96))
		var height := float(map_data.get("height", 112))
		var base_scale := minf((size.x - 24.0) / width, (size.y - 24.0) / height)
		var next_tile_size := base_scale * _zoom
		var map_size := Vector2(width, height) * next_tile_size
		_pan_offset = center - tile_under_center * next_tile_size - (size - map_size) * 0.5
	queue_redraw()

## The entity whose center is nearest to a screen point, within the touch radius, as
## GameLogic.pick_entity would choose it. Empty when none is close.
func _entity_near(position: Vector2) -> Dictionary:
	var best := {}
	var best_distance := INF
	var hit_radius := maxf(TOUCH_RADIUS_PIXELS, _tile_size.x * 0.55)
	for entity in snapshot.get("entities", []):
		if not entity is Dictionary or int(entity.get("kind", 0)) == KIND_PROJECTILE:
			continue
		var distance := position.distance_squared_to(_world_center(entity))
		if distance <= hit_radius * hit_radius and distance < best_distance:
			best = entity
			best_distance = distance
	return best
