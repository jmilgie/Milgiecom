# Void Runner — Level Design Guidelines

## File format

Each level is a JS file at `levels/levelN.js`. Register it by:
1. Setting `window.VOID_LEVELS[N-1] = { name, desc, enemies, par, map }` in the file
2. Adding `<script src="levels/levelN.js"></script>` in `index.html` before the main script

```js
window.VOID_LEVELS = window.VOID_LEVELS || [];
window.VOID_LEVELS[5] = {
  name: 'LEVEL NAME',
  desc: 'One-line description shown on mission select.',
  enemies: 'Enemy types label (display only)',
  par: 480,          // Target completion time in seconds (used for star rating + time bonus)
  map: [ "...", ... ],
};
```

---

## Map format

- Each row is a string of exactly **50 characters**
- All rows must be the **same length** — count carefully
- Recommended height: **34–36 rows**
- Outer border must be **fully walled** (`#`) on all 4 edges

### Tile legend

| Char | Meaning |
|------|---------|
| `#`  | Wall (solid, blocks movement + bullets) |
| `.`  | Floor (walkable) |
| `D`  | Door tile (walkable, renders differently — decorative only, does NOT lock) |
| `T`  | Terminal (floor tile, visual only) |
| `H`  | Health pickup (+30 HP) |
| `S`  | Data shard (score +100) |
| `W`  | Weapon pickup (upgrades player weapon) |
| `E`  | Exit (triggers mission complete on contact) |
| `@`  | Player spawn (converted to floor at runtime) |
| `1`  | Drone spawn (converted to floor at runtime) |
| `2`  | Sentinel spawn (converted to floor at runtime) |
| `3`  | Ghost spawn (converted to floor at runtime) |

---

## The golden rule: every item must be reachable

**A tile is reachable if the player can walk to it without passing through a wall.**
Before saving, trace a path from `@` to every `H`, `S`, `W`, `T`, and `E` in the map.

---

## Room / structure patterns

### ✅ U-room (open on one side) — USE THIS
The room has walls on 3 sides and is open on the 4th. Items go inside.
The player walks in from the open side.

Open on south:
```
#....########        <- top wall
#....#......#        <- side wall    side wall
#....#..S...#        <- item inside, reachable from below
#....#......#        <- side wall    side wall
#....#......#        <- NO closing bottom wall — open floor here
#.....(open floor)
```

Open on east:
```
#....######          <- top wall
#....#....           <- side + open right
#....#..S.           <- item reachable from right
#....#....           <- side + open right
#....######          <- bottom wall
```

### ✅ Standalone pillars — USE THIS FOR COVER
Single `#` or 2×1 `##` blocks that the player can walk fully around.
Great for combat cover without blocking routes.
```
#...##...##...##...#
```

### ✅ L-corners / partial walls — USE THIS
3-sided or 2-sided structures. Items placed in the open nook.
```
#....######
#....#....#
#....#..H..        <- open right side, H reachable
#....#....#
```

### ❌ Sealed room (4 walls, no opening) — NEVER USE
```
#....#########      <- top wall
#....#.......#      <- sealed sides
#....#...S...#      <- S UNREACHABLE — player cannot enter
#....#.......#      <- sealed sides
#....#########      <- bottom wall  ← THIS IS THE PROBLEM
```
If you see `#` closing all 4 sides of a region containing items, that's a bug.

---

## Connectivity checklist

Before finalising a level, verify:

- [ ] **Player spawn `@`** is on an interior floor tile, not adjacent to a wall on 3+ sides
- [ ] **Exit `E`** is reachable from spawn without passing through any wall
- [ ] **Every `H`, `S`, `W`** — trace a walkable path from `@` to each one
- [ ] **No sealed 4-wall rooms** containing any item or spawn tile
- [ ] **Section dividers** (horizontal wall rows) have at least one `.` or `D` gap
- [ ] **U-rooms** have no closing wall on their open side
- [ ] **Map width** — count chars in every row, must all be exactly 50

### Quick connectivity test (manual)
For each dividing wall row, identify the gap column(s).
Then confirm that at least one room or item on each side of the divider can reach that gap column by walking horizontally along open floor.

---

## Zone structure (recommended)

Divide the map into 2–3 vertical zones separated by a thin wall row with a gap:

```
Zone 1 (rows 1–11):   spawn area, intro enemies, 1–2 U-rooms with items
Divider (row 12):     "######################.#########################"
Zone 2 (rows 13–22):  mid-game, tougher enemies, more items
Divider (row 23):     "######################.#########################"
Zone 3 (rows 24–33):  boss/exit area, final pickups
```

The gap in a divider must be a `.` at a consistent column (col 22 works well, but anything works as long as it's consistent and not tucked into a corner).

---

## Item placement guidelines

| Item | Quantity | Notes |
|------|----------|-------|
| `H` (health) | 2–3 per level | Spread across zones, never in sealed rooms |
| `S` (shard)  | 3–5 per level | Reward exploration — some in U-rooms, some on open floor |
| `W` (weapon) | 1 per level (except L5) | Place in a U-room or clearly visible spot mid-level |
| `E` (exit)   | Exactly 1 | Place far from spawn, at the end of zone 3 |
| `T` (terminal) | 0–2 | Decorative, place anywhere reachable |

---

## Enemy placement guidelines

| Enemy | Placement |
|-------|-----------|
| `1` Drone    | Open corridors, near start — teaches shooting |
| `2` Sentinel | Mid/late zones, needs room to charge (don't trap in tiny alcoves) |
| `3` Ghost    | Late zones, open areas where teleporting is dangerous |

- Don't place enemies inside sealed structures (they'll path into walls)
- Spread enemies across zones — don't cluster all in one area
- Level 1 should have only `1` drones
- Level 5 (boss) should have no regular enemies (boss handles it)

---

## Par time guidance

| Level | Difficulty | Suggested `par` |
|-------|-----------|-----------------|
| 1     | Easy       | 240–300s        |
| 2     | Medium     | 360–420s        |
| 3     | Medium-hard| 420–480s        |
| 4     | Hard       | 480–540s        |
| 5     | Boss       | 540–600s        |
| New   | Custom     | ~60s per zone + 60s buffer |

Par is used for: star rating (complete under par = 2 stars, under 70% par = 3 stars) and time bonus score.
