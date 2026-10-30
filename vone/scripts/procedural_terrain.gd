@tool
extends MeshInstance3D
## Builds the ground of a match map as a noise-displaced mesh, with mountains, hills and valleys.
##
## This replaces the flat `pb_mesh.gd` plane the `Terrain` node carried. The mesh method comes from
## `examples/yt-example-projects/terrain`: a `PlaneMesh` gives the grid, the CPU moves every vertex up or
## down by noise, and finite differences of the same height function give the normal and the tangent, so a
## slope lights from the shape the game reads. `shaders/terrain.gdshader` then colors the result by height
## through a gradient, over a tiling noise normal map that breaks up its large faces.
##
## ## What the Map Keeps
##
## The lanes, the build zones, the Cores and the markers are the map, and the server owns them. The terrain
## never touches them: `configure` stamps every tile those claim into a mask, measures how far each tile sits
## from the nearest claimed tile, and multiplies the noise by a factor that is 0 on claimed ground and
## reaches 1 only `FLATTEN_FALLOFF` tiles away. Playable ground therefore stays flat at y = 0, the zone and
## lane overlays still lie on it, and the tap ray in `arena_3d.gd`, which meets the y = 0 plane, still reads
## the tile the player aimed at. The terrain rises in the space between: the Core bands outside the Core
## clearance, and the open ground beside the lanes.
##
## ## The Noise Layers
##
## Three layers stack, all in tiles and all seeded from the map's own `usedSeed`, so one seed always builds
## one terrain:
##
## - **Hills** (`_hills`, fractal FBM): the rolling base. It swings both ways, so it also cuts the valleys.
## - **Ranges** (`_ranges`, one low-frequency layer): where mountains may stand at all. `smoothstep` cuts it
##   off below `RANGE_FLOOR`, which leaves most of the map as hills and valleys and gathers the peaks into a
##   few ranges rather than spreading them evenly. The rim of the map always counts as range, so the arena
##   sits in a bowl rather than ending at a cliff over nothing.
## - **Ridges** (`_ridges`, fractal ridged): the mountains themselves, squared to sharpen the peaks and
##   multiplied by the range mask.

## The shader that colors the mesh, and the stops of its height gradient as `[offset, color]`. The ground a
## player sees sits at y = 0, which reads the middle of the gradient, and the art direction keeps it dark so
## the team colors and the lux glow stay the brightest things on screen.
const SHADER_PATH := "res://shaders/terrain.gdshader"
const GRADIENT_STOPS := [
	[0.00, "#0b1320"], [0.30, "#142033"], [0.44, "#1d3a2e"], [0.50, "#24402f"],
	[0.62, "#3a4a33"], [0.76, "#4a4238"], [0.88, "#6b6a66"], [1.00, "#d8e4ee"],
]

## The hills, in parts of `peak_height`, and the share of that height a valley may fall below zero.
const HILL_FRACTION := 0.3
const VALLEY_SCALE := 0.7

## Noise frequencies in cycles per tile, with the fractal settings of each layer.
const HILL_FREQUENCY := 0.018
const HILL_OCTAVES := 4
const RANGE_FREQUENCY := 0.006
const RANGE_OCTAVES := 3
## Below this the range mask is 0, which is why most of the map stays low.
const RANGE_FLOOR := 0.4
## The rim: the last tiles before the map edge count as mountain range whatever the noise says, which walls
## the arena in. The ramp runs from no bias this far inside the map to the full range at the edge itself.
const EDGE_RANGE := 20.0
const RIDGE_FREQUENCY := 0.012
const RIDGE_OCTAVES := 5
const RIDGE_LACUNARITY := 2.3
const RIDGE_GAIN := 0.45

## Seed salts, so the three layers and the terrain scenery never repeat one another's pattern.
const HILL_SALT := 0x51a7c3
const RANGE_SALT := 0x2f90d5
const RIDGE_SALT := 0x6c13b9
const NORMAL_MAP_SALT := 0x1d4e77

## Clearance in tiles: how far the flat ground reaches past each thing the map claims.
const LANE_MARGIN := 2
const CORE_MARGIN := 6
const MARKER_MARGIN := 3
## How far from the claimed ground the noise reaches its full height. A low number makes a wall, a high one
## flattens the map, and 8 tiles gives a slope a hero can be seen to climb.
const FLATTEN_FALLOFF := 8.0

## Vertices per tile along each axis. One is 97 by 113 vertices on the default map, which is the mobile
## budget; raise it on a desktop for a smoother skyline.
@export_range(1, 4, 1) var cells_per_tile := 1:
	set(value):
		cells_per_tile = maxi(1, value)
		rebuild()

## The tallest peak, in tiles. The gradient in the shader spans twice this.
@export_range(2.0, 24.0, 0.5) var peak_height := 10.0:
	set(value):
		peak_height = value
		rebuild()

var _map_width := 96
var _map_height := 112
var _hills := FastNoiseLite.new()
var _ranges := FastNoiseLite.new()
var _ridges := FastNoiseLite.new()
## One float per tile: the distance in tiles to the nearest tile the map claims, 0 on a claimed tile.
var _claimed_distance := PackedFloat32Array()

func _ready() -> void:
	_seed_noise(0)
	rebuild()

## Builds the terrain of one map. `layout` is the server's map layout and `reserved_rows` holds inclusive
## tile row ranges that stay flat whole, which `main3d.gd` fills with the two build zones. An empty layout is
## the map between matches: it takes the noise with no flat ground, as a backdrop for the start menu.
func configure(layout: Dictionary, reserved_rows: Array = []) -> void:
	_map_width = maxi(1, int(layout.get("width", 96)))
	_map_height = maxi(1, int(layout.get("height", 112)))
	_seed_noise(int(layout.get("usedSeed", 0)))
	_claimed_distance = _distance_field(_claimed_grid(layout, reserved_rows, _map_width, _map_height),
		_map_width, _map_height)
	rebuild()

## The ground height in tiles at a point given in tiles from the map's top-left corner. It is 0 over every
## lane, build zone, Core and marker, so a building, a creep or a tap lands where it always did.
func height_at(tile_x: float, tile_z: float) -> float:
	var flatten := flatten_at(tile_x, tile_z)
	if flatten <= 0.0:
		return 0.0
	return flatten * _noise_height(tile_x, tile_z)

## How much of the noise a point takes: 0 on ground the map claims, 1 once `FLATTEN_FALLOFF` tiles away.
func flatten_at(tile_x: float, tile_z: float) -> float:
	if _claimed_distance.is_empty():
		return 1.0
	return smoothstep(0.0, FLATTEN_FALLOFF, _distance_at(tile_x, tile_z))

## The three noise layers at a point, in tiles, before the flattening.
func _noise_height(tile_x: float, tile_z: float) -> float:
	var hill_height := peak_height * HILL_FRACTION
	var height := _hills.get_noise_2d(tile_x, tile_z) * hill_height
	var mask := smoothstep(RANGE_FLOOR, 1.0, (_ranges.get_noise_2d(tile_x, tile_z) + 1.0) * 0.5)
	mask = maxf(mask, _edge_bias(tile_x, tile_z))
	if mask > 0.0:
		var ridge := clampf((_ridges.get_noise_2d(tile_x, tile_z) + 1.0) * 0.5, 0.0, 1.0)
		height += ridge * ridge * mask * (peak_height - hill_height)
	if height < 0.0:
		height *= VALLEY_SCALE
	return height

## How much the rim of the map counts as mountain range: 0 more than `EDGE_RANGE` tiles inside the map and 1
## at the edge itself.
func _edge_bias(tile_x: float, tile_z: float) -> float:
	var inset := minf(
		minf(tile_x, float(_map_width) - tile_x),
		minf(tile_z, float(_map_height) - tile_z))
	return smoothstep(EDGE_RANGE, 0.0, inset)

## Rebuilds the mesh over the current map size. Every vertex takes its height, its normal and its tangent
## from `height_at`, so the lighting follows the same surface the game places its units on.
func rebuild() -> void:
	if not is_inside_tree():
		return
	var plane := PlaneMesh.new()
	plane.size = Vector2(float(_map_width), float(_map_height))
	plane.subdivide_width = maxi(0, _map_width * cells_per_tile - 1)
	plane.subdivide_depth = maxi(0, _map_height * cells_per_tile - 1)
	var arrays := plane.get_mesh_arrays()
	var vertices: PackedVector3Array = arrays[ArrayMesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[ArrayMesh.ARRAY_NORMAL]
	var tangents: PackedFloat32Array = arrays[ArrayMesh.ARRAY_TANGENT]
	# The plane is centered on the node, and the map counts its tiles from the top-left corner.
	var half_width := float(_map_width) * 0.5
	var half_height := float(_map_height) * 0.5
	var epsilon := 1.0 / float(cells_per_tile)
	for index in vertices.size():
		var vertex := vertices[index]
		var tile_x := vertex.x + half_width
		var tile_z := vertex.z + half_height
		vertex.y = height_at(tile_x, tile_z)
		vertices[index] = vertex
		# The slope in each direction, from a central difference of the same height function. The normal
		# negates it, which the example leaves out and which keeps a slope lit from the correct side.
		var slope_x := (height_at(tile_x + epsilon, tile_z) - height_at(tile_x - epsilon, tile_z)) / (2.0 * epsilon)
		var slope_z := (height_at(tile_x, tile_z + epsilon) - height_at(tile_x, tile_z - epsilon)) / (2.0 * epsilon)
		normals[index] = Vector3(-slope_x, 1.0, -slope_z).normalized()
		var tangent := Vector3(1.0, slope_x, 0.0).normalized()
		tangents[4 * index] = tangent.x
		tangents[4 * index + 1] = tangent.y
		tangents[4 * index + 2] = tangent.z
	arrays[ArrayMesh.ARRAY_VERTEX] = vertices
	arrays[ArrayMesh.ARRAY_NORMAL] = normals
	arrays[ArrayMesh.ARRAY_TANGENT] = tangents
	var array_mesh := ArrayMesh.new()
	array_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh = array_mesh
	_apply_material()

## The terrain material, built once and kept. The gradient spans twice `peak_height`, so the model y of a
## peak reads the last stop and a valley the first.
func _apply_material() -> void:
	var shader := load(SHADER_PATH) as Shader
	if shader == null:
		return
	var shader_material := material_override as ShaderMaterial
	if shader_material == null or shader_material.shader != shader:
		shader_material = ShaderMaterial.new()
		shader_material.shader = shader
		shader_material.set_shader_parameter("color_gradient", _gradient_texture())
		shader_material.set_shader_parameter("normal_map", _normal_map_texture())
		material_override = shader_material
	shader_material.set_shader_parameter("height", peak_height * 2.0)

func _gradient_texture() -> GradientTexture1D:
	var gradient := Gradient.new()
	var offsets := PackedFloat32Array()
	var colors := PackedColorArray()
	for stop in GRADIENT_STOPS:
		offsets.append(float(stop[0]))
		colors.append(Color(String(stop[1])))
	gradient.offsets = offsets
	gradient.colors = colors
	var texture := GradientTexture1D.new()
	texture.gradient = gradient
	texture.width = 1024
	return texture

func _normal_map_texture() -> NoiseTexture2D:
	var noise := FastNoiseLite.new()
	noise.seed = NORMAL_MAP_SALT
	noise.frequency = 0.01
	var texture := NoiseTexture2D.new()
	texture.width = 512
	texture.height = 512
	texture.seamless = true
	texture.as_normal_map = true
	texture.noise = noise
	return texture

## Seeds and shapes the three layers. Each takes the map seed with its own salt, so the hills, the ranges and
## the ridges never line up.
func _seed_noise(map_seed: int) -> void:
	_hills.seed = map_seed ^ HILL_SALT
	_hills.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_hills.fractal_type = FastNoiseLite.FRACTAL_FBM
	_hills.frequency = HILL_FREQUENCY
	_hills.fractal_octaves = HILL_OCTAVES
	_ranges.seed = map_seed ^ RANGE_SALT
	_ranges.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_ranges.fractal_type = FastNoiseLite.FRACTAL_FBM
	_ranges.frequency = RANGE_FREQUENCY
	_ranges.fractal_octaves = RANGE_OCTAVES
	_ridges.seed = map_seed ^ RIDGE_SALT
	_ridges.noise_type = FastNoiseLite.TYPE_SIMPLEX
	_ridges.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	_ridges.frequency = RIDGE_FREQUENCY
	_ridges.fractal_octaves = RIDGE_OCTAVES
	_ridges.fractal_lacunarity = RIDGE_LACUNARITY
	_ridges.fractal_gain = RIDGE_GAIN

## The distance field at a point, bilinear between the four nearest tile centers, so the slope has no steps.
func _distance_at(tile_x: float, tile_z: float) -> float:
	var x := clampf(tile_x - 0.5, 0.0, float(_map_width - 1))
	var z := clampf(tile_z - 0.5, 0.0, float(_map_height - 1))
	var x0 := int(floor(x))
	var z0 := int(floor(z))
	var x1 := mini(x0 + 1, _map_width - 1)
	var z1 := mini(z0 + 1, _map_height - 1)
	var fx := x - float(x0)
	var fz := z - float(z0)
	var top := lerpf(_claimed_distance[z0 * _map_width + x0], _claimed_distance[z0 * _map_width + x1], fx)
	var bottom := lerpf(_claimed_distance[z1 * _map_width + x0], _claimed_distance[z1 * _map_width + x1], fx)
	return lerpf(top, bottom, fz)

## One byte per tile: 1 where the map claims the ground and the terrain stays flat. The lanes, the Cores, the
## markers and the reserved rows each stamp their own clearance.
static func _claimed_grid(layout: Dictionary, reserved_rows: Array, map_width: int, map_height: int) -> PackedByteArray:
	var claimed := PackedByteArray()
	claimed.resize(map_width * map_height)
	if layout.is_empty():
		return claimed
	for rows in reserved_rows:
		var row_range := rows as Vector2i
		for tile_z in range(maxi(0, row_range.x), mini(map_height - 1, row_range.y) + 1):
			for tile_x in map_width:
				claimed[tile_z * map_width + tile_x] = 1
	for lane in layout.get("lanes", []):
		if not lane is Dictionary:
			continue
		for tile_index in lane.get("tiles", []):
			var index := int(tile_index)
			if index < 0 or index >= map_width * map_height:
				continue
			@warning_ignore("integer_division")
			_stamp(claimed, map_width, map_height, index % map_width, index / map_width, LANE_MARGIN)
	for key in [["cores", CORE_MARGIN], ["vents", MARKER_MARGIN], ["itemSpawns", MARKER_MARGIN], ["blockers", MARKER_MARGIN]]:
		for marker in layout.get(String(key[0]), []):
			if marker is Dictionary:
				_stamp(claimed, map_width, map_height, int(marker.get("tileX", 0)), int(marker.get("tileZ", 0)), int(key[1]))
	return claimed

static func _stamp(claimed: PackedByteArray, map_width: int, map_height: int, tile_x: int, tile_z: int, margin: int) -> void:
	for dz in range(-margin, margin + 1):
		var z := tile_z + dz
		if z < 0 or z >= map_height:
			continue
		for dx in range(-margin, margin + 1):
			var x := tile_x + dx
			if x >= 0 and x < map_width:
				claimed[z * map_width + x] = 1

## The distance in tiles from every tile to the nearest claimed tile, by two chamfer passes over the grid.
## The result is within a few percent of the true Euclidean distance, which a slope does not show.
static func _distance_field(claimed: PackedByteArray, map_width: int, map_height: int) -> PackedFloat32Array:
	var far := float(map_width + map_height)
	var distance := PackedFloat32Array()
	distance.resize(map_width * map_height)
	var any_claimed := false
	for index in claimed.size():
		var is_claimed := claimed[index] == 1
		any_claimed = any_claimed or is_claimed
		distance[index] = 0.0 if is_claimed else far
	if not any_claimed:
		return PackedFloat32Array()
	var diagonal := sqrt(2.0)
	for tile_z in map_height:
		for tile_x in map_width:
			var index := tile_z * map_width + tile_x
			var best := distance[index]
			if tile_x > 0:
				best = minf(best, distance[index - 1] + 1.0)
			if tile_z > 0:
				best = minf(best, distance[index - map_width] + 1.0)
				if tile_x > 0:
					best = minf(best, distance[index - map_width - 1] + diagonal)
				if tile_x < map_width - 1:
					best = minf(best, distance[index - map_width + 1] + diagonal)
			distance[index] = best
	for tile_z in range(map_height - 1, -1, -1):
		for tile_x in range(map_width - 1, -1, -1):
			var index := tile_z * map_width + tile_x
			var best := distance[index]
			if tile_x < map_width - 1:
				best = minf(best, distance[index + 1] + 1.0)
			if tile_z < map_height - 1:
				best = minf(best, distance[index + map_width] + 1.0)
				if tile_x < map_width - 1:
					best = minf(best, distance[index + map_width + 1] + diagonal)
				if tile_x > 0:
					best = minf(best, distance[index + map_width - 1] + diagonal)
			distance[index] = best
	return distance
