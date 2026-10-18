extends RefCounted
## Pure game-UI decisions: label text, affordability, tap resolution and the
## actions of a selected building. Nothing here touches nodes, the network or
## the scene tree, so the rules are testable headless (vone/tests/run_tests.gd).
##
## The web client implements the same functions in src/client/entity-text.js and
## src/client/ui/controls.js. test/fixtures/client-parity.json holds the cases
## that both runtimes must answer alike. A change to a decision belongs in both
## clients and in that file.

## The sim spec this port implements (SPEC_VERSION in src/sim/config.js). The
## client refuses a server on another spec. test/client-parity.test.js fails when
## this value and the sim disagree.
const SPEC_VERSION := "0.10.0"

const KIND_CORE := 1
const KIND_SOLAR := 2
const KIND_WIND := 3
const KIND_GEOTHERMAL := 4
const KIND_NUCLEAR := 5
const KIND_BARRACKS := 6
const KIND_TOWER := 7
const KIND_BLOCKER := 8
const KIND_CREEP := 9
const KIND_HERO := 10
const KIND_PROJECTILE := 11
const KIND_GROUND_ITEM := 12
const KIND_LOOT_BAG := 13

const UNITS_PER_TILE := 1000
const MILLI := 1000
## How close a tap must land to an entity to pick it, in tiles.
const PICK_RADIUS_TILES := 1.0

const KIND_NAMES := {
	KIND_CORE: "Lumen Core",
	KIND_SOLAR: "Solar",
	KIND_WIND: "Wind",
	KIND_GEOTHERMAL: "Geothermal",
	KIND_NUCLEAR: "Nuclear",
	KIND_BARRACKS: "Barracks",
	KIND_TOWER: "Tower",
	KIND_BLOCKER: "Blocker",
	KIND_CREEP: "Creep",
	KIND_HERO: "Hero",
	KIND_GROUND_ITEM: "Item",
	KIND_LOOT_BAG: "Loot Bag",
}
## Tower attack type by code (ATTACK_CODE in src/sim/buildings.js).
const ATTACK_NAMES := {1: "Melee", 2: "Ranged", 3: "Area"}
const ATTACK_TYPES := ["melee", "ranged", "area"]
## Attack choices of a creep order; Mixed cycles melee, ranged, area.
const ORDER_TYPES := ["melee", "ranged", "area", "mixed"]
## The build palette, in display order: [building key, label].
const PALETTE := [
	["solar", "Solar"], ["wind", "Wind"], ["geothermal", "Geothermal"],
	["nuclear", "Nuclear"], ["barracks", "Barracks"], ["tower", "Tower"],
]

## The attack types of a creep order: one type repeated, or melee, ranged, area in turn.
static func mix_for(count: int, type: String) -> Array:
	var cycle := ["melee", "ranged", "area"]
	var out: Array = []
	for i in count:
		out.append(cycle[i % cycle.size()] if type == "mixed" else type)
	return out

## Order type code of a hero pick in Order.type (ORDER_TYPE.hero in src/sim/creeps.js).
const HERO_ORDER := 2

## Seconds as the UI writes them, rounded up to a tenth, with integer math only:
## 99 ticks at 20 Hz is "5.0s".
static func seconds_text(ticks: int, tick_hz: int) -> String:
	@warning_ignore("integer_division")
	var tenths := (maxi(ticks, 0) * 10 + tick_hz - 1) / tick_hz
	@warning_ignore("integer_division")
	return "%d.%ds" % [tenths / 10, tenths % 10]

## The lines of a barracks queue, in queue order: [{index, orderId, text}]. A held group shows HELD.
## A hero pick shows the hero's name and the lux allocated to it.
static func queue_lines(orders: Array, barracks_id: int, tick_hz: int, hero_names: Array = []) -> Array:
	var initials := {1: "M", 2: "R", 3: "A"}
	var out: Array = []
	var index := 0
	for order in orders:
		if int(order.get("barracksId", -1)) != barracks_id:
			continue
		var mix: Array = order.get("mix", [])
		if int(order.get("type", 1)) == HERO_ORDER:
			var hero_name := String(hero_names[int(mix[0])]) if int(mix[0]) < hero_names.size() else "?"
			out.append({"index": index, "orderId": int(order.id), "text": "Hero %s %d lux %s" % [hero_name, int(mix[1]), seconds_text(int(order.get("ticksLeft", 0)), tick_hz)]})
		else:
			var letters := ""
			for code in mix:
				letters += String(initials.get(int(code), "?"))
			var status := "HELD" if int(order.get("held", 0)) == 1 else "%.1fs" % (maxf(0.0, float(order.get("ticksLeft", 0))) / float(tick_hz))
			out.append({"index": index, "orderId": int(order.id), "text": "Group of %d %s %s" % [mix.size(), letters, status]})
		index += 1
	return out

## The four abilities in slot order: type in data/abilities.json, letter, and how it is aimed.
const ABILITY_SLOTS := [
	{"slot": 0, "type": "melee", "letter": "M", "aim": "none"},
	{"slot": 1, "type": "ranged", "letter": "R", "aim": "target"},
	{"slot": 2, "type": "area", "letter": "A", "aim": "point"},
	{"slot": 3, "type": "shield", "letter": "S", "aim": "none"},
]

## The ability buttons of the hero bar: [{slot, type, letter, aim, costLux, ready, poor, text}].
## ready is false while the cooldown runs, poor when the Core could not pay and keep its minimum.
## abilities is data/abilities.json (costs in whole lux).
static func ability_states(hero: Dictionary, abilities: Dictionary, core_lux_milli: int, min_left_lux: int, tick_hz: int) -> Array:
	var cooldowns := [int(hero.get("cd0", 0)), int(hero.get("cd1", 0)), int(hero.get("cd2", 0)), int(hero.get("cd3", 0))]
	var out: Array = []
	for def in ABILITY_SLOTS:
		var slot := int(def.slot)
		var cost := int(abilities.templates[def.type].costLux)
		var ticks: int = cooldowns[slot]
		out.append({
			"slot": slot, "type": def.type, "letter": def.letter, "aim": def.aim, "costLux": cost,
			"ready": ticks == 0,
			"poor": not can_afford(core_lux_milli, cost, min_left_lux),
			"text": "%s %s" % [def.letter, seconds_text(ticks, tick_hz)] if ticks > 0 else "%s %d" % [def.letter, cost],
		})
	return out

## The command of an ability that needs no second tap, or an empty Dictionary for the aimed ones.
static func immediate_cast(slot: int, hero: Dictionary) -> Dictionary:
	if slot == 0:
		return {"t": "castAbility", "slot": 0}
	if slot == 3:
		return {"t": "castAbility", "slot": 3, "targetId": int(hero.id)}
	return {}

## What the barracks panel offers for picking a hero (GDD 7.1): {note, options}. note is empty when a
## pick is possible. ctx: player ({heroLock, heroCooldown}, or empty), hero_alive, hero_queued,
## roster ([{id, name, primary}]) and tick_hz.
static func hero_pick_state(ctx: Dictionary) -> Dictionary:
	var player: Dictionary = ctx.get("player", {})
	var tick_hz := int(ctx.get("tick_hz", 20))
	var note := ""
	if bool(ctx.get("hero_alive", false)):
		note = "Your hero is on the field."
	elif bool(ctx.get("hero_queued", false)):
		note = "Your hero is being built."
	elif not player.is_empty() and int(player.get("heroCooldown", 0)) > 0:
		note = "Next pick in %s" % seconds_text(int(player.heroCooldown), tick_hz)
	var options: Array = []
	for entry in ctx.get("roster", []):
		var locked := not player.is_empty() and (int(player.get("heroLock", 0)) & (1 << int(entry.id))) != 0
		options.append({"id": int(entry.id), "name": String(entry.name), "primary": String(entry.primary), "locked": locked, "enabled": not locked and note.is_empty()})
	return {"note": note, "options": options}

## The lux a hero pick can allocate (GDD 7.2): 25%, 50% and 75% of the Core's lux and the most the Core
## can pay while keeping its minimum. Whole lux, at least 1, without repeats: [{label, lux}].
static func hero_lux_choices(core_lux_milli: int, min_left_lux: int) -> Array:
	@warning_ignore("integer_division")
	var most := (core_lux_milli - min_left_lux * MILLI) / MILLI
	var out: Array = []
	if most < 1:
		return out
	for share in [["25%", 25], ["50%", 50], ["75%", 75], ["Max", 100]]:
		@warning_ignore("integer_division")
		var lux := mini(most, (core_lux_milli * int(share[1])) / (100 * MILLI))
		if lux < 1:
			continue
		var seen := false
		for c in out:
			seen = seen or int(c.lux) == lux
		if not seen:
			out.append({"label": share[0], "lux": lux})
	return out

## Buttons of the group panel. Split needs 2 or more creeps; the lane route button shows only after a custom path.
static func group_actions(size: int, custom: bool) -> Array:
	var out: Array = [{"id": "path", "label": "Path"}, {"id": "merge", "label": "Merge"}]
	if size >= 2:
		out.append({"id": "split", "label": "Split"})
	if custom:
		out.append({"id": "lane", "label": "Lane Route"})
	return out

## Creeps in a group.
static func group_size(entities: Array, group_id: int) -> int:
	var n := 0
	for entity in entities:
		if int(entity.get("kind", 0)) == KIND_CREEP and int(entity.get("groupId", 0)) == group_id:
			n += 1
	return n

static func is_building_kind(kind: int) -> bool:
	return kind >= KIND_SOLAR and kind <= KIND_TOWER

## Lux of an entity, rounded to the nearest whole lux: HP over its HP factor, milli units to lux.
static func lux_of(entity: Dictionary, hp_factor: Dictionary) -> int:
	var kind := int(entity.get("kind", 0))
	var factor := float(hp_factor.get("core", 1)) if kind == KIND_CORE else float(hp_factor.get("default", 10))
	return roundi(float(entity.get("hp", 0)) / factor / float(MILLI))

## Label text of an entity, or "" for kinds with no name (projectiles). A hero shows its roster name
## when hero_names has one, and any entity under a shield shows SHIELD.
## Examples: "Solar 20", "Tower R P2 S1 18", "Barracks 40 REC", "Lumen Core 94", "Halo 30 SHIELD".
static func entity_text(entity: Dictionary, hp_factor: Dictionary, hero_names: Array = []) -> String:
	var kind := int(entity.get("kind", 0))
	if not KIND_NAMES.has(kind):
		return ""
	var hero_type := int(entity.get("heroType", 0))
	var label: String = KIND_NAMES[kind]
	if kind == KIND_HERO and hero_type > 0 and hero_type <= hero_names.size():
		label = String(hero_names[hero_type - 1])
	var parts: Array[String] = [label]
	if kind == KIND_TOWER:
		parts.append(String(ATTACK_NAMES.get(int(entity.get("attack", 0)), "?")).substr(0, 1))
		if int(entity.get("powerLevel", 0)) > 0:
			parts.append("P%d" % int(entity.powerLevel))
		if int(entity.get("shellLevel", 0)) > 0:
			parts.append("S%d" % int(entity.shellLevel))
	parts.append(str(lux_of(entity, hp_factor)))
	if int(entity.get("stunTicks", 0)) > 0:
		parts.append("STUN")
	if int(entity.get("shieldHp", 0)) > 0:
		parts.append("SHIELD")
	if int(entity.get("recycle", 0)) > 0:
		parts.append("REC")
	return " ".join(parts)

## Whether the day half of the cycle is on (GDD 4.1). The match starts at dawn.
static func is_day(tick: int, day_night: Dictionary) -> bool:
	var day := int(day_night.get("dayTicks", 800))
	var night := int(day_night.get("nightTicks", 400))
	return tick % (day + night) < day

## Whether the Core can pay cost_lux and still keep its minimum (GDD 3.4).
static func can_afford(core_lux_milli: int, cost_lux: int, min_left_lux: int) -> bool:
	return core_lux_milli - cost_lux * MILLI >= min_left_lux * MILLI

## Inclusive tile rows [z0, z1] of a team's build zone, from the mapgen rows.
static func build_zone(mapgen: Dictionary, team: int) -> Vector2i:
	var z := 0
	var z0 := -1
	var z1 := -1
	for row in mapgen.get("rows", []):
		if int(row.get("team", -2)) == team:
			if z0 < 0:
				z0 = z
			z1 = z + int(row.get("height", 0)) - 1
		z += int(row.get("height", 0))
	return Vector2i(z0, z1)

## The entity nearest to a ground point (tiles), within the pick radius. Ties go
## to the lowest id. Projectiles are never picked. Returns an empty Dictionary
## when nothing is near.
static func pick_entity(entities: Array, ground: Vector2) -> Dictionary:
	var best := {}
	var best_d := PICK_RADIUS_TILES * PICK_RADIUS_TILES
	for entity in entities:
		if not entity is Dictionary or int(entity.get("kind", 0)) == KIND_PROJECTILE:
			continue
		var dx := float(entity.get("x", 0)) / UNITS_PER_TILE - ground.x
		var dz := float(entity.get("z", 0)) / UNITS_PER_TILE - ground.y
		var d := dx * dx + dz * dz
		if d < best_d:
			best = entity
			best_d = d
	return best

## What a tap does, as a Dictionary with one key: "command", "message", "select"
## (an entity id, or null to clear) or nothing else. The ctx holds:
##   ground (Vector2, tiles), entities, viewer_team, building ("" for none),
##   attack, core_lux_milli, data ({buildings, balance, mapgen}), vents, and for creeps
##   mode ("path" adds waypoints, "merge" picks the group to join, "" for none),
##   selected_group (id, or -1) and path_count (waypoints placed so far), and ability
##   (1 ranged or 2 area while the next tap aims that ability, -1 for none).
static func resolve_tap(ctx: Dictionary) -> Dictionary:
	var ground: Vector2 = ctx.ground
	var entities: Array = ctx.get("entities", [])
	var viewer_team := int(ctx.get("viewer_team", 0))
	var building := String(ctx.get("building", ""))
	var data: Dictionary = ctx.data
	var tile_x := int(floor(ground.x))
	var tile_z := int(floor(ground.y))

	var ability := int(ctx.get("ability", -1))
	if ability == 1:
		var target := pick_entity(entities, ground)
		if not target.is_empty() and int(target.kind) != KIND_PROJECTILE and (int(target.kind) == KIND_BLOCKER or (int(target.get("team", -1)) >= 0 and int(target.get("team", -1)) != viewer_team)):
			return {"command": {"t": "castAbility", "slot": 1, "targetId": int(target.id)}}
		return {"message": "Tap an enemy to hit."}
	if ability == 2:
		return {"command": {"t": "castAbility", "slot": 2, "x": roundi(ground.x * UNITS_PER_TILE), "z": roundi(ground.y * UNITS_PER_TILE)}}

	if not building.is_empty():
		var zone := build_zone(data.mapgen, viewer_team)
		if tile_z < zone.x or tile_z > zone.y or tile_x < 0 or tile_x >= int(data.mapgen.get("width", 96)):
			return {"message": "Build inside your own zone."}
		for entity in entities:
			if int(entity.get("kind", 0)) <= KIND_BLOCKER \
					and int(floor(float(entity.get("x", 0)) / UNITS_PER_TILE)) == tile_x \
					and int(floor(float(entity.get("z", 0)) / UNITS_PER_TILE)) == tile_z:
				return {"message": "That tile is taken."}
		var info: Dictionary = data.buildings[building]
		if bool(info.get("requiresVent", false)):
			var on_vent := false
			for vent in ctx.get("vents", []):
				if int(vent.team) == viewer_team and int(vent.tileX) == tile_x and int(vent.tileZ) == tile_z:
					on_vent = true
			if not on_vent:
				return {"message": "Geothermal needs a vent tile."}
		var cost := int(info.costLux)
		if not can_afford(int(ctx.get("core_lux_milli", 0)), cost, int(data.balance.core.minLeftAfterSpendLux)):
			return {"message": "Not enough lux: %s costs %d." % [building, cost]}
		var command := {"t": "build", "building": building, "tileX": tile_x, "tileZ": tile_z}
		if building == "tower":
			command["attack"] = String(ctx.get("attack", "ranged"))
		return {"command": command}

	var mode := String(ctx.get("mode", ""))
	if mode == "path":
		var max_waypoints := int(data.balance.creep.maxWaypoints)
		if int(ctx.get("path_count", 0)) >= max_waypoints:
			return {"message": "A path holds at most %d waypoints." % max_waypoints}
		return {"addWaypoint": [roundi(ground.x * UNITS_PER_TILE), roundi(ground.y * UNITS_PER_TILE)]}

	var picked := pick_entity(entities, ground)
	if mode == "merge":
		if not picked.is_empty() and int(picked.kind) == KIND_CREEP and int(picked.get("owner", -1)) == viewer_team and int(picked.get("groupId", 0)) != int(ctx.get("selected_group", -1)):
			return {"command": {"t": "mergeGroups", "intoGroupId": int(ctx.selected_group), "fromGroupId": int(picked.groupId)}}
		return {"message": "Tap one of your other groups to merge."}
	var hero := {}
	for entity in entities:
		if int(entity.get("kind", 0)) == KIND_HERO and int(entity.get("owner", -1)) == viewer_team:
			hero = entity
			break
	if not picked.is_empty() and is_building_kind(int(picked.kind)) and int(picked.get("owner", -1)) == viewer_team:
		return {"select": int(picked.id)}
	if not picked.is_empty() and int(picked.kind) == KIND_CREEP and int(picked.get("owner", -1)) == viewer_team:
		return {"selectGroup": int(picked.groupId)}
	if not picked.is_empty() and not hero.is_empty() and int(picked.id) != int(hero.id) and int(picked.get("team", -1)) != viewer_team:
		return {"command": {"t": "heroAttack", "targetId": int(picked.id)}}
	if not hero.is_empty():
		return {"command": {"t": "heroMove", "x": roundi(ground.x * UNITS_PER_TILE), "z": roundi(ground.y * UNITS_PER_TILE)}}
	return {"select": null}

## Actions the panel offers for a selected own building: [{id, label, command, costLux?}].
static func actions_for(entity: Dictionary, tower_data: Dictionary) -> Array:
	var out: Array = []
	var id := int(entity.get("id", 0))
	var recycle := int(entity.get("recycle", 0))
	if int(entity.get("kind", 0)) == KIND_TOWER and recycle == 0:
		for track in ["power", "shell"]:
			var level := int(entity.get("powerLevel", 0)) if track == "power" else int(entity.get("shellLevel", 0))
			var track_upgrades: Array = tower_data.upgrades[track]
			if level >= track_upgrades.size():
				continue
			out.append({
				"id": track,
				"label": "%s %d/%d" % ["Power" if track == "power" else "Shell", level + 1, track_upgrades.size()],
				"command": {"t": "upgrade", "towerId": id, "track": track},
				"costLux": int(track_upgrades[level].costLux),
			})
	if recycle > 0:
		out.append({"id": "cancel", "label": "Cancel Recycle", "command": {"t": "cancelRecycle", "buildingId": id}})
	else:
		out.append({"id": "recycle", "label": "Recycle", "command": {"t": "recycle", "buildingId": id}})
	return out
