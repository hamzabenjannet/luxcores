extends SceneTree
## Checks the main 3D scene, snapshot rendering and camera controls.

var _checks := 0
var _failures := 0

func _initialize() -> void:
	_run.call_deferred()

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
	var melee_entity := scene.get_node_or_null("Entities/Entity_9") as Node3D
	var melee_model := melee_entity.find_child("target_character", true, false) if melee_entity != null else null
	_check("melee creeps use the imported detailed model", melee_model is Node3D, true)
	if melee_model is Node3D:
		var melee_meshes := melee_model.find_children("*", "MeshInstance3D", true, false)
		_check("melee model contains its imported mesh", not melee_meshes.is_empty(), true)
		if not melee_meshes.is_empty():
			var surface_material := (melee_meshes[0] as MeshInstance3D).get_active_material(0) as StandardMaterial3D
			_check("team tint keeps the imported texture", surface_material != null and surface_material.albedo_texture != null, true)
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
