extends Node3D
## Runs the 3D world and places the existing match interface over it.

const GameLogic = preload("res://scripts/game_logic.gd")
const MainScript = preload("res://scripts/main.gd")

const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")
const ATTACK_COLORS := {
	1: Color("#ff9f43"),
	2: Color("#2de2e6"),
	3: Color("#b26bff"),
}
const TEMPLATE_NAMES := [
	"Solar", "CreepRanged", "CreepArea", "CreepMelee", "LumenCore",
	"Wind", "Geothermal", "Nuclear", "TowerArea", "TowerMelee",
	"TowerRanged", "Barracks",
]

@onready var _terrain: MeshInstance3D = $Terrain
@onready var _camera: Camera3D = $Camera3D

var _map_root: Node3D
var _entity_root: Node3D
var _effect_root: Node3D
var _path_root: Node3D
var _templates: Dictionary = {}
var _entities_by_id: Dictionary = {}
var _layout: Dictionary = {}
var _snapshot: Dictionary = {}
var _hp_factor := {"core": 1, "default": 10}
var _hero_names: Array = []
var _item_names: Array = []
var _paths: Array = []
var _selected_entity_id := -1
var _map_width := 96
var _map_height := 112
var _camera_target := Vector3.ZERO
var _base_camera_size := 192.0
var _camera_initialized := false
## While true the camera eases toward the viewer's hero. Dragging the map turns it off.
var _following := false
var _viewer_team := 0
var _follow_point := Vector3.ZERO
var _has_follow_point := false

func _ready() -> void:
	_camera.current = true
	_camera.projection = Camera3D.PROJECTION_ORTHOGONAL
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
	for template_name in TEMPLATE_NAMES:
		var template := get_node_or_null(NodePath(template_name)) as MeshInstance3D
		if template != null:
			_templates[template_name] = template
			template.visible = false
	_terrain.visible = true
	_add_interface()
	_configure_map()

func _add_interface() -> void:
	var canvas := CanvasLayer.new()
	canvas.layer = 1
	add_child(canvas)
	var interface = MainScript.new()
	interface.configure_3d_world(self)
	interface.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	canvas.add_child(interface)

func set_balance(balance: Dictionary, heroes: Dictionary = {}, items: Dictionary = {}) -> void:
	if balance.has("hpFactor"):
		_hp_factor = balance.hpFactor
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
	_remember_hero_point()
	_render_entities()
	_render_paths()

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

func _process(delta: float) -> void:
	if _following and _has_follow_point:
		# Ease toward the hero, a little faster than it walks; the easing follows the frame time.
		_camera_target = _camera_target.lerp(_follow_point, 1.0 - exp(-minf(delta, 0.1) * 8.0))
		_position_camera()

func set_selection(entity_id: int) -> void:
	_selected_entity_id = entity_id
	_render_entities()

func set_paths(paths: Array) -> void:
	_paths = paths
	_render_paths()

func get_rendered_entity_count() -> int:
	return _entities_by_id.size()

func get_camera_size() -> float:
	return _camera.size

func get_camera_target() -> Vector3:
	return _camera_target

func camera_ray_origin(viewport_position: Vector2) -> Vector3:
	return _camera.project_ray_origin(viewport_position)

func camera_ray_direction(viewport_position: Vector2) -> Vector3:
	return _camera.project_ray_normal(viewport_position)

func pan_camera(screen_delta: Vector2) -> void:
	var viewport_height := maxf(1.0, get_viewport().get_visible_rect().size.y)
	var units_per_pixel := _camera.size / viewport_height
	_following = false
	var shift := (-_camera.global_basis.x * screen_delta.x - _camera.global_basis.y * screen_delta.y) * units_per_pixel
	shift.y = 0.0
	_camera_target += shift
	_camera_target.x = clampf(_camera_target.x, -float(_map_width) * 0.5, float(_map_width) * 0.5)
	_camera_target.z = clampf(_camera_target.z, -float(_map_height) * 0.5, float(_map_height) * 0.5)
	_position_camera()

func zoom_by(factor: float) -> void:
	_camera.size = clampf(_camera.size * factor, _base_camera_size * 0.25, _base_camera_size * 1.5)

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
	var viewport_size := get_viewport().get_visible_rect().size
	var aspect := viewport_size.x / maxf(1.0, viewport_size.y)
	_base_camera_size = maxf(float(_map_height) * 1.2, float(_map_width) / maxf(0.1, aspect)) * 1.08
	_camera.size = _base_camera_size
	_camera_target = Vector3.ZERO
	_position_camera()

func _position_camera() -> void:
	var distance := maxf(float(_map_height), float(_map_width)) * 1.5
	_camera.position = _camera_target + Vector3(0.0, distance, distance * 0.8)
	_camera.look_at(_camera_target, Vector3.UP)

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
			var tile_z := int(tile_index / _map_width)
			var position := Vector3(
				float(tile_x) + 0.5 - float(_map_width) * 0.5,
				0.035,
				float(tile_z) + 0.5 - float(_map_height) * 0.5
			)
			multi_mesh.set_instance_transform(index, Transform3D(Basis.IDENTITY, position))
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
	var model := MeshInstance3D.new()
	if template != null and template.mesh != null:
		model.mesh = template.mesh
		model.transform = Transform3D(template.transform.basis.scaled(Vector3.ONE * 3.5), Vector3.ZERO)
	else:
		model.mesh = _fallback_mesh(kind)
		model.scale = Vector3.ONE * (1.6 if kind == GameLogic.KIND_CORE else 0.7)
	var model_material := _flat_material(tint)
	model.material_override = model_material
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
					return "CreepMelee"
		_:
			return ""

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
