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
	var canvas_layer: CanvasLayer
	for child in scene.get_children():
		if child is CanvasLayer:
			canvas_layer = child
			break
	_check("menu overlay is present", canvas_layer != null, true)
	var touch_overlay: Control
	var game_page: Control
	if canvas_layer != null:
		var interface := canvas_layer.get_child(0) as Control
		var home := interface.get("_home") as Control
		touch_overlay = interface.get("_arena") as Control
		game_page = interface.get("_game") as Control
		_check("start menu is visible", home.visible, true)
		_check("3D touch overlay is active", touch_overlay.get_script() == load("res://scripts/arena_3d.gd"), true)
		_check("zoom buttons are present", touch_overlay.get("_plus_button") is Button and touch_overlay.get("_minus_button") is Button, true)

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
	var balance := {"hpFactor": {"core": 1, "default": 10}}
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
		var camera := scene.get_node("Camera3D") as Camera3D
		var viewport_position := camera.unproject_position(Vector3(0.5, 0.0, 0.5))
		var local_position := touch_overlay.get_global_transform_with_canvas().affine_inverse() * viewport_position
		touch_overlay.call("_handle_map_tap", local_position)
		_check("3D touch maps back to tile coordinates", taps.size() == 1, true)
		if not taps.is_empty():
			_check("3D touch preserves tile position", is_equal_approx(taps[0].x, 48.5) and is_equal_approx(taps[0].y, 56.5), true)

	var initial_size := float(scene.call("get_camera_size"))
	scene.call("zoom_by", 0.8)
	_check("camera zoom changes view size", float(scene.call("get_camera_size")) < initial_size, true)
	var initial_target: Vector3 = scene.call("get_camera_target")
	scene.call("pan_camera", Vector2(30, 20))
	_check("camera drag changes view target", scene.call("get_camera_target") != initial_target, true)
	var scene_camera := scene.get_node("Camera3D") as Camera3D
	var initial_camera_position := scene_camera.position
	if touch_overlay != null:
		scene.call("set_follow", true)
		var left_key := InputEventKey.new()
		left_key.physical_keycode = KEY_LEFT
		left_key.pressed = true
		touch_overlay.call("_unhandled_key_input", left_key)
		_check("left arrow rotates the camera", scene_camera.position != initial_camera_position, true)
		_check("camera rotation stops hero follow", bool(scene.call("is_following")), false)
		var position_after_left := scene_camera.position
		var up_key := InputEventKey.new()
		up_key.physical_keycode = KEY_UP
		up_key.pressed = true
		touch_overlay.call("_unhandled_key_input", up_key)
		_check("up arrow changes camera elevation", scene_camera.position != position_after_left, true)
		var right_key := InputEventKey.new()
		right_key.physical_keycode = KEY_RIGHT
		right_key.pressed = true
		touch_overlay.call("_unhandled_key_input", right_key)
		_check("right arrow rotates the camera back", scene_camera.position != position_after_left, true)
		var down_key := InputEventKey.new()
		down_key.physical_keycode = KEY_DOWN
		down_key.pressed = true
		touch_overlay.call("_unhandled_key_input", down_key)
		_check("down arrow reverses the elevation change", scene_camera.position.distance_to(initial_camera_position) < 0.001, true)

	print("%d checks, %d failed" % [_checks, _failures])
	scene.queue_free()
	quit(_failures)

func _check(name: String, actual: Variant, expected: Variant) -> void:
	_checks += 1
	if actual == expected:
		return
	_failures += 1
	printerr("FAIL %s\n  actual:   %s\n  expected: %s" % [name, str(actual), str(expected)])
