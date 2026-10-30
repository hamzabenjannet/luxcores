shader_type spatial;

// Colors the procedural terrain by height and breaks up its large flat faces with a tiling normal map.
// Ported from examples/yt-example-projects/terrain/terrain.gdshader, which colors a mesh whose vertices
// the CPU has already displaced (scripts/procedural_terrain.gd).
//
// `height` spans the gradient: a vertex at model y of -height/2 reads the first color and one at +height/2
// the last, so the script sets it to twice the tallest peak it builds.

uniform float height = 16.0;
uniform sampler2D color_gradient;
uniform sampler2D normal_map;
// Tiles the normal map, in repeats over the whole map. The mesh UV runs 0 to 1 across the map.
uniform float normal_scale = 24.0;
uniform float normal_strength : hint_range(0.0, 1.0) = 0.35;

void fragment() {
	vec4 world_vertex = INV_VIEW_MATRIX * vec4(VERTEX, 1.0);
	vec3 model_vertex = (inverse(MODEL_MATRIX) * world_vertex).xyz;
	float gradient_uv = (model_vertex.y / height) + 0.5;
	ALBEDO = texture(color_gradient, vec2(gradient_uv)).rgb;
	NORMAL_MAP = texture(normal_map, UV * normal_scale).xyz;
	NORMAL_MAP_DEPTH = normal_strength;
	ROUGHNESS = 0.9;
	SPECULAR = 0.1;
}
