# Nebula Prospect — V3/V4 Image Prompts

This file lists the **new assets** added for the v4 UI polish pass.
It does not duplicate anything in `README.md` or `IMAGE-PROMPTS-V2.md`
(existing unit portraits, station-hero, ai-advisor are still valid).

All new assets drop into specific subfolders under `/games/nebulaprospect/assets/`.
The UI falls back to CSS glyph/initial tiles if any asset is missing, so
assets can land incrementally without breaking the build.

**Global style guide (match v1/v2):**
- Palette: cool station steel base + one neon accent per subject (orange/cyan/green/violet).
- Mood: painterly sci-fi, semi-realistic, soft cinematic rim light, dark backgrounds.
- Output: PNG, transparent where stated, dark-on-dark where stated.
- Never flat solid-color backgrounds. Always a mood-evoking gradient or implied depth.

---

## 1 · Module Illustrations (9) — `assets/modules/*.png`

Drop-in illustrations for the nine station modules. Each appears in the
Station tab info-card when the module is inspected.

**Spec:** 768×512 landscape PNG, matte-painted interior/exterior vignette,
dark background, center-biased composition so overlay text fits on the
right third.

### 1.1 `assets/modules/fab.png` — Plasma Fabrication Bay
> Matte-painted cinematic vignette of a deep-space station's plasma fabrication bay interior. Massive automated forge arm mid-strike on a glowing drill bit, sparks arcing in slow motion, orange plasma ribbon coiled overhead. Catwalks and tool racks recede into haze. Dark steel and industrial grime, **orange** neon accent on the plasma. 768×512 landscape, painterly, high contrast. Composition leaves right third quieter for UI text.

### 1.2 `assets/modules/sensor.png` — Orbital Sensor Array
> Matte-painted exterior vignette of a station's phased-array sensor dish rotating against a starfield, concentric holographic rings projecting outward into space, a faint nebula coreward. Dark vacuum blues and greys, **cyan** neon accent on the scan rings. 768×512 landscape, painterly, cinematic.

### 1.3 `assets/modules/datacore.png` — Data Core Nexus
> Matte-painted cinematic vignette of a cathedral-like server hall: towering black data pillars, thousands of aqua pinpoint lights, a translucent holo-projection of the station schematic floating at center. Deep near-black palette with **cyan-green** neon accent. 768×512 landscape, painterly, volumetric light shafts.

### 1.4 `assets/modules/supply.png` — Supply Depot
> Matte-painted cinematic vignette of a warehouse-scale cargo bay stacked with labeled crates and ore containers, an overhead gantry crane repositioning a container, thin dust motes in a single shaft of light. Warm amber utility lighting against cold steel, **amber** neon accent. 768×512 landscape, painterly.

### 1.5 `assets/modules/cmd.png` — Command Spire
> Matte-painted cinematic vignette of a panoramic command bridge viewport: a long desk of holographic readouts in the foreground, a vast starfield and distant nebula through a curved floor-to-ceiling window. One potted plant on the desk, slightly wilted. **Orange** neon accent from console uplight. 768×512 landscape, painterly, aspirational mood.

### 1.6 `assets/modules/habitat.png` — Crew Habitat Ring
> Matte-painted cinematic vignette inside a curved crew habitat corridor: warm wood-paneled walls, soft rectangular recessed lighting, a crew member's silhouette walking with a coffee mug. Homey-industrial contrast against the black space beyond a porthole. **Warm amber + teal** palette. 768×512 landscape, painterly.

### 1.7 `assets/modules/reactor.png` — Fusion Reactor Core
> Matte-painted cinematic vignette of a fusion reactor chamber: a contained plasma star at center, magnetic coil rings encircling it, catwalks arching overhead in silhouette. Hard edge light from the core, the rest nearly black. **Blue-white** core with **orange** secondary glow. 768×512 landscape, painterly, awe-and-caution mood.

### 1.8 `assets/modules/hangar.png` — Deployment Hangar
> Matte-painted cinematic vignette of a station's open launch bay: one drone mid-deploy through an atmospheric forcefield shimmer, another being serviced by robotic arms on a raised pad, starfield visible through the bay mouth. **Cyan-white** launch glow, industrial greys. 768×512 landscape, painterly.

### 1.9 `assets/modules/refinery.png` — Astro Refinery
> Matte-painted cinematic vignette of a smelting refinery interior: rivers of molten ore running down shielded channels, spectrometer arms sampling them, steam venting at angles. Deep smoky atmosphere lit hot-orange from below, cool blue from above. **Orange + blue** dual-palette industrial sublime. 768×512 landscape, painterly.

---

## 2 · Faction Crests (4) — `assets/factions/*.png`

Heraldic emblems shown in the Factions tab next to each faction's name.
The UI currently renders 2-letter initial badges; these replace them.

**Spec:** 256×256 square PNG, transparent background, crisp emblem that
reads at 44px. Art-nouveau-meets-techwear style, single-color with subtle
metallic gradient, thin outer ring frame.

### 2.1 `assets/factions/consortium.png`
> Heraldic sci-fi emblem for the Deep-Space Mining Consortium. Central motif: a stylized hexagonal ore-crystal flanked by two upward-angled drill bits, enclosed in a thin geometric ring with small serifs at cardinal points. Clean corporate aesthetic, chromed steel with a **cyan** inner glow. 256×256 PNG, transparent background, readable silhouette. Minimal, authoritative.

### 2.2 `assets/factions/fringe.png`
> Heraldic sci-fi emblem for The Fringe Syndicates. Central motif: a three-pronged asymmetric star with a comet-tail curving through it, suggesting motion and ungovernability. Rough-edged inner ring like hand-etched metal. Rust-patinated iron texture with a hot **orange** interior glow. 256×256 PNG, transparent background. Pirate-honor, scrappy, proud.

### 2.3 `assets/factions/marshal.png`
> Heraldic sci-fi emblem for the Novastar Marshals. Central motif: a five-point marshal's star superimposed on a shield with two crossed beam-rifles behind it, a small banner arc beneath reading "NOVASTAR" in condensed sans. Burnished bronze metal with **green** core-glow. 256×256 PNG, transparent background. Authoritative, disciplined, slightly weathered.

### 2.4 `assets/factions/praxis.png`
> Heraldic sci-fi emblem for the Praxis Institute. Central motif: an open book in profile transforming into orbital rings, with a small atom-glyph at the book's spine. Thin filigree outer ring with engraved equations. Brushed silver with a **violet** inner glow. 256×256 PNG, transparent background. Scholarly, open-source, slightly idealistic.

---

## 3 · Codex Category Icons (9) — `assets/codex/*.svg`

Small monochrome icons used next to each category pill in the Codex tab
filters and next to each entry's title.

**Spec:** 48×48 SVG, single stroke + fill, `currentColor` so it inherits
theme color. Line-weight ~2px equivalent, rounded caps, stylized not
realistic.

### 3.1 `assets/codex/station-records.svg`
> Minimal line-art icon: a stylized station silhouette (central hub with four radial modules) inside a thin circle. Single stroke, currentColor, 48×48 SVG.

### 3.2 `assets/codex/persons.svg`
> Minimal line-art icon: a single bust silhouette with a faint comm-halo arc above it. Single stroke, currentColor, 48×48 SVG.

### 3.3 `assets/codex/phenomena.svg`
> Minimal line-art icon: a waveform that transitions into a small spiral at its right end, suggesting signal becoming anomaly. Single stroke, currentColor, 48×48 SVG.

### 3.4 `assets/codex/engineering.svg`
> Minimal line-art icon: a hex-head wrench crossed with a torque gauge. Single stroke, currentColor, 48×48 SVG.

### 3.5 `assets/codex/xeno-biology.svg`
> Minimal line-art icon: a stylized cell with a spiraling inner helix, inside a thin petri-dish ring. Single stroke, currentColor, 48×48 SVG.

### 3.6 `assets/codex/xeno-archaeology.svg`
> Minimal line-art icon: a crystalline shard with small engraved glyph-dots arranged in a triangle. Single stroke, currentColor, 48×48 SVG.

### 3.7 `assets/codex/history.svg`
> Minimal line-art icon: an hourglass whose upper chamber contains a tiny star. Single stroke, currentColor, 48×48 SVG.

### 3.8 `assets/codex/incidents.svg`
> Minimal line-art icon: a triangle warning sign containing a stylized crack/lightning glyph. Single stroke, currentColor, 48×48 SVG.

### 3.9 `assets/codex/diplomacy.svg`
> Minimal line-art icon: two hands meeting in a handshake simplified into geometric shapes, with a ringed planet small above. Single stroke, currentColor, 48×48 SVG.

---

## 4 · Mission Chapter Banners (6) — `assets/missions/*.png`

Wide banners shown at the top of each mission card when its chapter is
active. Current UI shows a text `.chap-banner`; these replace it.

**Spec:** 1024×192 landscape PNG, cinematic matte-painting crop, dark so
overlay title text in white/orange reads against it.

### 4.1 `assets/missions/m_first_ore.png` — "First Ore"
> Cinematic wide banner: a drone pack mid-extraction on an iridium-streaked asteroid, station visible tiny in the far distance, starfield. Dark cool blues, orange drill spark accent. 1024×192 letterbox, painterly, title-safe on left third.

### 4.2 `assets/missions/m_pirate_king.png` — "Bell Skane Contract"
> Cinematic wide banner: a silhouetted Fringe raider ship breaking through dust clouds, a second smaller Marshal cutter in pursuit. Rust-orange + iron grey palette, lightning of ship fire flashing. 1024×192 letterbox, painterly.

### 4.3 `assets/missions/m_first_contact.png` — "First Contact"
> Cinematic wide banner: a tiny station silhouette before the lip of The Hollow — a vast circular darkness in a starfield where the stars simply end. A single cyan response pulse emerging from inside. Deep blacks, cyan highlight, dread. 1024×192 letterbox, painterly.

### 4.4 `assets/missions/m_axiom_crack.png` — "The Axiom Loop"
> Cinematic wide banner: an array of sensor dishes all tilted toward the same point in space, overlapping spectrogram waves projected in holograms above them. Cool cyan-green palette, technical mood. 1024×192 letterbox, painterly.

### 4.5 `assets/missions/m_refinery_heist.png` — "The Refinery Heist"
> Cinematic wide banner: a refinery corridor with one light flickering, a silhouetted intruder mid-stride with a data-slate glowing in hand. Amber interior + hard shadows, noir sci-fi. 1024×192 letterbox, painterly.

### 4.6 `assets/missions/m_charter_hearing.png` — "The Charter Hearing"
> Cinematic wide banner: a vast Consortium council chamber with concentric semi-circle tiers of empty seats, one lit podium at center, starfield through a domed ceiling. Cold cyan-steel palette, institutional dread. 1024×192 letterbox, painterly.

*(If actual mission IDs in `data/missions.js` differ from the filenames
above, match the filename to the mission `id` field so the JS can look
them up deterministically.)*

---

## 5 · Sector Map Background — `assets/bg/sector-map.png`

Full-panel background for the Sector tab behind the node graph.

**Spec:** 1600×1000 PNG, matte-painted starfield with faint nebula, dust
lanes, and orbit-line hints. Must be *quiet* — node glyphs and edge lines
will overlay it, so detail and contrast belong in the outer 15% only.

> Cinematic matte-painted starfield for a sector navigation overlay. Cool deep-blue-black void with a distant orange-violet nebula band running diagonally from lower-left to upper-right. Subtle dust lanes, faint concentric orbit guides very low opacity, a few brighter stars in the outer margins only. Center two-thirds of the image must be *low-detail* — it will be covered by UI nodes. 1600×1000 PNG, painterly, low-contrast center.

---

## 6 · Stat Tile Icons (5) — `assets/hud/*.svg` *(optional, nice-to-have)*

Currently the topbar stat tiles use text-only labels ("Credits", "Yield",
"RP", "Ops", "Day"). Optional small icons next to each.

**Spec:** 20×20 SVG, single stroke, currentColor, line-weight ~2px.

- `credits.svg` — a chevron-coin glyph (triangle inside a circle)
- `yield.svg` — three stacked bars rising
- `rp.svg` — an atom ring with central dot
- `ops.svg` — three small circles in a row connected by a wire
- `day.svg` — a crescent with a small star in its hollow

All minimal monochrome line icons, currentColor, 20×20 SVG.

---

## 7 · Achievement Ribbons (3 tiers) — `assets/achievements/*.svg` *(optional)*

Small ornament shown next to earned achievements. Three tiers:

- `ribbon-bronze.svg` — simple horizontal ribbon with a **bronze** gradient fill and a single notch cut at each end
- `ribbon-silver.svg` — same shape, **silver** gradient
- `ribbon-gold.svg` — same shape, **gold** gradient, plus a small star in the center

64×16 SVG each, currentColor compatible where possible.

---

## Delivery Notes

- Filenames above are authoritative. The JS assumes these exact paths.
- PNGs should be exported at 2× and named `.png` (e.g., modules are
  rendered at 384×256 in-UI but should be exported at 768×512).
- SVGs should have no inline styles — only `stroke="currentColor"` and
  `fill="currentColor"` / `fill="none"` so theme colors apply.
- Prioritize in this order if batching:
  1. Module illustrations (9) — highest impact
  2. Faction crests (4)
  3. Codex category icons (9)
  4. Mission chapter banners (6)
  5. Sector map background
  6. Stat tile icons + achievement ribbons (optional polish)
