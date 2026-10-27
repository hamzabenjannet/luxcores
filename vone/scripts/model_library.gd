extends RefCounted
## The one place that names a model file and places it on a tile.
##
## Gameplay never reaches inside an imported model. It asks this library for a spec, adds the node the
## library builds, and finds it again under the stable name `VISUAL_NAME`. A replacement file may carry any
## hierarchy, mesh, material, skeleton, bone or animation names, because nothing outside this file reads them.
##
## Each model arrives in its own units with its own origin, so `scale` fits it on a tile and `center`, in
## model units, centers it and rests it on the ground. Both come from the merged bounds measured in Godot,
## which the comment of each entry names. A replacement with a different pivot or unit needs those two
## numbers measured again: the importer keeps the file's `uid` and the settings of its `.import` sidecar, and
## it keeps nothing about the shape inside.

## The name every instantiated model carries, so gameplay and the tests address one stable node.
const VISUAL_NAME := "Visual"

## Models by template name (`_template_for` in `main3d.gd`).
const ENTITY_MODELS := {
	## 120 by 120 by 120, centered on its middle: a Core 1.8 tiles across, under its lux label at 2.1.
	"LumenCore": {
		"scene": preload("res://assets/lux_core_model_asset.glb"),
		"scale": 0.015,
		"center": Vector3(0.0, 60.26, 0.0),
	},
	## 1135 by 131 by 634: a wide, flat panel field on a 1.25 by 0.7 tile footprint.
	"Solar": {
		"scene": preload("res://assets/solar_panels.glb"),
		"scale": 0.0011,
		"center": Vector3(-482.6, 2.2, -93.2),
	},
	## 14 by 108 by 57, its origin at the hub with the tower below: 1.84 tiles tall, under the lux label.
	"Wind": {
		"scene": preload("res://assets/wind_turbine.glb"),
		"scale": 0.017,
		"center": Vector3(2.8, 75.3, 8.4),
	},
	## 3288 by 1827 by 4044: a station 1.05 by 0.58 by 1.29 tiles.
	"Geothermal": {
		"scene": preload("res://assets/geothermal_power_station.glb"),
		"scale": 0.00032,
		"center": Vector3(0.0, 7.8, 22.0),
	},
	## 49 by 25 by 82: a plant 0.84 by 0.43 by 1.4 tiles.
	"Nuclear": {
		"scene": preload("res://assets/nuclear_powerplant.glb"),
		"scale": 0.0171,
		"center": Vector3(-0.2, 1.0, -0.5),
	},
	## 23 by 90 by 23: a tower 1.5 tiles tall.
	"TowerRanged": {
		"scene": preload("res://assets/ranged_tower_model_asset.glb"),
		"scale": 0.0166,
		"center": Vector3(0.0, 0.0, 0.0),
	},
	## 37 by 87 by 37, its origin 42.5 above its base: a tower 1.5 tiles tall.
	"TowerArea": {
		"scene": preload("res://assets/area_tower_model_asset.glb"),
		"scale": 0.0173,
		"center": Vector3(0.0, 42.5, 0.0),
	},
	## 2.3 by 9.9 by 2.3: a tower 1.5 tiles tall.
	"TowerMelee": {
		"scene": preload("res://assets/melee_tower_model_asset.glb"),
		"scale": 0.152,
		"center": Vector3(0.0, 0.5, 0.0),
	},
	## 1.3 by 2.7 by 0.6: a creep 0.85 tiles tall, the height of the melee creep model.
	"CreepArea": {
		"scene": preload("res://assets/creep_area_model_asset.glb"),
		"scale": 0.32,
		"center": Vector3(0.0022, 1.3527, 0.0248),
	},
	## 0.019 by 0.037 by 0.008: a creep 0.85 tiles tall, the height of the melee creep model.
	"CreepRanged": {
		"scene": preload("res://assets/creep_ranged_model_asset.glb"),
		"scale": 23.3,
		"center": Vector3(0.0, 0.0001, -0.0007),
	},
	## The melee creep, half its own size, with its origin already at its feet.
	"CreepMeleeModelAsset": {
		"scene": preload("res://assets/CreepMeleeModelAsset.glb"),
		"scale": 0.5,
		"center": Vector3.ZERO,
	},
	## The barracks, standing 0.9 above the tile. `main3d.gd` turns it to the yaw of the editor showcase node.
	"Barracks": {
		"scene": preload("res://assets/creepBarracks.glb"),
		"scale": 1.0,
		"center": Vector3(0.0, 0.9, 0.0),
	},
	## 20 by 1.8 by 20: a flat bag one tile across.
	"LootBag": {
		"scene": preload("res://assets/loot_bag_model_asset.glb"),
		"scale": 0.049,
		"center": Vector3(0.0, 1.2012, 0.0),
	},
	## 4.6 by 2 by 5, its origin at one corner: a blocker 0.83 by 0.36 by 0.9 tiles.
	"Blocker": {
		"scene": preload("res://assets/blocker_model_asset.glb"),
		"scale": 0.18,
		"center": Vector3(0.2952, 0.0, -2.4999),
	},
}

## Models of the ground items, by item name (data/items.json). A name missing here renders as the orb.
const ITEM_MODELS := {
	## 23.5 by 3.2 by 23.5: a flat pickup 0.8 tiles across.
	"Energy Boost": {
		"scene": preload("res://assets/energy_boost_item_model_asset.glb"),
		"scale": 0.034,
		"center": Vector3(0.0, 1.0022, 0.0),
	},
	## 3.4 by 2.9 by 1.1: a pickup 0.7 tiles tall.
	"Energy Grab": {
		"scene": preload("res://assets/energy_grab_item_model_asset.glb"),
		"scale": 0.238,
		"center": Vector3(0.56, 0.02, -0.0139),
	},
	## 6.6 by 3.0 by 3.6, its origin 31.8 below the model: a pickup 0.8 tiles across.
	"Haste": {
		"scene": preload("res://assets/haste_item_model_asset.glb"),
		"scale": 0.12,
		"center": Vector3(0.0008, -31.8057, -29.8546),
	},
	## 6.5 by 10.0 by 9.3: a pickup 0.7 tiles tall.
	"Sluggish": {
		"scene": preload("res://assets/sluggish_item_model_asset.glb"),
		"scale": 0.07,
		"center": Vector3(-0.1651, -0.009, 1.5983),
	},
}

## The map markers (GDD 10.1), by layout key. The geothermal vent model is 0.26 by 0.05 by 0.24 in its own
## units and the item spawn model 200 by 30 by 200, so both end up about 0.9 tiles across and flat on the ground.
const MAP_MODELS := {
	"vents": {
		"scene": preload("res://assets/geothermal_vent_model_asset.glb"),
		"scale": 3.5,
		"center": Vector3(0.0, -0.0004, 0.0012),
	},
	"itemSpawns": {
		"scene": preload("res://assets/item_span_model_asset.glb"),
		"scale": 0.0045,
		"center": Vector3(0.0, 0.0, 0.0),
	},
}

## Hero models by roster name (data/heroes.json). A name missing here renders as the capsule. The models are
## 2 tiles tall with their origin at the middle, so a scale of 0.8 gives the capsule's 1.6 height.
const HERO_MODELS := {
	"Halo": {"scene": preload("res://assets/hero01.glb"), "scale": 0.8, "center": Vector3(0.0, 1.0, 0.0)},
	"Prism": {"scene": preload("res://assets/hero02.glb"), "scale": 0.8, "center": Vector3(0.0, 1.0, 0.0)},
	"Flare": {"scene": preload("res://assets/hero03.glb"), "scale": 0.8, "center": Vector3(0.0, 1.0, 0.0)},
	"Aurora": {"scene": preload("res://assets/hero04.glb"), "scale": 0.8, "center": Vector3(0.0, 1.0, 0.0)},
	"Corona": {"scene": preload("res://assets/hero05.glb"), "scale": 0.8, "center": Vector3(0.0, 1.0, 0.0)},
}

## The spec of a template name, an item name, a map layout key or a roster name, or `{}` when there is none.
static func entity_spec(template_name: String) -> Dictionary:
	return ENTITY_MODELS.get(template_name, {})

static func item_spec(item_name: String) -> Dictionary:
	return ITEM_MODELS.get(item_name, {})

static func map_spec(layout_key: String) -> Dictionary:
	return MAP_MODELS.get(layout_key, {})

static func hero_spec(hero_name: String) -> Dictionary:
	return HERO_MODELS.get(hero_name, {})

## The model of a spec, scaled and placed on the tile its anchor sits on, under the name `VISUAL_NAME`.
## Returns null for an empty spec, and for a file that no longer imports as a `Node3D`, so a caller that
## meets a replacement it cannot place draws its placeholder instead of failing.
static func instance(spec: Dictionary) -> Node3D:
	if spec.is_empty():
		return null
	var model := (spec.scene as PackedScene).instantiate() as Node3D
	if model == null:
		push_warning("Model %s did not import as a Node3D; the placeholder stands in." % spec.scene.resource_path)
		return null
	var model_scale := float(spec.scale)
	model.name = VISUAL_NAME
	model.scale = Vector3.ONE * model_scale
	model.position = (spec.center as Vector3) * model_scale
	return model
