extends SceneTree
## Draws one map's procedural ground from above and saves a screenshot, so a change to the noise layers or
## to the terrain shader can be looked at without a backend. It needs a window, so do not pass --headless:
##
##   node -e "import('./src/sim/mapgen.js').then(async m => { const fs = await import('node:fs');
##     fs.writeFileSync('/tmp/map.json', JSON.stringify(m.generateMap(1234567,
##       JSON.parse(fs.readFileSync('data/mapgen.json', 'utf8'))))); })"
##   Godot --path vone --script res://tests/terrain_shot.gd -- --map=/tmp/map.json --out=/tmp/terrain.png
##
## --map takes the JSON of a map layout, which is also what GET /api/game/maps/<seed> answers, and --cells
## sets the vertex density of the terrain, as `cells_per_tile` does in the editor.

## Where the camera stands and how much of the map it takes in, which frames the whole 96 by 112 tile map.
const CAMERA_POSITION := Vector3(0.0, 110.0, 120.0)
const CAMERA_SIZE := 170.0

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var layout: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(_argument("map", "/tmp/map.json")))
	var scene: Node = load("res://scenes/main3d.tscn").instantiate()
	root.add_child(scene)
	root.size = Vector2i(1280, 960)
	await process_frame
	(scene.get_node("Terrain") as MeshInstance3D).set("cells_per_tile",
		int(_argument("cells", "1")))
	scene.call("set_world", layout, {"tick": 100, "entities": []}, 0)
	# The debug camera, placed by hand above the middle of the map, and no interface over it.
	scene.call("set_camera_mode", 1)
	for child in scene.get_children():
		if child is CanvasLayer:
			child.visible = false
	for _frame in 5:
		await process_frame
	scene.set_process(false)
	var camera := scene.get("_camera") as Camera3D
	camera.size = CAMERA_SIZE
	camera.position = CAMERA_POSITION
	camera.look_at(Vector3.ZERO, Vector3.UP)
	for _frame in 3:
		await process_frame
	await RenderingServer.frame_post_draw
	var path := _argument("out", "/tmp/terrain.png")
	root.get_texture().get_image().save_png(path)
	print("saved %s" % path)
	quit(0)

func _argument(name: String, fallback: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--%s=" % name):
			return argument.split("=", true, 1)[1]
	return fallback
