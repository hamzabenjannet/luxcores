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
## The build palette, in display order: [building key, label].
const PALETTE := [
	["solar", "Solar"], ["wind", "Wind"], ["geothermal", "Geothermal"],
	["nuclear", "Nuclear"], ["barracks", "Barracks"], ["tower", "Tower"],
]

static func is_building_kind(kind: int) -> bool:
	return kind >= KIND_SOLAR and kind <= KIND_TOWER

## Lux of an entity, rounded to the nearest whole lux: HP over its HP factor, milli units to lux.
static func lux_of(entity: Dictionary, hp_factor: Dictionary) -> int:
	var kind := int(entity.get("kind", 0))
	var factor := float(hp_factor.get("core", 1)) if kind == KIND_CORE else float(hp_factor.get("default", 10))
	return roundi(float(entity.get("hp", 0)) / factor / float(MILLI))

## Label text of an entity, or "" for kinds with no name (projectiles).
## Examples: "Solar 20", "Tower R P2 S1 18", "Barracks 40 REC", "Lumen Core 94".
static func entity_text(entity: Dictionary, hp_factor: Dictionary) -> String:
	var kind := int(entity.get("kind", 0))
	if not KIND_NAMES.has(kind):
		return ""
	var parts: Array[String] = [KIND_NAMES[kind]]
	if kind == KIND_TOWER:
		parts.append(String(ATTACK_NAMES.get(int(entity.get("attack", 0)), "?")).substr(0, 1))
		if int(entity.get("powerLevel", 0)) > 0:
			parts.append("P%d" % int(entity.powerLevel))
		if int(entity.get("shellLevel", 0)) > 0:
			parts.append("S%d" % int(entity.shellLevel))
	parts.append(str(lux_of(entity, hp_factor)))
	if int(entity.get("stunTicks", 0)) > 0:
		parts.append("STUN")
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
##   attack, core_lux_milli, data ({buildings, balance, mapgen}), vents.
static func resolve_tap(ctx: Dictionary) -> Dictionary:
	var ground: Vector2 = ctx.ground
	var entities: Array = ctx.get("entities", [])
	var viewer_team := int(ctx.get("viewer_team", 0))
	var building := String(ctx.get("building", ""))
	var data: Dictionary = ctx.data
	var tile_x := int(floor(ground.x))
	var tile_z := int(floor(ground.y))

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

	var picked := pick_entity(entities, ground)
	var hero := {}
	for entity in entities:
		if int(entity.get("kind", 0)) == KIND_HERO and int(entity.get("owner", -1)) == viewer_team:
			hero = entity
			break
	if not picked.is_empty() and is_building_kind(int(picked.kind)) and int(picked.get("owner", -1)) == viewer_team:
		return {"select": int(picked.id)}
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
