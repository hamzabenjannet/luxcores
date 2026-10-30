extends SceneTree
## Checks the main 3D scene, snapshot rendering and camera controls.

const ModelLibrary = preload("res://scripts/model_library.gd")
const TerrainScatter = preload("res://scripts/terrain_scatter.gd")

var _checks := 0
var _failures := 0

func _initialize() -> void:
	_run.call_deferred()

## The stable visual node of an entity, and whether it holds an imported model rather than a placeholder.
## A placeholder is the `MeshInstance3D` the scene builds itself, so no check reads a name from inside a model.
func _visual_of(scene: Node, id: int) -> Node3D:
	var entity := scene.get_node_or_null("Entities/Entity_%d" % id) as Node3D
	return entity.get_node_or_null(ModelLibrary.VISUAL_NAME) as Node3D if entity != null else null

func _is_model(visual: Node3D) -> bool:
	return visual != null and not (visual is MeshInstance3D) and not visual.find_children("*", "MeshInstance3D", true, false).is_empty()

func _run() -> void:
	var scene: Node = load("res://scenes/main3d.tscn").instantiate()
	root.add_child(scene)
	await process_frame
	_check("main scene is 3D", scene is Node3D, true)
	_check("terrain is present", scene.get_node_or_null("Terrain") is MeshInstance3D, true)
	_check("camera is present", scene.get_node_or_null("Camera3D") is Camera3D, true)
	_check("RTS camera is present", scene.get_node_or_null("RTScamera") is Camera3D, true)
	var sun := scene.get_node("DirectionalLight3D") as DirectionalLight3D
	_check("sun casts shadows", sun.shadow_enabled, true)
	scene.call("set_balance", {"dayNight": {"dayTicks": 8, "nightTicks": 4}})
	scene.call("_update_sun", 4.0)
	var noon_position := sun.position
	_check("daytime sun rises above the arena", noon_position.y > 0.0, true)
	_check("daytime sun aims toward the arena", (sun.global_basis * Vector3.FORWARD).normalized().dot((-sun.position).normalized()) > 0.99, true)
	_check("daytime sun reaches full strength", is_equal_approx(sun.light_energy, 2.0), true)
	scene.call("_update_sun", 10.0)
	_check("nighttime sun passes below the arena", sun.position.y < 0.0, true)
	_check("nighttime sun fades out", is_equal_approx(sun.light_energy, 0.0), true)
	_check("sun moves around the arena over the cycle", sun.position != noon_position, true)
	var canvas_layer: CanvasLayer
	for child in scene.get_children():
		if child is CanvasLayer:
			canvas_layer = child
			break
	_check("menu overlay is present", canvas_layer != null, true)
	var touch_overlay: Control
	var game_page: Control
	var game_interface: Control
	var minimap: Control = scene.get("_minimap") as Control
	_check("RTS minimap is 125 by 125 pixels at the top-left edge", minimap != null and minimap.size == Vector2(125.0, 125.0) and minimap.position == Vector2.ZERO, true)
	if canvas_layer != null:
		game_interface = canvas_layer.get_child(0) as Control
		var home := game_interface.get("_home") as Control
		touch_overlay = game_interface.get("_arena") as Control
		game_page = game_interface.get("_game") as Control
		_check("start menu is visible", home.visible, true)
		_check("3D touch overlay is active", touch_overlay.get_script() == load("res://scripts/arena_3d.gd"), true)
		_check("zoom buttons are present", touch_overlay.get("_plus_button") is Button and touch_overlay.get("_minus_button") is Button, true)
		_check("key settings overlay and button are available", game_interface.get("_key_settings_overlay") is Control and game_interface.get("_key_settings_button") is Button, true)
		var leave_button := game_interface.get("_leave_button") as Button
		var keys_button := game_interface.get("_key_settings_button") as Button
		var stats_label := game_interface.get("_world_label") as Label
		_check("KEYS sits directly to the right of LEAVE", keys_button.get_parent() == leave_button.get_parent() and keys_button.get_index() == leave_button.get_index() + 1, true)
		_check("KEYS stays out of the stats row", keys_button.get_parent() != stats_label.get_parent(), true)
		_check("match HUD buttons use compact sizes", leave_button.custom_minimum_size.y <= 36.0 and keys_button.custom_minimum_size.y <= 36.0, true)
		_check("match stats use compact text", stats_label.get_theme_font_size("font_size") <= 12, true)
		var camera_selector := game_interface.get("_camera_selector") as OptionButton
		_check("camera selector defaults to the RTS camera", camera_selector != null and camera_selector.selected == 0, true)
		_check("RTS camera is active by default", int(scene.call("get_camera_mode")) == 0 and (scene.get_node("RTScamera") as Camera3D).current, true)
		if camera_selector != null:
			camera_selector.item_selected.emit(1)
			_check("camera selector activates the debug camera", int(scene.call("get_camera_mode")) == 1 and (scene.get_node("Camera3D") as Camera3D).current, true)
			camera_selector.item_selected.emit(0)
			_check("camera selector restores the RTS camera", int(scene.call("get_camera_mode")) == 0 and (scene.get_node("RTScamera") as Camera3D).current, true)

	var entities: Array = []
	for kind in range(1, 14):
		entities.append({
			"id": kind,
			"kind": kind,
			"team": kind % 2,
			"x": 48000,
			"z": 56000,
			"hp": 10000,
			"attack": (kind % 3) + 1,
		})
	var balance := {
		"hpFactor": {"core": 1, "default": 10},
		"dayNight": {"dayTicks": 8, "nightTicks": 4},
	}
	var heroes := {"roster": [{"id": 1, "name": "Test Hero"}]}
	scene.call("set_balance", balance)
	if touch_overlay != null:
		touch_overlay.call("set_balance", balance, heroes)
		_check("3D overlay forwards balance and hero roster", scene.get("_hero_names"), ["Test Hero"])
	var layout := {
		"width": 96,
		"height": 112,
		"lanes": [],
		"vents": [],
		"itemSpawns": [],
	}
	var snapshot := {"entities": entities}
	if touch_overlay != null:
		touch_overlay.call("set_world", layout, snapshot, 0)
	else:
		scene.call("set_world", layout, snapshot, 0)
	if game_page != null:
		game_page.visible = true
	await process_frame
	_check("RTS minimap appears in RTS mode", minimap.visible, true)
	_check("all entity kinds render", int(scene.call("get_rendered_entity_count")), entities.size())
	# Every collector and the tower render an imported model under the stable node name, and the model keeps
	# its own materials with no team tint. No check names a node inside a model, so a replacement file with a
	# different hierarchy still passes.
	for building in [["Lumen Core", 1], ["Solar", 2], ["Wind", 3], ["Geothermal", 4], ["Nuclear", 5], ["Tower", 7], ["Blocker", 8], ["Loot bag", 13]]:
		var building_model := _visual_of(scene, int(building[1]))
		_check("%s uses its imported model" % String(building[0]), _is_model(building_model), true)
		if _is_model(building_model):
			var building_meshes := building_model.find_children("*", "MeshInstance3D", true, false)
			_check("%s carries no team tint" % String(building[0]), (building_meshes[0] as MeshInstance3D).get_surface_override_material(0) == null, true)
	var barracks_entity := _visual_of(scene, 6)
	var barracks_meshes := barracks_entity.find_children("*", "MeshInstance3D", true, false) if barracks_entity != null else []
	_check("Barracks uses the imported creep Barracks model", not barracks_meshes.is_empty(), true)
	if not barracks_meshes.is_empty():
		_check("Barracks carries no team tint", (barracks_meshes[0] as MeshInstance3D).get_surface_override_material(0) == null, true)
		var barracks_material := (barracks_meshes[0] as MeshInstance3D).get_active_material(0) as StandardMaterial3D
		_check("Barracks keeps its imported texture", barracks_material != null and barracks_material.albedo_texture != null, true)
	var melee_model := _visual_of(scene, 9)
	_check("melee creeps use the imported detailed model", _is_model(melee_model), true)
	if _is_model(melee_model):
		var melee_meshes := melee_model.find_children("*", "MeshInstance3D", true, false)
		_check("melee model contains its imported mesh", not melee_meshes.is_empty(), true)
		if not melee_meshes.is_empty():
			var surface_material := (melee_meshes[0] as MeshInstance3D).get_active_material(0) as StandardMaterial3D
			_check("melee creep keeps the imported texture", surface_material != null and surface_material.albedo_texture != null, true)
			_check("melee creep carries no team tint", surface_material != null and surface_material.albedo_color == Color.WHITE and (melee_meshes[0] as MeshInstance3D).get_surface_override_material(0) == null, true)
	var tower_visual := _visual_of(scene, 7)
	var tower_meshes := tower_visual.find_children("*", "MeshInstance3D", true, false) if tower_visual != null else []
	_check("buildings built from the scene meshes carry no team tint", not tower_meshes.is_empty() and (tower_meshes[0] as MeshInstance3D).material_override == null, true)
	# The ranged and area creeps and the four ground items each render their own imported model.
	var item_list: Array = []
	for item_name in ["Energy Boost", "Energy Grab", "Haste", "Sluggish"]:
		item_list.append({"id": item_list.size(), "name": item_name})
	scene.call("set_balance", balance, {}, {"list": item_list})
	var model_entities: Array = [
		{"id": 300, "kind": 9, "team": 0, "owner": 0, "x": 48000, "z": 56000, "hp": 10000, "attack": 2},
		{"id": 301, "kind": 9, "team": 0, "owner": 0, "x": 49000, "z": 56000, "hp": 10000, "attack": 3},
	]
	for item in item_list:
		model_entities.append({"id": 310 + int(item.id), "kind": 12, "team": -1, "owner": -1, "x": 48000, "z": 57000, "hp": 10000, "itemId": int(item.id) + 1})
	var marker_layout := layout.duplicate(true)
	marker_layout["vents"] = [{"tileX": 40, "tileZ": 60, "team": 0}]
	marker_layout["itemSpawns"] = [{"tileX": 44, "tileZ": 60}, {"tileX": 52, "tileZ": 60}]
	scene.call("set_world", marker_layout, {"entities": model_entities}, 0)
	await process_frame
	for model_case in [["ranged creep", 300], ["area creep", 301], ["Energy Boost", 310], ["Energy Grab", 311], ["Haste", 312], ["Sluggish", 313]]:
		var imported := _visual_of(scene, int(model_case[1]))
		_check("%s uses its imported model" % String(model_case[0]), _is_model(imported), true)
	var overlays := scene.get_node("MapOverlays")
	_check("the geothermal vent of the map renders its imported model", overlays.find_children("Vent_*", "Node3D", false, false).size(), 1)
	_check("every item spawn of the map renders its imported model", overlays.find_children("ItemSpawn_*", "Node3D", false, false).size(), 2)
	_check("each marker holds one imported model", overlays.find_children(ModelLibrary.VISUAL_NAME, "Node3D", true, false).size(), 3)

	var roster: Array = []
	for hero_name in ["Halo", "Prism", "Flare", "Aurora", "Corona"]:
		roster.append({"id": roster.size(), "name": hero_name})
	scene.call("set_balance", balance, {"roster": roster})
	var hero_entities: Array = []
	for hero_type in range(1, 7):
		hero_entities.append({"id": 200 + hero_type, "kind": 10, "team": 0, "owner": 0, "x": 48000, "z": 56000, "hp": 10000, "heroType": hero_type})
	scene.call("set_world", layout, {"entities": hero_entities}, 0)
	await process_frame
	var hero_files := ["hero01", "hero02", "hero03", "hero04", "hero05"]
	for index in hero_files.size():
		var hero_visual := _visual_of(scene, 201 + index)
		var hero_meshes := hero_visual.find_children("*", "MeshInstance3D", true, false) if hero_visual != null else []
		var hero_mesh := hero_meshes[0] as MeshInstance3D if not hero_meshes.is_empty() else null
		# The roster name maps to the file in the library, and the entity renders a model rather than the capsule.
		var hero_spec: Dictionary = ModelLibrary.hero_spec(String(roster[index].name))
		_check("%s maps to the %s model" % [roster[index].name, hero_files[index]], not hero_spec.is_empty() and String(hero_spec.scene.resource_path) == "res://assets/%s.glb" % hero_files[index], true)
		_check("%s renders that model" % roster[index].name, _is_model(hero_visual), true)
		var hero_material := hero_mesh.get_active_material(0) as StandardMaterial3D if hero_mesh != null else null
		_check("%s keeps its imported texture" % roster[index].name, hero_material != null and hero_material.albedo_texture != null, true)
		_check("%s carries no team tint" % roster[index].name, hero_material != null and hero_material.albedo_color == Color.WHITE, true)
	var unknown_hero := _visual_of(scene, 206) as MeshInstance3D
	_check("a hero type outside the roster keeps the capsule", unknown_hero != null and unknown_hero.mesh is CapsuleMesh, true)
	scene.call("set_balance", balance, heroes)
	scene.call("set_world", layout, snapshot, 0)
	await process_frame

	if touch_overlay != null:
		var taps: Array[Vector2] = []
		touch_overlay.tapped.connect(func(ground: Vector2) -> void: taps.append(ground))
		var camera := scene.get_node("RTScamera") as Camera3D
		var viewport_position := camera.unproject_position(Vector3(0.5, 0.0, 24.5))
		var local_position := touch_overlay.get_global_transform_with_canvas().affine_inverse() * viewport_position
		touch_overlay.call("_handle_map_tap", local_position)
		_check("3D touch maps back to tile coordinates", taps.size() == 1, true)
		if not taps.is_empty():
			_check("3D touch preserves tile position", is_equal_approx(taps[0].x, 48.5) and is_equal_approx(taps[0].y, 80.5), true)

	var initial_size := float(scene.call("get_camera_size"))
	scene.call("zoom_by", 0.8)
	_check("camera zoom changes view size", float(scene.call("get_camera_size")) < initial_size, true)
	var initial_target: Vector3 = scene.call("get_camera_target")
	scene.call("pan_camera", Vector2(30, 20))
	_check("camera drag changes view target", scene.call("get_camera_target") != initial_target, true)
	var rts_camera := scene.get_node("RTScamera")
	var viewport_rect := Rect2(Vector2.ZERO, Vector2(1280.0, 960.0))
	_check("RTS edge scroll moves left", rts_camera.call("_edge_scroll_movement", Vector2(0.0, 480.0), viewport_rect).x, -1.0)
	_check("RTS edge scroll moves right", rts_camera.call("_edge_scroll_movement", Vector2(1280.0, 480.0), viewport_rect).x, 1.0)
	_check("RTS edge scroll moves up", rts_camera.call("_edge_scroll_movement", Vector2(640.0, 0.0), viewport_rect).z, -1.0)
	_check("RTS edge scroll moves down", rts_camera.call("_edge_scroll_movement", Vector2(640.0, 960.0), viewport_rect).z, 1.0)
	scene.call("set_camera_mode", 0)
	var minimap_rect: Rect2 = minimap.call("_map_rect")
	_check("minimap map fills its window without padding", minimap_rect == Rect2(Vector2.ZERO, Vector2(125.0, 125.0)), true)
	minimap.call("_handle_map_click", minimap_rect.get_center())
	_check("minimap click jumps the RTS camera to that map point", scene.call("get_camera_target"), Vector3.ZERO)
	var rts_target_after_click: Vector3 = scene.call("get_camera_target")
	touch_overlay.call("_begin_pointer", Vector2.ZERO)
	touch_overlay.call("_move_pointer", Vector2(10.0, 0.0), false)
	_check("left dragging does not pan the RTS camera", scene.call("get_camera_target"), rts_target_after_click)
	scene.call("set_camera_mode", 1)
	_check("RTS minimap hides in debug mode", minimap.visible, false)
	var debug_target: Vector3 = scene.call("get_camera_target")
	touch_overlay.call("_begin_pointer", Vector2.ZERO)
	touch_overlay.call("_move_pointer", Vector2(10.0, 0.0))
	_check("left dragging pans the debug camera", scene.call("get_camera_target") != debug_target, true)
	var scene_camera := scene.get_node("Camera3D") as Camera3D
	var initial_camera_position := scene_camera.position
	if touch_overlay != null:
		scene.call("set_follow", true)
		var left_key := InputEventKey.new()
		left_key.physical_keycode = KEY_LEFT
		left_key.pressed = true
		touch_overlay.call("_unhandled_key_input", left_key)
		_advance_camera(scene)
		_check("left arrow rotates the camera", scene_camera.position != initial_camera_position, true)
		_check("camera rotation stops hero follow", bool(scene.call("is_following")), false)
		var position_after_left := scene_camera.position
		var up_key := InputEventKey.new()
		up_key.physical_keycode = KEY_UP
		up_key.pressed = true
		touch_overlay.call("_unhandled_key_input", up_key)
		_advance_camera(scene)
		_check("up arrow changes camera elevation", scene_camera.position != position_after_left, true)
		var right_key := InputEventKey.new()
		right_key.physical_keycode = KEY_RIGHT
		right_key.pressed = true
		touch_overlay.call("_unhandled_key_input", right_key)
		_advance_camera(scene)
		_check("right arrow rotates the camera back", scene_camera.position != position_after_left, true)
		var down_key := InputEventKey.new()
		down_key.physical_keycode = KEY_DOWN
		down_key.pressed = true
		touch_overlay.call("_unhandled_key_input", down_key)
		_advance_camera(scene)
		_check("down arrow reverses the elevation change", scene_camera.position.distance_to(initial_camera_position) < 0.1, true)
		var mouse_baseline := scene_camera.position
		var initial_zoom := float(touch_overlay.call("get_zoom"))
		var wheel_up := InputEventMouseButton.new()
		wheel_up.button_index = MOUSE_BUTTON_WHEEL_UP
		wheel_up.pressed = true
		touch_overlay.call("_gui_input", wheel_up)
		_check("mouse wheel zooms without rotating the camera", float(touch_overlay.call("get_zoom")) > initial_zoom and scene_camera.position == mouse_baseline, true)
		var wheel_down := InputEventMouseButton.new()
		wheel_down.button_index = MOUSE_BUTTON_WHEEL_DOWN
		wheel_down.pressed = true
		touch_overlay.call("_gui_input", wheel_down)
		_check("wheel down restores the previous zoom", is_equal_approx(float(touch_overlay.call("get_zoom")), initial_zoom), true)
		var middle_press := InputEventMouseButton.new()
		middle_press.button_index = MOUSE_BUTTON_MIDDLE
		middle_press.pressed = true
		touch_overlay.call("_gui_input", middle_press)
		var horizontal_mouse_drag := InputEventMouseMotion.new()
		horizontal_mouse_drag.relative = Vector2(30.0, 0.0)
		touch_overlay.call("_gui_input", horizontal_mouse_drag)
		_advance_camera(scene)
		_check("middle-button horizontal mouse movement orbits the camera", scene_camera.position != mouse_baseline, true)
		var position_after_horizontal_drag := scene_camera.position
		var vertical_mouse_drag := InputEventMouseMotion.new()
		vertical_mouse_drag.relative = Vector2(0.0, -20.0)
		touch_overlay.call("_gui_input", vertical_mouse_drag)
		_advance_camera(scene)
		_check("middle-button vertical mouse movement adjusts elevation", scene_camera.position != position_after_horizontal_drag, true)
		var middle_release := InputEventMouseButton.new()
		middle_release.button_index = MOUSE_BUTTON_MIDDLE
		middle_release.pressed = false
		touch_overlay.call("_gui_input", middle_release)
		var position_after_middle_drag := scene_camera.position
		var mouse_motion_after_release := InputEventMouseMotion.new()
		mouse_motion_after_release.relative = Vector2(30.0, -20.0)
		touch_overlay.call("_gui_input", mouse_motion_after_release)
		_advance_camera(scene)
		_check("mouse movement after middle-button release does not swivel", scene_camera.position == position_after_middle_drag, true)
		var position_before_pan := scene_camera.position
		var pan_gesture := InputEventPanGesture.new()
		pan_gesture.delta = Vector2(20.0, 0.0)
		touch_overlay.call("_gui_input", pan_gesture)
		_advance_camera(scene)
		_check("trackpad scrolling rotates the camera", scene_camera.position != position_before_pan, true)
		var position_before_pinch := scene_camera.position
		var pinch := InputEventMagnifyGesture.new()
		pinch.factor = 1.2
		touch_overlay.call("_gui_input", pinch)
		_check("trackpad pinch zooms without rotating the camera", float(touch_overlay.call("get_zoom")) != initial_zoom and scene_camera.position == position_before_pinch, true)

	if game_interface != null:
		game_interface.set("_data", {
			"buildings": {
				"solar": {"costLux": 1}, "wind": {"costLux": 1}, "geothermal": {"costLux": 1},
				"nuclear": {"costLux": 1}, "barracks": {"costLux": 1}, "tower": {"costLux": 1},
			},
			"balance": {"core": {"minLeftAfterSpendLux": 1}, "hpFactor": {"core": 1, "default": 10}},
			"abilities": {"templates": {
				"melee": {"costLux": 5}, "ranged": {"costLux": 5}, "area": {"costLux": 5}, "shield": {"costLux": 10},
			}},
			"items": {"list": [
				{"id": 0, "name": "Energy Boost", "target": "ownHeroOrBuilding", "effect": {"kind": "addLux"}},
				{"id": 1, "name": "Energy Grab", "target": "self", "effect": {"kind": "funnelMode"}},
				{"id": 2, "name": "Haste", "target": "self", "effect": {"kind": "attackSpeed"}},
				{"id": 3, "name": "Sluggish", "target": "enemyUnit", "effect": {"kind": "attackSpeed"}},
			]},
			"heroes": {"roster": [{"id": 1, "name": "Test Hero", "primary": "melee"}]},
		})
		game_interface.set("_current_snapshot", {
			"entities": [{"id": 100, "kind": 10, "owner": 0, "team": 0, "hp": 10000, "heroType": 1, "cd0": 0, "cd1": 0, "cd2": 0, "cd3": 0}],
			"players": [{"id": 0, "items": [1, 0, 0, 0], "funnelLux": 0}],
			"teams": [{"coreLux": 100000}],
			"orders": [],
			"groups": [],
		})
		game_interface.set("_role", "player")
		(game_interface.get("_game") as Control).visible = true
		var ranged_key := InputEventKey.new()
		ranged_key.physical_keycode = KEY_W
		ranged_key.pressed = true
		game_interface.call("_unhandled_key_input", ranged_key)
		_check("W hotkey enables ranged aim", int(game_interface.get("_ability")), 1)
		var item_key := InputEventKey.new()
		item_key.physical_keycode = KEY_1
		item_key.pressed = true
		game_interface.call("_unhandled_key_input", item_key)
		_check("1 hotkey enables Energy Boost targeting", int(game_interface.get("_item_aim")), 0)
		var ability_keys: Array = game_interface.get("_ability_keys")
		var original_melee_key := int(ability_keys[0])
		var original_ranged_key := int(ability_keys[1])
		var binding_buttons: Array = game_interface.get("_key_binding_buttons")
		game_interface.call("_open_key_settings")
		game_interface.call("_begin_key_capture", "abilities", 1, binding_buttons[1])
		var remap_key := InputEventKey.new()
		remap_key.physical_keycode = KEY_A
		remap_key.pressed = true
		game_interface.call("_input", remap_key)
		_check("settings remap the ranged slot", int(ability_keys[1]), KEY_A)
		game_interface.call("_begin_key_capture", "abilities", 0, binding_buttons[0])
		game_interface.call("_input", remap_key)
		_check("settings reject a duplicate key", int(ability_keys[0]), original_melee_key)
		var cancel_remap := InputEventKey.new()
		cancel_remap.physical_keycode = KEY_ESCAPE
		cancel_remap.pressed = true
		game_interface.call("_input", cancel_remap)
		ability_keys[1] = original_ranged_key
		game_interface.call("_save_key_bindings")
		game_interface.call("_refresh_key_binding_buttons")
		(game_interface.get("_key_settings_overlay") as Control).visible = false

	_check_terrain_toggle(scene, game_interface)
	_check_procedural_terrain(scene)
	_check_terrain_scatter(scene)

	print("%d checks, %d failed" % [_checks, _failures])
	scene.queue_free()
	quit(_failures)

func _check(name: String, actual: Variant, expected: Variant) -> void:
	_checks += 1
	if actual == expected:
		return
	_failures += 1
	printerr("FAIL %s\n  actual:   %s\n  expected: %s" % [name, str(actual), str(expected)])

func _advance_camera(scene: Node) -> void:
	for _frame in range(60):
		scene.call("_process", 1.0 / 60.0)


## A map with one straight mid lane, two Cores and one vent, which is enough to test every clearance rule of
## the ground and of the scenery. `reserved` holds the two build zones, as `main3d.gd` passes them.
func _test_layout() -> Dictionary:
	var map_width := 96
	var lane_tiles: Array = []
	for tile_z in range(20, 92):
		for tile_x in range(46, 50):
			lane_tiles.append(tile_z * map_width + tile_x)
	return {
		"width": map_width, "height": 112, "usedSeed": 4242,
		"lanes": [{"team": 0, "lane": "mid", "tiles": lane_tiles}],
		"cores": [{"team": 0, "tileX": 48, "tileZ": 96}, {"team": 1, "tileX": 48, "tileZ": 16}],
		"vents": [{"team": 0, "tileX": 20, "tileZ": 90}], "blockers": [], "itemSpawns": [],
	}

## The same map under another seed, which both the ground and the scenery must build differently.
func _other_seed_layout() -> Dictionary:
	var layout := _test_layout()
	layout.usedSeed = 99
	return layout

## The procedural ground: the noise-displaced mesh that replaced the flat plane. The checks drive the real
## `Terrain` node of the scene, so they cover the mesh, its material and the height the game reads.
func _check_procedural_terrain(scene: Node) -> void:
	var terrain := scene.get_node_or_null("Terrain") as MeshInstance3D
	_check("the terrain carries the procedural script", terrain != null \
		and terrain.get_script() == load("res://scripts/procedural_terrain.gd"), true)
	if terrain == null:
		return
	var layout := _test_layout()
	var map_width := int(layout.width)
	var map_height := int(layout.height)
	var reserved := [Vector2i(32, 47), Vector2i(64, 79)]
	terrain.call("configure", layout, reserved)
	_check("the node carries no scale of its own", terrain.scale, Vector3.ONE)
	var array_mesh := terrain.mesh as ArrayMesh
	var cells_per_tile := int(terrain.get("cells_per_tile"))
	_check("the terrain is a generated mesh", array_mesh != null and array_mesh.get_surface_count() == 1, true)
	if array_mesh == null:
		return
	var vertices: PackedVector3Array = array_mesh.surface_get_arrays(0)[ArrayMesh.ARRAY_VERTEX]
	_check("the mesh holds one vertex per terrain cell",
		vertices.size(), (map_width * cells_per_tile + 1) * (map_height * cells_per_tile + 1))
	var aabb := array_mesh.get_aabb()
	_check("the mesh spans the whole map",
		is_equal_approx(aabb.size.x, float(map_width)) and is_equal_approx(aabb.size.z, float(map_height)), true)
	var material := terrain.material_override as ShaderMaterial
	_check("the terrain shader colors the mesh", material != null \
		and material.shader == load("res://shaders/terrain.gdshader"), true)
	if material != null:
		_check("the gradient spans twice the tallest peak",
			float(material.get_shader_parameter("height")), float(terrain.get("peak_height")) * 2.0)
		_check("the shader reads a height gradient", material.get_shader_parameter("color_gradient") is GradientTexture1D, true)
		_check("the shader reads a normal map", material.get_shader_parameter("normal_map") is NoiseTexture2D, true)
	# Gameplay ground stays flat: a lane, both build zones and the ground around a Core.
	var flat_over_lanes := true
	for tile_index in layout.lanes[0].tiles:
		@warning_ignore("integer_division")
		if terrain.call("height_at", float(int(tile_index) % map_width) + 0.5, float(int(tile_index) / map_width) + 0.5) != 0.0:
			flat_over_lanes = false
	var flat_over_build_rows := true
	for rows in reserved:
		for tile_z in range(rows.x, rows.y + 1):
			for tile_x in map_width:
				if terrain.call("height_at", float(tile_x) + 0.5, float(tile_z) + 0.5) != 0.0:
					flat_over_build_rows = false
	var flat_over_cores := true
	for core in layout.cores:
		if terrain.call("height_at", float(core.tileX) + 0.5, float(core.tileZ) + 0.5) != 0.0:
			flat_over_cores = false
	_check("the ground stays flat over every lane", flat_over_lanes, true)
	_check("the ground stays flat over both build zones", flat_over_build_rows, true)
	_check("the ground stays flat under both Cores", flat_over_cores, true)
	# The open ground outside the lanes rises and falls, and no peak passes the limit.
	var peak_height := float(terrain.get("peak_height"))
	var highest := 0.0
	var lowest := 0.0
	var within_limits := true
	for tile_z in range(0, map_height, 2):
		for tile_x in range(0, map_width, 2):
			var height := float(terrain.call("height_at", float(tile_x) + 0.5, float(tile_z) + 0.5))
			highest = maxf(highest, height)
			lowest = minf(lowest, height)
			if absf(height) > peak_height:
				within_limits = false
	_check("mountains rise over the open ground", highest > peak_height * 0.4, true)
	_check("valleys fall below the base plane", lowest < -0.5, true)
	_check("no height passes the peak limit", within_limits, true)
	# One seed builds one terrain, and another seed builds another.
	var sample_points := [Vector2(8.5, 8.5), Vector2(80.5, 20.5), Vector2(16.5, 100.5), Vector2(88.5, 60.5)]
	var first: Array = []
	for point in sample_points:
		first.append(float(terrain.call("height_at", point.x, point.y)))
	terrain.call("configure", layout, reserved)
	var repeated: Array = []
	for point in sample_points:
		repeated.append(float(terrain.call("height_at", point.x, point.y)))
	_check("one seed builds one terrain", repeated, first)
	terrain.call("configure", _other_seed_layout(), reserved)
	var other: Array = []
	for point in sample_points:
		other.append(float(terrain.call("height_at", point.x, point.y)))
	_check("another seed builds another terrain", other != first, true)
	# The slope between the lane and the open ground is gradual, not a wall.
	terrain.call("configure", layout, reserved)
	var steepest := 0.0
	for tile_z in range(0, map_height, 4):
		var previous := float(terrain.call("height_at", 0.5, float(tile_z) + 0.5))
		for tile_x in range(1, map_width):
			var height := float(terrain.call("height_at", float(tile_x) + 0.5, float(tile_z) + 0.5))
			steepest = maxf(steepest, absf(height - previous))
			previous = height
	_check("the ground climbs no more than a tile per tile", steepest <= 1.0, true)
	terrain.call("configure", {}, [])

## The start-menu switch for the procedural terrain. The map here carries no layout, so the scatter stays
## bare whichever way the switch stands and no check loads the 165 MB of scans.
func _check_terrain_toggle(scene: Node, game_interface: Control) -> void:
	if game_interface == null:
		return
	var toggle := game_interface.get("_terrain_toggle") as CheckButton
	_check("the start menu offers the terrain switch", toggle != null, true)
	if toggle == null:
		return
	_check("the terrain switch names the feature", toggle.text, "Toggle auto terrain generation")
	_check("the terrain switch starts off", toggle.button_pressed, false)
	_check("the world starts with the terrain off", scene.call("is_auto_terrain_enabled"), false)
	toggle.button_pressed = true
	_check("the switch turns the terrain on", scene.call("is_auto_terrain_enabled"), true)
	var scatter_root := scene.get_node_or_null("Terrain3D/%s" % TerrainScatter.ROOT_NAME) as Node3D
	_check("a map with no layout stays bare with the terrain on", scatter_root != null and scatter_root.get_child_count() == 0, true)
	toggle.button_pressed = false
	_check("the switch turns the terrain off again", scene.call("is_auto_terrain_enabled"), false)

## The procedural terrain. The checks run on `TerrainScatter.plan`, which is pure, so none of them loads the
## 165 MB of scans; the scene check below only asks that the node the props go under exists.
func _check_terrain_scatter(scene: Node) -> void:
	_check("the scene holds a node for the terrain props", scene.get_node_or_null("Terrain3D") is Node3D, true)
	var scatter_root := scene.get_node_or_null("Terrain3D/%s" % TerrainScatter.ROOT_NAME) as Node3D
	_check("the empty map between matches stays bare", scatter_root != null and scatter_root.get_child_count() == 0, true)
	for prop in TerrainScatter.PROP_NAMES:
		_check("%s names a model the library can place" % prop, not ModelLibrary.TERRAIN_MODELS.get(prop, {}).is_empty(), true)
		var rules: Dictionary = TerrainScatter.PROP_RULES.get(prop, {})
		_check("%s keeps its mound inside its footprint" % prop, float(rules.mound_radius) <= float(rules.footprint) * 0.5, true)
	_check("the desert rocks are gone from the library", ModelLibrary.TERRAIN_MODELS.has("rocks_in_a_desert"), false)
	_check("the library and the tiling rules name the same props",
		TerrainScatter.PROP_NAMES.size(), ModelLibrary.TERRAIN_MODELS.size())
	var layout := _test_layout()
	var map_width := int(layout.width)
	var map_height := int(layout.height)
	var lane_tiles: Array = layout.lanes[0].tiles
	var reserved := [Vector2i(32, 47), Vector2i(64, 79)]
	var plan := TerrainScatter.plan(layout, reserved)
	# A tiled map fills its open ground: a sparse scatter of a dozen props would fail this.
	_check("the tiling fills the open ground with props", plan.size() > 40, true)
	_check("one seed plans one tiling", JSON.stringify(TerrainScatter.plan(layout, reserved)), JSON.stringify(plan))
	_check("another seed plans another tiling",
		JSON.stringify(TerrainScatter.plan(_other_seed_layout(), reserved)) != JSON.stringify(plan), true)
	var counts := {}
	var triangles := 0
	var clear_of_lanes := true
	var clear_of_cores := true
	var clear_of_build_rows := true
	var inside_the_map := true
	var same_kind_apart := true
	for index in plan.size():
		var entry: Dictionary = plan[index]
		var radius := float(entry.radius)
		counts[entry.prop] = int(counts.get(entry.prop, 0)) + 1
		triangles += int(TerrainScatter.PROP_RULES[entry.prop].triangles)
		if entry.x - radius < 0.0 or entry.x + radius > float(map_width) \
				or entry.z - radius < 0.0 or entry.z + radius > float(map_height):
			inside_the_map = false
		for tile_index in lane_tiles:
			@warning_ignore("integer_division")
			var lane_point := Vector2(float(int(tile_index) % map_width) + 0.5, float(int(tile_index) / map_width) + 0.5)
			if lane_point.distance_to(Vector2(entry.x, entry.z)) < radius + float(TerrainScatter.LANE_CLEARANCE):
				clear_of_lanes = false
		for core in layout.cores:
			if Vector2(float(core.tileX) + 0.5, float(core.tileZ) + 0.5).distance_to(Vector2(entry.x, entry.z)) \
					< radius + float(TerrainScatter.CORE_CLEARANCE):
				clear_of_cores = false
		for rows in reserved:
			if entry.z + radius >= float(rows.x) and entry.z - radius <= float(rows.y) + 1.0:
				clear_of_build_rows = false
		for other_index in range(index + 1, plan.size()):
			var other: Dictionary = plan[other_index]
			if String(entry.prop) != String(other.prop):
				continue
			if Vector2(entry.x, entry.z).distance_to(Vector2(other.x, other.z)) \
					< float(TerrainScatter.PROP_RULES[entry.prop].same_kind_gap):
				same_kind_apart = false
	_check("every prop stays on the map", inside_the_map, true)
	_check("no prop reaches a lane", clear_of_lanes, true)
	_check("no prop reaches a Core", clear_of_cores, true)
	_check("no prop reaches a build zone", clear_of_build_rows, true)
	_check("two props of one kind keep their own gap", same_kind_apart, true)
	_check("the triangle budget holds", triangles <= TerrainScatter.TRIANGLE_BUDGET, true)
	var over_cap := false
	var kinds_used := 0
	for prop in TerrainScatter.PROP_NAMES:
		if int(counts.get(prop, 0)) > int(TerrainScatter.PROP_RULES[prop].max_count):
			over_cap = true
		if int(counts.get(prop, 0)) > 0:
			kinds_used += 1
	_check("no prop passes its own cap", over_cap, false)
	_check("the tiling mixes several models", kinds_used >= 4, true)
	# The ground the props imply: flat where the game is played, raised only where a prop stands.
	var flat_over_lanes := true
	for tile_index in lane_tiles:
		@warning_ignore("integer_division")
		if TerrainScatter.plan_height_at(plan, float(int(tile_index) % map_width) + 0.5, float(int(tile_index) / map_width) + 0.5) != 0.0:
			flat_over_lanes = false
	var flat_over_build_rows := true
	for rows in reserved:
		for tile_z in range(rows.x, rows.y + 1):
			for tile_x in map_width:
				if TerrainScatter.plan_height_at(plan, float(tile_x) + 0.5, float(tile_z) + 0.5) != 0.0:
					flat_over_build_rows = false
	_check("the ground stays flat over every lane", flat_over_lanes, true)
	_check("the ground stays flat over both build zones", flat_over_build_rows, true)
	var mound := 0.0
	for entry in plan:
		mound = maxf(mound, TerrainScatter.plan_height_at(plan, float(entry.x), float(entry.z)))
	_check("the ground rises under the props", mound > 0.0, true)
	_check("the ground falls back to zero over the middle lane", TerrainScatter.plan_height_at(plan, 48.0, 56.0), 0.0)
