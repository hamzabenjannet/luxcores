extends Node3D
## Runs the 3D world and places the existing match interface over it.

const GameLogic = preload("res://scripts/game_logic.gd")
const MainScript = preload("res://scripts/main.gd")
const MinimapScript = preload("res://scripts/minimap_3d.gd")
const CREEP_MELEE_MODEL = preload("res://assets/CreepMeleeModelAsset.glb")

const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")
const ATTACK_COLORS := {
	1: Color("#ff9f43"),
	2: Color("#2de2e6"),
	3: Color("#b26bff"),
}
const TEMPLATE_NAMES := [
	"Solar", "CreepRanged", "CreepArea", "CreepMeleeModelAsset", "LumenCore",
	"Wind", "Geothermal", "Nuclear", "TowerArea", "TowerMelee",
	"TowerRanged", "Barracks",
]

@onready var _terrain: MeshInstance3D = $Terrain
@onready var _camera: Camera3D = $Camera3D
@onready var _rtscamera: Camera3D = $RTScamera
@onready var _sun: DirectionalLight3D = $DirectionalLight3D

const CAMERA_RTS := 0
const CAMERA_DEBUG := 1
const RTS_CAMERA_DEFAULT_DISTANCE := 25.0

var _map_root: Node3D
var _entity_root: Node3D
var _effect_root: Node3D
var _path_root: Node3D
var _minimap: Control
var _templates: Dictionary = {}
var _entities_by_id: Dictionary = {}
var _layout: Dictionary = {}
var _snapshot: Dictionary = {}
var _day_night := {"dayTicks": 800, "nightTicks": 400}
var _sun_tick := 0.0
var _sun_tick_target := 0.0
var _hp_factor := {"core": 1, "default": 10}
var _hero_names: Array = []
var _item_names: Array = []
var _paths: Array = []
var _selected_entity_id := -1
var _map_width := 96
var _map_height := 112
var _camera_target := Vector3.ZERO
var _camera_yaw := 0.0
var _camera_pitch := atan(1.0 / 0.8)
var _camera_yaw_target := 0.0
var _camera_pitch_target := atan(1.0 / 0.8)
## The camera size (vertical extent in world units) at zoom 1, which shows 32 tiles across and at least 28 tall (GDD 10.1).
var _view_size := 100.0
var _ghost: MeshInstance3D
## True once the camera was framed on the viewer's base, which needs the first real world.
var _fitted_to_world := false
var _aim_ring: MeshInstance3D
var _camera_initialized := false
var _camera_mode := CAMERA_RTS
## While true the camera eases toward the viewer's hero. Dragging the map turns it off.
var _following := false
var _viewer_team := 0
var _follow_point := Vector3.ZERO
var _has_follow_point := false

const VIEW_TILES_WIDE := 32.0
## A wide window shows at least this many tiles top to bottom at zoom 1, as in the web client.
const VIEW_TILES_TALL_MIN := 28.0
const CAMERA_ROTATION_STEP := deg_to_rad(5.0)
const CAMERA_ROTATION_SMOOTHING := 12.0
const CAMERA_PITCH_MIN := deg_to_rad(15.0)
const CAMERA_PITCH_MAX := deg_to_rad(75.0)

func _ready() -> void:
	_camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	_camera.current = false
	set_camera_mode(CAMERA_RTS)
	_map_root = Node3D.new()
	_map_root.name = "MapOverlays"
	add_child(_map_root)
	_entity_root = Node3D.new()
	_entity_root.name = "Entities"
	add_child(_entity_root)
	_effect_root = Node3D.new()
	_effect_root.name = "Effects"
	add_child(_effect_root)
	_path_root = Node3D.new()
	_path_root.name = "Paths"
	add_child(_path_root)
	_ghost = _marker_mesh(BoxMesh.new(), Color(0.3, 0.95, 0.63, 0.55))
	(_ghost.mesh as BoxMesh).size = Vector3(0.9, 0.6, 0.9)
	_aim_ring = _marker_mesh(CylinderMesh.new(), Color(1.0, 0.84, 0.42, 0.6))
	(_aim_ring.mesh as CylinderMesh).top_radius = 0.95
	(_aim_ring.mesh as CylinderMesh).bottom_radius = 0.95
	(_aim_ring.mesh as CylinderMesh).height = 0.05
	get_viewport().size_changed.connect(_on_viewport_resized)
	for template_name in TEMPLATE_NAMES:
		var template := get_node_or_null(NodePath(template_name)) as Node3D
		if template != null:
			_templates[template_name] = template
			template.visible = false
	_terrain.visible = true
	_add_interface()
	_configure_map()
	_update_sun(_sun_tick)

func _add_interface() -> void:
	var canvas := CanvasLayer.new()
	canvas.layer = 1
	add_child(canvas)
	var interface = MainScript.new()
	interface.configure_3d_world(self)
	interface.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	canvas.add_child(interface)
	_minimap = MinimapScript.new()
	_minimap.name = "RTSMinimap"
	_minimap.anchor_left = 0.0
	_minimap.anchor_right = 0.0
	_minimap.offset_left = 0.0
	_minimap.offset_right = 125.0
	_minimap.offset_top = 0.0
	_minimap.offset_bottom = 125.0
	_minimap.set_world_root(self)
	canvas.add_child(_minimap)

func set_balance(balance: Dictionary, heroes: Dictionary = {}, items: Dictionary = {}) -> void:
	if balance.has("hpFactor"):
		_hp_factor = balance.hpFactor
	var day_night: Variant = balance.get("dayNight")
	if day_night is Dictionary:
		_day_night = day_night
		_update_sun(_sun_tick)
	_hero_names = []
	for entry in heroes.get("roster", []):
		_hero_names.append(String(entry.name))
	_item_names = []
	for entry in items.get("list", []):
		_item_names.append(String(entry.name))

func set_world(layout: Dictionary, world_snapshot: Dictionary, team: int) -> void:
	var map_changed := layout != _layout
	_layout = layout
	_snapshot = world_snapshot
	var snapshot_tick := float(world_snapshot.get("tick", 0))
	if world_snapshot.is_empty() or snapshot_tick < _sun_tick_target:
		_sun_tick = snapshot_tick
	_sun_tick_target = snapshot_tick
	_viewer_team = team
	var next_width := int(layout.get("width", 96))
	var next_height := int(layout.get("height", 112))
	if next_width != _map_width or next_height != _map_height:
		_map_width = next_width
		_map_height = next_height
		_camera_initialized = false
		map_changed = true
	if map_changed:
		_configure_map()
	_update_sun(_sun_tick)
	if layout.is_empty():
		_fitted_to_world = false # the next match frames its own base
	elif not _fitted_to_world:
		_fitted_to_world = true
		_fit_camera()
	_remember_hero_point()
	_render_entities()
	_render_paths()
	if is_instance_valid(_minimap):
		_minimap.call("set_map_data", _layout, _snapshot, _camera_target)
		_minimap.visible = _camera_mode == CAMERA_RTS and not _layout.is_empty()
	_update_minimap()

## The ground point of the viewer's living hero, which the camera follows.
func _remember_hero_point() -> void:
	_has_follow_point = false
	for entity in _snapshot.get("entities", []):
		if int(entity.get("kind", 0)) == GameLogic.KIND_HERO and int(entity.get("owner", -1)) == _viewer_team and int(entity.get("hp", 0)) > 0:
			_follow_point = Vector3(
				float(entity.get("x", 0)) / GameLogic.UNITS_PER_TILE - float(_map_width) * 0.5, 0.0,
				float(entity.get("z", 0)) / GameLogic.UNITS_PER_TILE - float(_map_height) * 0.5)
			_has_follow_point = true
			return

func set_follow(on: bool) -> void:
	_following = on

func is_following() -> bool:
	return _following

func set_camera_mode(mode: int) -> void:
	if mode != CAMERA_RTS and mode != CAMERA_DEBUG:
		push_error("Unknown camera mode: %d." % mode)
		return
	_camera_mode = mode
	_rtscamera.current = mode == CAMERA_RTS
	_camera.current = mode == CAMERA_DEBUG
	_rtscamera.set_process(mode == CAMERA_RTS)
	_rtscamera.set_process_unhandled_input(mode == CAMERA_RTS)
	if is_instance_valid(_minimap):
		_minimap.visible = mode == CAMERA_RTS and not _layout.is_empty()
	if mode == CAMERA_RTS:
		_sync_rts_camera_target()
		_update_minimap()

func get_camera_mode() -> int:
	return _camera_mode

func _process(delta: float) -> void:
	if _snapshot.has("tick"):
		var sun_weight := 1.0 - exp(-minf(delta, 0.1) * 12.0)
		_sun_tick = lerpf(_sun_tick, _sun_tick_target, sun_weight)
		_update_sun(_sun_tick)
	if _camera_mode == CAMERA_RTS:
		if _following and _has_follow_point:
			_camera_target = _camera_target.lerp(_follow_point, 1.0 - exp(-minf(delta, 0.1) * 8.0))
			_sync_rts_camera_target()
		_update_minimap()
		return
	var camera_changed := false
	if _following and _has_follow_point:
		# Ease toward the hero, a little faster than it walks; the easing follows the frame time.
		_camera_target = _camera_target.lerp(_follow_point, 1.0 - exp(-minf(delta, 0.1) * 8.0))
		camera_changed = true
	var rotation_weight := 1.0 - exp(-minf(delta, 0.1) * CAMERA_ROTATION_SMOOTHING)
	if absf(angle_difference(_camera_yaw, _camera_yaw_target)) > 0.0001:
		_camera_yaw = lerp_angle(_camera_yaw, _camera_yaw_target, rotation_weight)
		camera_changed = true
	if absf(_camera_pitch - _camera_pitch_target) > 0.0001:
		_camera_pitch = lerpf(_camera_pitch, _camera_pitch_target, rotation_weight)
		camera_changed = true
	if camera_changed:
		_position_camera()

func _update_sun(tick: float) -> void:
	var day_ticks := maxi(1, int(_day_night.get("dayTicks", 800)))
	var night_ticks := maxi(1, int(_day_night.get("nightTicks", 400)))
	var cycle_ticks := day_ticks + night_ticks
	var cycle_tick := fposmod(tick, float(cycle_ticks))
	var phase: float
	if cycle_tick < day_ticks:
		phase = PI * cycle_tick / float(day_ticks)
	else:
		phase = PI + PI * (cycle_tick - day_ticks) / float(night_ticks)

	var sun_height := sin(phase)
	var orbit_radius := maxf(float(_map_width), float(_map_height)) * 0.65
	_sun.position = Vector3(
		cos(phase) * orbit_radius,
		sun_height * orbit_radius * 0.9,
		sin(phase) * orbit_radius
	)
	_sun.look_at(Vector3.ZERO, Vector3.UP)

	var daylight := smoothstep(-0.12, 0.28, sun_height)
	_sun.light_energy = 2.0 * daylight
	_sun.light_indirect_energy = 2.0 * daylight
	_sun.light_volumetric_fog_energy = 4.0 * daylight
	_sun.light_specular = 2.0 * daylight

func set_selection(entity_id: int) -> void:
	_selected_entity_id = entity_id
	_render_entities()

func set_paths(paths: Array) -> void:
	_paths = paths
	_render_paths()

func get_rendered_entity_count() -> int:
	return _entities_by_id.size()

func get_camera_size() -> float:
	return float(_rtscamera.get("orbit_distance")) if _camera_mode == CAMERA_RTS else _camera.size

func get_camera_target() -> Vector3:
	if _camera_mode == CAMERA_RTS:
		var target: Vector3 = _rtscamera.get("orbit_center")
		return target
	return _camera_target

func jump_camera_to_map_position(map_position: Vector2) -> void:
	if _camera_mode != CAMERA_RTS:
		return
	_following = false
	_camera_target = Vector3(
		clampf(map_position.x, 0.0, float(_map_width)) - float(_map_width) * 0.5,
		0.0,
		clampf(map_position.y, 0.0, float(_map_height)) - float(_map_height) * 0.5
	)
	_sync_rts_camera_target()
	_update_minimap()

func _update_minimap() -> void:
	if not is_instance_valid(_minimap):
		return
	_minimap.call("set_camera_target", get_camera_target())

func camera_ray_origin(viewport_position: Vector2) -> Vector3:
	return _active_camera().project_ray_origin(viewport_position)

func camera_ray_direction(viewport_position: Vector2) -> Vector3:
	return _active_camera().project_ray_normal(viewport_position)

func pan_camera(screen_delta: Vector2) -> void:
	var viewport_height := maxf(1.0, get_viewport().get_visible_rect().size.y)
	_following = false
	var units_per_pixel: float
	var basis: Basis
	if _camera_mode == CAMERA_RTS:
		var distance := float(_rtscamera.get("orbit_distance"))
		units_per_pixel = 2.0 * distance * tan(deg_to_rad(_rtscamera.fov) * 0.5) / viewport_height
		basis = _rtscamera.global_basis
	else:
		units_per_pixel = _camera.size / viewport_height
		basis = _camera.global_basis
	var shift := (-basis.x * screen_delta.x - basis.y * screen_delta.y) * units_per_pixel
	shift.y = 0.0
	_camera_target += shift
	_camera_target.x = clampf(_camera_target.x, -float(_map_width) * 0.5, float(_map_width) * 0.5)
	_camera_target.z = clampf(_camera_target.z, -float(_map_height) * 0.5, float(_map_height) * 0.5)
	_position_active_camera()

func rotate_camera(direction: Vector2) -> void:
	_following = false
	if _camera_mode == CAMERA_RTS:
		var yaw := float(_rtscamera.get("_yaw")) - direction.x * CAMERA_ROTATION_STEP
		var pitch := float(_rtscamera.get("_pitch")) - direction.y * CAMERA_ROTATION_STEP
		var min_pitch := deg_to_rad(float(_rtscamera.get("pitch_min_deg")))
		var max_pitch := deg_to_rad(float(_rtscamera.get("pitch_max_deg")))
		_rtscamera.set("_yaw", wrapf(yaw, -PI, PI))
		_rtscamera.set("_pitch", clampf(pitch, min_pitch, max_pitch))
		_rtscamera.call("_update_camera_position")
		return
	_camera_yaw_target = wrapf(_camera_yaw_target + direction.x * CAMERA_ROTATION_STEP, -PI, PI)
	_camera_pitch_target = clampf(_camera_pitch_target - direction.y * CAMERA_ROTATION_STEP, CAMERA_PITCH_MIN, CAMERA_PITCH_MAX)

## The zoom factor; 1 shows 32 tiles across. The limits are GameLogic.ZOOM_MIN and ZOOM_MAX.
func get_zoom() -> float:
	if _camera_mode == CAMERA_RTS:
		return RTS_CAMERA_DEFAULT_DISTANCE / float(_rtscamera.get("orbit_distance"))
	return _view_size / _camera.size

func set_zoom(zoom: float) -> void:
	if _camera_mode == CAMERA_RTS:
		var distance := RTS_CAMERA_DEFAULT_DISTANCE / GameLogic.clamp_zoom(zoom)
		distance = clampf(distance, float(_rtscamera.get("camera_zoom_min")), float(_rtscamera.get("camera_zoom_max")))
		_rtscamera.set("orbit_distance", distance)
		_rtscamera.call("_update_camera_position")
		return
	_camera.size = _view_size / GameLogic.clamp_zoom(zoom)

## Multiplies the view size by `factor`: below 1 zooms in.
func zoom_by(factor: float) -> void:
	set_zoom(get_zoom() / factor)

## A flat or boxy marker that draws over the world without lighting or depth, hidden until set.
func _marker_mesh(mesh: Mesh, color: Color) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.no_depth_test = true
	material.albedo_color = color
	instance.material_override = material
	instance.visible = false
	add_child(instance)
	return instance

## The build ghost: a translucent box on the tile, green when the building can go there and red when not.
func set_ghost(tile_x: int, tile_z: int, valid: bool) -> void:
	_ghost.visible = true
	_ghost.position = Vector3(float(tile_x) + 0.5 - float(_map_width) * 0.5, 0.3, float(tile_z) + 0.5 - float(_map_height) * 0.5)
	(_ghost.material_override as StandardMaterial3D).albedo_color = Color(0.3, 0.95, 0.63, 0.55) if valid else Color(1.0, 0.35, 0.35, 0.55)

func clear_ghost() -> void:
	_ghost.visible = false

func is_ghost_visible() -> bool:
	return _ghost.visible

## The aim ring of a held ability, at a ground point in tiles.
func set_aim(point: Vector2) -> void:
	_aim_ring.visible = true
	_aim_ring.position = Vector3(point.x - float(_map_width) * 0.5, 0.05, point.y - float(_map_height) * 0.5)

func clear_aim() -> void:
	_aim_ring.visible = false

func _on_viewport_resized() -> void:
	if not _camera_initialized:
		return
	var zoom := get_zoom()
	_view_size = _view_size_for_viewport()
	set_zoom(zoom)

func _view_size_for_viewport() -> float:
	var viewport_size := get_viewport().get_visible_rect().size
	return maxf(VIEW_TILES_WIDE * maxf(1.0, viewport_size.y) / maxf(1.0, viewport_size.x), VIEW_TILES_TALL_MIN)

func _configure_map() -> void:
	if not is_instance_valid(_terrain) or not is_instance_valid(_map_root):
		return
	_terrain.position = Vector3.ZERO
	_terrain.rotation = Vector3.ZERO
	_terrain.scale = Vector3(_map_width, 1.0, _map_height)
	for child in _map_root.get_children():
		_map_root.remove_child(child)
		child.queue_free()
	_add_zone_overlays()
	_add_lane_overlays()
	_add_map_markers("vents", Color("#4cf3c5"))
	_add_map_markers("itemSpawns", Color("#f7dc69"))
	if not _camera_initialized:
		_fit_camera()
		_camera_initialized = true

func _fit_camera() -> void:
	_view_size = _view_size_for_viewport()
	_camera.size = _view_size
	# Start on the viewer's three rows (Core row, build row, DMZ), as the web client does: z 80 for team 0, z 32 for team 1.
	var core_x := float(_map_width) * 0.5
	for entity in _snapshot.get("entities", []):
		if int(entity.get("kind", 0)) == GameLogic.KIND_CORE and int(entity.get("team", -1)) == _viewer_team:
			core_x = float(entity.get("x", 0)) / GameLogic.UNITS_PER_TILE
	# A wide window starts 8 tiles nearer the base, so the Core is not under the panel at the bottom (as in the web client).
	var viewport_size := get_viewport().get_visible_rect().size
	var nearer := 8.0 if viewport_size.x > viewport_size.y else 0.0
	_camera_target = Vector3(core_x - float(_map_width) * 0.5, 0.0, (80.0 + nearer if _viewer_team == 0 else 32.0 - nearer) - float(_map_height) * 0.5)
	_position_active_camera()

func _position_camera() -> void:
	var distance := maxf(float(_map_height), float(_map_width)) * 1.5
	var horizontal_distance := distance * 0.8
	var radius := sqrt(distance * distance + horizontal_distance * horizontal_distance)
	var horizontal_offset := radius * cos(_camera_pitch)
	_camera.position = _camera_target + Vector3(
		sin(_camera_yaw) * horizontal_offset,
		radius * sin(_camera_pitch),
		cos(_camera_yaw) * horizontal_offset
	)
	_camera.look_at(_camera_target, Vector3.UP)

func _position_active_camera() -> void:
	_position_camera()
	_sync_rts_camera_target()

func _sync_rts_camera_target() -> void:
	_rtscamera.set("orbit_center", _camera_target)
	_rtscamera.call("_update_camera_position")

func _active_camera() -> Camera3D:
	return _rtscamera if _camera_mode == CAMERA_RTS else _camera

func _add_zone_overlays() -> void:
	var bands := [
		{"team": 1, "parts": 2},
		{"team": 1, "parts": 1},
		{"team": -1, "parts": 1},
		{"team": 0, "parts": 1},
		{"team": 0, "parts": 2},
	]
	var part_height := float(_map_height) / 7.0
	var z := -float(_map_height) * 0.5
	for band in bands:
		var height := part_height * float(band.parts)
		var team := int(band.team)
		var tint := TEAM_BLUE if team == 0 else TEAM_RED if team == 1 else Color("#9aa7b5")
		var overlay := MeshInstance3D.new()
		var plane := PlaneMesh.new()
		plane.size = Vector2(float(_map_width), height)
		overlay.mesh = plane
		overlay.position = Vector3(0.0, 0.015, z + height * 0.5)
		overlay.material_override = _flat_material(Color(tint.r, tint.g, tint.b, 0.08))
		_map_root.add_child(overlay)
		z += height

func _add_lane_overlays() -> void:
	for lane in _layout.get("lanes", []):
		if not lane is Dictionary:
			continue
		var tiles: Array = lane.get("tiles", [])
		if tiles.is_empty():
			continue
		var team := int(lane.get("team", -1))
		var tint := TEAM_BLUE if team == 0 else TEAM_RED
		var mesh := PlaneMesh.new()
		mesh.size = Vector2(0.92, 0.92)
		var multi_mesh := MultiMesh.new()
		multi_mesh.transform_format = MultiMesh.TRANSFORM_3D
		multi_mesh.mesh = mesh
		multi_mesh.instance_count = tiles.size()
		for index in tiles.size():
			var tile_index := int(tiles[index])
			var tile_x := tile_index % _map_width
			@warning_ignore("integer_division")
			var tile_z := tile_index / _map_width
			var tile_center := Vector3(
				float(tile_x) + 0.5 - float(_map_width) * 0.5,
				0.035,
				float(tile_z) + 0.5 - float(_map_height) * 0.5
			)
			multi_mesh.set_instance_transform(index, Transform3D(Basis.IDENTITY, tile_center))
		var lane_mesh := MultiMeshInstance3D.new()
		lane_mesh.multimesh = multi_mesh
		lane_mesh.material_override = _flat_material(Color(tint.r, tint.g, tint.b, 0.22))
		_map_root.add_child(lane_mesh)

func _add_map_markers(key: String, tint: Color) -> void:
	for marker in _layout.get(key, []):
		if not marker is Dictionary:
			continue
		var mesh_instance := MeshInstance3D.new()
		var shape := CylinderMesh.new()
		shape.top_radius = 0.28
		shape.bottom_radius = 0.4
		shape.height = 0.16
		mesh_instance.mesh = shape
		mesh_instance.material_override = _flat_material(tint)
		mesh_instance.position = Vector3(
			float(marker.get("tileX", 0)) + 0.5 - float(_map_width) * 0.5,
			0.14,
			float(marker.get("tileZ", 0)) + 0.5 - float(_map_height) * 0.5
		)
		_map_root.add_child(mesh_instance)

func _render_entities() -> void:
	if not is_instance_valid(_entity_root) or not is_instance_valid(_effect_root):
		return
	for child in _entity_root.get_children():
		_entity_root.remove_child(child)
		child.queue_free()
	for child in _effect_root.get_children():
		_effect_root.remove_child(child)
		child.queue_free()
	_entities_by_id.clear()
	var entities: Array = _snapshot.get("entities", [])
	var by_id: Dictionary = {}
	for entity in entities:
		if not entity is Dictionary:
			continue
		var id := int(entity.get("id", -1))
		var node := _make_entity(entity)
		_entity_root.add_child(node)
		_entities_by_id[id] = node
		by_id[id] = entity
	_render_creep_group_labels(entities)
	_render_aim_lines(entities, by_id)

## One label per creep group, above the group's centroid, instead of one label per creep.
func _render_creep_group_labels(entities: Array) -> void:
	for group_label in GameLogic.creep_group_labels(entities, _hp_factor):
		var tint := TEAM_BLUE if int(group_label.team) == 0 else TEAM_RED
		var label := Label3D.new()
		label.text = String(group_label.text)
		label.position = Vector3(
			float(group_label.x) / GameLogic.UNITS_PER_TILE - float(_map_width) * 0.5, 2.3,
			float(group_label.z) / GameLogic.UNITS_PER_TILE - float(_map_height) * 0.5)
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = 32
		label.pixel_size = 0.01
		label.modulate = tint.lightened(0.22)
		_entity_root.add_child(label)

func _make_entity(entity: Dictionary) -> Node3D:
	var id := int(entity.get("id", -1))
	var kind := int(entity.get("kind", 0))
	var team := int(entity.get("team", -1))
	var tint := TEAM_BLUE if team == 0 else TEAM_RED if team == 1 else Color("#aab4bf")
	var x := float(entity.get("x", 0)) / GameLogic.UNITS_PER_TILE - float(_map_width) * 0.5
	var z := float(entity.get("z", 0)) / GameLogic.UNITS_PER_TILE - float(_map_height) * 0.5
	var anchor := Node3D.new()
	anchor.name = "Entity_%d" % id
	anchor.position = Vector3(x, 0.12, z)
	var template_name := _template_for(entity)
	var template := _templates.get(template_name) as MeshInstance3D
	if template_name == "CreepMeleeModelAsset":
		var melee_model := CREEP_MELEE_MODEL.instantiate() as Node3D
		melee_model.scale = Vector3.ONE * 0.5
		_tint_melee_model(melee_model, tint)
		anchor.add_child(melee_model)
	else:
		var model := MeshInstance3D.new()
		if template != null and template.mesh != null:
			model.mesh = template.mesh
			model.transform = Transform3D(template.transform.basis.scaled(Vector3.ONE * 3.5), Vector3.ZERO)
		else:
			model.mesh = _fallback_mesh(kind)
			model.scale = Vector3.ONE * (1.6 if kind == GameLogic.KIND_CORE else 0.7)
		model.material_override = _flat_material(tint)
		anchor.add_child(model)
	if kind == GameLogic.KIND_TOWER:
		_add_tower_marker(anchor, entity)
	if id == _selected_entity_id:
		_add_selection_marker(anchor, tint)
	var label_text := GameLogic.entity_text(entity, _hp_factor, _hero_names, _item_names) if kind != GameLogic.KIND_CREEP else ""
	if not label_text.is_empty():
		var label := Label3D.new()
		label.text = label_text
		label.position = Vector3(0.0, 2.1, 0.0)
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = 32
		label.pixel_size = 0.01
		label.modulate = tint.lightened(0.22)
		anchor.add_child(label)
	return anchor

func _template_for(entity: Dictionary) -> String:
	var kind := int(entity.get("kind", 0))
	match kind:
		GameLogic.KIND_CORE:
			return "LumenCore"
		GameLogic.KIND_SOLAR:
			return "Solar"
		GameLogic.KIND_WIND:
			return "Wind"
		GameLogic.KIND_GEOTHERMAL:
			return "Geothermal"
		GameLogic.KIND_NUCLEAR:
			return "Nuclear"
		GameLogic.KIND_BARRACKS:
			return "Barracks"
		GameLogic.KIND_TOWER:
			match int(entity.get("attack", 0)):
				1:
					return "TowerMelee"
				3:
					return "TowerArea"
				_:
					return "TowerRanged"
		GameLogic.KIND_CREEP:
			match int(entity.get("attack", 0)):
				2:
					return "CreepRanged"
				3:
					return "CreepArea"
				_:
					return "CreepMeleeModelAsset"
		_:
			return ""

func _tint_melee_model(model: Node3D, tint: Color) -> void:
	for node in model.find_children("*", "MeshInstance3D", true, false):
		var mesh_instance := node as MeshInstance3D
		if mesh_instance.mesh == null:
			continue
		for surface in mesh_instance.mesh.get_surface_count():
			var source_material := mesh_instance.get_active_material(surface) as StandardMaterial3D
			if source_material == null:
				mesh_instance.set_surface_override_material(surface, _flat_material(tint))
				continue
			var team_material := source_material.duplicate() as StandardMaterial3D
			team_material.albedo_color *= tint
			mesh_instance.set_surface_override_material(surface, team_material)

func _fallback_mesh(kind: int) -> Mesh:
	if kind == GameLogic.KIND_HERO:
		var hero := CapsuleMesh.new()
		hero.radius = 0.42
		hero.height = 1.6
		return hero
	if kind == GameLogic.KIND_PROJECTILE or kind == GameLogic.KIND_GROUND_ITEM:
		var orb := SphereMesh.new()
		orb.radius = 0.3
		orb.height = 0.6
		return orb
	if kind == GameLogic.KIND_LOOT_BAG or kind == GameLogic.KIND_BLOCKER:
		return BoxMesh.new()
	var default_mesh := CylinderMesh.new()
	default_mesh.top_radius = 0.65
	default_mesh.bottom_radius = 0.65
	default_mesh.height = 1.2
	return default_mesh

func _add_tower_marker(parent: Node3D, entity: Dictionary) -> void:
	var marker := MeshInstance3D.new()
	var cap := SphereMesh.new()
	cap.radius = 0.22
	cap.height = 0.44
	marker.mesh = cap
	marker.position = Vector3(0.0, 0.82, 0.0)
	marker.material_override = _flat_material(ATTACK_COLORS.get(int(entity.get("attack", 0)), Color.WHITE))
	parent.add_child(marker)

func _add_selection_marker(parent: Node3D, tint: Color) -> void:
	var marker := MeshInstance3D.new()
	var ring := TorusMesh.new()
	ring.inner_radius = 0.62
	ring.outer_radius = 0.76
	marker.mesh = ring
	marker.position.y = 0.08
	marker.material_override = _flat_material(tint.lightened(0.5))
	parent.add_child(marker)

func _render_aim_lines(entities: Array, by_id: Dictionary) -> void:
	var vertices: Array[Vector3] = []
	for entity in entities:
		if not entity is Dictionary:
			continue
		var kind := int(entity.get("kind", 0))
		if kind != GameLogic.KIND_TOWER and kind != GameLogic.KIND_HERO:
			continue
		var target_id := int(entity.get("targetId", 0))
		if target_id == 0 or not by_id.has(target_id):
			continue
		vertices.append(_entity_position(entity, 0.8))
		vertices.append(_entity_position(by_id[target_id], 0.8))
	if vertices.is_empty():
		return
	var mesh := ImmediateMesh.new()
	mesh.surface_begin(Mesh.PRIMITIVE_LINES, _flat_material(Color("#eaf4ff")))
	for vertex in vertices:
		mesh.surface_add_vertex(vertex)
	mesh.surface_end()
	var lines := MeshInstance3D.new()
	lines.mesh = mesh
	_effect_root.add_child(lines)

func _render_paths() -> void:
	if not is_instance_valid(_path_root):
		return
	for child in _path_root.get_children():
		child.queue_free()
	for path in _paths:
		if not path is Dictionary:
			continue
		var points: Array = path.get("points", [])
		var vertices: Array[Vector3] = []
		for index in range(1, points.size()):
			var from: Vector2 = points[index - 1]
			var to: Vector2 = points[index]
			vertices.append(Vector3(from.x - float(_map_width) * 0.5, 0.18, from.y - float(_map_height) * 0.5))
			vertices.append(Vector3(to.x - float(_map_width) * 0.5, 0.18, to.y - float(_map_height) * 0.5))
		if vertices.is_empty():
			continue
		var path_color: Color = path.get("color", Color("#fff2a8"))
		var mesh := ImmediateMesh.new()
		mesh.surface_begin(Mesh.PRIMITIVE_LINES)
		for vertex in vertices:
			mesh.surface_add_vertex(vertex)
		mesh.surface_end()
		var lines := MeshInstance3D.new()
		lines.mesh = mesh
		lines.material_override = _flat_material(path_color)
		_path_root.add_child(lines)

func _entity_position(entity: Dictionary, height: float) -> Vector3:
	return Vector3(
		float(entity.get("x", 0)) / GameLogic.UNITS_PER_TILE - float(_map_width) * 0.5,
		height,
		float(entity.get("z", 0)) / GameLogic.UNITS_PER_TILE - float(_map_height) * 0.5
	)

func _flat_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if color.a < 1.0:
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return material
