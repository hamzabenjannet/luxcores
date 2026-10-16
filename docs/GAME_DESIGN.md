# Lumen: Game Design Document (MVP)

Working title. A strategy game mixing hero control (Dota 2), creep waypoint paths (Age of Empires) and base building with tower defense (Generals Zero Hour, Clash Royale). Everything in the world is made of light energy, measured in **lux**. Destroyed things dissolve into light; there is no blood or gore.

Status: draft v0.9.1. Numbers marked *(default)* live in `data/balance.json` and will be tuned through MVP playtests.

---

## 0. Changelog

### v0.9 → v0.9.1

| Area | Change |
|---|---|
| Black hole | Removed from the design, the data and the client; the map center is ordinary DMZ ground and the mid lane crosses it (section 10.1) |
| Lane width | 3 tiles *(default)* (section 10.2) |
| Connectivity check | Blockers and Cores are the only walls (section 10.2) |
| Spacing | Distances are measured as the larger of the two axis differences; a relaxed spacing applies to one element only (section 10.2) |

### v0.8 → v0.9

| Area | Change |
|---|---|
| Lanes | Side lanes stay in their columns, then curve into the middle column in the Core row and merge at the Core |
| Minimap | None; players travel with the hero or slide the view |
| Map content | Procedurally generated from the match seed, mirrored (section 10.2) |

### v0.7 → v0.8

| Area | Change |
|---|---|
| Map | 96 × 112 tiles; rows 32 / 16 / 16 / 16 / 32; the viewport shows 1 column × 3 rows (section 10.1) |
| Travel | Core to Core about 80 tiles: roughly 40 s for a creep, 27 s for a hero |

### v0.6 → v0.7

| Area | Change |
|---|---|
| Map | 96 × 192 tiles: 3 columns of 32 × 192 (section 10) |
| Hero spawn | Production timer in the barracks queue |
| Creep cap | Lowered from 50 to 30 alive per player (2 waves of 5 per lane); a merged group can hold all 30 |
| Barracks destroyed | Held creeps and waiting items are lost |
| Split | Halves; the odd creep stays in the original group |

### v0.5 → v0.6

| Area | Change |
|---|---|
| Travel time | Kept as is; judged in playtests |
| Barracks queue | Capped creep groups and waiting items are held aside; later orders skip ahead |
| Hero pick | Optional; done from a barracks; in team modes each player picks from their own barracks |
| Stuns | Also hit buildings (a stunned tower stops attacking) |
| Simultaneous Core death | Draw |
| Creep groups | Merge and split; one group per path command; groups can share the same waypoints |
| Map layout | Pending clarification (Q1) |

### v0.4 → v0.5

| Area | Change |
|---|---|
| Unlimited mode | No target length; ends only on a defeat |
| Map | 192 × 192 tiles; portrait viewport of 32 × 64 tiles; the 3 curved lanes merge near each Core |
| 5v5 economy | Every teammate spends freely from the shared Core |
| Footprints | Every building is 1 × 1 tile |
| Queues | Items wait in the barracks for the next hero; creep orders wait for a free cap slot |
| Readability | Glow brightness shows lux; no HP bars |
| End of match | Stats screen |
| Team colors | Red vs blue |

### v0.3 → v0.4

| Area | Change |
|---|---|
| Kill bounty | None. Combat profit comes only from Energy Grab and loot bags |
| Loot bag | The owner's next hero can reclaim it |
| Shield ability | Targets own hero, own buildings, own creeps or a teammate's hero |
| Lumen Core | Passive, never attacks |
| Towers | Dota targeting rule |
| Items | Bought through the barracks production queue |
| Creeps | Cap of 50 alive per player |
| Lanes | Curved |
| Fog of war | Post-MVP; visibility groundwork laid in the sim now |
| Art | Low-poly neon, models and team colors by Hama BEN JANNET |

### v0.2 → v0.3

| Area | Change |
|---|---|
| Abilities | 4 ability types: melee, ranged, area, **shield**. Each hero has one of each. Lux cost per cast plus a 5 s cooldown |
| Hero spawn | Next to a barracks chosen at pick time |
| Inventory | Hero-owned, 50 slots, dropped as a loot bag on death |
| Items | Cost lowered from 100 to 20; effects aligned (section 8) |
| Energy Grab | Funnel budget 50 lux |
| Haste, Sluggish | ±300 attack speed for 300 ticks (15 s) |
| Blockers | Destroying one only frees tiles |
| Timed-mode score | Inventory items excluded |
| Numbers | Whole economy rescaled to one logic (section 3.8) |

### v0.1 → v0.2

Single hero with a 5-hero rotation, funnel unit replaced by the Energy Grab item, consumable items, creep waypoint paths, XP removed, black hole made decorative, environment blockers added, platform plan moved to web MVP then Godot.

---

## 1. Core loop

1. Build energy collectors.
2. Build towers.
3. Build barracks.
4. Pick a hero from the roster of 5 and a barracks to spawn at.
5. Order creep groups and set their paths (at any time, while the group is selected).
6. Move the hero, attack, cast abilities, use items. With Energy Grab active, hero attacks funnel lux to your Core instead of destroying it.
7. Win by reducing the enemy Lumen Core to 0 lux, or by owning more total lux when the timer ends.

## 2. Game modes

| Mode | End condition | Winner |
|---|---|---|
| Unlimited | A Lumen Core reaches 0 lux | The team whose Core survives |
| Timed (10 min) | Core at 0, or timer reaches 10:00 | Core survivor; at the buzzer, the team with the higher **total lux value** |

**Total lux value** = Core lux + lux value of every building, creep and hero the team owns. Items are not counted.

Main mode: **1v1** (mobile). PC scope: up to **5v5**, one hero per player.

Unlimited mode has no target length. Entropy and collector rates are tuned from playtests so that defenses can't hold forever, without forcing a fixed duration.

Both Cores reaching 0 on the same tick: draw.

### 2.1 Team economy (2v2 to 5v5)

The team shares one Lumen Core and one lux pool. Every player spends from it freely, including hero HP allocation.

Buildings are owned by the player who built them. A player picks heroes, orders creeps and buys items only at their own barracks. Creep caps (30) count per player. A future vote-to-limit option for an over-spending teammate is out of MVP scope.

## 3. The lux economy

### 3.1 Lumen Core

- The team's bank and its life. Core HP **is** its lux (HP factor 1).
- Starting lux: `100 × number of players on the team`.
- No cap. At 0, the team loses.

### 3.2 HP factor

| Entity | HP factor |
|---|---|
| Lumen Core | 1 |
| Everything else (buildings, creeps, heroes, blockers) | 10 |

**Lux value** of an entity = `current HP / 10`.

### 3.3 Income buffer

Collected and funneled lux enters a pending pool and settles into the Core 2 s later (40 ticks). Pending lux is not Core HP.

### 3.4 Spending

Buildings, creeps, heroes, ability casts and items move lux from the Core at 1:1. A purchase is refused if it would leave the Core below 1 lux.

### 3.5 Damage and funneling

| Source | Effect | Lux goes to |
|---|---|---|
| Creep, tower, hero attack, ability | Removes HP | Lost |
| Hero attack with Energy Grab active | Removes HP | Hero owner's pending pool, at `HP removed / 10` |

### 3.6 Recycling

Buildings only. Refund `60% × current lux value`, 3 s channel, cancel by tapping the building again.

### 3.7 Entropy

Buildings, creeps and heroes lose 1% of max HP per minute *(default)*. The Core is exempt.

### 3.8 Number logic

Every price is anchored to two references: the starting Core (100 lux) and a basic solar collector (20 lux, earning 2 lux/s by day).

| Rule | Consequence |
|---|---|
| A collector pays itself back in 10 to 20 s of output | Expanding the economy early is always worth it |
| A tower costs the same as a solar collector | Defend vs. grow is a real choice |
| A full creep group (5) costs about one tower | Attacking and defending trade evenly |
| Items cost 20, about one tower | An item is a tactical spend, affordable from the first minute |
| An item's lux effect is below its cost | Items buy convenience and timing, never free lux |
| Energy Grab budget (50) is above its cost (20) | It pays off only if the hero survives long enough to land the hits |

## 4. Collectors

| Collector | Cost | Output | Payback | Rule |
|---|---|---|---|---|
| Solar | 20 | 2 lux/s by day, 0 at night | 10 s of daylight | Day/night cycle |
| Wind | 20 | 0 to 3 lux/s (avg 1.5) | ~13 s | Rerolls every 10 s (seeded RNG) |
| Geothermal | 40 | 2 lux/s | 20 s | Vent tiles only (2 per build zone) |
| Nuclear | 80 | 5 lux/s | 16 s | Meltdown risk |

- Day/night: 40 s day + 20 s night. Match starts at dawn.
- Meltdown: if the team spends nothing for 120 s while owning nuclear plants, each plant is destroyed and deals 50% of its max HP as damage within 3 tiles, to both teams. Any spend resets the timer.

## 5. Buildings

| Building | Cost | HP | Notes |
|---|---|---|---|
| Lumen Core | n/a | = lux | Bank and life; passive, never attacks |
| Solar, Wind | 20 | 200 | Income |
| Geothermal | 40 | 400 | Income |
| Nuclear | 80 | 800 | Income |
| Barracks | 40 | 400 | Creeps, items, hero spawn point |
| Tower | 20 | 200 | 20 damage per hit, 1 hit/s, range 5 tiles; attack type chosen at build |

- Placement anywhere in the team's build zone on free tiles. DMZ and map center are no-build.
- Every building, including the Lumen Core, occupies 1 × 1 tile.
- No limit on barracks or towers.
- Recycling a barracks refunds its queued orders at 100% *(default)*.

### 5.0 Tower targeting

1. Keep the current target while it stays in range.
2. Otherwise, pick the nearest enemy in range (ties: lowest entity ID).
3. **Override**: if an enemy hero within range attacks a friendly hero, the tower switches to that enemy hero. The override lasts 3 s *(default)* after the last such attack.

### 5.1 Tower upgrades

Two tracks, 3 levels each:

| Level | Cost | Power track | Shell track |
|---|---|---|---|
| 1 | 10 | +25% damage | +100 HP |
| 2 | 20 | +25% damage | +200 HP |
| 3 | 40 | +25% damage | +400 HP |

Shell HP equals upgrade cost × 10, consistent with the HP factor. Lux spent on Power is stored in the tower and counts toward its recycle refund.

## 6. Environment blockers

- Neutral structures generated from the match seed in both build zones, mirrored.
- 6 per build zone, 1 tile each, 200 HP *(default)*.
- They block building until destroyed. Only heroes attack them; creeps path around.
- Destroying one frees its tile. No reward.

## 7. Hero

### 7.1 Roster and rotation

- 5 heroes, fixed roster. Both players may field the same hero.
- One hero alive per player.
- **Rotation**: a picked hero is locked until the player has picked the other 4. Then the full roster unlocks again.
- Picking is optional. A player can stay hero-less while building.
- Picks are made from a barracks the player owns (tap barracks → Hero tab). The pick enters that barracks' production queue with a 5 s build time *(default)*; the allocated lux is paid at order time. The hero spawns next to that barracks. With no barracks, no hero can be picked.
- Death: 5 s cooldown before the next pick is allowed. Worst case from death to a hero on the field: 10 s.
- If the barracks is destroyed while the hero is in production, the order and its lux are lost.

### 7.2 HP allocation

- At pick time the player allocates L lux, `1 ≤ L ≤ Core lux − 1`.
- HP = L × 10.
- No XP and no levels in this version.

### 7.3 Base stats

| Stat | Hero | Creep |
|---|---|---|
| Damage per hit | 20 | 10 |
| Attack speed | 100 (= 1 hit/s) | 100 |
| Move speed | 3 tiles/s | 2 tiles/s |
| Sight | 7 tiles | 6 tiles |

Attack speed: `hits per second = attackSpeed / 100`. Minimum 20.

### 7.4 Attack types

| Type | Damage multiplier per target | Reach | Proc |
|---|---|---|---|
| Melee | 100% | Contact | 15% chance to stun 0.5 s (units and buildings; a stunned tower stops attacking) |
| Ranged | 60% | 4 tiles | 15% chance to knock back 0.5 tiles |
| Area | 35% | 3 tiles, splash radius 1.2 tiles | none |

Each hero has a primary type for basic attacks.

### 7.5 Abilities

Each hero has exactly 4 abilities, one per type. All share a 5 s cooldown (100 ticks) per ability.

| Slot | Type | Cost | Default effect |
|---|---|---|---|
| 1 | Melee | 5 | 60 damage to the target in contact, guaranteed stun 0.5 s |
| 2 | Ranged | 5 | 60 damage to one target within 6 tiles |
| 3 | Area | 5 | 40 damage to all enemies within 1.5 tiles of a point within 5 tiles |
| 4 | Shield | 10 | Absorbs up to 150 damage for 5 s on one target within 5 tiles: own hero, own building, own creep or a teammate's hero. Not the Lumen Core |

Damage values are before the type multiplier on basic attacks only; abilities use the listed number directly *(default)*.

Placeholder roster (kits differ by tuning the template values; names to be designed):

| # | Hero | Primary type | Identity |
|---|---|---|---|
| 0 | Halo | Melee | Tanky brawler: stronger shield |
| 1 | Prism | Ranged | Long range: ranged ability at 8 tiles |
| 2 | Flare | Area | Wave clear: larger area radius |
| 3 | Aurora | Ranged | Skirmisher: faster move speed |
| 4 | Corona | Melee | Diver: melee ability with a dash |

Ability template:

```json
{ "id": "prism_beam", "type": "ranged", "luxCost": 5, "cooldownTicks": 100,
  "shape": "single", "range": 8000, "damage": 60, "effects": [] }
```

### 7.6 Environment interactions

- Pick up items and loot bags (walk over them, auto pickup).
- Attack and destroy environment blockers.

## 8. Items

### 8.1 Rules

- Single use. Cost 20 lux each.
- Sources: bought at any barracks, dropped by kills, spawned on the map.
- **Buying**: an item order enters the barracks production queue (1 s build time *(default)*) and lands in the inventory of the player's hero when done. With no hero alive, it waits in the barracks and transfers to the next hero at spawn, wherever that hero spawns.
- **Inventory**: 50 slots, owned by the hero.
- **On hero death**, the whole inventory drops as a **loot bag** where the hero died. Any hero who walks over it takes the contents, up to free slots, including the owner's next hero. The bag despawns after 30 s.
- Use: from the inventory or from 4 quick slots on the HUD.

### 8.2 Starter items

| ID | Name | Cost | Target | Effect |
|---|---|---|---|---|
| 0 | Energy Boost | 20 | Own hero or own building, never the Core | +15 lux (+150 HP) |
| 1 | Energy Grab | 20 | Own hero | Hero attacks funnel instead of drain until 50 lux has been transferred, then consumed |
| 2 | Haste | 20 | Own hero | +300 attack speed for 300 ticks (15 s) |
| 3 | Sluggish | 20 | Enemy hero or creep | −300 attack speed for 300 ticks (15 s), floored at 20 |

Haste turns 1 hit/s into 4 hits/s. If playtests show it's dominant, +100 (2 hits/s) is the first adjustment to try.

### 8.3 Drops and map spawns

- Kill drop: 10% chance on creep kill, random starter item (seeded RNG).
- Hero kills drop the loot bag (section 8.1) instead of a random item.
- Map spawns: one item every 60 s at one of 4 mirrored points in the DMZ.
- Single items on the ground despawn after 30 s.

## 9. Creeps

- Ordered at a barracks in groups of 1 to 5, with a chosen attack-type mix.
- Cost 5 lux per creep (HP 50). Build time 2 s per group.
- Always commanded as a group.
- Cap: 30 alive creeps per player (enough for 2 waves of 5 on each lane). A finished group that would exceed it is **held** in its barracks until enough slots free up, then spawns. Held groups don't block the queue: later orders (items included) skip ahead.
- A barracks destroyed while holding groups or items loses them; no refund.

### 9.0 Groups

- **Merge**: select group A, tap Merge, tap group B. B joins A and takes A's path *(default)*.
- **Split**: select a group, tap Split; it divides into two halves. With an odd count, the extra creep stays in the original group (7 → 4 + 3). A group of 1 can't split. Both halves keep the current path.
- One group selected at a time; a path command applies to that group only.
- Several groups can be given the same waypoints. Path mode offers **Reuse last path** to repeat the previous waypoint set in one tap.
- No group size limit beyond the creep cap: one merged group can hold all 30.

### 9.1 Paths

- **No path**: the group walks the nearest lane toward the enemy Lumen Core.
- **Barracks default path**: optional; new groups inherit it.
- **Group path**: up to 10 waypoints, set or replaced any time while selected.
- After the last waypoint, the group heads for the enemy Lumen Core.

### 9.2 Behavior

- Auto-engage enemy creeps, heroes and buildings within sight.
- After the target dies, resume toward the current waypoint.

## 10. Map

### 10.1 Layout

**96 wide × 112 tall.** A grid of 3 columns × 5 rows. Each column is 32 tiles wide and carries one lane.

| Rows | Height | Left column (x 0–31) | Middle column (x 32–63) | Right column (x 64–95) |
|---|---|---|---|---|
| 0–31 | 32 | Enemy build zone, left lane | Enemy build zone, mid lane, **enemy Lumen Core** | Enemy build zone, right lane |
| 32–47 | 16 | Enemy build zone, left lane | Enemy build zone, mid lane | Enemy build zone, right lane |
| 48–63 | 16 | DMZ, left lane | DMZ, mid lane, **map center** | DMZ, right lane |
| 64–79 | 16 | Your build zone, left lane | Your build zone, mid lane | Your build zone, right lane |
| 80–111 | 32 | Your build zone, left lane | Your build zone, mid lane, **your Lumen Core** | Your build zone, right lane |

**Viewport rule**: the portrait viewport (32 × 64 tiles at default zoom) shows exactly 1 column × 3 rows. From your Core it frames your Core row, your build row and the DMZ: 32 + 16 + 16 = 64. Moving between columns or toward the enemy side means sliding the view.

- Each team's build zone: 96 × 48 tiles (Core row + build row).
- DMZ: 16 rows across the full width, no-build. The map center, (47.5, 55.5) in tile indices, is the one point that the mirror in section 10.2 maps onto itself.
- Lumen Cores: (47, 15) for the enemy and (48, 96) for you, point-mirrored through the map center.
- Grid for placement, continuous coordinates for movement.
- **Lanes**: each lane runs inside its own column through both build rows and the DMZ. In the Core row, the left and right lanes curve into the middle column and merge with the mid lane at the Lumen Core. Creeps without a custom path follow the nearest lane.
- **No minimap.** Players see the rest of the map by moving the hero or sliding the view.
- Core to Core: roughly 80 tiles along the mid lane (more on the curved side lanes), about 40 s for a creep and 27 s for a hero.
### 10.2 Procedural generation

Map content comes from the match seed, through the same seeded RNG as the sim, so a seed always yields the same map and replays need no map file.

Generation runs on your half, then point-mirrors everything through the map center onto the enemy half:

| Element | Count per team | Rule *(default)* |
|---|---|---|
| Lanes | 3 | Fixed shape; control points get a seeded sideways jitter of up to ±3 tiles inside their column; each lane is 3 tiles wide *(default)* |
| Geothermal vents | 2 | In 2 different columns, chosen by the seed |
| Blockers | 6 | 2 per column |
| Item spawn points | 2 (4 in total) | In the DMZ, 1 per side column |

Placement constraints for vents and blockers:

- Not on a lane tile, nor within 2 tiles of one. Distance means the larger of the two axis differences.
- Not within 6 tiles of the Lumen Core.
- At least 4 tiles from any other generated element.
- Retry with the next RNG value when a spot fails, up to 50 tries per element. After that, the generator relaxes the spacing rule by 1 tile for that element and continues.
- After generation, a flood fill checks that every lane connects the two Cores; if not, the seed is advanced and generation reruns. The fill treats blockers and Cores as walls and visits neighbors in the order north, east, south, west.

## 11. Mobile controls (portrait)

The map is larger than the screen. The camera follows the selected hero while it moves; a drag pans freely and stops follow.

### 11.1 Gestures

| Gesture | Context | Action |
|---|---|---|
| Tap ground | Hero selected | Move to point |
| Tap enemy or blocker | Hero selected | Attack target |
| Tap item or loot bag | Hero selected | Walk to it and pick up |
| Tap creep | Any | Select its group |
| Tap barracks | Any | Sheet: creeps, items, default path |
| Tap other own building | Any | Info, upgrade, recycle |
| One-finger drag | Anywhere | Pan; stops hero follow |
| Pinch | Anywhere | Zoom |
| Tap hero portrait | Any | Select hero, recenter, resume follow |

### 11.2 Ability targeting

- Melee and shield: tap the button, cast immediately (melee on the current target).
- Ranged and area: tap the button, then tap a target or point. Tapping the button again cancels.

### 11.3 Creep path mode

1. Select a group.
2. Tap **Path**; each map tap adds a numbered waypoint (max 10).
3. **Undo**, **Go**, or **Cancel**.

### 11.4 HUD (portrait)

```
 ---------------------------------------
 | Core 340 (+12)  09:12  ☀  Enemy 280 |
 |                                     |
 |              game view              |
 |                                     |
 | [hero]  [M][R][A][S]  [grab 32/50]  |
 | [it1][it2][it3][it4] [bag] [BUILD]  |
 ---------------------------------------
```

## 12. MVP opponent

### 12.1 Bot

1. Picks heroes in roster order, allocating 50% of Core lux, spawning at its newest barracks.
2. Hero walks the nearest lane toward the enemy Core and attacks whatever is in range. No abilities, no items.
3. Every 1 s, spends settled lux in rotation: collector, barracks, tower, creep group of 5.
4. Creep groups use the default lane path.

### 12.2 Hot seat

Two command sources on one device, with a toggle that switches which side the touch input controls.

## 13. Out of scope for now

XP and levels, DMZ reduced-HP building, "+0.5 per 100 lux", account levels, networking, fog of war (the sim already computes visibility, see TECH_ARCHITECTURE.md section 6.2).

## 13.1 Art direction

- Style: **low-poly neon**. Every entity is a light construct: flat-shaded low-poly shapes with emissive edges and bloom.
- Models (.glb): designed by Hama BEN JANNET.
- Team colors: **red vs blue**.
- Readability on a phone screen matters more than detail: silhouettes must tell hero, creep, tower and collector apart at the default zoom.
- **No HP bars.** Emissive brightness shows an entity's lux: `brightness = 20% + 80% × (current HP / max HP)`, so it reads as health. Tapping an entity shows its exact lux.
- Destruction: entities dissolve into particles of their team color.

## 13.2 End-of-match screen

Per team, and per player in team modes:

| Stat | Meaning |
|---|---|
| Lux collected | Total collector output |
| Lux spent | On buildings, creeps, heroes, abilities, items |
| Lux drained | Enemy lux destroyed by your damage |
| Lux funneled | Enemy lux transferred to your Core by Energy Grab |
| Lux recycled | Refunds received |
| Lux lost to entropy | Passive decay |

Plus match duration and winner.

## 14. Open questions

None blocking the MVP. Every *(default)* value is a playtest tuning point.
