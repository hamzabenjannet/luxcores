extends Control

const BackendClientScript = preload("res://scripts/backend_client.gd")
const ArenaScript = preload("res://scripts/arena.gd")
const Arena3DScript = preload("res://scripts/arena_3d.gd")
const GameLogic = preload("res://scripts/game_logic.gd")
const TEAM_BLUE := Color("#3d8bff")
const TEAM_RED := Color("#ff4d4d")
## Start-menu modes, in the order of the selector.
const MODES := ["Play against bot", "Watch bot against bot", "Host a match for two"]
## The smallest window the interface still fits in. The window opens maximized and follows every resize.
const MIN_WINDOW_SIZE := Vector2i(480, 360)
## Space between the window edge and the controls, in virtual pixels.
const UI_MARGIN := 10
## Widths of the start card and of the top and bottom panels. Narrower windows get the window width less the margins.
const HOME_WIDTH := 560.0
const SHEET_WIDTH := 600.0
## The orders window: its width, and the height of a row (it shows three rows before it scrolls).
const ORDERS_WIDTH := 270.0
const ORDER_ROW_HEIGHT := 30.0
const ORDERS_VISIBLE_ROWS := 3

var _backend: Node
var _home: VBoxContainer
var _game: VBoxContainer
var _server_input: LineEdit
var _name_input: LineEdit
var _match_input: LineEdit
var _seed_input: SpinBox
var _entropy_input: LineEdit
var _limit_selector: OptionButton
var _cap_input: LineEdit
var _mode_selector: OptionButton
var _status_label: Label
var _home_card: PanelContainer
var _home_center: CenterContainer
var _top_panel: PanelContainer
var _top_box: VBoxContainer
var _bottom_sheet: PanelContainer
var _bottom_box: VBoxContainer
var _summary_card: PanelContainer
var _leave_button: Button
## The orders window (a floating log of every order made, collapsed by default) and what it needs.
var _orders_window: PanelContainer
var _orders_toggle: Button
var _orders_scroll: ScrollContainer
var _orders_list: VBoxContainer
var _order_log: Array = []
var _cancelled_ids: Array = []
var _orders_key := ""
var _orders_labels := {}
var _rejoin_button: Button
## When the Leave button was armed for a forfeit, in msec, or 0.
var _leave_armed_until := 0
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
var _order_key := ""
var _hero_box: VBoxContainer
var _hero_key := ""
var _shop_box: VBoxContainer
var _shop_key := ""
var _summary_box: VBoxContainer
var _hero_bar: HBoxContainer
var _hero_name_label: Button
var _follow_button: Button
var _ability_buttons: Array = []
var _item_bar: HBoxContainer
var _item_buttons: Array = []
## The id of the item (Energy Boost or Sluggish) whose target the next tap chooses, or -1.
var _item_aim := -1
## The tile chosen for the building in the palette, {tileX, tileZ}, or empty. The Place button sends it (GDD 11.5).
var _ghost := {}
var _place_button: Button
## A press on an aimed ability button: {slot, start (global Vector2), aiming}, or empty. A drag off the button aims.
var _hold := {}
## A click right after an aim drag must not toggle the tap-tap aim, so the button ignores presses until this time (msec).
var _ignore_press_until := 0
## The slot (1 ranged, 2 area) whose target the next tap chooses, or -1.
var _ability := -1
## Label of the chosen hero allocation, one of GameLogic.hero_lux_choices.
var _hero_alloc := "50%"
## Orders sent and not yet in a snapshot, as dim queue rows: {id, barracks_id, text, base, expires_ms}.
## expires_ms is INF until the server has answered.
var _pending: Array = []
var _pending_seq := 0
var _action_buttons: Array = []
var _order_button: Button
## The hero lux choices of the latest refresh, which a hero button reads when it is pressed.
var _hero_choices: Array = []
var _hero_note: Label
var _hero_alloc_buttons := {}
var _shop_buttons := {}
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
var _world_3d: Node3D
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
	_build_interface()
	_maximize_window()

func configure_3d_world(world: Node3D) -> void:
	_world_3d = world

func _build_interface() -> void:
	_set_dark_theme()
	# The arena is the background of the whole window and takes every tap that no control catches. The
	# controls float over it in translucent panels, so the map keeps all the space, as in the web client.
	_arena = Arena3DScript.new() if _world_3d != null else ArenaScript.new()
	if _arena is Control and _arena.has_method("set_world_root"):
		_arena.set_world_root(_world_3d)
	_arena.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_arena.tapped.connect(_on_arena_tapped)
	add_child(_arena)

	var margin := MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "top", "right", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, UI_MARGIN)
	add_child(margin)

	_build_orders_window()

	var pages := VBoxContainer.new()
	pages.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pages.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pages.size_flags_vertical = Control.SIZE_EXPAND_FILL
	pages.add_theme_constant_override("separation", 10)
	margin.add_child(pages)

	# The start screen: a card in the middle of the window that scrolls when the window is too small for it.
	_home = VBoxContainer.new()
	_home.add_theme_constant_override("separation", 12)
	_home.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_home_card = PanelContainer.new()
	_home_card.add_theme_stylebox_override("panel", _overlay_style(0.94))
	var home_scroll := ScrollContainer.new()
	home_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	home_scroll.add_child(_home)
	_home_card.add_child(home_scroll)
	_home_center = CenterContainer.new()
	_home_center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_home_center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_home_center.add_child(_home_card)
	pages.add_child(_home_center)
	# The container around the card goes with it, or it keeps its share of the height in the game.
	_home.visibility_changed.connect(func() -> void:
		_home_center.visible = _home.visible
		_fit_overlays())
	_add_field(_home, "Backend URL", "https://luxcores.webrit.cloud", "_server_input")
	_add_field(_home, "Player name", "Halo", "_name_input")
	_add_field(_home, "Match ID (blank to use the mode below)", "", "_match_input")
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
	_entropy_input = LineEdit.new()
	_entropy_input.placeholder_text = "Entropy %/s (default)"
	_entropy_input.tooltip_text = "Percent of the maximum HP that buildings, creeps and heroes lose per second, 0 to 100 with one decimal. The host of a match sets it."
	_entropy_input.custom_minimum_size = Vector2(220, 52)
	match_options.add_child(_entropy_input)
	_home.add_child(match_options)
	var limit_options := HBoxContainer.new()
	_limit_selector = OptionButton.new()
	_limit_selector.add_item("Unlimited")
	_limit_selector.add_item("Capped")
	_limit_selector.tooltip_text = "Unlimited runs until a Core falls. Capped ends as a draw at the tick limit. The host of a match sets it."
	_limit_selector.custom_minimum_size = Vector2(260, 52)
	_limit_selector.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	limit_options.add_child(_limit_selector)
	_cap_input = LineEdit.new()
	_cap_input.placeholder_text = "Tick limit (20 per second)"
	_cap_input.text = "10000"
	_cap_input.custom_minimum_size = Vector2(220, 52)
	limit_options.add_child(_cap_input)
	_home.add_child(limit_options)
	var connect_button := _make_button("CONNECT / CREATE MATCH", Color("#315f95"))
	connect_button.pressed.connect(_connect_match)
	_home.add_child(connect_button)
	# Offered when this device was in a match that it did not leave (a closed window, a crash).
	_rejoin_button = _make_button("REJOIN LAST MATCH", Color("#34577a"))
	_rejoin_button.visible = false
	_rejoin_button.pressed.connect(_rejoin_last_match)
	_home.add_child(_rejoin_button)
	_server_input.text_changed.connect(func(_text: String) -> void: _refresh_rejoin())

	_status_label = Label.new()
	_status_label.text = "Connect to a Luxcores backend to start."
	_status_label.add_theme_font_size_override("font_size", 17)
	_status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status_label.add_theme_color_override("font_color", Color("#aabbd0"))
	_status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_home.add_child(_status_label)

	_game = VBoxContainer.new()
	_game.visible = false
	_game.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_game.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_game.add_theme_constant_override("separation", 8)
	pages.add_child(_game)

	# Top: the match, its phase and the clock, the status line and the Start and Leave buttons.
	_top_panel = PanelContainer.new()
	_top_panel.add_theme_stylebox_override("panel", _overlay_style(0.8))
	_top_panel.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_game.add_child(_top_panel)
	_top_box = VBoxContainer.new()
	_top_box.add_theme_constant_override("separation", 4)
	_top_panel.add_child(_top_box)
	var match_id_row := HBoxContainer.new()
	match_id_row.add_theme_constant_override("separation", 8)
	var match_id_label := Label.new()
	match_id_label.text = "Match"
	match_id_label.add_theme_font_size_override("font_size", 16)
	match_id_row.add_child(match_id_label)
	_match_id_input = LineEdit.new()
	_match_id_input.editable = false
	_match_id_input.select_all_on_focus = true
	_match_id_input.custom_minimum_size = Vector2(120, 40)
	_match_id_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	match_id_row.add_child(_match_id_input)
	var copy_match_id_button := _make_button("COPY", Color("#34577a"))
	copy_match_id_button.custom_minimum_size = Vector2(70, 40)
	copy_match_id_button.size_flags_horizontal = Control.SIZE_SHRINK_END
	copy_match_id_button.pressed.connect(_copy_match_id)
	match_id_row.add_child(copy_match_id_button)
	_start_button = _make_button("START", Color("#287557"))
	_start_button.custom_minimum_size = Vector2(80, 40)
	_start_button.size_flags_horizontal = Control.SIZE_SHRINK_END
	_start_button.pressed.connect(_start_match)
	match_id_row.add_child(_start_button)
	_leave_button = _make_button("LEAVE", Color("#52313b"))
	_leave_button.custom_minimum_size = Vector2(80, 40)
	_leave_button.size_flags_horizontal = Control.SIZE_SHRINK_END
	_leave_button.pressed.connect(_on_leave_pressed)
	match_id_row.add_child(_leave_button)
	_top_box.add_child(match_id_row)
	var labels_row := HBoxContainer.new()
	labels_row.add_theme_constant_override("separation", 14)
	_match_label = Label.new()
	_match_label.text = ""
	_match_label.add_theme_font_size_override("font_size", 16)
	_match_label.add_theme_color_override("font_color", Color("#d5e5fa"))
	labels_row.add_child(_match_label)
	_phase_label = Label.new()
	_phase_label.text = "LOBBY"
	_phase_label.add_theme_font_size_override("font_size", 18)
	_phase_label.add_theme_color_override("font_color", Color("#f0bd68"))
	labels_row.add_child(_phase_label)
	_world_label = Label.new()
	_world_label.text = "Waiting for match snapshot"
	_world_label.add_theme_font_size_override("font_size", 17)
	_world_label.add_theme_color_override("font_color", Color("#b7c7da"))
	_world_label.clip_text = true
	_world_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	labels_row.add_child(_world_label)
	_top_box.add_child(labels_row)

	_build_description = Label.new()
	_build_description.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_build_description.add_theme_font_size_override("font_size", 15)
	_build_description.add_theme_color_override("font_color", Color("#d5e5fa"))
	_build_description.visible = false
	_top_box.add_child(_build_description)

	# The middle is the map. It only holds the end-of-match table, which shows over it.
	var middle := CenterContainer.new()
	middle.mouse_filter = Control.MOUSE_FILTER_IGNORE
	middle.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_game.add_child(middle)
	_summary_card = PanelContainer.new()
	_summary_card.visible = false
	_summary_card.add_theme_stylebox_override("panel", _overlay_style(0.94))
	middle.add_child(_summary_card)
	# The end-of-match screen (GDD 13.2), filled when the match ends.
	_summary_box = VBoxContainer.new()
	_summary_box.visible = false
	_summary_box.add_theme_constant_override("separation", 4)
	_summary_card.add_child(_summary_box)
	_summary_box.visibility_changed.connect(func() -> void: _summary_card.visible = _summary_box.visible)

	# Bottom: the build palette, the selection panel and the hero and item bars.
	_bottom_sheet = PanelContainer.new()
	_bottom_sheet.add_theme_stylebox_override("panel", _overlay_style(0.8))
	_bottom_sheet.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_game.add_child(_bottom_sheet)
	_bottom_box = VBoxContainer.new()
	_bottom_box.add_theme_constant_override("separation", 6)
	_bottom_sheet.add_child(_bottom_box)

	_palette = GridContainer.new()
	_palette.columns = 6
	_palette.add_theme_constant_override("h_separation", 10)
	_palette.add_theme_constant_override("v_separation", 10)
	_bottom_box.add_child(_palette)
	for item in GameLogic.PALETTE:
		var build_button := _make_button(item[1], Color("#24364a"))
		build_button.custom_minimum_size = Vector2(0, 46)
		build_button.add_theme_font_size_override("font_size", 15)
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
	_bottom_box.add_child(_tower_attack_row)

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
	# The queue is not here: the orders window keeps it, so a new order never moves a button of this panel.
	_order_box = VBoxContainer.new()
	_order_box.add_theme_constant_override("separation", 6)
	_panel.add_child(_order_box)
	_hero_box = VBoxContainer.new()
	_hero_box.add_theme_constant_override("separation", 6)
	_panel.add_child(_hero_box)
	_shop_box = VBoxContainer.new()
	_shop_box.add_theme_constant_override("separation", 6)
	_panel.add_child(_shop_box)
	_bottom_box.add_child(_panel)

	# The hero bar: the hero's label and its four abilities, M R A S. It shows while a hero lives.
	_hero_bar = HBoxContainer.new()
	_hero_bar.visible = false
	_hero_bar.add_theme_constant_override("separation", 8)
	# A tap on the hero's name recenters the camera and resumes follow (GDD 11.1, the hero portrait).
	_hero_name_label = _make_button("", Color("#1b2a3b"))
	_hero_name_label.flat = true
	_hero_name_label.add_theme_font_size_override("font_size", 18)
	_hero_name_label.custom_minimum_size = Vector2(120, 52)
	_hero_name_label.size_flags_horizontal = Control.SIZE_FILL
	_hero_name_label.pressed.connect(_recenter_on_hero)
	_hero_bar.add_child(_hero_name_label)
	_follow_button = _make_button("Follow", Color("#24364a"))
	_follow_button.custom_minimum_size = Vector2(90, 52)
	_follow_button.pressed.connect(_toggle_follow)
	_hero_bar.add_child(_follow_button)
	for ability_def in GameLogic.ABILITY_SLOTS:
		var ability_button := _make_button(String(ability_def.letter), Color("#24364a"))
		ability_button.custom_minimum_size = Vector2(0, 52)
		ability_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		ability_button.pressed.connect(_on_ability_pressed.bind(int(ability_def.slot)))
		if String(ability_def.aim) != "none":
			ability_button.gui_input.connect(_on_ability_gui_input.bind(int(ability_def.slot), ability_button))
		_hero_bar.add_child(ability_button)
		_ability_buttons.append(ability_button)
	_bottom_box.add_child(_hero_bar)
	# The item bar: one quick slot per item, with how many the hero holds. It shows while a hero lives.
	_item_bar = HBoxContainer.new()
	_item_bar.visible = false
	_item_bar.add_theme_constant_override("separation", 8)
	_bottom_box.add_child(_item_bar)

	get_viewport().size_changed.connect(_fit_overlays)
	_fit_overlays.call_deferred()

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
	var dark_theme := Theme.new()
	dark_theme.set_color("font_color", "Label", Color("#e4edf8"))
	dark_theme.set_color("font_color", "Button", Color("#f4f7fc"))
	dark_theme.set_color("font_hover_color", "Button", Color.WHITE)
	dark_theme.set_font_size("font_size", "Button", 19)
	dark_theme.set_font_size("font_size", "LineEdit", 20)
	dark_theme.set_font_size("font_size", "SpinBox", 18)
	dark_theme.set_color("font_color", "LineEdit", Color("#f3f6fb"))
	dark_theme.set_color("font_placeholder_color", "LineEdit", Color("#78889b"))
	dark_theme.set_stylebox("normal", "LineEdit", _panel_style(Color("#111d2b")))
	dark_theme.set_stylebox("focus", "LineEdit", _panel_style(Color("#17283c")))
	dark_theme.set_stylebox("normal", "SpinBox", _panel_style(Color("#111d2b")))
	self.theme = dark_theme

## Opens at the largest window the screen allows. The scene stretches with the window (project.godot:
## canvas_items with an expanding aspect), so the interface and the 3D view follow every resize. Phones and
## the web build already fill the screen, and a headless run has no window to change.
func _maximize_window() -> void:
	var window := get_window()
	window.min_size = MIN_WINDOW_SIZE
	if OS.has_feature("pc") and DisplayServer.get_name() != "headless":
		window.mode = Window.MODE_MAXIMIZED

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
	var capped := _limit_selector.selected == 1
	var cap_ticks := GameLogic.tick_cap_from_text(_cap_input.text)
	if capped and cap_ticks < 0 and _match_input.text.strip_edges() == "":
		_set_status("The tick limit is a whole number from 1 to %d." % GameLogic.MAX_TICK_CAP)
		return
	_set_status("Signing in and opening the match...")
	var result: Dictionary = await _backend.connect_match({
		"server": _server_input.text,
		"name": _name_input.text,
		"match_id": _match_input.text,
		"vs_bot": _mode_selector.selected == 0,
		"bot_vs_bot": _mode_selector.selected == 1,
		"seed": int(_seed_input.value),
		"entropy": _entropy_input.text,
		"max_ticks": cap_ticks if capped else 0,
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
	_arena.set_balance(_data.balance, _data.heroes, _data.items)
	_tick_hz = int(_backend.get_spec().get("tickHz", 20))
	_match_id_input.text = _backend.get_match_id()
	_show_page(true)
	var spectator := _role == "spectator"
	_palette.visible = not spectator
	_match_label.text = "WATCHING BOTS" if spectator else "Team %d  •  %s" % [
		_viewer_team,
		"HOST" if _is_host else "PLAYER",
	]
	_set_match_phase(str(_current_match.get("status", "lobby")))
	_update_start_button()
	_refresh_palette()
	var rules_text := "Entropy %s%% per second. Tick limit: %s." % [
		GameLogic.entropy_text(int(_current_match.get("entropyPermillePerSecond", _data.balance.economy.entropyPermillePerSecond))),
		GameLogic.tick_cap_text(int(_current_match.get("maxTicks", _backend.get_spec().get("matchMaxTicks", 0)))),
	]
	if _is_host:
		_set_status("Lobby connected. %s Start the match when ready." % rules_text)
	else:
		_set_status("Lobby connected. %s Waiting for the host to start the match." % rules_text)
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
	_item_aim = -1
	_selected_group = -1
	_mode = ""
	_path_points = []
	# A second press on the same building puts it back.
	_building = "" if _building == building else building
	_ghost = {}
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
	var title := building.capitalize()
	match building:
		"solar":
			title = "Solar collector"
		"wind":
			title = "Wind collector"
		"geothermal":
			title = "Geothermal collector"
	var description := "%s costs %d lux. Tap a free tile in your build zone." % [
		title,
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
		"item": _item_aim,
	})
	if result.has("command"):
		_ability = -1
		_item_aim = -1
		# A placed building ends build mode at once, so a second tap cannot place a second one.
		if GameLogic.ends_build_mode(result.command):
			_building = ""
			_build_description.visible = false
			_tower_attack_row.visible = false
			_arena.set_selection(_building, _selected_entity)
			_refresh_palette()
		if result.get("deselect", false):
			_selected_entity = -1
			_selected_group = -1
		var acknowledgement: Dictionary = await _backend.send_command(result.command)
		if acknowledgement.get("accepted", false):
			_set_status("Order sent. The server will validate it.")
		if _mode == "merge":
			_mode = ""
	elif result.has("ghost"):
		_ghost = result.ghost
		if result.has("message"):
			_set_status(String(result.message))
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
	_update_orders_window()
	if _building.is_empty():
		_ghost = {}
	if _ghost.is_empty():
		_arena.clear_ghost()
	else:
		_arena.set_ghost(Vector2i(int(_ghost.tileX), int(_ghost.tileZ)), not _ghost_check().has("message"))
	var now_ms := float(Time.get_ticks_msec())
	_pending = _pending.filter(func(entry: Dictionary) -> bool:
		return GameLogic.pending_kept(int(entry.base), float(entry.expires_ms), _real_order_count(int(entry.barracks_id)), now_ms))
	if _mode == "path":
		_show_path_bar()
		return
	if not _building.is_empty() and not _ghost.is_empty():
		_show_ghost_panel()
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
		_shop_key = ""
		_clear_box(_shop_box)
		return
	_show_building_panel(selected)

## The placement check for the ghost tile with the lux of now.
func _ghost_check() -> Dictionary:
	return GameLogic.placement({
		"tile_x": int(_ghost.tileX), "tile_z": int(_ghost.tileZ), "entities": _current_snapshot.get("entities", []),
		"viewer_team": _viewer_team, "building": _building, "attack": GameLogic.ATTACK_TYPES[_tower_attack_selector.selected],
		"core_lux_milli": _viewer_core_lux_milli(), "data": _data, "vents": _current_map.get("vents", []),
	})

## Place and Cancel for the ghost, and why the ghost is red when it is.
func _show_ghost_panel() -> void:
	_panel.visible = true
	_clear_box(_order_box)
	_clear_box(_hero_box)
	_clear_box(_shop_box)
	_order_key = ""
	_hero_key = ""
	_shop_key = ""
	var check := _ghost_check()
	var title := "%s at %d, %d" % [_building.capitalize(), int(_ghost.tileX), int(_ghost.tileZ)]
	if check.has("message"):
		title += ": " + String(check.message)
	_panel_title.text = title
	var key := "ghost|" + _building
	if key != _panel_key or not is_instance_valid(_place_button):
		_panel_key = key
		_clear_box(_panel_row)
		_place_button = _make_button("Place  %d" % int(_data.buildings[_building].costLux), Color("#1d5a43"))
		_place_button.custom_minimum_size = Vector2(0, 48)
		_place_button.name = "PlaceGhost"
		_place_button.pressed.connect(_place_ghost)
		_panel_row.add_child(_place_button)
		var cancel_button := _make_button("Cancel", Color("#52313b"))
		cancel_button.custom_minimum_size = Vector2(0, 48)
		cancel_button.name = "CancelGhost"
		cancel_button.pressed.connect(_cancel_ghost)
		_panel_row.add_child(cancel_button)
	_place_button.modulate = Color(1, 1, 1, 0.5) if check.has("message") else Color.WHITE

func _cancel_ghost() -> void:
	_ghost = {}
	_refresh_panel()

## Sends the build for the ghost tile. A placed building ends build mode at once, so a second tap cannot place a second one.
func _place_ghost() -> void:
	var check := _ghost_check()
	if check.has("message"):
		_set_status(String(check.message))
		return
	_building = ""
	_ghost = {}
	_build_description.visible = false
	_tower_attack_row.visible = false
	_arena.set_selection(_building, _selected_entity)
	_refresh_palette()
	_refresh_panel()
	_run_panel_action(check.command)

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
	_order_key = ""
	_hero_key = ""
	_shop_key = ""
	_clear_box(_shop_box)
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
	_order_key = ""
	_hero_key = ""
	_shop_key = ""
	_clear_box(_shop_box)
	var member_count := GameLogic.group_size(_current_snapshot.get("entities", []), int(group.id))
	_panel_title.text = "Group of %d: tap another of your groups to merge." % member_count if _mode == "merge" else "Group of %d, %s" % [member_count, "custom path" if int(group.get("custom", 0)) == 1 else "lane route"]
	var actions := GameLogic.group_actions(member_count, int(group.get("custom", 0)) == 1)
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
	# The key holds the action ids only: whether an upgrade is affordable changes with the lux, and a button
	# replaced between press and release loses the click. The dimming follows in place below.
	var key := str(selected.id)
	for action in actions:
		key += "|%s" % action.id
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
		_action_buttons = _panel_row.get_children()
	for index in actions.size():
		if index < _action_buttons.size():
			var poor: bool = actions[index].has("costLux") and not GameLogic.can_afford(lux, int(actions[index].costLux), min_left)
			(_action_buttons[index] as Button).modulate = Color(1, 1, 1, 0.5) if poor else Color.WHITE
	if int(selected.kind) == GameLogic.KIND_BARRACKS and int(selected.get("recycle", 0)) == 0:
		_show_barracks_controls(selected, lux, min_left)
	else:
		_clear_box(_order_box)
		_clear_box(_hero_box)
		_order_key = ""
		_hero_key = ""
		_shop_key = ""
		_clear_box(_shop_box)

## Creep order controls and the queue of a barracks.
func _show_barracks_controls(barracks: Dictionary, lux: int, min_left: int) -> void:
	var creep: Dictionary = _data.balance.creep
	var cost := _order_count * int(creep.costLux)
	var poor := not GameLogic.can_afford(lux, cost, min_left)
	var waypoints: Array = barracks.get("waypoints", [])
	var order_key := "%d|%d|%s|%d" % [int(barracks.id), _order_count, _order_type, waypoints.size()]
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
		_order_button = _make_button("Order %d creeps  %d lux" % [_order_count, cost], Color("#287557"))
		_order_button.custom_minimum_size = Vector2(0, 48)
		_order_button.pressed.connect(_run_panel_action.bind({"t": "orderCreeps", "barracksId": int(barracks.id), "mix": GameLogic.mix_for(_order_count, _order_type)}))
		_order_box.add_child(_order_button)
		var path_button := _make_button("Default Path" if not waypoints.is_empty() else "Set Default Path", Color("#2f4c75"))
		path_button.custom_minimum_size = Vector2(0, 48)
		path_button.pressed.connect(_start_barracks_path.bind(int(barracks.id)))
		_order_box.add_child(path_button)
		if not waypoints.is_empty():
			var clear_button := _make_button("Clear Path", Color("#52313b"))
			clear_button.custom_minimum_size = Vector2(0, 48)
			clear_button.pressed.connect(_run_panel_action.bind({"t": "setBarracksPath", "barracksId": int(barracks.id), "waypoints": []}))
			_order_box.add_child(clear_button)

	if is_instance_valid(_order_button):
		_order_button.modulate = Color(1, 1, 1, 0.5) if poor else Color.WHITE
	_show_hero_picks(barracks, lux, min_left)
	_show_shop(barracks, lux, min_left)

## Item names by item id, from data/items.json.
func _item_names() -> Array:
	var names: Array = []
	for entry in _data.get("items", {}).get("list", []):
		names.append(String(entry.name))
	return names

func _item_list() -> Array:
	return _data.get("items", {}).get("list", [])

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
	_hero_choices = choices
	# The key holds labels and flags only: the amounts follow the Core's lux every tick, and a button
	# replaced between press and release loses the click. The texts update in place below.
	var key := "%d" % int(barracks.id)
	for option in pick_state.options:
		key += "|%d%s%s" % [int(option.id), "L" if option.locked else "", "E" if option.enabled else ""]
	for choice in choices:
		key += "|" + String(choice.label)
	key += "|" + (String(chosen.label) if not chosen.is_empty() else "")
	if key != _hero_key:
		_hero_key = key
		_hero_alloc_buttons.clear()
		_clear_box(_hero_box)
		_hero_note = Label.new()
		_hero_note.add_theme_font_size_override("font_size", 15)
		_hero_note.add_theme_color_override("font_color", Color("#8a93a6"))
		_hero_box.add_child(_hero_note)
		var allocation := HBoxContainer.new()
		allocation.add_theme_constant_override("separation", 6)
		for choice in choices:
			var alloc_button := _make_button("", Color("#315f95") if choice == chosen else Color("#24364a"))
			alloc_button.custom_minimum_size = Vector2(0, 44)
			alloc_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			alloc_button.pressed.connect(_set_hero_alloc.bind(String(choice.label)))
			allocation.add_child(alloc_button)
			_hero_alloc_buttons[String(choice.label)] = alloc_button
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
			hero_button.pressed.connect(_pick_hero.bind(int(option.id), int(barracks.id)))
			heroes.add_child(hero_button)
		_hero_box.add_child(heroes)
	var note_text := "Hero: %s" % pick_state.note if not String(pick_state.note).is_empty() else "Hero: pick one, with the lux below"
	if is_instance_valid(_hero_note) and _hero_note.text != note_text:
		_hero_note.text = note_text
	for choice in choices:
		var alloc: Button = _hero_alloc_buttons.get(String(choice.label))
		if alloc != null:
			var alloc_text := "%s %d" % [choice.label, int(choice.lux)]
			if alloc.text != alloc_text:
				alloc.text = alloc_text

## The item part of a barracks panel (GDD 8.1): one button per item with its price. A bought item
## waits in the queue and reaches the hero's inventory when it is built.
func _show_shop(barracks: Dictionary, lux: int, min_left: int) -> void:
	var shop := GameLogic.shop_states(_item_list(), lux, min_left)
	var key := str(int(barracks.id))
	for entry in shop:
		key += "|%d" % int(entry.id)
	if key != _shop_key:
		_shop_key = key
		_shop_buttons.clear()
		_clear_box(_shop_box)
		var note := Label.new()
		note.add_theme_font_size_override("font_size", 15)
		note.add_theme_color_override("font_color", Color("#8a93a6"))
		note.text = "Items: bought here, carried by your hero"
		_shop_box.add_child(note)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		for entry in shop:
			var item_button := _make_button("%s %d" % [entry.name, int(entry.costLux)], Color("#24364a"))
			item_button.custom_minimum_size = Vector2(0, 44)
			item_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			item_button.name = "ShopItem%d" % int(entry.id)
			item_button.pressed.connect(_run_panel_action.bind({"t": "orderItem", "barracksId": int(barracks.id), "itemId": int(entry.id)}))
			row.add_child(item_button)
			_shop_buttons[int(entry.id)] = item_button
		_shop_box.add_child(row)
	for entry in shop:
		var shop_button: Button = _shop_buttons.get(int(entry.id))
		if shop_button != null:
			shop_button.modulate = Color(1, 1, 1, 0.5) if bool(entry.poor) else Color.WHITE

func _set_hero_alloc(label: String) -> void:
	_hero_alloc = label
	_refresh_panel()

func _pick_hero(hero_id: int, barracks_id: int) -> void:
	var chosen: Dictionary = {}
	for choice in _hero_choices:
		if String(choice.label) == _hero_alloc:
			chosen = choice
	if chosen.is_empty() and not _hero_choices.is_empty():
		chosen = _hero_choices[0]
	if chosen.is_empty():
		_set_status("Not enough lux for a hero.")
		return
	_run_panel_action({"t": "pickHero", "heroId": hero_id, "lux": int(chosen.lux), "barracksId": barracks_id})

## The hero bar: the ability buttons show the letter and cost, or the seconds until ready.
func _refresh_hero_bar() -> void:
	var hero := _viewer_hero()
	if hero.is_empty() or _data.is_empty():
		_hero_bar.visible = false
		_item_bar.visible = false
		_ability = -1
		_item_aim = -1
		return
	_hero_bar.visible = true
	_follow_button.flat = not _arena.is_following()
	_hero_name_label.text = GameLogic.entity_text(hero, _data.balance.hpFactor, _hero_names(), _item_names())
	_refresh_item_bar()
	var states := GameLogic.ability_states(hero, _data.abilities, _viewer_core_lux_milli(), int(_data.balance.core.minLeftAfterSpendLux), _tick_hz)
	for state in states:
		var button: Button = _ability_buttons[int(state.slot)]
		button.text = String(state.text)
		var dim: bool = not bool(state.ready) or bool(state.poor)
		button.modulate = Color(1, 1, 1, 0.5 if dim else 1.0)
		button.flat = _ability != int(state.slot)

## The hero's name was tapped: follow the hero again.
func _recenter_on_hero() -> void:
	_arena.set_follow(true)
	_refresh_hero_bar()

## A click on an ability button, unless it ends an aim drag.
func _on_ability_pressed(slot: int) -> void:
	if Time.get_ticks_msec() < _ignore_press_until:
		return
	_cast_from_bar(slot)

## Hold-to-aim: press an aimed ability button, drag onto the map and lift to cast there. Lifting back over the
## button cancels, and a press that stays on it is a plain click (GameLogic.hold_aim_release).
func _on_ability_gui_input(event: InputEvent, slot: int, button: Button) -> void:
	var global_point := Vector2.ZERO
	var down := false
	var is_pointer := false
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		is_pointer = true
		down = event.pressed
		global_point = button.get_global_transform_with_canvas() * event.position
	elif event is InputEventScreenTouch:
		is_pointer = true
		down = event.pressed
		global_point = button.get_global_transform_with_canvas() * event.position
	elif event is InputEventMouseMotion or event is InputEventScreenDrag:
		global_point = button.get_global_transform_with_canvas() * event.position
	else:
		return
	if is_pointer and down:
		if _hold.is_empty() and not _viewer_hero().is_empty():
			_hold = {"slot": slot, "start": global_point, "aiming": false}
		return
	if _hold.is_empty() or int(_hold.slot) != slot:
		return
	var over_button := button.get_global_rect().has_point(global_point)
	if is_pointer:
		var aiming := bool(_hold.aiming)
		_hold = {}
		_arena.clear_aim()
		if not aiming:
			return
		_ignore_press_until = Time.get_ticks_msec() + 200
		var what := GameLogic.hold_aim_release(true, over_button)
		var ground: Dictionary = _arena.ground_at_global(global_point)
		if what == "cast" and not ground.is_empty():
			_on_arena_tapped(ground.ground)
		# A refused cast (no enemy under the finger) ends the aim too: the drag was the whole gesture.
		if _ability == slot:
			_ability = -1
		_refresh_hero_bar()
		return
	if not bool(_hold.aiming):
		if GameLogic.hold_aim_phase((global_point - (_hold.start as Vector2)).length()) != "aiming":
			return
		var hero := _viewer_hero()
		var state: Dictionary = GameLogic.ability_states(hero, _data.abilities, _viewer_core_lux_milli(), int(_data.balance.core.minLeftAfterSpendLux), _tick_hz)[slot]
		if not bool(state.ready):
			_hold = {} # not ready: the release is a plain click, which says why
			return
		_hold["aiming"] = true
		_ability = slot
		_item_aim = -1
		_building = ""
		_ghost = {}
		_selected_entity = -1
		_selected_group = -1
		_mode = ""
		_build_description.visible = false
		_tower_attack_row.visible = false
		_refresh_hero_bar()
	var ground: Dictionary = _arena.ground_at_global(global_point)
	if over_button or ground.is_empty():
		_arena.clear_aim()
	else:
		_arena.set_aim(ground.ground)

## The camera follows the hero while on; dragging the map turns it off.
func _toggle_follow() -> void:
	_arena.set_follow(not _arena.is_following())
	_refresh_hero_bar()

## The item quick slots under the ability buttons: the short name and how many the hero holds.
func _refresh_item_bar() -> void:
	var items := _item_list()
	if _item_buttons.is_empty() and not items.is_empty():
		for entry in items:
			var item_button := _make_button(GameLogic.item_short_name(String(entry.name)), Color("#2b3a2f"))
			item_button.custom_minimum_size = Vector2(0, 44)
			item_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			item_button.name = "Item%d" % int(entry.id)
			item_button.pressed.connect(_use_from_bar.bind(int(entry.id)))
			_item_bar.add_child(item_button)
			_item_buttons.append(item_button)
	_item_bar.visible = not _item_buttons.is_empty()
	var player := _viewer_player()
	for state in GameLogic.item_states(items, player.get("items", []), int(player.get("funnelLux", 0))):
		var item_button: Button = _item_buttons[int(state.id)]
		item_button.text = String(state.text)
		item_button.modulate = Color(1, 1, 1, 1.0 if bool(state.ready) else 0.5)
		item_button.flat = not (bool(state.active) or _item_aim == int(state.id))

## An item button: self items apply at once, the others wait for a tap on the target.
func _use_from_bar(id: int) -> void:
	if _viewer_hero().is_empty():
		return
	var player := _viewer_player()
	var state: Dictionary = GameLogic.item_states(_item_list(), player.get("items", []), int(player.get("funnelLux", 0)))[id]
	if not bool(state.ready):
		_set_status("Energy Grab is running." if bool(state.active) else "You hold no %s." % String(_item_names()[id]))
		return
	var use := GameLogic.immediate_use(id, _item_list())
	_ability = -1
	if not use.is_empty():
		_item_aim = -1
		_run_panel_action(use)
	elif _item_aim == id:
		_item_aim = -1
	else:
		_item_aim = id
		_building = ""
		_selected_entity = -1
		_selected_group = -1
		_mode = ""
		_build_description.visible = false
		_tower_attack_row.visible = false
		_set_status("Tap your hero or a building." if String(state.aim) == "ally" else "Tap an enemy hero or creep.")
	_arena.set_selection(_building, _selected_entity)
	_refresh_palette()
	_refresh_panel()

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
		_item_aim = -1
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

## The real orders of one barracks in the latest snapshot.
func _real_order_count(barracks_id: int) -> int:
	var count := 0
	for order in _current_snapshot.get("orders", []):
		if int(order.get("barracksId", -1)) == barracks_id:
			count += 1
	return count

## Sends a command. A barracks order shows in the queue at once as a dim row, and the row goes away when
## the snapshot has the real one, when the server refuses it, or a few seconds after the server accepted it.
func _run_panel_action(command: Dictionary) -> void:
	var text := GameLogic.pending_line(command, _hero_names(), _item_names())
	var mark := {}
	if not text.is_empty() and command.has("barracksId"):
		var barracks_id := int(command.barracksId)
		var waiting := 0
		for entry in _pending:
			if int(entry.barracks_id) == barracks_id:
				waiting += 1
		_pending_seq += 1
		# The order is in a snapshot once the real count passes this base.
		mark = {"id": _pending_seq, "barracks_id": barracks_id, "text": text, "base": _real_order_count(barracks_id) + waiting, "expires_ms": INF}
		_pending.append(mark)
		_refresh_panel()
	var acknowledgement: Dictionary = await _backend.send_command(command)
	if acknowledgement.get("accepted", false):
		if not mark.is_empty():
			mark["expires_ms"] = float(Time.get_ticks_msec()) + GameLogic.PENDING_MS
		if String(command.get("t", "")) == "cancelQueue":
			_cancelled_ids.append(int(command.orderId)) # the log shows it as cancelled, not as done
		_set_status("Order sent. The server will validate it.")
	elif not mark.is_empty():
		_pending = _pending.filter(func(entry: Dictionary) -> bool: return int(entry.id) != int(mark.id))
		_refresh_panel()

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
	_backend.forget_match() # a finished match is nothing to rejoin
	_current_match["status"] = "finished"
	_set_match_phase("finished")
	_update_start_button()
	var summary := GameLogic.match_summary(result, _viewer_team, _role == "spectator", int(result.get("endedTick", 0)), _tick_hz)
	_set_status("%s (%s)." % [summary.title, summary.reason])
	_show_summary(summary)

## Fills the end-of-match box: the title and duration, then one row per counter with a value for each side.
func _show_summary(summary: Dictionary) -> void:
	_clear_box(_summary_box)
	var title := Label.new()
	title.text = "%s   %s" % [summary.title, summary.duration]
	title.add_theme_font_size_override("font_size", 24)
	_summary_box.add_child(title)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 18)
	var header := Label.new()
	header.text = ""
	grid.add_child(header)
	for column in summary.columns:
		var column_label := Label.new()
		column_label.text = String(column)
		column_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		column_label.add_theme_color_override("font_color", Color("#8a93a6"))
		grid.add_child(column_label)
	for row in summary.rows:
		var name_label := Label.new()
		name_label.text = String(row.label)
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(name_label)
		for value in row.values:
			var value_label := Label.new()
			value_label.text = str(int(value))
			value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			grid.add_child(value_label)
	_summary_box.add_child(grid)
	var summary_buttons := HBoxContainer.new()
	summary_buttons.add_theme_constant_override("separation", 10)
	var close_summary := _make_button("CLOSE", Color("#34577a"))
	close_summary.custom_minimum_size = Vector2(0, 44)
	close_summary.pressed.connect(func() -> void: _summary_box.visible = false)
	summary_buttons.add_child(close_summary)
	var back_to_menu := _make_button("BACK TO MENU", Color("#52313b"))
	back_to_menu.custom_minimum_size = Vector2(0, 44)
	back_to_menu.name = "BackToMenu"
	back_to_menu.pressed.connect(_leave_match)
	summary_buttons.add_child(back_to_menu)
	_summary_box.add_child(summary_buttons)
	_summary_box.visible = true

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
	@warning_ignore("integer_division")
	var seconds := tick / _tick_hz
	var day := GameLogic.is_day(tick, _data.balance.dayNight) if not _data.is_empty() else true
	@warning_ignore("integer_division")
	var minutes := seconds / 60
	_world_label.text = "%s · %02d:%02d %s · %s %.0f · %s %.0f" % [
		"RUNNING", minutes, seconds % 60, "DAY" if day else "NIGHT",
		"Blue" if _role == "spectator" else "Core", mine,
		"Red" if _role == "spectator" else "Enemy", other,
	]
	_world_label.add_theme_color_override("font_color", TEAM_BLUE if _viewer_team == 0 else TEAM_RED)

## The LEAVE button. In a running match for two humans the first press only arms the button, because leaving
## forfeits the match; the second press within three seconds leaves. Everything else leaves at once.
## The orders window: a small floating window at the top right, collapsed by default, that logs every order the player
## made and shows the timer of the ones still in a queue. It sits outside the barracks panel, so a new order never
## pushes that panel's buttons around, and it shows three rows before it scrolls.
func _build_orders_window() -> void:
	_orders_window = PanelContainer.new()
	_orders_window.visible = false
	_orders_window.add_theme_stylebox_override("panel", _overlay_style(0.9))
	_orders_window.anchor_left = 1.0
	_orders_window.anchor_right = 1.0
	_orders_window.offset_left = -(ORDERS_WIDTH + UI_MARGIN)
	_orders_window.offset_right = -UI_MARGIN
	_orders_window.offset_top = UI_MARGIN
	_orders_window.grow_vertical = Control.GROW_DIRECTION_END
	add_child(_orders_window)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	_orders_window.add_child(box)
	_orders_toggle = Button.new()
	_orders_toggle.flat = true
	_orders_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_orders_toggle.focus_mode = Control.FOCUS_NONE
	_orders_toggle.add_theme_font_size_override("font_size", 16)
	_orders_toggle.pressed.connect(func() -> void:
		_orders_scroll.visible = not _orders_scroll.visible
		_update_orders_toggle()
		_fit_overlays())
	box.add_child(_orders_toggle)
	_orders_scroll = ScrollContainer.new()
	_orders_scroll.visible = false # collapsed by default
	_orders_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_orders_scroll.custom_minimum_size = Vector2(ORDERS_WIDTH - 20.0, ORDER_ROW_HEIGHT * ORDERS_VISIBLE_ROWS)
	box.add_child(_orders_scroll)
	_orders_list = VBoxContainer.new()
	_orders_list.add_theme_constant_override("separation", 0)
	_orders_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_orders_scroll.add_child(_orders_list)
	_update_orders_toggle()

func _update_orders_toggle() -> void:
	var queued := 0
	for entry in _order_log:
		if String(entry.state) == "queued":
			queued += 1
	queued += _pending.size()
	var text := "Orders (%d) %s" % [queued, "▾" if _orders_scroll.visible else "▸"]
	if _orders_toggle.text != text:
		_orders_toggle.text = text

## Logs the player's orders from the latest snapshot and redraws the window: the rows are rebuilt only when
## they change, and the timers update in place.
func _update_orders_window() -> void:
	if _orders_window == null or _role == "spectator":
		return
	var orders: Array = _current_snapshot.get("orders", [])
	_order_log = GameLogic.update_order_log(_order_log, orders, _viewer_team, int(_current_snapshot.get("tick", 0)), _cancelled_ids, _hero_names(), _item_names())
	_cancelled_ids = []
	var rows := GameLogic.log_rows(_order_log, orders, _tick_hz)
	var key := ""
	for entry in _pending:
		key += "p%d," % int(entry.id)
	key += "|"
	for row in rows:
		key += "%d:%s," % [int(row.id), String(row.state)]
	if key != _orders_key:
		_orders_key = key
		_orders_labels.clear()
		_clear_box(_orders_list)
		for entry in _pending:
			var pending_row := _order_row("...", String(entry.text), false)
			pending_row.modulate = Color(1, 1, 1, 0.55)
			_orders_list.add_child(pending_row)
		for row in rows:
			var order_row := _order_row(String(row.time), String(row.text), bool(row.canCancel))
			if String(row.state) != "queued":
				order_row.modulate = Color(1, 1, 1, 0.6)
			if bool(row.canCancel):
				order_row.get_child(2).pressed.connect(_run_panel_action.bind({"t": "cancelQueue", "barracksId": int(row.barracksId), "orderId": int(row.id)}))
			_orders_labels[int(row.id)] = order_row.get_child(1)
			_orders_list.add_child(order_row)
	else:
		for row in rows:
			var label: Label = _orders_labels.get(int(row.id))
			if label != null and label.text != String(row.text):
				label.text = String(row.text)
	_update_orders_toggle()

## One row of the window: the match time, the order, and a cancel button for a queued order.
func _order_row(time_text: String, text: String, can_cancel: bool) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.custom_minimum_size.y = ORDER_ROW_HEIGHT
	row.add_theme_constant_override("separation", 6)
	var time_label := Label.new()
	time_label.text = time_text
	time_label.add_theme_font_size_override("font_size", 14)
	time_label.add_theme_color_override("font_color", Color("#8a93a6"))
	row.add_child(time_label)
	var label := Label.new()
	label.text = text
	label.clip_text = true
	label.add_theme_font_size_override("font_size", 14)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(label)
	var cancel := _make_button("✕", Color("#52313b"))
	cancel.custom_minimum_size = Vector2(36, 24)
	cancel.size_flags_horizontal = Control.SIZE_SHRINK_END
	cancel.disabled = not can_cancel
	cancel.visible = can_cancel
	row.add_child(cancel)
	return row

func _on_leave_pressed() -> void:
	var status := str(_current_match.get("status", "lobby"))
	var humans := 0
	for entry in _current_match.get("players", []):
		if str(entry.get("kind", "")) == "human":
			humans += 1
	if GameLogic.leave_needs_confirm(status, _role, humans) and Time.get_ticks_msec() > _leave_armed_until:
		_leave_armed_until = Time.get_ticks_msec() + 3000
		_leave_button.text = "FORFEIT?"
		_set_status("Leaving forfeits this match. Press the button again to leave.")
		await get_tree().create_timer(3.0).timeout
		_leave_button.text = "LEAVE"
		return
	await _leave_match()

## Tells the server (a lobby seat is freed or cancelled, a running match is stopped or forfeited), closes the
## connection and returns to the start screen.
func _leave_match() -> void:
	var leave_action := GameLogic.leave_call(str(_current_match.get("status", "lobby")), _role, _is_host)
	_leave_button.disabled = true
	await _backend.leave_match(leave_action)
	_leave_button.disabled = false
	_leave_button.text = "LEAVE"
	_leave_armed_until = 0
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
	_ghost = {}
	_order_log = []
	_cancelled_ids = []
	_orders_key = ""
	_pending = []
	_build_description.visible = false
	_tower_attack_row.visible = false
	_arena.clear_ghost()
	_arena.set_world({}, {}, 0) # the map and the units of the match leave the screen
	_summary_box.visible = false
	_show_page(false)
	_set_status("Disconnected.")

## Shows the start screen or the game. The status line moves with it: into the card at the start, under the match
## information in the game.
## Shows the rejoin button when this device remembers a match on the server in the address field.
func _refresh_rejoin() -> void:
	if _rejoin_button == null or _server_input == null:
		return
	var remembered: String = _backend.remembered_match(_server_input.text)
	_rejoin_button.visible = not remembered.is_empty()
	_rejoin_button.text = "REJOIN LAST MATCH (%s)" % remembered.substr(0, 8)

func _rejoin_last_match() -> void:
	_match_input.text = _backend.remembered_match(_server_input.text)
	await _connect_match()

func _show_page(in_game: bool) -> void:
	_home.visible = not in_game
	_game.visible = in_game
	_arena.visible = in_game # the zoom buttons belong to the game, not to the start screen
	_orders_window.visible = in_game and _role != "spectator"
	var target: Node = _top_box if in_game else _home
	if _status_label.get_parent() != target:
		_status_label.reparent(target)
	if not in_game:
		_refresh_rejoin()
	_fit_overlays()

func _overlay_style(alpha: float) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.03, 0.05, 0.09, alpha)
	style.border_color = Color("#2c4057")
	style.set_border_width_all(1)
	style.set_corner_radius_all(10)
	style.set_content_margin_all(10)
	return style

## Sizes the floating panels to the window: the cards keep their width on a big window and shrink to the window
## on a small one, and the start card is no taller than the window (it scrolls).
func _fit_overlays() -> void:
	if _home_card == null:
		return
	var room := get_viewport_rect().size - Vector2(UI_MARGIN * 2, UI_MARGIN * 2)
	_home_card.custom_minimum_size = Vector2(minf(HOME_WIDTH, room.x), minf(_home.get_combined_minimum_size().y + 24.0, room.y))
	_top_panel.custom_minimum_size.x = minf(SHEET_WIDTH, room.x)
	# The orders window sits at the top right; a window too narrow for it beside the top panel gets it below.
	var beside := room.x >= SHEET_WIDTH + 2.0 * (ORDERS_WIDTH + UI_MARGIN)
	_orders_window.offset_top = UI_MARGIN if beside else _top_panel.get_combined_minimum_size().y + UI_MARGIN * 2.0
	_bottom_sheet.custom_minimum_size.x = minf(SHEET_WIDTH, room.x)

func _copy_match_id() -> void:
	if _match_id_input.text.is_empty():
		_set_status("There is no match ID to copy.")
		return
	DisplayServer.clipboard_set(_match_id_input.text)
	_set_status("Match ID copied. Share it with the other player.")

func _set_status(text: String) -> void:
	if is_instance_valid(_status_label):
		_status_label.text = text
		_fit_overlays.call_deferred()

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
