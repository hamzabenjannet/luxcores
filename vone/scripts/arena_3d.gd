extends Control
## Captures map gestures and sends their ground coordinates to the shared rules.

signal tapped(ground: Vector2)

const GameLogic = preload("res://scripts/game_logic.gd")

const DRAG_THRESHOLD_SQUARED := 25.0
const ZOOM_FACTOR := 1.25
const CAMERA_ROTATION_PER_PIXEL := 0.02

var _world_root: Node3D
var _map: Dictionary = {}
var _dragging := false
var _rotating_camera := false
var _pointer_moved := false
var _last_pointer := Vector2.ZERO
var _press_position := Vector2.ZERO
var _plus_button: Button
var _minus_button: Button
var draw_count := 0
## Fingers on the screen by touch index, at their latest position, and the pinch they make.
var _touches := {}
var _pinch_distance := 0.0
var _pinch_zoom := 1.0

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
	# The zoom buttons sit on the right edge, in the middle, clear of the panels at the top and bottom.
	_plus_button.anchor_left = 1.0
	_plus_button.anchor_right = 1.0
	_plus_button.anchor_top = 0.5
	_plus_button.anchor_bottom = 0.5
	_plus_button.offset_left = -58.0
	_plus_button.offset_right = -12.0
	_plus_button.offset_top = -52.0
	_plus_button.offset_bottom = -6.0
	_plus_button.pressed.connect(_zoom_in)
	add_child(_plus_button)

	_minus_button = Button.new()
	_minus_button.text = "−"
	_minus_button.tooltip_text = "Zoom out"
	_minus_button.focus_mode = Control.FOCUS_NONE
	_minus_button.custom_minimum_size = Vector2(44, 44)
	_minus_button.anchor_left = 1.0
	_minus_button.anchor_right = 1.0
	_minus_button.anchor_top = 0.5
	_minus_button.anchor_bottom = 0.5
	_minus_button.offset_left = -58.0
	_minus_button.offset_right = -12.0
	_minus_button.offset_top = 6.0
	_minus_button.offset_bottom = 52.0
	_minus_button.pressed.connect(_zoom_out)
	add_child(_minus_button)

func _zoom_in() -> void:
	if is_instance_valid(_world_root):
		_world_root.call("zoom_by", 1.0 / ZOOM_FACTOR)

func _zoom_out() -> void:
	if is_instance_valid(_world_root):
		_world_root.call("zoom_by", ZOOM_FACTOR)

## The zoom factor of the world; 1 shows 32 tiles across.
func get_zoom() -> float:
	return float(_world_root.call("get_zoom")) if is_instance_valid(_world_root) else 1.0

func set_zoom(zoom: float) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_zoom", zoom)

## The build ghost on a tile (green when valid), or none.
func set_ghost(tile: Vector2i, valid: bool) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_ghost", tile.x, tile.y, valid)

func clear_ghost() -> void:
	if is_instance_valid(_world_root):
		_world_root.call("clear_ghost")

## The aim ring of a held ability at a ground point in tiles, or none.
func set_aim(point: Vector2) -> void:
	if is_instance_valid(_world_root):
		_world_root.call("set_aim", point)

func clear_aim() -> void:
	if is_instance_valid(_world_root):
		_world_root.call("clear_aim")

## The ground point in tiles under a point of the whole window (global canvas coordinates), or an
## empty Dictionary when the view does not look at the ground there.
func ground_at_global(global_point: Vector2) -> Dictionary:
	var ground = _ground_at(get_global_transform_with_canvas().affine_inverse() * global_point)
	return {} if ground == null else {"ground": ground}

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMagnifyGesture:
		# A trackpad pinch: the factor is the change of the finger distance since the last event.
		set_zoom(GameLogic.pinch_zoom(get_zoom(), 1.0, event.factor))
		accept_event()
		return
	if event is InputEventPanGesture:
		# Trackpad scrolling rotates the view; magnify gestures above remain zoom.
		if is_instance_valid(_world_root):
			_world_root.call("rotate_camera", event.delta * CAMERA_ROTATION_PER_PIXEL)
		accept_event()
		return
	if event is InputEventMouseButton and event.pressed:
		match event.button_index:
			MOUSE_BUTTON_WHEEL_UP:
				set_zoom(GameLogic.pinch_zoom(get_zoom(), 1.0, 1.1))
			MOUSE_BUTTON_WHEEL_DOWN:
				set_zoom(GameLogic.pinch_zoom(get_zoom(), 1.0, 1.0 / 1.1))
		if event.button_index == MOUSE_BUTTON_WHEEL_UP or event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			accept_event()
			return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_MIDDLE:
		_rotating_camera = event.pressed
		accept_event()
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_begin_pointer(event.position)
		else:
			_end_pointer(event.position)
		accept_event()
		return
	if event is InputEventMouseMotion and _rotating_camera:
		if is_instance_valid(_world_root):
			_world_root.call("rotate_camera", event.relative * CAMERA_ROTATION_PER_PIXEL)
		accept_event()
		return
	if event is InputEventMouseMotion and _dragging and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		var allow_pan := is_instance_valid(_world_root) and int(_world_root.call("get_camera_mode")) == 1
		_move_pointer(event.position, allow_pan)
		accept_event()
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
			if _touches.size() == 2:
				# A second finger turns the press into a pinch: no tap and no pan from here on.
				_dragging = false
				_pointer_moved = true
				_pinch_distance = _finger_distance()
				_pinch_zoom = get_zoom()
			elif _touches.size() == 1:
				_begin_pointer(event.position)
		else:
			_touches.erase(event.index)
			if _touches.size() < 2:
				_pinch_distance = 0.0
			# The last finger up ends the gesture. After a pinch it is no tap, because the pinch set _pointer_moved.
			if _touches.is_empty():
				_end_pointer(event.position)
		accept_event()
		return
	if event is InputEventScreenDrag:
		_touches[event.index] = event.position
		if _pinch_distance > 0.0 and _touches.size() >= 2:
			set_zoom(GameLogic.pinch_zoom(_pinch_zoom, _pinch_distance, _finger_distance()))
		elif _dragging:
			_move_pointer(event.position)
		accept_event()

func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	if is_instance_valid(_world_root) and int(_world_root.call("get_camera_mode")) == 0:
		return
	var direction := Vector2.ZERO
	match event.physical_keycode:
		KEY_LEFT:
			direction.x = -1.0
		KEY_RIGHT:
			direction.x = 1.0
		KEY_UP:
			direction.y = -1.0
		KEY_DOWN:
			direction.y = 1.0
	if not direction.is_zero_approx() and is_instance_valid(_world_root):
		_world_root.call("rotate_camera", direction)
		accept_event()

func _finger_distance() -> float:
	var points: Array = _touches.values()
	return (points[0] as Vector2).distance_to(points[1] as Vector2)

func _begin_pointer(point: Vector2) -> void:
	_dragging = true
	_pointer_moved = false
	_last_pointer = point
	_press_position = point

func _end_pointer(point: Vector2) -> void:
	_dragging = false
	if not _pointer_moved:
		_handle_map_tap(point)

func _move_pointer(point: Vector2, allow_pan: bool = true) -> void:
	var delta := point - _last_pointer
	if _press_position.distance_squared_to(point) > DRAG_THRESHOLD_SQUARED:
		_pointer_moved = true
	if allow_pan and _pointer_moved and is_instance_valid(_world_root):
		var viewport_delta := get_global_transform_with_canvas().basis_xform(delta)
		_world_root.call("pan_camera", viewport_delta)
	_last_pointer = point

## The ground point in tiles under a point of this control, or null when the ray misses the ground.
func _ground_at(local_point: Vector2) -> Variant:
	if _map.is_empty() or not is_instance_valid(_world_root):
		return null
	var viewport_position := get_global_transform_with_canvas() * local_point
	var ray_origin: Vector3 = _world_root.call("camera_ray_origin", viewport_position)
	var ray_direction: Vector3 = _world_root.call("camera_ray_direction", viewport_position)
	if is_zero_approx(ray_direction.y):
		return null
	var distance := -ray_origin.y / ray_direction.y
	if distance < 0.0:
		return null
	var hit := ray_origin + ray_direction * distance
	return Vector2(
		hit.x + float(_map.get("width", 96)) * 0.5,
		hit.z + float(_map.get("height", 112)) * 0.5
	)

func _handle_map_tap(screen_point: Vector2) -> void:
	var ground = _ground_at(screen_point)
	if ground != null:
		tapped.emit(ground)
