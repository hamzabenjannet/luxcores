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
## ## How the Lanes Cross It
##
## The noise covers the whole map, the middle included. The lanes do not flatten it: they cut through it like
## a road. `configure` stamps the lane tiles, the Cores and the markers into a mask and measures how far each
## tile sits from it, and `height_at` blends the ground toward the **floor height** over `CUT_FALLOFF` tiles.
## The floor is the hill layer alone, shrunk by `FLOOR_SCALE` and carrying no ridge, so a lane rolls gently
## and never climbs a mountain: a range in its way becomes a pass. Everything else, the build rows and the
## DMZ among them, takes the full terrain.
##
## Nothing in the game reads y = 0 as the ground any more. `main3d.gd` seats buildings, creeps, heroes,
## labels, the ghost and the aim ring on `height_at`, drapes the lane and zone overlays on it, and answers a
## tap by marching the camera ray against it (`ground_point`), so a tap on a slope reads the tile the player
## sees rather than the tile under the slope.
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

## The cut: how far past each thing the map owns the ground still follows the lane floor, in tiles.
const LANE_MARGIN := 1
const CORE_MARGIN := 4
const MARKER_MARGIN := 2
## How far from the cut the ground climbs back to the full terrain. A low number walls the lane in, a high
## one flattens the map around it, and 6 tiles gives a bank a hero can be seen to climb.
const CUT_FALLOFF := 6.0
## The floor a lane follows: the hill layer alone, at this share of its height. It keeps a lane rolling
## instead of flat, and small enough that no slope on it hides a creep.
const FLOOR_SCALE := 0.45

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
## One float per tile: the distance in tiles to the nearest tile the lanes, the Cores or the markers own,
## and 0 on such a tile. Empty while no map is configured, which leaves the terrain uncut.
var _cut_distance := PackedFloat32Array()

func _ready() -> void:
	_seed_noise(0)
	rebuild()

## Builds the terrain of one map. `layout` is the server's map layout: its lanes, Cores and markers cut the
## road through the noise. An empty layout is the map between matches, which takes the uncut terrain as a
## backdrop for the start menu.
func configure(layout: Dictionary) -> void:
	_map_width = maxi(1, int(layout.get("width", 96)))
	_map_height = maxi(1, int(layout.get("height", 112)))
	_seed_noise(int(layout.get("usedSeed", 0)))
	_cut_distance = _distance_field(_cut_grid(layout, _map_width, _map_height), _map_width, _map_height)
	rebuild()

## The ground height in tiles at a point given in tiles from the map's top-left corner. Everything the game
## draws sits on this, and `main3d.gd` answers a tap against it.
func height_at(tile_x: float, tile_z: float) -> float:
	var hills := _hills.get_noise_2d(tile_x, tile_z) * peak_height * HILL_FRACTION
	var cut := cut_at(tile_x, tile_z)
	if cut >= 1.0:
		return _sink(hills * FLOOR_SCALE)
	var open_ground := _open_height(tile_x, tile_z, hills)
	if cut <= 0.0:
		return open_ground
	return lerpf(open_ground, _sink(hills * FLOOR_SCALE), cut)

## How much of the lane floor a point takes: 1 on a tile the lanes, the Cores or the markers own, falling to
## 0 over `CUT_FALLOFF` tiles.
func cut_at(tile_x: float, tile_z: float) -> float:
	if _cut_distance.is_empty():
		return 0.0
	return 1.0 - smoothstep(0.0, CUT_FALLOFF, _distance_at(tile_x, tile_z))

## The open ground: the hills, plus the ridges wherever the range mask lets a mountain stand.
func _open_height(tile_x: float, tile_z: float, hills: float) -> float:
	var height := hills
	var mask := smoothstep(RANGE_FLOOR, 1.0, (_ranges.get_noise_2d(tile_x, tile_z) + 1.0) * 0.5)
	mask = maxf(mask, _edge_bias(tile_x, tile_z))
	if mask > 0.0:
		var ridge := clampf((_ridges.get_noise_2d(tile_x, tile_z) + 1.0) * 0.5, 0.0, 1.0)
		height += ridge * ridge * mask * (peak_height - peak_height * HILL_FRACTION)
	return _sink(height)

## Shallows a dip below the base plane, so a valley reads as a valley and not as a hole.
func _sink(height: float) -> float:
	return height * VALLEY_SCALE if height < 0.0 else height

## How much the rim of the map counts as mountain range: 0 more than `EDGE_RANGE` tiles inside the map and 1
## at the edge itself.
func _edge_bias(tile_x: float, tile_z: float) -> float:
	var inset := minf(
		minf(tile_x, float(_map_width) - tile_x),
		minf(tile_z, float(_map_height) - tile_z))
	return smoothstep(EDGE_RANGE, 0.0, inset)

## Rebuilds the mesh over the current map size. The heights are measured once into a grid, and the normal
## and the tangent of a vertex come from the heights of its neighbors in that grid, so the lighting follows
## the same surface the game places its units on at one `height_at` call per vertex.
func rebuild() -> void:
	if not is_inside_tree():
		return
	var columns := _map_width * cells_per_tile
	var rows := _map_height * cells_per_tile
	var plane := PlaneMesh.new()
	plane.size = Vector2(float(_map_width), float(_map_height))
	plane.subdivide_width = maxi(0, columns - 1)
	plane.subdivide_depth = maxi(0, rows - 1)
	var arrays := plane.get_mesh_arrays()
	var vertices: PackedVector3Array = arrays[ArrayMesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[ArrayMesh.ARRAY_NORMAL]
	var tangents: PackedFloat32Array = arrays[ArrayMesh.ARRAY_TANGENT]
	# The plane is centered on the node, and the map counts its tiles from the top-left corner.
	var half_width := float(_map_width) * 0.5
	var half_height := float(_map_height) * 0.5
	var spacing := 1.0 / float(cells_per_tile)
	var heights := PackedFloat32Array()
	heights.resize((columns + 1) * (rows + 1))
	for row in rows + 1:
		for column in columns + 1:
			heights[row * (columns + 1) + column] = height_at(float(column) * spacing, float(row) * spacing)
	for index in vertices.size():
		var vertex := vertices[index]
		var tile_x := vertex.x + half_width
		var tile_z := vertex.z + half_height
		var column := clampi(int(round(tile_x / spacing)), 0, columns)
		var row := clampi(int(round(tile_z / spacing)), 0, rows)
		vertex.y = heights[row * (columns + 1) + column]
		vertices[index] = vertex
		# The slope in each direction, from a central difference over the grid. The normal negates it, which
		# the example leaves out and which keeps a slope lit from the correct side.
		var slope_x := _grid_slope(heights, columns, rows, column, row, 1, 0, spacing)
		var slope_z := _grid_slope(heights, columns, rows, column, row, 0, 1, spacing)
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

## The slope of the height grid at one node, along one axis. A node on the border of the grid has no
## neighbor on one side and takes the one-sided difference instead.
func _grid_slope(heights: PackedFloat32Array, columns: int, rows: int, column: int, row: int,
		step_x: int, step_z: int, spacing: float) -> float:
	var low_column := maxi(0, column - step_x)
	var low_row := maxi(0, row - step_z)
	var high_column := mini(columns, column + step_x)
	var high_row := mini(rows, row + step_z)
	var span := float((high_column - low_column) + (high_row - low_row)) * spacing
	if span <= 0.0:
		return 0.0
	return (heights[high_row * (columns + 1) + high_column] - heights[low_row * (columns + 1) + low_column]) / span

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

## The distance to the road at a point, bilinear between the four nearest tile centers, so a bank has no
## steps.
func _distance_at(tile_x: float, tile_z: float) -> float:
	var x := clampf(tile_x - 0.5, 0.0, float(_map_width - 1))
	var z := clampf(tile_z - 0.5, 0.0, float(_map_height - 1))
	var x0 := int(floor(x))
	var z0 := int(floor(z))
	var x1 := mini(x0 + 1, _map_width - 1)
	var z1 := mini(z0 + 1, _map_height - 1)
	var fx := x - float(x0)
	var fz := z - float(z0)
	var top := lerpf(_cut_distance[z0 * _map_width + x0], _cut_distance[z0 * _map_width + x1], fx)
	var bottom := lerpf(_cut_distance[z1 * _map_width + x0], _cut_distance[z1 * _map_width + x1], fx)
	return lerpf(top, bottom, fz)

## One byte per tile: 1 where the road runs and the ground follows the lane floor. The lanes, the Cores and
## the markers each stamp their own margin; the build rows and the DMZ stamp nothing, so they keep their
## hills.
static func _cut_grid(layout: Dictionary, map_width: int, map_height: int) -> PackedByteArray:
	var claimed := PackedByteArray()
	claimed.resize(map_width * map_height)
	if layout.is_empty():
		return claimed
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

## The distance in tiles from every tile to the nearest tile of the road, by two chamfer passes over the
## grid.
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
