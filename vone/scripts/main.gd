extends Control

const BackendClientScript = preload("res://scripts/backend_client.gd")
const ArenaScript = preload("res://scripts/arena.gd")
const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")
const MIN_WINDOW_WIDTH := 320
const MIN_WINDOW_HEIGHT := 480
const MAX_WINDOW_WIDTH := 3840
const MAX_WINDOW_HEIGHT := 2160

var _backend: Node
var _home: VBoxContainer
var _game: VBoxContainer
var _server_input: LineEdit
var _name_input: LineEdit
var _match_input: LineEdit
var _resolution_width: SpinBox
var _resolution_height: SpinBox
var _seed_input: SpinBox
var _bot_toggle: CheckButton
var _status_label: Label
var _match_label: Label
var _world_label: Label
var _start_button: Button
var _recycle_button: Button
var _arena: Control
var _building := ""
var _selected_entity := -1
var _current_snapshot: Dictionary = {}
var _current_match: Dictionary = {}
var _current_map: Dictionary = {}
var _viewer_team := 0
var _is_host := false

func _ready() -> void:
	_backend = BackendClientScript.new()
	add_child(_backend)
	_backend.snapshot_received.connect(_on_snapshot)
	_backend.match_status_changed.connect(_on_match_status)
	_backend.match_ended.connect(_on_match_ended)
	_backend.message_received.connect(_set_status)
	get_window().size_changed.connect(_on_window_resized)
	_build_interface()
	_restore_window_size()
	_on_window_resized()

func _build_interface() -> void:
	_set_dark_theme()
	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 28)
	margin.add_theme_constant_override("margin_top", 26)
	margin.add_theme_constant_override("margin_right", 28)
	margin.add_theme_constant_override("margin_bottom", 26)
	add_child(margin)

	var pages := VBoxContainer.new()
	pages.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pages.size_flags_vertical = Control.SIZE_EXPAND_FILL
	pages.add_theme_constant_override("separation", 16)
	margin.add_child(pages)

	var title := Label.new()
	title.text = "LUXCORES"
	title.add_theme_font_size_override("font_size", 44)
	title.add_theme_color_override("font_color", Color("#eaf4ff"))
	pages.add_child(title)
	var tagline := Label.new()
	tagline.text = "A light-powered strategy game"
	tagline.add_theme_font_size_override("font_size", 20)
	tagline.add_theme_color_override("font_color", Color("#9eafc4"))
	pages.add_child(tagline)

	_home = VBoxContainer.new()
	_home.add_theme_constant_override("separation", 14)
	pages.add_child(_home)
	_add_field(_home, "Backend URL", "http://127.0.0.1:3000", "_server_input")
	_add_field(_home, "Player name", "Halo", "_name_input")
	_add_field(_home, "Match ID (blank to host)", "", "_match_input")
	var resolution_row := HBoxContainer.new()
	resolution_row.add_theme_constant_override("separation", 10)
	_resolution_width = _make_resolution_input("W ", 600, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH)
	resolution_row.add_child(_resolution_width)
	_resolution_height = _make_resolution_input("H ", 800, MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT)
	resolution_row.add_child(_resolution_height)
	var apply_resolution_button := _make_button("APPLY SIZE", Color("#34577a"))
	apply_resolution_button.custom_minimum_size.x = 120
	apply_resolution_button.pressed.connect(_apply_window_size)
	resolution_row.add_child(apply_resolution_button)
	_home.add_child(resolution_row)
	var match_options := HBoxContainer.new()
	_bot_toggle = CheckButton.new()
	_bot_toggle.text = "Play against bot"
	_bot_toggle.button_pressed = true
	_bot_toggle.add_theme_font_size_override("font_size", 18)
	match_options.add_child(_bot_toggle)
	_seed_input = SpinBox.new()
	_seed_input.min_value = 0
	_seed_input.max_value = 2147483647
	_seed_input.value = 1234567
	_seed_input.prefix = "Seed "
	_seed_input.custom_minimum_size = Vector2(180, 52)
	match_options.add_child(_seed_input)
	_home.add_child(match_options)
	var connect_button := _make_button("CONNECT / CREATE MATCH", Color("#315f95"))
	connect_button.pressed.connect(_connect_match)
	_home.add_child(connect_button)

	_status_label = Label.new()
	_status_label.text = "Connect to a Luxcores backend to start."
	_status_label.add_theme_font_size_override("font_size", 18)
	_status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status_label.add_theme_color_override("font_color", Color("#aabbd0"))
	pages.add_child(_status_label)

	_game = VBoxContainer.new()
	_game.visible = false
	_game.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_game.add_theme_constant_override("separation", 10)
	pages.add_child(_game)
	_match_label = Label.new()
	_match_label.text = ""
	_match_label.add_theme_font_size_override("font_size", 18)
	_match_label.add_theme_color_override("font_color", Color("#d5e5fa"))
	_game.add_child(_match_label)
	_world_label = Label.new()
	_world_label.text = "Waiting for match snapshot"
	_world_label.add_theme_font_size_override("font_size", 20)
	_world_label.add_theme_color_override("font_color", Color("#b7c7da"))
	_game.add_child(_world_label)

	_arena = ArenaScript.new()
	_arena.custom_minimum_size = Vector2.ZERO
	_arena.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_arena.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_arena.tile_pressed.connect(_on_tile_pressed)
	_arena.entity_pressed.connect(_on_entity_pressed)
	_game.add_child(_arena)

	var action_grid := GridContainer.new()
	action_grid.columns = 3
	action_grid.add_theme_constant_override("h_separation", 10)
	action_grid.add_theme_constant_override("v_separation", 10)
	_game.add_child(action_grid)
	for item in [
		["Solar", "solar"], ["Wind", "wind"], ["Geothermal", "geothermal"],
		["Nuclear", "nuclear"], ["Barracks", "barracks"], ["Tower", "tower"],
	]:
		var build_button := _make_button(item[0], Color("#24364a"))
		build_button.pressed.connect(_select_building.bind(item[1]))
		action_grid.add_child(build_button)

	var game_controls := HBoxContainer.new()
	_start_button = _make_button("START MATCH", Color("#287557"))
	_start_button.pressed.connect(_start_match)
	game_controls.add_child(_start_button)
	_recycle_button = _make_button("RECYCLE SELECTED", Color("#75582b"))
	_recycle_button.disabled = true
	_recycle_button.pressed.connect(_recycle_selected)
	game_controls.add_child(_recycle_button)
	var leave_button := _make_button("LEAVE", Color("#52313b"))
	leave_button.pressed.connect(_leave_match)
	game_controls.add_child(leave_button)
	_game.add_child(game_controls)

func _add_field(parent: VBoxContainer, caption: String, initial_text: String, variable_name: String) -> void:
	var field_column := VBoxContainer.new()
	field_column.add_theme_constant_override("separation", 3)
	var label := Label.new()
	label.text = caption
	label.add_theme_font_size_override("font_size", 18)
	label.add_theme_color_override("font_color", Color("#aebfd3"))
	field_column.add_child(label)
	var input := LineEdit.new()
	input.text = initial_text
	input.clear_button_enabled = true
	input.custom_minimum_size.y = 54
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	field_column.add_child(input)
	parent.add_child(field_column)
	set(variable_name, input)

func _make_button(caption: String, color: Color) -> Button:
	var button := Button.new()
	button.text = caption
	button.custom_minimum_size = Vector2(0, 58)
	button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var normal := StyleBoxFlat.new()
	normal.bg_color = color
	normal.set_corner_radius_all(8)
	normal.content_margin_left = 8
	normal.content_margin_right = 8
	button.add_theme_stylebox_override("normal", normal)
	var hover := normal.duplicate()
	hover.bg_color = color.lightened(0.12)
	button.add_theme_stylebox_override("hover", hover)
	return button

func _set_dark_theme() -> void:
	var theme := Theme.new()
	theme.set_color("font_color", "Label", Color("#e4edf8"))
	theme.set_color("font_color", "Button", Color("#f4f7fc"))
	theme.set_color("font_hover_color", "Button", Color.WHITE)
	theme.set_font_size("font_size", "Button", 19)
	theme.set_font_size("font_size", "LineEdit", 20)
	theme.set_font_size("font_size", "SpinBox", 18)
	theme.set_color("font_color", "LineEdit", Color("#f3f6fb"))
	theme.set_color("font_placeholder_color", "LineEdit", Color("#78889b"))
	theme.set_stylebox("normal", "LineEdit", _panel_style(Color("#111d2b")))
	theme.set_stylebox("focus", "LineEdit", _panel_style(Color("#17283c")))
	theme.set_stylebox("normal", "SpinBox", _panel_style(Color("#111d2b")))
	self.theme = theme

func _make_resolution_input(prefix_text: String, default_value: int, minimum: int, maximum: int) -> SpinBox:
	var input := SpinBox.new()
	input.min_value = minimum
	input.max_value = maximum
	input.step = 10
	input.value = default_value
	input.prefix = prefix_text
	input.custom_minimum_size = Vector2(130, 52)
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return input

func _restore_window_size() -> void:
	var settings := ConfigFile.new()
	var error := settings.load("user://luxcores.cfg")
	if error != OK and error != ERR_FILE_NOT_FOUND:
		_set_status("Could not load saved window size (error %d)." % error)
		return
	var screen_size := DisplayServer.screen_get_size()
	var width := int(settings.get_value("display", "width", mini(600, screen_size.x)))
	var height := int(settings.get_value("display", "height", mini(800, screen_size.y)))
	if not _is_valid_window_size(width, height):
		_set_status("Saved window size is outside the supported range. Using 600 × 800.")
		width = mini(600, screen_size.x)
		height = mini(800, screen_size.y)
	_resolution_width.value = width
	_resolution_height.value = height
	get_window().size = Vector2i(width, height)

func _on_window_resized() -> void:
	if not is_instance_valid(_resolution_width) or not is_instance_valid(_resolution_height):
		return
	var window_size := get_window().size
	_resolution_width.value = window_size.x
	_resolution_height.value = window_size.y

func _apply_window_size() -> void:
	var width := int(_resolution_width.value)
	var height := int(_resolution_height.value)
	if not _is_valid_window_size(width, height):
		_set_status("Window width must be %d–%d and height %d–%d." % [
			MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH, MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT,
		])
		return
	var settings := ConfigFile.new()
	var load_error := settings.load("user://luxcores.cfg")
	if load_error != OK and load_error != ERR_FILE_NOT_FOUND:
		_set_status("Could not load user settings (error %d)." % load_error)
		return
	settings.set_value("display", "width", width)
	settings.set_value("display", "height", height)
	var save_error := settings.save("user://luxcores.cfg")
	if save_error != OK:
		_set_status("Could not save window size (error %d)." % save_error)
		return
	get_window().size = Vector2i(width, height)
	_set_status("Window size set to %d × %d." % [width, height])

func _is_valid_window_size(width: int, height: int) -> bool:
	return (
		width >= MIN_WINDOW_WIDTH and width <= MAX_WINDOW_WIDTH
		and height >= MIN_WINDOW_HEIGHT and height <= MAX_WINDOW_HEIGHT
	)

func _panel_style(color: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.border_color = Color("#2c4057")
	style.set_border_width_all(1)
	style.set_corner_radius_all(7)
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	return style

func _connect_match() -> void:
	_set_status("Signing in and opening the match...")
	var result: Dictionary = await _backend.connect_match({
		"server": _server_input.text,
		"name": _name_input.text,
		"match_id": _match_input.text,
		"vs_bot": _bot_toggle.button_pressed,
		"seed": int(_seed_input.value),
	})
	if not result.ok:
		_set_status(str(result.get("message", "Could not connect to the match.")))
		return
	_current_match = result.match
	_current_map = result.map
	_viewer_team = int(result.viewer_team)
	_is_host = bool(result.get("is_host", false))
	_home.visible = false
	_game.visible = true
	_match_label.text = "Match " + _backend.get_match_id() + "  •  Team " + str(_viewer_team)
	_update_start_button()
	_recycle_button.disabled = true
	if _is_host:
		_set_status("Lobby connected. Start the match when ready.")
	else:
		_set_status("Lobby connected. Waiting for the host to start the match.")
	_arena.set_world(_current_map, _current_snapshot, _viewer_team)
	_update_world_label()

func _start_match() -> void:
	_start_button.disabled = true
	_set_status("Starting the authoritative server match...")
	var result: Dictionary = await _backend.start_match()
	if not result.ok:
		_start_button.disabled = false
		_set_status(str(result.get("message", "The match could not start.")))
		return
	_current_match = result.data
	_start_button.visible = false
	_set_status("Match started. Waiting for the first snapshot...")

func _select_building(building: String) -> void:
	_building = building
	_selected_entity = -1
	_recycle_button.disabled = true
	_arena.set_selection(_building, _selected_entity)
	_set_status("Selected " + building.capitalize() + ". Tap a free tile in your blue build zone.")

func _on_tile_pressed(tile_x: int, tile_z: int) -> void:
	if _building.is_empty():
		return
	var command := {
		"t": "build",
		"building": _building,
		"tileX": tile_x,
		"tileZ": tile_z,
	}
	if _building == "tower":
		command["attack"] = "melee"
	_backend.send_command(command)
	_set_status("Build order sent. The server will validate placement and cost.")
	_building = ""
	_arena.set_selection(_building, _selected_entity)

func _on_entity_pressed(entity_id: int) -> void:
	_selected_entity = entity_id
	_building = ""
	_arena.set_selection(_building, _selected_entity)
	_refresh_recycle_control()
	_set_status("Selected entity " + str(entity_id) + ".")

func _selected_building() -> Dictionary:
	for entity in _current_snapshot.get("entities", []):
		if int(entity.get("id", -1)) == _selected_entity and int(entity.get("team", -1)) == _viewer_team and int(entity.get("kind", 0)) >= 2 and int(entity.get("kind", 0)) <= 7:
			return entity
	return {}

func _refresh_recycle_control() -> void:
	var selected := _selected_building()
	_recycle_button.disabled = selected.is_empty()
	_recycle_button.text = "CANCEL RECYCLE" if int(selected.get("recycle", 0)) > 0 else "RECYCLE SELECTED"

func _recycle_selected() -> void:
	var selected := _selected_building()
	if selected.is_empty():
		_set_status("Select one of your buildings first.")
		return
	var cancelling := int(selected.get("recycle", 0)) > 0
	_backend.send_command({
		"t": "cancelRecycle" if cancelling else "recycle",
		"buildingId": _selected_entity,
	})
	_set_status("Recycle cancellation sent." if cancelling else "Recycle order sent.")

func _on_snapshot(world_snapshot: Dictionary) -> void:
	_current_snapshot = world_snapshot
	if is_instance_valid(_arena) and _game.visible:
		_arena.set_world(_current_map, _current_snapshot, _viewer_team)
		_refresh_recycle_control()
	_update_world_label()
	if str(_current_match.get("status", "")) == "running":
		_update_start_button()

func _on_match_status(status: String, details: Dictionary) -> void:
	if details.has("players"):
		_current_match = details
	if status == "running":
		_start_button.visible = false
		_set_status("Match running. Commands resolve on the server.")
	elif status == "lobby":
		_update_start_button()

func _update_start_button() -> void:
	if not is_instance_valid(_start_button):
		return
	var is_lobby := str(_current_match.get("status", "lobby")) == "lobby"
	_start_button.visible = is_lobby
	_start_button.disabled = false

func _on_match_ended(result: Dictionary) -> void:
	var winner: Variant = result.get("winnerTeam", null)
	if bool(result.get("draw", false)) or winner == null:
		_set_status("Match ended in a draw.")
	else:
		_set_status("Match ended. Team %s wins." % str(winner))

func _update_world_label() -> void:
	if _current_snapshot.is_empty():
		_world_label.text = "Lobby · waiting for the match to start"
		return
	var tick := int(_current_snapshot.get("tick", 0))
	var teams: Array = _current_snapshot.get("teams", [])
	var lux := 0.0
	if _viewer_team < teams.size():
		lux = float(teams[_viewer_team].get("coreLux", 0)) / 1000.0
	_world_label.text = "Tick %d  ·  Core %.1f lux" % [tick, lux]
	_world_label.add_theme_color_override("font_color", TEAM_BLUE if _viewer_team == 0 else TEAM_RED)

func _leave_match() -> void:
	_backend.disconnect_match()
	_current_snapshot = {}
	_current_match = {}
	_current_map = {}
	_selected_entity = -1
	_is_host = false
	_building = ""
	_game.visible = false
	_home.visible = true
	_set_status("Disconnected.")

func _set_status(text: String) -> void:
	if is_instance_valid(_status_label):
		_status_label.text = text
