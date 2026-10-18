# Lumen: Game Design Document (MVP)

Working title. A strategy game mixing hero control (Dota 2), creep waypoint paths (Age of Empires) and base building with tower defense (Generals Zero Hour, Clash Royale). Everything in the world is made of light energy, measured in **lux**. Destroyed things dissolve into light; there is no blood or gore.

Status: draft v0.9.9. Numbers marked *(default)* live in `data/balance.json` and will be tuned through MVP playtests.

---

## 0. Changelog

### v0.9.8 → v0.9.9

Details that the item milestone (M6) needed. Section 8.4 states each one, and Hamza confirmed its open choices on 2026-10-19.

| Area | Change |
|---|---|
| Item rules | Section 8.4 lists how the inventory, purchases, delivery, use, Energy Grab, Haste, Sluggish, drops, map spawns and pickups work in the sim |
| Interface | A placed building ends build mode at once (section 11), and a tap on a ground item or loot bag sends the hero to take it |

### v0.9.7 → v0.9.8

Details that the hero milestone (M5) needed. Section 7.7 states each one, and Hamza confirmed its four open choices on 2026-10-18.

| Area | Change |
|---|---|
| Hero rules | Section 7.7 lists how picks, the rotation lock, the death cooldown, the four abilities and shields work in the sim |
| Hero attack | A hero ordered to attack walks into reach of its target and stops there (section 11.1) |
| Bot | The bot picks heroes and steers them as section 12.1 says (the first version of the bot had no hero) |

### v0.9.6 → v0.9.7

| Area | Change |
|---|---|
| M4 rules | The owners approved section 9.3 on 2026-10-18 |
| Unit spacing | Group members walk spread out: `unitSpacingMilliTiles` (500, a half tile) between neighbours' edges (section 7.3) |
| Melee gap | A melee attacker stops `meleeGapMilliTiles` (250, a quarter tile) short of contact, which leaves room for weapons and animation (section 7.4) |
| Collision | Units never overlap each other or a building, whatever the build order; an earlier version let units walk through older buildings (section 7.3) |
| Stalemate | A match that nobody has won ends as a draw at `match.stalemateTicks` (10000), adjustable for long test runs (section 2) |

### v0.9.5 → v0.9.6

Clarifications that the creep milestone (M4) needed. The owners approved them on 2026-10-18; section 9.3 states each one.

| Area | Change |
|---|---|
| Barracks queue | One group in production per barracks; held groups never block it; cancelling refunds 100%; recycling refunds queued orders and loses held groups (section 9.3) |
| Creep spawn and routes | Groups spawn on free tiles around the barracks; the default route is own lane, then the enemy lane of the same column (section 9.3) |
| Creep behavior | Nearest enemy in sight is the target; melee stands beside a building; leader advances waypoints (section 9.3) |
| Groups | Merge and split details; a split puts the highest creep ids in the new group (section 9.3) |

### v0.9.4 → v0.9.5

| Area | Change |
|---|---|
| Ranged attacks | Basic ranged attacks create projectiles that hit one tick after launch |

### v0.9.3 → v0.9.4

| Area | Change |
|---|---|
| Unit colliders | Heroes and creeps use a 0.25-tile circle radius for movement and collision (section 7.3) |

### v0.9.2 → v0.9.3

| Area | Change |
|---|---|
| Tower attack type | Towers use the selected type's damage multiplier and proc from section 7.4, while keeping their 5-tile range (sections 5 and 7.4) |

### v0.9.1 → v0.9.2

Clarifications that the economy milestone (M2) needed. The owners approve each one.

| Area | Change |
|---|---|
| Recycling | The refund goes into the Core at once, not through the income buffer; only the owner of a building can recycle it (sections 2.1, 3.6) |
| Wind | A wind plant rolls its output when it is built, then again every 10 s (section 4) |
| Entropy | HP is removed once per second, and 60 seconds remove exactly the percentage of max HP (section 3.7) |
| Meltdown | It hurts Cores, buildings, creeps and heroes within 3 tiles, not neutral blockers; damage to a Core comes out of its lux (section 4) |
| Vents | Other buildings may stand on a vent tile; only a geothermal collector needs one (section 5) |

### v0.9 → v0.9.1

| Area | Change |
|---|---|
| Black hole | Removed from the design, the data and the client; the map center is ordinary DMZ ground and the mid lane crosses it (section 10.1) |
| Lane width | 3 tiles *(default)* (section 10.2) |
| Connectivity check | Blockers and Cores are the only walls (section 10.2) |
| Spacing | Distances are measured as the larger of the two axis differences; a relaxed spacing applies to one element only (section 10.2) |
| Health display | Glow-as-health removed; a lux number sits beside each unit and building (section 13.1) |
| Core max HP | Rises with the Core's HP instead of staying at the starting lux (section 3.1) |

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

A match that nobody has won ends as a draw after 10000 ticks (about 8 minutes), so a stalemate cannot run forever. Tests and test servers raise the limit with the `MATCH_MAX_TICKS` setting.

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
- The Core's max HP is the highest HP it has held, so it rises with the Core's lux and never falls.

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

Buildings only. Refund `60% × current lux value`, 3 s channel, cancel by tapping the building again. The refund goes into the Core at once, not through the income buffer. Only the owner of a building can recycle it.

### 3.7 Entropy

Buildings, creeps and heroes lose 1% of max HP per minute *(default)*. The Core is exempt. HP is removed once per second, and 60 seconds remove exactly 1% of max HP.

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
| Wind | 20 | 0 to 3 lux/s (avg 1.5) | ~13 s | Rolls when built, then rerolls every 10 s (seeded RNG) |
| Geothermal | 40 | 2 lux/s | 20 s | Vent tiles only (2 per build zone) |
| Nuclear | 80 | 5 lux/s | 16 s | Meltdown risk |

- Day/night: 40 s day + 20 s night. Match starts at dawn.
- Meltdown: if the team spends nothing for 120 s while owning nuclear plants, each plant is destroyed and deals 50% of its max HP as damage within 3 tiles, to both teams. Any spend resets the timer. The blast hurts Cores, buildings, creeps and heroes within 3 tiles; neutral blockers are not hurt. Damage to a Core comes out of its lux.

## 5. Buildings

| Building | Cost | HP | Notes |
|---|---|---|---|
| Lumen Core | n/a | = lux | Bank and life; passive, never attacks |
| Solar, Wind | 20 | 200 | Income |
| Geothermal | 40 | 400 | Income |
| Nuclear | 80 | 800 | Income |
| Barracks | 40 | 400 | Creeps, items, hero spawn point |
| Tower | 20 | 200 | 20 damage per hit, 1 hit/s, range 5 tiles; attack type chosen at build |

- Placement anywhere in the team's build zone on free tiles. DMZ and map center are no-build. A vent tile is free like any other; only a geothermal collector needs one.
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
| Circle collider radius | 0.25 tiles | 0.25 tiles |
| Walking spacing in a group | 0.5 tile between edges (1 tile between centers) | same |

Attack speed: `hits per second = attackSpeed / 100`. Minimum 20.

Units never overlap each other or a building. A group walks in a grid whose neighbours keep the spacing above, and corners squeeze it to about three quarters of a tile. The numbers are `unitSpacingMilliTiles` and `meleeGapMilliTiles` in `data/balance.json`.

### 7.4 Attack types

| Type | Damage multiplier per target | Reach | Proc |
|---|---|---|---|
| Melee | 100% | Contact: a quarter tile of air between the bodies | 15% chance to stun 0.5 s (units and buildings; a stunned tower stops attacking) |
| Ranged | 60% | 4 tiles | Projectile hits after 1 tick; 15% chance to knock back 0.5 tiles |
| Area | 35% | 3 tiles, splash radius 1.2 tiles | none |

Each hero has a primary type for basic attacks. Towers apply the selected type's damage multiplier and proc, but keep their 5-tile range.

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

### 7.7 Rules as Implemented (M5)

The sections above left these details open. `src/sim/heroes.js` and the hero systems follow them. Hamza confirmed four of them on 2026-10-18 from options he was shown: the rotation lock at spawn, instant resolution of abilities, the Area ability hitting enemy buildings and the Lumen Core, and no casting while stunned. Hama has not reviewed the feel of the abilities yet.

- **Picking.** `pickHero` names the roster hero, the whole lux to allocate and the barracks. It is refused when the hero is locked, the death cooldown runs, the player already has a hero or a hero order, the barracks is not theirs or is recycling, or the lux would leave the Core under 1. The pick pays at once and queues like a creep order. `cancelQueue` refunds a hero order in full, and a barracks that dies with the order in its queue loses the lux.
- **Rotation lock.** A hero is locked when it spawns, not when it is ordered, so a cancelled or lost pick counts for nothing. The fifth distinct hero resets the lock, which makes the sixth pick free again. Each player has a rotation of their own.
- **Spawn.** The hero stands on the nearest free tile around the barracks, with `lux × 10` HP, the roster's primary attack type and its own move speed if the roster entry has one (Aurora, 4 tiles per second).
- **Death.** A hero that dies (in combat, by entropy or by a meltdown) starts the 5 second cooldown in that tick. Its allocated lux is gone.
- **Casting.** `castAbility` takes a slot (0 melee, 1 ranged, 2 area, 3 shield). It is refused for a stunned hero, during the slot's cooldown, for a bad target, or when the cost would leave the Core under 1 lux. A refused cast costs nothing. An accepted one pays at once, resolves in the same tick and starts the cooldown, which counts the tick of the cast (100 ticks in all).
- **Melee.** It hits the hero's current attack target, so the player attacks first. The target must be within contact distance. A hero with a dash (Corona, 3 tiles) closes the gap along the line to the target and then strikes. The stun is guaranteed.
- **Ranged.** It hits `targetId` at once, no projectile, if the target is within range, measured between centers. It has no knockback.
- **Area.** It hits every enemy unit, building and Lumen Core within the radius of a point that lies within range of the hero, and never a neutral blocker or an own building. A cast over empty ground still costs.
- **Shield.** One shield per target: a new cast replaces the old one. It covers an own or allied hero, an own building or an own creep, and never the Lumen Core or an enemy. It absorbs damage from every attack and ability, a tick of damage as one sum, and the rest of a blow goes to HP. Entropy and the meltdown ignore it.
- **Towers.** An ability that hits a hero makes the enemy towers in reach of the caster switch to the caster (section 5.0).

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

### 8.4 Rules as Implemented (M6)

The sections above left these details open. `src/sim/items.js` and the item systems follow them. Hamza confirmed the open choices on 2026-10-19 from options he was shown: the inventory as a count per item, a new Haste or Sluggish replacing the old one, the inventory and the Energy Grab budget hidden from the other team, creep deaths from any cause rolling a drop, Energy Grab ending with the hero, Energy Boost raising the maximum HP, and a stun blocking item use. Hama has not reviewed the item interface.

- **Inventory.** It is a count per item id, 50 items in all, and `useItem` names an item by its id (`inventorySlot`), so the four quick slots of the HUD are the four items. The inventory belongs to the player and is empty while no hero lives, because a hero's death empties it into a loot bag.
- **Buying.** `orderItem` pays the full price at once and queues like a creep order, with a build time of 1 s. `cancelQueue` refunds the whole price. A finished item is held in its barracks until its owner has a hero and a free slot, and then goes to the inventory, oldest first. It is delivered in the tick the hero spawns. A barracks that dies loses the items it holds.
- **Using.** `useItem` needs a living hero, and an item that needs a target must find it within 5 tiles of the hero. A refused use keeps the item. A stunned hero cannot use items, as it cannot cast abilities.
- **Energy Boost.** It adds 15 lux (150 HP) to the HP and to the maximum HP of an own hero or building, never the Lumen Core. It also works on a building in its recycle channel.
- **Energy Grab.** The budget of 50 lux belongs to the player and is refused while a budget still runs. Only a hero's basic attacks funnel, with their splash and shots, and only against enemy units, buildings and the Lumen Core. The lux funneled is the HP that the target lost after its shield, at the target's HP factor (1 for the Core). It goes to the pending pool, and the budget is consumed when it reaches 0. The effect ends when the hero dies, and abilities never funnel.
- **Haste and Sluggish.** An item sets the attack speed change of its target for 300 ticks, counting the tick of the use. A second change replaces the first and does not add to it. Sluggish needs an enemy hero or creep, never a building. The attack speed has a floor of 20 (section 7.3).
- **Drops.** Every creep that dies, from any cause, rolls the 10% chance for a random item on the spot where it died. A hero that dies drops its inventory as one loot bag and never a random item. An empty inventory drops nothing.
- **Map spawns.** At every tick that is a multiple of 1 200, one random item appears at one of the four DMZ points, chosen by the seeded generator. Two items may share a point.
- **Pickup.** A hero takes a ground item or a loot bag when it stands within 0.6 tiles of it and has a free slot. Of several heroes in reach the nearest one takes it, whichever team it plays for. A bag gives as many items as the free slots hold and stays with the rest. `pickUp` walks the hero to the item, and the system takes it on arrival.
- **Despawn.** A ground item and a loot bag last 600 ticks from the tick they appear.
- **Hidden information.** The match data sends a player's inventory and Energy Grab budget only to that player's team. The other team and the public snapshot never carry them.
- **Bots.** They buy and use no items (section 12.1), but a bot hero takes what it walks over.

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

### 9.3 Rules as Implemented (M4, approved 2026-10-18)

The sections above left these details open. `src/sim/creeps.js` and the behavior system follow them.

- **Queue.** A barracks builds one group at a time, in the order the player gave. The lux is paid at order time. `cancelQueue` removes any order, held ones included, and refunds 100%. Recycling a barracks refunds the queued orders at 100% and loses held groups; a barracks destroyed by an enemy loses everything with no refund. A barracks in its recycle channel stops producing and takes no new order.
- **Spawn.** A finished group appears on the nearest free tiles around its barracks (ring by ring, row by row). The physics then separates overlapping creeps.
- **Default route.** A group without a path walks the team's lane nearest to its spawn, from the lane vertex nearest to the spawn out to the map center, then the enemy lane that ends next to it, down to the enemy Lumen Core. After the last waypoint the group heads for the enemy Core.
- **Targets.** A creep keeps its target while it lives and stays within sight (6 tiles). Without one, it takes the nearest enemy creep, hero, building or Lumen Core in sight, and never a neutral blocker. It stands still and attacks inside its attack reach: melee 1 tile between centers, ranged 4, area 3. Melee creeps walk to the free tile beside a building.
- **Waypoints.** A group moves on when its leader, the creep with the lowest id, comes within 1.5 tiles of the current waypoint. A waypoint on a blocked tile moves to the nearest free tile within 3 tiles.
- **Paths.** A barracks default path is copied into each new group and does not change existing groups. A custom path replaces the old one and restarts at its first waypoint. An empty path puts the group back on the lane route.
- **Merge and split.** Merge needs no distance; the result may hold up to 30 creeps. A split gives the new group the creeps with the highest ids, so the original keeps the lowest and the odd one. Both halves keep the path and its progress.
- **Entropy.** Creeps lose 1% of max HP per minute like buildings and heroes (section 3.7).

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

A hero told to attack a target walks until the target is in reach, hits it, and stands still when it dies.

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
- **No HP bars and no glow-as-health.** A small number beside each unit and building shows its lux count (section 3.2); the Core shows its HP, which is its lux. Glow is decoration and carries no information.
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
