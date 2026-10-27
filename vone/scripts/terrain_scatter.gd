extends RefCounted
## Tiles a map with terrain scenery and answers how high its ground stands.
##
## The arena is a flat plane at y = 0 (`Terrain` in `scenes/main3d.tscn`), and the lanes, the zone bands and
## the markers that `main3d.gd` draws on it stay the map. This script covers the rest of the plane: it lays a
## grid of cells over the map, gives every cell that gameplay does not claim one of the models in
## `ModelLibrary.TERRAIN_MODELS`, and reports the ground height those models imply, so `main3d.gd` can seat
## buildings and units on it.
##
## ## What the Models Can and Cannot Do
##
## The six files are photogrammetry scans of separate scenes. They share no ground plane and carry no
## collision shape, so they are **not** a height map and nothing here raycasts them. Each prop instead
## declares a mound: a height and a radius, measured by hand against the model, that stand for the ground the
## model rests on. `height_at` returns the highest mound covering a point and 0 everywhere else, which gives a
## continuous, cheap and deterministic surface.
##
## The mounds never reach a lane, a build zone, a Core, a vent, an item spawn or a blocker, because the
## planner keeps every cell clear of them by more than its mound radius. Over all those places `height_at`
## returns 0, so a building, a tower or a creep sits exactly where it sat before. A hero that walks into the
## scenery is the one case that moves, and it rises with the mound. The tap ray in `arena_3d.gd` still meets
## the y = 0 plane, so a tap on a raised slope reads the tile under the slope rather than the tile the eye
## picks; the mound heights stay small (at most 1 tile) to keep that error well below one tile.
##
## ## How It Draws
##
## The scans arrive as hundreds or thousands of separate little meshes each, which one node per mesh would
## turn into tens of thousands of draw calls once the whole map is tiled. `_merged_mesh` therefore merges each
## prop once into a single mesh with one surface per material, and every copy of that prop goes into one
## `MultiMeshInstance3D`. A tiled map costs one node and about ten draw calls per prop kind, whatever the
## number of copies, and the merge result is cached for the rest of the session.

const ModelLibrary = preload("res://scripts/model_library.gd")

## The node `build` fills, and the prefix of the node that draws all copies of one prop.
const ROOT_NAME := "TerrainScatter"
const PROP_PREFIX := "TerrainProps"

## The props in the order the weighted draw walks them. Dictionary keys are never iterated, so one seed
## always produces one tiling.
const PROP_NAMES: Array[String] = [
	"forest_in_the_mountains",
	"forest_loner",
	"forest_pond",
	"forest_with_a_road",
	"rocks_formation_01",
	"rocks_formation_02",
]

## Tiling rules per prop, distances in tiles. `ModelLibrary.TERRAIN_MODELS` owns the file and the fit; this
## table owns how the prop behaves on the map, so both are tuned in one place each.
##
## - `footprint`: the width the model needs. Half of it is the radius every clearance test uses. Five props
##   match `CELL_TILES` and tile edge to edge; `forest_loner` is narrower and fills a cell the others cannot.
## - `mound_height` and `mound_radius`: the ground the model stands on. Keep `mound_radius` at or below half
##   the footprint, or the ground rises outside the space the cell reserved.
## - `weight`: the relative chance of the draw picking this prop. `forest_in_the_mountains` carries most of
##   the weight because it is the one cheap scan, at 19 k triangles against 102 k to 1.96 M for the rest.
## - `max_count`: how many copies one map may hold.
## - `same_kind_gap`: how far two copies of this prop stay apart, in tiles. A gap above `CELL_TILES` keeps
##   the prop out of the cell next door, and the distinctive props carry the widest gaps. The ridge is the
##   exception at 0: it is the one scan cheap enough to cover open ground, and six models cannot tile a map
##   if none of them may repeat, so its copies differ by yaw and scale instead of by distance.
## - `triangles`: the triangle count of one copy, counted in the glTF file, which `TRIANGLE_BUDGET` spends.
const PROP_RULES := {
	"forest_in_the_mountains": {"footprint": 5.0, "mound_height": 1.0, "mound_radius": 2.0, "weight": 100, "max_count": 400, "same_kind_gap": 0.0, "triangles": 19419},
	"forest_loner": {"footprint": 3.0, "mound_height": 0.3, "mound_radius": 1.2, "weight": 9, "max_count": 10, "same_kind_gap": 6.0, "triangles": 101683},
	"forest_pond": {"footprint": 5.0, "mound_height": 0.0, "mound_radius": 0.0, "weight": 2, "max_count": 2, "same_kind_gap": 25.0, "triangles": 256652},
	"forest_with_a_road": {"footprint": 5.0, "mound_height": 0.15, "mound_radius": 1.8, "weight": 4, "max_count": 5, "same_kind_gap": 16.0, "triangles": 151954},
	"rocks_formation_01": {"footprint": 5.0, "mound_height": 0.45, "mound_radius": 1.8, "weight": 5, "max_count": 6, "same_kind_gap": 11.0, "triangles": 159997},
	"rocks_formation_02": {"footprint": 5.0, "mound_height": 0.6, "mound_radius": 2.0, "weight": 1, "max_count": 1, "same_kind_gap": 40.0, "triangles": 1959775},
}

## The side of one terrain cell, in tiles. The grid divides the map into whole cells, so a map that is not a
## multiple of this stretches its cells a little rather than leaving a strip bare.
const CELL_TILES := 5.0
## How far a prop may sit from the middle of its cell, so the grid does not read as a grid.
const CELL_JITTER := 1.2
## How many jittered points one cell tries before it gives up. A cell beside a lane often has free ground on
## one side only, and a second or third try finds it.
const CELL_ATTEMPTS := 4
## Mixed into the map seed, so the terrain of a seed never repeats the lane jitter of that same seed.
const SEED_SALT := 0x7e44a1

## How many triangles all props together may draw. This is the first knob to turn for a slow device, and the
## number is a desktop figure: the scans are dense, and covering the open ground of a 96 by 112 tile map
## costs millions of triangles however they are arranged. `rocks_formation_02` spends a quarter of the
## budget on one copy, which is why that prop is capped at one and why that file is the first worth
## decimating. Draw calls stay flat whatever the count, because every copy of a prop goes into one
## `MultiMesh`.
const TRIANGLE_BUDGET := 8_000_000

## Clearance in tiles. A prop must keep its footprint radius plus the clearance away from each of these.
const BORDER_MARGIN := 1.0
const LANE_CLEARANCE := 2
const CORE_CLEARANCE := 8
const MARKER_CLEARANCE := 4

## Anti-clumping beyond each prop's own `same_kind_gap`: a kind already standing within that gap times
## `NEARBY_FACTOR` has its weight divided by `REPEAT_PENALTY`, which thins out the repeats the hard gap
## still allows. A prop with a gap of 0, the one that covers open ground, takes no penalty.
const NEARBY_FACTOR := 2.0
const REPEAT_PENALTY := 5

## The scale and the yaw of a prop vary, so two copies of one model do not read as copies.
const SCALE_JITTER := 0.12

## Terrain is scenery: it casts no shadow, which keeps the heavy scans off the shadow pass.
const CASTS_SHADOWS := false

## The merged mesh of each prop already built, by prop name. Merging walks a whole scan, so it happens once
## per prop per session and every map after the first reuses the result.
static var _merged_meshes := {}

var _plan: Array = []
var _root: Node3D

## The placements of the current map, each `{prop, x, z, yaw, scale, radius, mound_height, mound_radius}`
## with `x` and `z` in tiles from the map's top-left corner.
func get_plan() -> Array:
	return _plan

## Plans and draws the terrain of `layout` under a `ROOT_NAME` child of `parent`, replacing whatever stood
## there. `reserved_rows` holds inclusive tile row ranges that take no props at all, which `main3d.gd` fills
## with the two build zones.
func build(parent: Node3D, layout: Dictionary, reserved_rows: Array = []) -> void:
	if not is_instance_valid(parent):
		return
	if is_instance_valid(_root):
		_root.get_parent().remove_child(_root)
		_root.queue_free()
	_root = Node3D.new()
	_root.name = ROOT_NAME
	parent.add_child(_root)
	_plan = [] if layout.is_empty() else plan(layout, reserved_rows)
	var map_width := float(layout.get("width", 96))
	var map_height := float(layout.get("height", 112))
	for prop in PROP_NAMES:
		var transforms: Array[Transform3D] = []
		for entry in _plan:
			if String(entry.prop) != prop:
				continue
			var basis := Basis(Vector3.UP, float(entry.yaw)).scaled(Vector3.ONE * float(entry.scale))
			# The prop rests on the base plane: its own geometry is the hill that `height_at` reports.
			var origin := Vector3(float(entry.x) - map_width * 0.5, 0.0, float(entry.z) - map_height * 0.5)
			transforms.append(Transform3D(basis, origin))
		if transforms.is_empty():
			continue
		var mesh := _merged_mesh(prop)
		if mesh == null:
			continue
		var multi_mesh := MultiMesh.new()
		multi_mesh.transform_format = MultiMesh.TRANSFORM_3D
		multi_mesh.mesh = mesh
		multi_mesh.instance_count = transforms.size()
		for index in transforms.size():
			multi_mesh.set_instance_transform(index, transforms[index])
		var node := MultiMeshInstance3D.new()
		node.name = "%s_%s" % [PROP_PREFIX, prop]
		node.multimesh = multi_mesh
		if not CASTS_SHADOWS:
			node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_root.add_child(node)

## The ground height in tiles at a point given in tiles from the map's top-left corner.
func height_at(tile_x: float, tile_z: float) -> float:
	return plan_height_at(_plan, tile_x, tile_z)

## The ground height of any plan, so a test can measure a plan without drawing it.
static func plan_height_at(prop_plan: Array, tile_x: float, tile_z: float) -> float:
	var height := 0.0
	for entry in prop_plan:
		var radius := float(entry.mound_radius)
		if radius <= 0.0:
			continue
		var dx := tile_x - float(entry.x)
		var dz := tile_z - float(entry.z)
		var distance := sqrt(dx * dx + dz * dz)
		if distance >= radius:
			continue
		# A smoothstep falloff: full height at the middle, tapering to level ground at the rim.
		var t := 1.0 - distance / radius
		height = maxf(height, float(entry.mound_height) * t * t * (3.0 - 2.0 * t))
	return height

## The placements of a map, one pass over the cell grid in row order. Pure and deterministic: one `layout`
## and one `reserved_rows` always give one answer, because the draw runs on a seed taken from `usedSeed` and
## walks `PROP_NAMES` in order.
##
## A cell takes the first prop of its weighted draw whose footprint fits the free ground there. A cell that
## no prop fits, which is every cell over a lane, a build zone or a Core, stays empty.
static func plan(layout: Dictionary, reserved_rows: Array = []) -> Array:
	var map_width := int(layout.get("width", 96))
	var map_height := int(layout.get("height", 112))
	if map_width <= 0 or map_height <= 0:
		return []
	var blocked := _blocked_grid(layout, reserved_rows, map_width, map_height)
	var rng := RandomNumberGenerator.new()
	# The map seed, mixed with odd constants so the tiling of a seed shares nothing with its lane jitter.
	rng.seed = int(layout.get("usedSeed", 0)) * 6364136223846793005 + SEED_SALT \
		^ (map_width * 73856093) ^ (map_height * 19349663)
	var columns := maxi(1, int(round(float(map_width) / CELL_TILES)))
	var rows := maxi(1, int(round(float(map_height) / CELL_TILES)))
	var cell_width := float(map_width) / float(columns)
	var cell_height := float(map_height) / float(rows)
	var placements: Array = []
	var counts := {}
	var triangles := 0
	for row in rows:
		for column in columns:
			var prop := ""
			var radius := 0.0
			var x := 0.0
			var z := 0.0
			var scale_jitter := 1.0
			for _attempt in CELL_ATTEMPTS:
				x = (float(column) + 0.5) * cell_width + rng.randf_range(-CELL_JITTER, CELL_JITTER)
				z = (float(row) + 0.5) * cell_height + rng.randf_range(-CELL_JITTER, CELL_JITTER)
				scale_jitter = 1.0 + rng.randf_range(-SCALE_JITTER, SCALE_JITTER)
				# The candidates come back in a weighted random order, and the cell takes the first that
				# fits. A cell beside a lane holds only the narrow prop, and asking in order finds it.
				for candidate in _candidates(rng, counts, placements, triangles, x, z, scale_jitter):
					var candidate_radius := float(PROP_RULES[candidate].footprint) * 0.5 * scale_jitter
					if not _overlaps_blocked(blocked, map_width, map_height, x, z, candidate_radius):
						prop = candidate
						radius = candidate_radius
						break
				if not prop.is_empty():
					break
			if prop.is_empty():
				continue
			var rules: Dictionary = PROP_RULES[prop]
			placements.append({
				"prop": prop,
				"x": x,
				"z": z,
				"yaw": rng.randf_range(0.0, TAU),
				"scale": scale_jitter,
				"radius": radius,
				"mound_height": float(rules.mound_height),
				"mound_radius": float(rules.mound_radius) * scale_jitter,
			})
			counts[prop] = int(counts.get(prop, 0)) + 1
			triangles += int(rules.triangles)
	return placements

## The props a cell may take, in a weighted random order. A prop drops out when it has reached its cap, when
## it would pass `TRIANGLE_BUDGET`, or when another of its kind stands within its own `same_kind_gap`. The
## rest are drawn without replacement, with the kinds already standing within `NEARBY_RADIUS` discounted.
static func _candidates(rng: RandomNumberGenerator, counts: Dictionary, placements: Array,
		triangles: int, x: float, z: float, scale_jitter: float) -> Array[String]:
	var names: Array[String] = []
	var weights: Array[int] = []
	var total := 0
	for prop in PROP_NAMES:
		var rules: Dictionary = PROP_RULES[prop]
		if int(counts.get(prop, 0)) >= int(rules.max_count):
			continue
		if triangles + int(rules.triangles) > TRIANGLE_BUDGET:
			continue
		var nearest := _nearest_of_kind(placements, prop, x, z)
		var gap := float(rules.same_kind_gap)
		if nearest < gap:
			continue
		var weight := int(rules.weight)
		if nearest < gap * NEARBY_FACTOR:
			@warning_ignore("integer_division")
			weight = maxi(1, weight / REPEAT_PENALTY)
		names.append(prop)
		weights.append(weight)
		total += weight
	var order: Array[String] = []
	while total > 0:
		var roll := rng.randi_range(0, total - 1)
		var taken := names.size() - 1
		for index in names.size():
			roll -= weights[index]
			if roll < 0:
				taken = index
				break
		order.append(names[taken])
		total -= weights[taken]
		names.remove_at(taken)
		weights.remove_at(taken)
	return order

## The distance from (x, z) to the nearest prop of one kind, or a large number when there is none yet.
static func _nearest_of_kind(placements: Array, prop: String, x: float, z: float) -> float:
	var nearest := 1.0e9
	for entry in placements:
		if String(entry.prop) != prop:
			continue
		var dx := x - float(entry.x)
		var dz := z - float(entry.z)
		nearest = minf(nearest, sqrt(dx * dx + dz * dz))
	return nearest

## One byte per tile: 1 where no prop may stand. The lanes, the Cores, the markers and the reserved rows
## stamp their clearance into it once, so a cell costs a few array reads.
static func _blocked_grid(layout: Dictionary, reserved_rows: Array, map_width: int, map_height: int) -> PackedByteArray:
	var blocked := PackedByteArray()
	blocked.resize(map_width * map_height)
	for rows in reserved_rows:
		var range_rows := rows as Vector2i
		for tile_z in range(maxi(0, range_rows.x), mini(map_height - 1, range_rows.y) + 1):
			for tile_x in map_width:
				blocked[tile_z * map_width + tile_x] = 1
	for lane in layout.get("lanes", []):
		if not lane is Dictionary:
			continue
		for tile_index in lane.get("tiles", []):
			var index := int(tile_index)
			if index < 0 or index >= map_width * map_height:
				continue
			@warning_ignore("integer_division")
			_stamp(blocked, map_width, map_height, index % map_width, index / map_width, LANE_CLEARANCE)
	for key in [["cores", CORE_CLEARANCE], ["vents", MARKER_CLEARANCE], ["itemSpawns", MARKER_CLEARANCE], ["blockers", MARKER_CLEARANCE]]:
		for marker in layout.get(String(key[0]), []):
			if marker is Dictionary:
				_stamp(blocked, map_width, map_height, int(marker.get("tileX", 0)), int(marker.get("tileZ", 0)), int(key[1]))
	return blocked

## Marks every tile within `clearance` of one tile as blocked.
static func _stamp(blocked: PackedByteArray, map_width: int, map_height: int, tile_x: int, tile_z: int, clearance: int) -> void:
	for dz in range(-clearance, clearance + 1):
		var z := tile_z + dz
		if z < 0 or z >= map_height:
			continue
		for dx in range(-clearance, clearance + 1):
			var x := tile_x + dx
			if x < 0 or x >= map_width or dx * dx + dz * dz > clearance * clearance:
				continue
			blocked[z * map_width + x] = 1

## The blocked mask has one bit per tile, so a footprint rim can pass between two tile centres. Every
## clearance test adds this much to the radius, which covers half a tile diagonal and a little more.
const GRID_SAMPLE_SLACK := 0.75

## Whether the disc of `footprint_radius` around (x, z) in tiles reaches the map border or any blocked tile.
## The disc is sampled on the tile grid, which is the resolution the blocked mask has.
static func _overlaps_blocked(blocked: PackedByteArray, map_width: int, map_height: int,
		x: float, z: float, footprint_radius: float) -> bool:
	var radius := footprint_radius + GRID_SAMPLE_SLACK
	if x - radius < BORDER_MARGIN or x + radius > float(map_width) - BORDER_MARGIN:
		return true
	if z - radius < BORDER_MARGIN or z + radius > float(map_height) - BORDER_MARGIN:
		return true
	var reach := int(ceil(radius))
	var center_x := int(floor(x))
	var center_z := int(floor(z))
	for dz in range(-reach, reach + 1):
		var tile_z := center_z + dz
		if tile_z < 0 or tile_z >= map_height:
			return true
		for dx in range(-reach, reach + 1):
			var tile_x := center_x + dx
			if tile_x < 0 or tile_x >= map_width:
				return true
			var offset_x := float(tile_x) + 0.5 - x
			var offset_z := float(tile_z) + 0.5 - z
			if offset_x * offset_x + offset_z * offset_z > radius * radius:
				continue
			if blocked[tile_z * map_width + tile_x] == 1:
				return true
	return false

## One prop as a single mesh, fitted and resting on the ground, with one surface per material. The scan is
## instantiated once, its `MeshInstance3D` nodes are appended into a `SurfaceTool` per material, and the
## instance is thrown away. Everything else the file holds, its cameras and its lights among them, is left
## behind, so nothing outside this function reads a name from inside an imported scene.
static func _merged_mesh(prop: String) -> ArrayMesh:
	if _merged_meshes.has(prop):
		return _merged_meshes[prop]
	var model := ModelLibrary.instance(ModelLibrary.terrain_spec(prop))
	if model == null:
		_merged_meshes[prop] = null
		return null
	var tools := {}
	var materials: Array[Material] = []
	for node in model.find_children("*", "MeshInstance3D", true, false):
		var source := node as MeshInstance3D
		if source.mesh == null:
			continue
		var node_transform := _transform_within(source, model)
		for surface in source.mesh.get_surface_count():
			var material := source.get_active_material(surface)
			if not tools.has(material):
				var started := SurfaceTool.new()
				started.begin(Mesh.PRIMITIVE_TRIANGLES)
				tools[material] = started
				materials.append(material)
			(tools[material] as SurfaceTool).append_from(source.mesh, surface, node_transform)
	model.queue_free()
	var merged := ArrayMesh.new()
	for material in materials:
		var tool_for_material := tools[material] as SurfaceTool
		tool_for_material.set_material(material)
		merged = tool_for_material.commit(merged)
	if merged.get_surface_count() == 0:
		push_warning("Terrain model %s held no mesh; the prop is skipped." % prop)
		_merged_meshes[prop] = null
		return null
	_merged_meshes[prop] = merged
	return merged

## The transform of a node in the space of one of its ancestors, including that ancestor's own transform.
## The scan is never added to the tree, so `global_transform` is not available here.
static func _transform_within(node: Node3D, ancestor: Node3D) -> Transform3D:
	var combined := Transform3D.IDENTITY
	var walked := node
	while walked != null and walked != ancestor:
		combined = walked.transform * combined
		walked = walked.get_parent() as Node3D
	return ancestor.transform * combined
