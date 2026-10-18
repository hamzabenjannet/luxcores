extends Control
## Captures map gestures and sends their ground coordinates to the shared rules.

signal tapped(ground: Vector2)

const DRAG_THRESHOLD_SQUARED := 25.0
const ZOOM_FACTOR := 1.25

var _world_root: Node3D
var _map: Dictionary = {}
var _dragging := false
var _pointer_moved := false
var _last_pointer := Vector2.ZERO
var _press_position := Vector2.ZERO
var _plus_button: Button
var _minus_button: Button
var draw_count := 0

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true
	_build_zoom_buttons()

func set_world_root(world: Node3D) -> void:
	_world_root = world

func set_balance(balance: Dictionary, heroes: Dictionary = {}, items: Dictionary = {}) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_balance", balance, heroes, items)

func set_world(layout: Dictionary, world_snapshot: Dictionary, _team: int) -> void:
	_map = layout
	draw_count += 1
	if is_instance_valid(_world_root):
		_world_root.call("set_world", layout, world_snapshot, _team)

## The camera follows the viewer's hero while this is on. Dragging the map turns it off.
func set_follow(on: bool) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_follow", on)

func is_following() -> bool:
	return is_instance_valid(_world_root) and bool(_world_root.call("is_following"))

func set_selection(_building: String, entity_id: int = -1) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_selection", entity_id)

func set_paths(paths: Array) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_paths", paths)

func _build_zoom_buttons() -> void:
	_plus_button = Button.new()
	_plus_button.text = "+"
	_plus_button.tooltip_text = "Zoom in"
	_plus_button.focus_mode = Control.FOCUS_NONE
	_plus_button.custom_minimum_size = Vector2(44, 44)
	_plus_button.anchor_left = 1.0
	_plus_button.anchor_right = 1.0
	_plus_button.offset_left = -98.0
	_plus_button.offset_right = -52.0
	_plus_button.offset_top = 8.0
	_plus_button.offset_bottom = 54.0
	_plus_button.pressed.connect(_zoom_in)
	add_child(_plus_button)

	_minus_button = Button.new()
	_minus_button.text = "−"
	_minus_button.tooltip_text = "Zoom out"
	_minus_button.focus_mode = Control.FOCUS_NONE
	_minus_button.custom_minimum_size = Vector2(44, 44)
	_minus_button.anchor_left = 1.0
	_minus_button.anchor_right = 1.0
	_minus_button.offset_left = -48.0
	_minus_button.offset_right = -2.0
	_minus_button.offset_top = 8.0
	_minus_button.offset_bottom = 54.0
	_minus_button.pressed.connect(_zoom_out)
	add_child(_minus_button)

func _zoom_in() -> void:
	if is_instance_valid(_world_root):
		_world_root.call("zoom_by", 1.0 / ZOOM_FACTOR)

func _zoom_out() -> void:
	if is_instance_valid(_world_root):
		_world_root.call("zoom_by", ZOOM_FACTOR)

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_begin_pointer(event.position)
		else:
			_end_pointer(event.position)
		accept_event()
		return
	if event is InputEventMouseMotion and _dragging and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		_move_pointer(event.position)
		accept_event()
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			_begin_pointer(event.position)
		else:
			_end_pointer(event.position)
		accept_event()
		return
	if event is InputEventScreenDrag and _dragging:
		_move_pointer(event.position)
		accept_event()

func _begin_pointer(position: Vector2) -> void:
	_dragging = true
	_pointer_moved = false
	_last_pointer = position
	_press_position = position

func _end_pointer(position: Vector2) -> void:
	_dragging = false
	if not _pointer_moved:
		_handle_map_tap(position)

func _move_pointer(position: Vector2) -> void:
	var delta := position - _last_pointer
	if _press_position.distance_squared_to(position) > DRAG_THRESHOLD_SQUARED:
		_pointer_moved = true
	if _pointer_moved and is_instance_valid(_world_root):
		var viewport_delta := get_global_transform_with_canvas().basis_xform(delta)
		_world_root.call("pan_camera", viewport_delta)
	_last_pointer = position

func _handle_map_tap(position: Vector2) -> void:
	if _map.is_empty() or not is_instance_valid(_world_root):
		return
	var viewport_position := get_global_transform_with_canvas() * position
	var ray_origin: Vector3 = _world_root.call("camera_ray_origin", viewport_position)
	var ray_direction: Vector3 = _world_root.call("camera_ray_direction", viewport_position)
	if is_zero_approx(ray_direction.y):
		return
	var distance := -ray_origin.y / ray_direction.y
	if distance < 0.0:
		return
	var point := ray_origin + ray_direction * distance
	var ground := Vector2(
		point.x + float(_map.get("width", 96)) * 0.5,
		point.z + float(_map.get("height", 112)) * 0.5
	)
	tapped.emit(ground)
