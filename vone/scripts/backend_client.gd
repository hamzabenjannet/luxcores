extends Node

signal snapshot_received(snapshot: Dictionary)
signal match_status_changed(status: String, details: Dictionary)
signal match_ended(result: Dictionary)
signal message_received(message: String)

const GameLogic = preload("res://scripts/game_logic.gd")
const REQUEST_TIMEOUT_SECONDS := 10.0

var _http: HTTPRequest
var _socket := WebSocketPeer.new()
var _server := ""
var _token := ""
var _player_id := ""
var _player_name := ""
var _match_id := ""
var _match_status := ""
var _viewer_team := 0
var _sequence := 0
## What only the viewer's own team may see (GDD 8.4), by player id: {items, funnelLux}. The room snapshot
## leaves it out, so it is merged into every snapshot before the signal.
var _private: Dictionary = {}
var _next_frame_id := 1
var _acknowledgements: Dictionary = {}
var _map: Dictionary = {}
var _socket_url := ""
## True once a match connection has been open, so a later close counts as a drop and not as a start-up failure.
var _was_open := false
var _reconnecting := false
var _leaving := false
var _role := "player"
var _spec: Dictionary = {}
var _data: Dictionary = {}

func _ready() -> void:
	_http = HTTPRequest.new()
	_http.timeout = REQUEST_TIMEOUT_SECONDS
	add_child(_http)

func _process(_delta: float) -> void:
	if _socket.get_ready_state() == WebSocketPeer.STATE_CLOSED:
		if _was_open and not _reconnecting and not _leaving and not _match_id.is_empty():
			_reconnect()
		return
	_socket.poll()
	while _socket.get_available_packet_count() > 0:
		var packet := _socket.get_packet().get_string_from_utf8()
		var parsed: Variant = JSON.parse_string(packet)
		if not parsed is Dictionary:
			message_received.emit("The server sent an invalid WebSocket frame.")
			continue
		_handle_frame(parsed)

func connect_match(options: Dictionary) -> Dictionary:
	_leaving = false
	_was_open = false
	_match_status = ""
	_server = str(options.get("server", "")).strip_edges().trim_suffix("/")
	if _server.is_empty():
		return _failure("Enter the backend address.")
	if not _server.begins_with("http://") and not _server.begins_with("https://"):
		return _failure("The backend address must start with http:// or https://.")

	var display_name := str(options.get("name", "")).strip_edges()
	if display_name.length() < 2 or display_name.length() > 24:
		return _failure("Choose a player name between 2 and 24 characters.")

	var auth := await _sign_in(display_name)
	if not auth.ok:
		return auth
	_token = str(auth.data.get("accessToken", ""))
	_player_id = str(auth.data.get("player", {}).get("id", ""))
	_player_name = str(auth.data.get("player", {}).get("name", display_name))
	if _token.is_empty() or _player_id.is_empty():
		return _failure("The backend returned an incomplete sign-in response.")

	var loaded := await _load_server_rules()
	if not loaded.ok:
		return loaded

	var match_response: Dictionary
	var requested_match := str(options.get("match_id", "")).strip_edges()
	if requested_match.is_empty() or requested_match.to_lower() == "new":
		var create_body := {
			"name": _player_name + "'s match",
			"vsBot": bool(options.get("vs_bot", false)),
			"botVsBot": bool(options.get("bot_vs_bot", false)),
		}
		var map_seed := int(options.get("seed", 0))
		if map_seed > 0:
			create_body["seed"] = map_seed
		var entropy_text := str(options.get("entropy", "")).strip_edges()
		var entropy_tenths := GameLogic.entropy_from_text(entropy_text)
		if entropy_tenths >= 0:
			create_body["entropyPermillePerSecond"] = entropy_tenths
		create_body["maxTicks"] = int(options.get("max_ticks", 0))
		match_response = await _request("/api/matches", HTTPClient.METHOD_POST, create_body, true)
	else:
		# A bot match has no slot to take, so an existing one is watched instead of joined.
		var existing := await _request("/api/matches/" + requested_match.uri_encode(), HTTPClient.METHOD_GET, {}, true)
		if not existing.ok:
			return existing
		if bool(existing.data.get("botVsBot", false)):
			match_response = existing
		else:
			match_response = await _request("/api/matches/" + requested_match.uri_encode() + "/join", HTTPClient.METHOD_POST, {}, true)
	if not match_response.ok:
		return match_response

	var match_data: Dictionary = match_response.data
	_match_id = str(match_data.get("id", ""))
	if _match_id.is_empty():
		return _failure("The backend returned a match without an ID.")
	_viewer_team = 0
	for player in match_data.get("players", []):
		if str(player.get("playerId", "")) == _player_id:
			_viewer_team = int(player.get("team", 0))

	var map_response := await _request("/api/game/maps/" + str(match_data.get("seed", 0)), HTTPClient.METHOD_GET)
	if not map_response.ok:
		return map_response
	_map = map_response.data

	_socket_url = _server.replace("https://", "wss://").replace("http://", "ws://") + "/ws"
	var socket_error := _socket.connect_to_url(_socket_url)
	if socket_error != OK:
		return _failure("Could not open the match connection (error %d)." % socket_error)
	var opened := await _wait_for_socket_open()
	if not opened:
		_socket.close()
		return _failure("The match connection did not open. Check the backend address and network.")

	var auth_ack := await _send_request("auth", {"token": _token})
	if not auth_ack.get("ok", false):
		_socket.close()
		return _failure("The backend rejected sign-in on the match connection.")
	var join_ack := await _send_request("match:join", {"matchId": _match_id})
	if not join_ack.get("ok", false):
		_socket.close()
		return _failure("Could not join the match room: " + str(join_ack.get("error", "unknown error")))
	_role = str(join_ack.get("role", "player"))
	_sequence = int(join_ack.get("nextSeq", 0))
	_was_open = true
	_take_private(join_ack.get("private"))
	if join_ack.get("snapshot") is Dictionary:
		snapshot_received.emit(_with_private(join_ack.snapshot))

	var joined_status := str(join_ack.get("status", match_data.get("status", "")))
	if joined_status not in ["lobby", "running", "finished", "cancelled"]:
		_socket.close()
		return _failure("The backend returned an invalid match status.")
	if _match_status.is_empty():
		_match_status = joined_status
	match_data["status"] = _match_status
	match_status_changed.emit(_match_status, match_data)
	return {
		"ok": true,
		"match": match_data,
		"map": _map,
		"viewer_team": _viewer_team,
		"player_name": _player_name,
		"role": _role,
		"data": _data,
		"is_host": _player_id == str(match_data.get("hostId", "")),
	}

func start_match() -> Dictionary:
	if _match_id.is_empty():
		return _failure("Join a match before starting it.")
	var response := await _request("/api/matches/" + _match_id + "/start", HTTPClient.METHOD_POST, {}, true)
	if response.ok:
		message_received.emit("Match start requested.")
	return response

func send_command(command: Dictionary) -> Dictionary:
	if _socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		message_received.emit("The match connection is closed. Rejoin the match.")
		return {"accepted": false, "reason": "closed"}
	var payload := {
		"matchId": _match_id,
		"seq": _sequence,
		"cmd": command,
	}
	_sequence += 1
	var id := _send_frame("match:command", payload)
	var acknowledgement := await _wait_for_ack(id)
	if not acknowledgement.get("accepted", false):
		message_received.emit("Command rejected: " + str(acknowledgement.get("reason", acknowledgement.get("error", "invalid command"))))
		# The server's count wins; the player taps again.
		if acknowledgement.has("nextSeq"):
			_sequence = int(acknowledgement.nextSeq)
	return acknowledgement

func get_role() -> String:
	return _role

func get_data() -> Dictionary:
	return _data

func get_spec() -> Dictionary:
	return _spec

func get_map() -> Dictionary:
	return _map

func get_viewer_team() -> int:
	return _viewer_team

func get_match_id() -> String:
	return _match_id

## Reopens the match connection after a drop, for example a server restart: sign in again,
## rejoin the room, and continue the command count where the server says. The server rebuilds a
## running match from its log, so the join may find no snapshot for a few seconds.
func _reconnect() -> void:
	_reconnecting = true
	message_received.emit("Connection lost. Reconnecting...")
	for attempt in range(90):
		if _leaving:
			break
		_socket = WebSocketPeer.new()
		if _socket.connect_to_url(_socket_url) == OK and await _wait_for_socket_open():
			var auth_ack := await _send_request("auth", {"token": _token})
			if auth_ack.get("ok", false):
				var join_ack := await _send_request("match:join", {"matchId": _match_id})
				if join_ack.get("ok", false):
					_sequence = int(join_ack.get("nextSeq", _sequence))
					_take_private(join_ack.get("private"))
					if join_ack.get("snapshot") is Dictionary:
						snapshot_received.emit(_with_private(join_ack.snapshot))
						message_received.emit("Reconnected.")
						_reconnecting = false
						return
					if str(join_ack.get("status", "")) != "running":
						_reconnecting = false
						return
		_socket.close()
		await get_tree().create_timer(1.0).timeout
	_reconnecting = false
	_was_open = false
	message_received.emit("Could not reconnect to the match.")

## Tells the server this client leaves, then closes the connection. `call` is GameLogic.leave_call(): "leave" frees
## a lobby seat or cancels the lobby, "quit" leaves a running match (a forfeit against a human, a stop otherwise), and
## "none" only disconnects. A failed call is ignored: the match may have ended, and the connection closes either way.
func leave_match(call: String) -> void:
	if call != "none" and not _match_id.is_empty() and not _token.is_empty():
		await _request("/api/matches/%s/%s" % [_match_id, call], HTTPClient.METHOD_POST, {}, true)
	disconnect_match()

func disconnect_match() -> void:
	_leaving = true
	_was_open = false
	if _socket.get_ready_state() != WebSocketPeer.STATE_CLOSED:
		_socket.close()
	_token = ""
	_match_id = ""
	_match_status = ""
	_acknowledgements.clear()

## Checks that this client implements the server's spec, then loads the data
## files the server simulates with, so costs and upgrades never live in two places.
func _load_server_rules() -> Dictionary:
	var spec_response := await _request("/api/game/spec", HTTPClient.METHOD_GET)
	if not spec_response.ok:
		return spec_response
	_spec = spec_response.data
	if str(_spec.get("specVersion", "")) != GameLogic.SPEC_VERSION:
		return _failure("This server simulates spec %s and this client implements spec %s." % [str(_spec.get("specVersion", "?")), GameLogic.SPEC_VERSION])
	_data = {}
	for key in ["buildings", "balance", "mapgen", "heroes", "abilities", "items"]:
		var file_response := await _request("/data/%s.json" % key, HTTPClient.METHOD_GET)
		if not file_response.ok:
			return file_response
		_data[key] = file_response.data
	return {"ok": true}

func _sign_in(display_name: String) -> Dictionary:
	var settings := ConfigFile.new()
	var settings_error := settings.load("user://luxcores.cfg")
	var device_secret := ""
	if settings_error == OK:
		device_secret = str(settings.get_value("account", _server, ""))
	if not device_secret.is_empty():
		var device_login := await _request("/api/auth/device", HTTPClient.METHOD_POST, {"deviceSecret": device_secret})
		if device_login.ok:
			return device_login
		if int(device_login.get("status_code", 0)) != 401:
			return device_login

	var guest_login := await _request("/api/auth/guest", HTTPClient.METHOD_POST, {"name": display_name})
	if not guest_login.ok:
		return guest_login
	var new_secret := str(guest_login.data.get("deviceSecret", ""))
	if new_secret.is_empty():
		return _failure("The backend did not return a device sign-in secret.")
	settings.set_value("account", _server, new_secret)
	var save_error := settings.save("user://luxcores.cfg")
	if save_error != OK:
		return _failure("Could not save this device's sign-in secret (error %d)." % save_error)
	return guest_login

func _request(path: String, method: HTTPClient.Method, payload: Dictionary = {}, authenticated := false) -> Dictionary:
	var url := _server + path
	var headers := PackedStringArray(["Content-Type: application/json"])
	if authenticated:
		headers.append("Authorization: Bearer " + _token)
	var body := "" if method == HTTPClient.METHOD_GET else JSON.stringify(payload)
	var request_error := _http.request(url, headers, method, body)
	if request_error != OK:
		return _failure("Could not send %s (error %d)." % [path, request_error])
	var result: Array = await _http.request_completed
	var response_code := int(result[1])
	var response_body := (result[3] as PackedByteArray).get_string_from_utf8()
	var response: Variant = JSON.parse_string(response_body) if not response_body.is_empty() else {}
	if response_code < 200 or response_code >= 300:
		var detail := "HTTP %d" % response_code
		if response is Dictionary:
			detail = str(response.get("message", detail))
		var failure := _failure(path + ": " + detail)
		failure["status_code"] = response_code
		return failure
	if not response is Dictionary:
		return _failure(path + ": the backend returned invalid JSON.")
	return {"ok": true, "data": response}

func _wait_for_socket_open() -> bool:
	for _frame in range(300):
		var state := _socket.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			return true
		if state == WebSocketPeer.STATE_CLOSED:
			return false
		await get_tree().process_frame
	return false

func _send_request(event_name: String, data: Dictionary) -> Dictionary:
	var id := _send_frame(event_name, data)
	return await _wait_for_ack(id)

func _send_frame(event_name: String, data: Dictionary) -> int:
	var id := _next_frame_id
	_next_frame_id += 1
	var error := _socket.send_text(JSON.stringify({"event": event_name, "data": data, "id": id}))
	if error != OK:
		message_received.emit("Could not send a match message (error %d)." % error)
	return id

func _wait_for_ack(id: int) -> Dictionary:
	for _frame in range(300):
		if _acknowledgements.has(id):
			var acknowledgement: Dictionary = _acknowledgements[id]
			_acknowledgements.erase(id)
			return acknowledgement
		if _socket.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			return {"ok": false, "error": "match connection closed"}
		await get_tree().process_frame
	return {"ok": false, "error": "server acknowledgement timed out"}

func _take_private(state: Variant) -> void:
	if not state is Dictionary:
		return
	_private = {}
	for entry in state.get("players", []):
		_private[int(entry.id)] = {"items": entry.get("items", []), "funnelLux": int(entry.get("funnelLux", 0))}

## The snapshot with each known player's inventory and Energy Grab budget filled in. Others get an empty inventory.
func _with_private(snapshot: Dictionary) -> Dictionary:
	var players: Array = []
	for player in snapshot.get("players", []):
		var merged: Dictionary = {"items": [], "funnelLux": 0}
		merged.merge(player, true)
		merged.merge(_private.get(int(player.get("id", -1)), {}), true)
		players.append(merged)
	var out := snapshot.duplicate()
	out["players"] = players
	return out

func _handle_frame(frame: Dictionary) -> void:
	var event_name := str(frame.get("event", ""))
	var data: Variant = frame.get("data", {})
	if event_name == "ack":
		var acknowledgement: Dictionary = data if data is Dictionary else {}
		_acknowledgements[int(frame.get("id", -1))] = acknowledgement
	elif event_name == "match:snapshot" and data is Dictionary:
		snapshot_received.emit(_with_private(data))
	elif event_name == "match:private" and data is Dictionary:
		_take_private(data)
	elif event_name == "match:started" and data is Dictionary:
		_match_status = "running"
		if data.get("snapshot") is Dictionary:
			snapshot_received.emit(_with_private(data.snapshot))
		match_status_changed.emit("running", data)
	elif event_name == "match:updated" and data is Dictionary:
		_match_status = str(data.get("status", _match_status))
		match_status_changed.emit(_match_status, data)
	elif event_name == "match:ended" and data is Dictionary:
		_match_status = "finished"
		var ended_result: Dictionary = data.get("result", {}).duplicate()
		ended_result["endedTick"] = int(data.get("endedTick", 0))
		match_ended.emit(ended_result)
	elif event_name == "exception" and data is Dictionary:
		message_received.emit("Backend error: " + str(data.get("error", "unknown error")))
	elif event_name == "chat:message" and data is Dictionary:
		message_received.emit(str(data.get("from", "Player")) + ": " + str(data.get("text", "")))

func _failure(message: String) -> Dictionary:
	return {"ok": false, "message": message}
