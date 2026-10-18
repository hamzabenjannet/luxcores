extends Control

const BackendClientScript = preload("res://scripts/backend_client.gd")
const ArenaScript = preload("res://scripts/arena.gd")
const GameLogic = preload("res://scripts/game_logic.gd")
const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")
## Start-menu modes, in the order of the selector.
const MODES := ["Play against bot", "Watch bot against bot", "Host a match for two"]
const DEFAULT_WINDOW_WIDTH := 600
const DEFAULT_WINDOW_HEIGHT := 1200
const PREVIOUS_DEFAULT_WINDOW_HEIGHT := 800
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
var _mode_selector: OptionButton
var _status_label: Label
var _match_label: Label
var _match_id_input: LineEdit
var _phase_label: Label
var _world_label: Label
var _build_description: Label
var _start_button: Button
var _palette: GridContainer
var _palette_buttons := {}
var _panel: VBoxContainer
var _panel_title: Label
var _panel_row: HBoxContainer
var _panel_key := ""
var _order_box: VBoxContainer
var _queue_box: VBoxContainer
var _order_key := ""
var _hero_box: VBoxContainer
var _hero_key := ""
var _hero_bar: HBoxContainer
var _hero_name_label: Label
var _ability_buttons: Array = []
## The slot (1 ranged, 2 area) whose target the next tap chooses, or -1.
var _ability := -1
## Label of the chosen hero allocation, one of GameLogic.hero_lux_choices.
var _hero_alloc := "50%"
var _queue_key := ""
var _queue_labels := {}
var _mode := ""
var _selected_group := -1
var _path_target := {}
var _path_points: Array = []
var _last_path: Array = []
var _order_count := 5
var _order_type := "mixed"
var _tower_attack_row: HBoxContainer
var _tower_attack_selector: OptionButton
var _arena: Control
var _building := ""
var _selected_entity := -1
var _current_snapshot: Dictionary = {}
var _current_match: Dictionary = {}
var _current_map: Dictionary = {}
var _viewer_team := 0
var _is_host := false
var _role := "player"
var _data: Dictionary = {}
var _tick_hz := 20

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

	#var title := Label.new()
	#title.text = "LUXCORES"
	#title.add_theme_font_size_override("font_size", 44)
	#title.add_theme_color_override("font_color", Color("#eaf4ff"))
	#pages.add_child(title)
	#var tagline := Label.new()
	#tagline.text = "A light-powered strategy game"
	#tagline.add_theme_font_size_override("font_size", 20)
	#tagline.add_theme_color_override("font_color", Color("#9eafc4"))
	#pages.add_child(tagline)

	_home = VBoxContainer.new()
	_home.add_theme_constant_override("separation", 14)
	pages.add_child(_home)
	_add_field(_home, "Backend URL", "https://luxcores.webrit.cloud", "_server_input")
	_add_field(_home, "Player name", "Halo", "_name_input")
	_add_field(_home, "Match ID (blank to use the mode below)", "", "_match_input")
	var resolution_row := HBoxContainer.new()
	resolution_row.add_theme_constant_override("separation", 10)
	_resolution_width = _make_resolution_input("W ", DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH)
	resolution_row.add_child(_resolution_width)
	_resolution_height = _make_resolution_input("H ", DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT)
	resolution_row.add_child(_resolution_height)
	var apply_resolution_button := _make_button("APPLY SIZE", Color("#34577a"))
	apply_resolution_button.custom_minimum_size.x = 120
	apply_resolution_button.pressed.connect(_apply_window_size)
	resolution_row.add_child(apply_resolution_button)
	_home.add_child(resolution_row)
	var match_options := HBoxContainer.new()
	_mode_selector = OptionButton.new()
	for mode in MODES:
		_mode_selector.add_item(mode)
	_mode_selector.select(0)
	_mode_selector.custom_minimum_size = Vector2(260, 52)
	_mode_selector.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	match_options.add_child(_mode_selector)
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
	var match_id_row := HBoxContainer.new()
	match_id_row.add_theme_constant_override("separation", 10)
	var match_id_label := Label.new()
	match_id_label.text = "Match ID"
	match_id_label.add_theme_font_size_override("font_size", 18)
	match_id_row.add_child(match_id_label)
	_match_id_input = LineEdit.new()
	_match_id_input.editable = false
	_match_id_input.select_all_on_focus = true
	_match_id_input.custom_minimum_size.y = 48
	_match_id_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	match_id_row.add_child(_match_id_input)
	var copy_match_id_button := _make_button("COPY", Color("#34577a"))
	copy_match_id_button.custom_minimum_size = Vector2(100, 48)
	copy_match_id_button.pressed.connect(_copy_match_id)
	match_id_row.add_child(copy_match_id_button)
	_game.add_child(match_id_row)
	_match_label = Label.new()
	_match_label.text = ""
	_match_label.add_theme_font_size_override("font_size", 18)
	_match_label.add_theme_color_override("font_color", Color("#d5e5fa"))
	_game.add_child(_match_label)
	_phase_label = Label.new()
	_phase_label.text = "LOBBY"
	_phase_label.add_theme_font_size_override("font_size", 22)
	_phase_label.add_theme_color_override("font_color", Color("#f0bd68"))
	_game.add_child(_phase_label)
	_world_label = Label.new()
	_world_label.text = "Waiting for match snapshot"
	_world_label.add_theme_font_size_override("font_size", 20)
	_world_label.add_theme_color_override("font_color", Color("#b7c7da"))
	_game.add_child(_world_label)

	_build_description = Label.new()
	_build_description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_build_description.add_theme_font_size_override("font_size", 17)
	_build_description.add_theme_color_override("font_color", Color("#d5e5fa"))
	_build_description.visible = false
	_game.add_child(_build_description)

	_arena = ArenaScript.new()
	_arena.custom_minimum_size = Vector2.ZERO
	_arena.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_arena.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_arena.tapped.connect(_on_arena_tapped)
	_game.add_child(_arena)

	_palette = GridContainer.new()
	_palette.columns = 3
	_palette.add_theme_constant_override("h_separation", 10)
	_palette.add_theme_constant_override("v_separation", 10)
	_game.add_child(_palette)
	for item in GameLogic.PALETTE:
		var build_button := _make_button(item[1], Color("#24364a"))
		build_button.pressed.connect(_select_building.bind(item[0]))
		_palette.add_child(build_button)
		_palette_buttons[item[0]] = build_button

	_tower_attack_row = HBoxContainer.new()
	_tower_attack_row.add_theme_constant_override("separation", 10)
	var tower_attack_label := Label.new()
	tower_attack_label.text = "Tower attack"
	tower_attack_label.add_theme_font_size_override("font_size", 18)
	_tower_attack_row.add_child(tower_attack_label)
	_tower_attack_selector = OptionButton.new()
	for attack_type in GameLogic.ATTACK_TYPES:
		_tower_attack_selector.add_item(attack_type.capitalize())
	_tower_attack_selector.select(0)
	_tower_attack_selector.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_tower_attack_row.add_child(_tower_attack_selector)
	_tower_attack_row.visible = false
	_game.add_child(_tower_attack_row)

	# The selected building's actions: tower upgrades and recycle. The buttons are rebuilt
	# only when the actions change, so a tap never lands on a button that was just replaced.
	_panel = VBoxContainer.new()
	_panel.visible = false
	_panel.add_theme_constant_override("separation", 6)
	_panel_title = Label.new()
	_panel_title.add_theme_font_size_override("font_size", 18)
	_panel.add_child(_panel_title)
	_panel_row = HBoxContainer.new()
	_panel_row.add_theme_constant_override("separation", 10)
	_panel.add_child(_panel_row)
	_order_box = VBoxContainer.new()
	_order_box.add_theme_constant_override("separation", 6)
	_panel.add_child(_order_box)
	_hero_box = VBoxContainer.new()
	_hero_box.add_theme_constant_override("separation", 6)
	_panel.add_child(_hero_box)
	_queue_box = VBoxContainer.new()
	_queue_box.add_theme_constant_override("separation", 4)
	_panel.add_child(_queue_box)
	_game.add_child(_panel)

	# The hero bar: the hero's label and its four abilities, M R A S. It shows while a hero lives.
	_hero_bar = HBoxContainer.new()
	_hero_bar.visible = false
	_hero_bar.add_theme_constant_override("separation", 8)
	_hero_name_label = Label.new()
	_hero_name_label.add_theme_font_size_override("font_size", 18)
	_hero_name_label.custom_minimum_size.x = 120
	_hero_bar.add_child(_hero_name_label)
	for ability_def in GameLogic.ABILITY_SLOTS:
		var ability_button := _make_button(String(ability_def.letter), Color("#24364a"))
		ability_button.custom_minimum_size = Vector2(0, 52)
		ability_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		ability_button.pressed.connect(_cast_from_bar.bind(int(ability_def.slot)))
		_hero_bar.add_child(ability_button)
		_ability_buttons.append(ability_button)
	_game.add_child(_hero_bar)

	var game_controls := HBoxContainer.new()
	_start_button = _make_button("START MATCH", Color("#287557"))
	_start_button.pressed.connect(_start_match)
	game_controls.add_child(_start_button)
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
	var width := int(settings.get_value("display", "width", mini(DEFAULT_WINDOW_WIDTH, screen_size.x)))
	var height := int(settings.get_value("display", "height", mini(DEFAULT_WINDOW_HEIGHT, screen_size.y)))
	if width == DEFAULT_WINDOW_WIDTH and height == PREVIOUS_DEFAULT_WINDOW_HEIGHT:
		height = mini(DEFAULT_WINDOW_HEIGHT, screen_size.y)
	if not _is_valid_window_size(width, height):
		_set_status("Saved window size is outside the supported range. Using 600 × 1200.")
		width = mini(DEFAULT_WINDOW_WIDTH, screen_size.x)
		height = mini(DEFAULT_WINDOW_HEIGHT, screen_size.y)
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
		"vs_bot": _mode_selector.selected == 0,
		"bot_vs_bot": _mode_selector.selected == 1,
		"seed": int(_seed_input.value),
	})
	if not result.ok:
		_set_status(str(result.get("message", "Could not connect to the match.")))
		return
	_current_match = result.match
	_current_map = result.map
	_viewer_team = int(result.viewer_team)
	_is_host = bool(result.get("is_host", false))
	_role = str(result.get("role", "player"))
	_data = result.data
	_arena.set_balance(_data.balance, _data.heroes)
	_tick_hz = int(_backend.get_spec().get("tickHz", 20))
	_match_id_input.text = _backend.get_match_id()
	_home.visible = false
	_game.visible = true
	var spectator := _role == "spectator"
	_palette.visible = not spectator
	_match_label.text = "WATCHING BOTS" if spectator else "Team %d  •  %s" % [
		_viewer_team,
		"HOST" if _is_host else "PLAYER",
	]
	_set_match_phase(str(_current_match.get("status", "lobby")))
	_update_start_button()
	_refresh_palette()
	if _is_host:
		_set_status("Lobby connected. Start the match when ready.")
	else:
		_set_status("Lobby connected. Waiting for the host to start the match.")
	_arena.set_world(_current_map, _current_snapshot, _viewer_team)
	_update_world_label()

func _start_match() -> void:
	_start_button.disabled = true
	_current_match["status"] = "starting"
	_set_match_phase("starting")
	_set_status("Starting the authoritative server match...")
	var result: Dictionary = await _backend.start_match()
	if not result.ok:
		_restore_match_after_start_failure()
		_set_status(str(result.get("message", "The match could not start.")))
		return
	var match_data: Variant = result.get("data", {})
	if not match_data is Dictionary or str(match_data.get("status", "")) != "running":
		_restore_match_after_start_failure()
		_set_status("The backend did not confirm that the match started.")
		return
	_current_match = match_data
	_set_match_phase("running")
	_update_start_button()
	_set_status("Match running. Waiting for the first server snapshot...")

func _select_building(building: String) -> void:
	_ability = -1
	_selected_group = -1
	_mode = ""
	_path_points = []
	# A second press on the same building puts it back.
	_building = "" if _building == building else building
	_selected_entity = -1
	_tower_attack_row.visible = _building == "tower"
	_build_description.visible = not _building.is_empty()
	if _building.is_empty():
		_arena.set_selection(_building, _selected_entity)
		_refresh_palette()
		_set_status("Build mode off.")
		return
	_build_description.text = _building_selection_description(building)
	_arena.set_selection(_building, _selected_entity)
	_refresh_palette()
	_set_status("Selected " + building.capitalize() + ".")

func _building_selection_description(building: String) -> String:
	var name := building.capitalize()
	match building:
		"solar":
			name = "Solar collector"
		"wind":
			name = "Wind collector"
		"geothermal":
			name = "Geothermal collector"
	var description := "%s costs %d lux. Tap a free tile in your build zone." % [
		name,
		int(_data.buildings[building].costLux),
	]
	if building == "geothermal":
		description += " It must be placed on a labeled vent."
	elif building == "tower":
		description += " Choose its attack type above."
	return description

## Every tap on the map goes through the shared rules in game_logic.gd, which the web client mirrors.
func _on_arena_tapped(ground: Vector2) -> void:
	if _role == "spectator" or _data.is_empty():
		return
	var result := GameLogic.resolve_tap({
		"ground": ground,
		"entities": _current_snapshot.get("entities", []),
		"viewer_team": _viewer_team,
		"building": _building,
		"attack": GameLogic.ATTACK_TYPES[_tower_attack_selector.selected],
		"core_lux_milli": _viewer_core_lux_milli(),
		"data": _data,
		"vents": _current_map.get("vents", []),
		"mode": _mode,
		"selected_group": _selected_group,
		"path_count": _path_points.size(),
		"ability": _ability,
	})
	if result.has("command"):
		_ability = -1
		var acknowledgement: Dictionary = await _backend.send_command(result.command)
		if acknowledgement.get("accepted", false):
			_set_status("Order sent. The server will validate it.")
		if _mode == "merge":
			_mode = ""
	elif result.has("message"):
		_set_status(String(result.message))
	elif result.has("addWaypoint"):
		_path_points.append(result.addWaypoint)
	elif result.has("selectGroup"):
		_selected_group = int(result.selectGroup)
		_selected_entity = -1
		_mode = ""
		_building = ""
		_build_description.visible = false
		_tower_attack_row.visible = false
		_set_status("Selected a group of %d creeps." % GameLogic.group_size(_current_snapshot.get("entities", []), _selected_group))
	elif result.has("select"):
		_selected_entity = -1 if result.select == null else int(result.select)
		_selected_group = -1
		if _selected_entity >= 0:
			_building = ""
			_build_description.visible = false
			_tower_attack_row.visible = false
			_set_status("Selected entity %d." % _selected_entity)
	_arena.set_selection(_building, _selected_entity)
	_refresh_palette()
	_refresh_panel()

func _viewer_core_lux_milli() -> int:
	var teams: Array = _current_snapshot.get("teams", [])
	if _viewer_team < teams.size():
		return int(teams[_viewer_team].get("coreLux", 0))
	return 0

## Dims the palette entries the Core cannot pay for, and marks the active one.
func _refresh_palette() -> void:
	if _data.is_empty():
		return
	var lux := _viewer_core_lux_milli()
	var min_left := int(_data.balance.core.minLeftAfterSpendLux)
	for item in GameLogic.PALETTE:
		var button: Button = _palette_buttons[item[0]]
		var cost := int(_data.buildings[item[0]].costLux)
		button.text = "%s  %d" % [item[1], cost]
		var poor := not GameLogic.can_afford(lux, cost, min_left)
		button.modulate = Color(1, 1, 1, 0.5 if poor else 1.0)
		button.button_pressed = false
		button.flat = _building != item[0]

## Shows one section of the panel: path mode, a selected group, or a selected building. The buttons
## are rebuilt only when they change, so a tap never lands on a button that was just replaced.
func _refresh_panel() -> void:
	if _data.is_empty():
		return
	_arena.set_paths(_paths_to_draw())
	_refresh_hero_bar()
	if _mode == "path":
		_show_path_bar()
		return
	var group := _group_record(_selected_group)
	if _selected_group >= 0 and group.is_empty():
		_selected_group = -1
		if _mode == "merge":
			_mode = ""
	if not group.is_empty():
		_show_group_panel(group)
		return
	var selected := {}
	for entity in _current_snapshot.get("entities", []):
		if int(entity.get("id", -1)) == _selected_entity and GameLogic.is_building_kind(int(entity.get("kind", 0))) and int(entity.get("owner", -1)) == _viewer_team:
			selected = entity
			break
	if selected.is_empty():
		_selected_entity = -1 if _selected_entity >= 0 and not _entity_exists(_selected_entity) else _selected_entity
		_panel.visible = false
		_panel_key = ""
		_order_key = ""
		_hero_key = ""
		_queue_key = ""
		return
	_show_building_panel(selected)

func _group_record(group_id: int) -> Dictionary:
	if group_id < 0:
		return {}
	for group in _current_snapshot.get("groups", []):
		if int(group.get("id", -1)) == group_id:
			return group
	return {}

func _clear_box(box: Node) -> void:
	for child in box.get_children():
		box.remove_child(child)
		child.queue_free()

## Fills a row with buttons: each item is {label, color, call (Callable), dim (bool)}.
func _fill_row(row: Container, items: Array) -> void:
	_clear_box(row)
	for item in items:
		var button := _make_button(String(item.label), item.color)
		button.custom_minimum_size = Vector2(0, 48)
		if bool(item.get("dim", false)):
			button.modulate = Color(1, 1, 1, 0.5)
		button.pressed.connect(item.call)
		row.add_child(button)

func _show_path_bar() -> void:
	_panel.visible = true
	_clear_box(_order_box)
	_clear_box(_hero_box)
	_clear_box(_queue_box)
	_order_key = ""
	_hero_key = ""
	_queue_key = ""
	_panel_title.text = "Path: %d/%d waypoints. Tap the map to add one." % [_path_points.size(), int(_data.balance.creep.maxWaypoints)]
	var key := "path|%d|%d" % [_path_points.size(), _last_path.size()]
	if key == _panel_key:
		return
	_panel_key = key
	var items: Array = [
		{"label": "Undo", "color": Color("#2f4c75"), "call": _path_undo},
		{"label": "Go", "color": Color("#287557"), "call": _path_go},
		{"label": "Cancel", "color": Color("#52313b"), "call": _path_cancel},
	]
	if not _last_path.is_empty():
		items.append({"label": "Reuse Last", "color": Color("#2f4c75"), "call": _path_reuse})
	_fill_row(_panel_row, items)

func _path_undo() -> void:
	if not _path_points.is_empty():
		_path_points.pop_back()
	_refresh_panel()

func _path_cancel() -> void:
	_mode = ""
	_path_target = {}
	_path_points = []
	_refresh_panel()

func _path_reuse() -> void:
	_path_points = _last_path.duplicate(true)
	_refresh_panel()

func _path_go() -> void:
	if _path_target.is_empty():
		return
	_last_path = _path_points.duplicate(true)
	var waypoints: Array = []
	for point in _path_points:
		waypoints.append([int(point[0]), int(point[1])])
	var command := {"t": "setGroupPath", "groupId": int(_path_target.id), "waypoints": waypoints} if _path_target.type == "group" else {"t": "setBarracksPath", "barracksId": int(_path_target.id), "waypoints": waypoints}
	_path_cancel()
	_run_panel_action(command)

func _show_group_panel(group: Dictionary) -> void:
	_panel.visible = true
	_clear_box(_order_box)
	_clear_box(_hero_box)
	_clear_box(_queue_box)
	_order_key = ""
	_hero_key = ""
	_queue_key = ""
	var size := GameLogic.group_size(_current_snapshot.get("entities", []), int(group.id))
	_panel_title.text = "Group of %d: tap another of your groups to merge." % size if _mode == "merge" else "Group of %d, %s" % [size, "custom path" if int(group.get("custom", 0)) == 1 else "lane route"]
	var actions := GameLogic.group_actions(size, int(group.get("custom", 0)) == 1)
	var key := "group|%d|%s" % [int(group.id), _mode]
	for action in actions:
		key += "|" + String(action.id)
	if key == _panel_key:
		return
	_panel_key = key
	var items: Array = []
	for action in actions:
		items.append({"label": action.label, "color": Color("#315f95") if _mode == "merge" and action.id == "merge" else Color("#2f4c75"), "call": _group_action.bind(String(action.id), int(group.id))})
	_fill_row(_panel_row, items)

func _group_action(action_id: String, group_id: int) -> void:
	match action_id:
		"path":
			_mode = "path"
			_path_target = {"type": "group", "id": group_id}
			_path_points = []
		"merge":
			_mode = "" if _mode == "merge" else "merge"
		"split":
			_run_panel_action({"t": "splitGroup", "groupId": group_id})
		"lane":
			_run_panel_action({"t": "setGroupPath", "groupId": group_id, "waypoints": []})
	_refresh_panel()

func _show_building_panel(selected: Dictionary) -> void:
	_panel.visible = true
	var title := GameLogic.entity_text(selected, _data.balance.hpFactor)
	if int(selected.kind) == GameLogic.KIND_TOWER:
		title += " (%s)" % GameLogic.ATTACK_NAMES.get(int(selected.get("attack", 0)), "?")
	_panel_title.text = title
	var lux := _viewer_core_lux_milli()
	var min_left := int(_data.balance.core.minLeftAfterSpendLux)
	var actions := GameLogic.actions_for(selected, _data.buildings.tower)
	var key := str(selected.id)
	for action in actions:
		var poor: bool = action.has("costLux") and not GameLogic.can_afford(lux, int(action.costLux), min_left)
		key += "|%s:%s" % [action.id, str(poor)]
	if key != _panel_key:
		_panel_key = key
		var items: Array = []
		for action in actions:
			var label := String(action.label)
			if action.has("costLux"):
				label += "  %d" % int(action.costLux)
			items.append({
				"label": label,
				"color": Color("#75582b") if action.id == "recycle" or action.id == "cancel" else Color("#2f4c75"),
				"call": _run_panel_action.bind(action.command),
				"dim": action.has("costLux") and not GameLogic.can_afford(lux, int(action.costLux), min_left),
			})
		_fill_row(_panel_row, items)
	if int(selected.kind) == GameLogic.KIND_BARRACKS and int(selected.get("recycle", 0)) == 0:
		_show_barracks_controls(selected, lux, min_left)
	else:
		_clear_box(_order_box)
		_clear_box(_hero_box)
		_clear_box(_queue_box)
		_order_key = ""
		_hero_key = ""
		_queue_key = ""

## Creep order controls and the queue of a barracks.
func _show_barracks_controls(barracks: Dictionary, lux: int, min_left: int) -> void:
	var creep: Dictionary = _data.balance.creep
	var cost := _order_count * int(creep.costLux)
	var poor := not GameLogic.can_afford(lux, cost, min_left)
	var waypoints: Array = barracks.get("waypoints", [])
	var order_key := "%d|%d|%s|%s|%d" % [int(barracks.id), _order_count, _order_type, str(poor), waypoints.size()]
	if order_key != _order_key:
		_order_key = order_key
		_clear_box(_order_box)
		var counts := HBoxContainer.new()
		counts.add_theme_constant_override("separation", 6)
		for n in range(int(creep.groupMin), int(creep.groupMax) + 1):
			var count_button := _make_button(str(n), Color("#315f95") if n == _order_count else Color("#24364a"))
			count_button.custom_minimum_size = Vector2(0, 44)
			count_button.pressed.connect(_set_order_count.bind(n))
			counts.add_child(count_button)
		_order_box.add_child(counts)
		var types := HBoxContainer.new()
		types.add_theme_constant_override("separation", 6)
		for type in GameLogic.ORDER_TYPES:
			var type_button := _make_button(String(type).capitalize(), Color("#315f95") if type == _order_type else Color("#24364a"))
			type_button.custom_minimum_size = Vector2(0, 44)
			type_button.pressed.connect(_set_order_type.bind(String(type)))
			types.add_child(type_button)
		_order_box.add_child(types)
		var order_button := _make_button("Order %d creeps  %d lux" % [_order_count, cost], Color("#287557"))
		order_button.custom_minimum_size = Vector2(0, 48)
		if poor:
			order_button.modulate = Color(1, 1, 1, 0.5)
		order_button.pressed.connect(_run_panel_action.bind({"t": "orderCreeps", "barracksId": int(barracks.id), "mix": GameLogic.mix_for(_order_count, _order_type)}))
		_order_box.add_child(order_button)
		var path_button := _make_button("Default Path" if not waypoints.is_empty() else "Set Default Path", Color("#2f4c75"))
		path_button.custom_minimum_size = Vector2(0, 48)
		path_button.pressed.connect(_start_barracks_path.bind(int(barracks.id)))
		_order_box.add_child(path_button)
		if not waypoints.is_empty():
			var clear_button := _make_button("Clear Path", Color("#52313b"))
			clear_button.custom_minimum_size = Vector2(0, 48)
			clear_button.pressed.connect(_run_panel_action.bind({"t": "setBarracksPath", "barracksId": int(barracks.id), "waypoints": []}))
			_order_box.add_child(clear_button)

	_show_hero_picks(barracks, lux, min_left)
	var lines := GameLogic.queue_lines(_current_snapshot.get("orders", []), int(barracks.id), _tick_hz, _hero_names())
	var queue_key := str(barracks.id)
	for order in _current_snapshot.get("orders", []):
		if int(order.barracksId) == int(barracks.id):
			queue_key += "|%d:%d" % [int(order.id), int(order.held)]
	if queue_key != _queue_key:
		_queue_key = queue_key
		_queue_labels.clear()
		_clear_box(_queue_box)
		for line in lines:
			var row := HBoxContainer.new()
			var label := Label.new()
			label.text = String(line.text)
			label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(label)
			var cancel := _make_button("✕", Color("#52313b"))
			cancel.custom_minimum_size = Vector2(56, 40)
			cancel.pressed.connect(_run_panel_action.bind({"t": "cancelQueue", "barracksId": int(barracks.id), "orderId": int(line.orderId)}))
			row.add_child(cancel)
			_queue_box.add_child(row)
			_queue_labels[int(line.index)] = label
	else:
		for line in lines:
			var node: Label = _queue_labels.get(int(line.index))
			if node != null and node.text != String(line.text):
				node.text = String(line.text)

## Roster names in roster order, from data/heroes.json.
func _hero_names() -> Array:
	var names: Array = []
	for entry in _data.get("heroes", {}).get("roster", []):
		names.append(String(entry.name))
	return names

func _roster() -> Array:
	var roster: Array = []
	for entry in _data.get("heroes", {}).get("roster", []):
		roster.append({"id": int(entry.id), "name": String(entry.name), "primary": String(entry.primary)})
	return roster

func _viewer_hero() -> Dictionary:
	if _role == "spectator":
		return {}
	for entity in _current_snapshot.get("entities", []):
		if int(entity.get("kind", 0)) == GameLogic.KIND_HERO and int(entity.get("owner", -1)) == _viewer_team and int(entity.get("hp", 0)) > 0:
			return entity
	return {}

func _viewer_player() -> Dictionary:
	for player in _current_snapshot.get("players", []):
		if int(player.get("id", -1)) == _viewer_team:
			return player
	return {}

## The hero part of a barracks panel (GDD 7.1): the lux to allocate and the roster, with locked heroes
## and the death cooldown shown. A tap on a hero picks it at this barracks.
func _show_hero_picks(barracks: Dictionary, lux: int, min_left: int) -> void:
	var queued := false
	for order in _current_snapshot.get("orders", []):
		if int(order.get("owner", -1)) == _viewer_team and int(order.get("type", 1)) == GameLogic.HERO_ORDER:
			queued = true
	var pick_state := GameLogic.hero_pick_state({
		"player": _viewer_player(), "hero_alive": not _viewer_hero().is_empty(), "hero_queued": queued,
		"roster": _roster(), "tick_hz": _tick_hz,
	})
	var choices := GameLogic.hero_lux_choices(lux, min_left)
	var chosen: Dictionary = {}
	for choice in choices:
		if String(choice.label) == _hero_alloc:
			chosen = choice
	if chosen.is_empty() and not choices.is_empty():
		chosen = choices[0]
	var key := "%d|%s" % [int(barracks.id), String(pick_state.note)]
	for option in pick_state.options:
		key += "|%d%s%s" % [int(option.id), "L" if option.locked else "", "E" if option.enabled else ""]
	for choice in choices:
		key += "|%d" % int(choice.lux)
	key += "|" + (String(chosen.label) if not chosen.is_empty() else "")
	if key == _hero_key:
		return
	_hero_key = key
	_clear_box(_hero_box)
	var note := Label.new()
	note.add_theme_font_size_override("font_size", 15)
	note.add_theme_color_override("font_color", Color("#8a93a6"))
	note.text = "Hero: %s" % pick_state.note if not String(pick_state.note).is_empty() else "Hero: pick one, with the lux below"
	_hero_box.add_child(note)
	var allocation := HBoxContainer.new()
	allocation.add_theme_constant_override("separation", 6)
	for choice in choices:
		var alloc_button := _make_button("%s %d" % [choice.label, int(choice.lux)], Color("#315f95") if choice == chosen else Color("#24364a"))
		alloc_button.custom_minimum_size = Vector2(0, 44)
		alloc_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		alloc_button.pressed.connect(_set_hero_alloc.bind(String(choice.label)))
		allocation.add_child(alloc_button)
	_hero_box.add_child(allocation)
	var heroes := HBoxContainer.new()
	heroes.add_theme_constant_override("separation", 6)
	for option in pick_state.options:
		var hero_button := _make_button("%s %s" % [option.name, String(option.primary).substr(0, 1).to_upper()], Color("#24364a"))
		hero_button.custom_minimum_size = Vector2(0, 44)
		hero_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		hero_button.name = "HeroPick%d" % int(option.id)
		if not bool(option.enabled):
			hero_button.modulate = Color(1, 1, 1, 0.5)
		hero_button.pressed.connect(_pick_hero.bind(int(option.id), int(barracks.id), int(chosen.lux) if not chosen.is_empty() else 0))
		heroes.add_child(hero_button)
	_hero_box.add_child(heroes)

func _set_hero_alloc(label: String) -> void:
	_hero_alloc = label
	_refresh_panel()

func _pick_hero(hero_id: int, barracks_id: int, lux: int) -> void:
	if lux < 1:
		_set_status("Not enough lux for a hero.")
		return
	_run_panel_action({"t": "pickHero", "heroId": hero_id, "lux": lux, "barracksId": barracks_id})

## The hero bar: the ability buttons show the letter and cost, or the seconds until ready.
func _refresh_hero_bar() -> void:
	var hero := _viewer_hero()
	if hero.is_empty() or _data.is_empty():
		_hero_bar.visible = false
		_ability = -1
		return
	_hero_bar.visible = true
	_hero_name_label.text = GameLogic.entity_text(hero, _data.balance.hpFactor, _hero_names())
	var states := GameLogic.ability_states(hero, _data.abilities, _viewer_core_lux_milli(), int(_data.balance.core.minLeftAfterSpendLux), _tick_hz)
	for state in states:
		var button: Button = _ability_buttons[int(state.slot)]
		button.text = String(state.text)
		var dim: bool = not bool(state.ready) or bool(state.poor)
		button.modulate = Color(1, 1, 1, 0.5 if dim else 1.0)
		button.flat = _ability != int(state.slot)

func _cast_from_bar(slot: int) -> void:
	var hero := _viewer_hero()
	if hero.is_empty():
		return
	var state: Dictionary = GameLogic.ability_states(hero, _data.abilities, _viewer_core_lux_milli(), int(_data.balance.core.minLeftAfterSpendLux), _tick_hz)[slot]
	if not bool(state.ready):
		_set_status("%s is not ready: %s." % [state.letter, String(state.text).substr(2)])
		return
	var cast := GameLogic.immediate_cast(slot, hero)
	if not cast.is_empty():
		_ability = -1
		_run_panel_action(cast)
	elif _ability == slot:
		_ability = -1
	else:
		_ability = slot
		_building = ""
		_selected_entity = -1
		_selected_group = -1
		_mode = ""
		_build_description.visible = false
		_tower_attack_row.visible = false
		_set_status("Tap an enemy to hit." if slot == 1 else "Tap the ground to strike.")
	_arena.set_selection(_building, _selected_entity)
	_refresh_palette()
	_refresh_panel()

func _set_order_count(count: int) -> void:
	_order_count = count
	_refresh_panel()

func _set_order_type(type: String) -> void:
	_order_type = type
	_refresh_panel()

func _start_barracks_path(barracks_id: int) -> void:
	_mode = "path"
	_path_target = {"type": "barracks", "id": barracks_id}
	_path_points = []
	_refresh_panel()

## Paths to draw: the selected group's remaining route, a barracks default path and the path being drawn.
func _paths_to_draw() -> Array:
	var out: Array = []
	var gold := Color("#ffd76a")
	var group := _group_record(_selected_group)
	if not group.is_empty():
		var points: Array = []
		for entity in _current_snapshot.get("entities", []):
			if int(entity.get("kind", 0)) == GameLogic.KIND_CREEP and int(entity.get("groupId", 0)) == int(group.id):
				points.append(Vector2(float(entity.x), float(entity.z)) / GameLogic.UNITS_PER_TILE)
				break
		var waypoints: Array = group.get("waypoints", [])
		for i in range(int(group.get("wpIndex", 0)), waypoints.size()):
			points.append(Vector2(float(waypoints[i][0]), float(waypoints[i][1])) / GameLogic.UNITS_PER_TILE)
		out.append({"points": points, "color": gold})
	for entity in _current_snapshot.get("entities", []):
		if int(entity.get("id", -1)) == _selected_entity and int(entity.get("kind", 0)) == GameLogic.KIND_BARRACKS and not entity.get("waypoints", []).is_empty():
			var points: Array = [Vector2(float(entity.x), float(entity.z)) / GameLogic.UNITS_PER_TILE]
			for waypoint in entity.waypoints:
				points.append(Vector2(float(waypoint[0]), float(waypoint[1])) / GameLogic.UNITS_PER_TILE)
			out.append({"points": points, "color": gold})
	if _mode == "path":
		var points: Array = []
		for point in _path_points:
			points.append(Vector2(float(point[0]), float(point[1])) / GameLogic.UNITS_PER_TILE)
		out.append({"points": points, "color": Color.WHITE})
	return out

func _entity_exists(entity_id: int) -> bool:
	for entity in _current_snapshot.get("entities", []):
		if int(entity.get("id", -1)) == entity_id:
			return true
	return false

func _run_panel_action(command: Dictionary) -> void:
	var acknowledgement: Dictionary = await _backend.send_command(command)
	if acknowledgement.get("accepted", false):
		_set_status("Order sent. The server will validate it.")

func _on_snapshot(world_snapshot: Dictionary) -> void:
	_current_snapshot = world_snapshot
	if _match_phase_is_active():
		_current_match["status"] = "running"
		_set_match_phase("running")
		_update_start_button()
	if is_instance_valid(_arena) and _game.visible:
		_arena.set_world(_current_map, _current_snapshot, _viewer_team)
		_refresh_palette()
		_refresh_panel()
	_update_world_label()

func _on_match_status(status: String, details: Dictionary) -> void:
	if details.has("id"):
		_current_match = details
	_current_match["status"] = status
	if status == "running":
		_set_match_phase("running")
		_update_start_button()
		_set_status("Match running. Commands resolve on the server.")
	elif status == "lobby":
		_set_match_phase("lobby")
		_update_start_button()

func _update_start_button() -> void:
	if not is_instance_valid(_start_button):
		return
	var is_lobby := str(_current_match.get("status", "lobby")) == "lobby"
	_start_button.visible = is_lobby and _is_host
	_start_button.disabled = false

func _on_match_ended(result: Dictionary) -> void:
	_current_match["status"] = "finished"
	_set_match_phase("finished")
	_update_start_button()
	var winner: Variant = result.get("winnerTeam", null)
	var reason := str(result.get("reason", ""))
	if bool(result.get("draw", false)) or winner == null:
		_set_status("Draw (%s)." % reason)
	elif _role == "spectator":
		_set_status("%s wins (%s)." % ["Blue" if int(winner) == 0 else "Red", reason])
	else:
		_set_status("%s (%s)." % ["Victory" if int(winner) == _viewer_team else "Defeat", reason])

func _update_world_label() -> void:
	if _current_snapshot.is_empty():
		_world_label.text = "Lobby · waiting for the match to start"
		return
	var tick := int(_current_snapshot.get("tick", 0))
	var teams: Array = _current_snapshot.get("teams", [])
	var mine := 0.0
	var other := 0.0
	if _viewer_team < teams.size():
		mine = float(teams[_viewer_team].get("coreLux", 0)) / 1000.0
	if 1 - _viewer_team < teams.size():
		other = float(teams[1 - _viewer_team].get("coreLux", 0)) / 1000.0
	var seconds := tick / _tick_hz
	var day := GameLogic.is_day(tick, _data.balance.dayNight) if not _data.is_empty() else true
	_world_label.text = "%s · %02d:%02d %s · %s %.0f · %s %.0f" % [
		"RUNNING", seconds / 60, seconds % 60, "DAY" if day else "NIGHT",
		"Blue" if _role == "spectator" else "Core", mine,
		"Red" if _role == "spectator" else "Enemy", other,
	]
	_world_label.add_theme_color_override("font_color", TEAM_BLUE if _viewer_team == 0 else TEAM_RED)

func _leave_match() -> void:
	_backend.disconnect_match()
	_match_id_input.clear()
	_current_snapshot = {}
	_current_match = {}
	_current_map = {}
	_is_host = false
	_phase_label.text = "DISCONNECTED"
	_selected_entity = -1
	_selected_group = -1
	_mode = ""
	_path_points = []
	_building = ""
	_build_description.visible = false
	_tower_attack_row.visible = false
	_game.visible = false
	_home.visible = true
	_set_status("Disconnected.")

func _copy_match_id() -> void:
	if _match_id_input.text.is_empty():
		_set_status("There is no match ID to copy.")
		return
	DisplayServer.clipboard_set(_match_id_input.text)
	_set_status("Match ID copied. Share it with the other player.")

func _set_status(text: String) -> void:
	if is_instance_valid(_status_label):
		_status_label.text = text

func _set_match_phase(phase: String) -> void:
	if not is_instance_valid(_phase_label):
		return
	_phase_label.text = phase.to_upper().replace("_", " ")
	match phase:
		"lobby":
			_phase_label.add_theme_color_override("font_color", Color("#f0bd68"))
		"starting":
			_phase_label.add_theme_color_override("font_color", Color("#83c6ff"))
		"running":
			_phase_label.add_theme_color_override("font_color", Color("#78e0aa"))
		"finished":
			_phase_label.add_theme_color_override("font_color", Color("#c6a4ed"))
		_:
			_phase_label.add_theme_color_override("font_color", Color("#aabbd0"))

func _match_phase_is_active() -> bool:
	return _current_match.get("status", "lobby") in ["starting", "running"]

func _restore_match_after_start_failure() -> void:
	var phase := str(_current_match.get("status", "lobby"))
	if phase != "running":
		phase = "lobby"
		_current_match["status"] = phase
	_set_match_phase(phase)
	_update_start_button()
