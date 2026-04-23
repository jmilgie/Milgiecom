# Nebula Prospect

**Deep-Space Mining Consortium — Overseer Dashboard**

A browser-based management / strategy sim. You run a nebula mining station: dispatch
specialist crew to operations, upgrade nine station modules, scan sectors for bonus
ops, and survive pirate raids while pushing Quantum Yield to 25M.

- **Location:** `/games/nebulaprospect/index.html`
- **Tech:** Pure HTML / CSS / vanilla JS, no build step
- **Save key:** `nebula-prospect-v1` (localStorage)
- **Target:** iPad + PC browsers, single-page responsive layout
- **Theme:** Uses the global Industrial theme by default

## Gameplay Summary

- **Goal:** Reach 25M Quantum Yield before Signal Integrity hits 0 or Threat Index hits 100.
- **Operations:** Tap any entry in the left queue to assign a matching unit. Correct
  specialization runs much faster and fatigues less.
- **Modules:** Tap any floating module card on the station to upgrade. Each module
  provides a unique bonus — e.g. Astro Refinery upgrades lift refinery efficiency,
  Fusion Reactor upgrades raise max Processing Load.
- **Sector Map:** Tap any node on the bottom-left map to run a deep scan for 50K and
  reveal 3 new operations. Free probes hit sometimes.
- **Pirates:** Threat rises with yield. When Threat > 60% random raids drain yield and
  auto-spawn a Security op. Completing Security ops reduces threat.
- **Pause:** ⏸ in top bar, or Space bar.
- **New Game / Help / Hub:** Menu icon `≡` in the top bar.

## File Layout

```
/games/nebulaprospect/
├── index.html                  # Game (single HTML file, inline CSS+JS)
├── README.md                   # This file
└── assets/
    ├── placeholder.svg         # Generic fallback
    ├── units/                  # Unit portrait placeholders
    │   ├── kx47.svg
    │   ├── veyra.svg
    │   ├── swarm.svg
    │   ├── rook.svg
    │   ├── jace.svg
    │   ├── echo7.svg
    │   ├── kira.svg
    │   ├── nix.svg
    │   ├── mek3.svg
    │   └── velraz.svg
    └── modules/                # (reserved — modules are SVG-drawn in index.html)
```

The game tile image lives at `/games/assets/catalog/nebula-prospect.{png|svg}` and is
referenced from `/games/index.html`.

## Image Generation Queue

All portraits should drop into `/games/nebulaprospect/assets/units/` with a `.png`
extension (the game code references `.png` with a text fallback, so **dropping a
PNG at the same path instantly replaces the placeholder**).

All prompts target a consistent **"industrial sci-fi dashboard portrait"** style:
- **Framing:** square, tight head-and-shoulders, facing slightly toward camera
- **Background:** dark teal / slate gradient with cyan accent glow, minimal detail
- **Lighting:** strong rim light from upper left in cool cyan, warm amber fill from lower right
- **Palette:** dominant cyan `#00cfff`, accent amber `#ff6a00`, greens allowed for bio tech
- **Finish:** painterly-realistic, semi-cel-shaded, readable at 40×40 px, no text
- **Aspect:** 1:1, 512×512 PNG

Each prompt is deliberately self-contained so you can run them one at a time.

---

### 1. `assets/catalog/nebula-prospect.png` (game hub tile)

**Path:** `games/assets/catalog/nebula-prospect.png` · **Size:** 1280×720 (or 800×480)

> Wide cinematic composition of a deep-space mining station: a central command spire
> flanked by a habitat ring on the left and an ore refinery on the right, solar panels
> on both ends, a glowing orange fusion reactor core at the base. Matte painted
> industrial sci-fi hardware with cool cyan rim lighting and warm amber accents from
> refinery vents. Nebula backdrop with soft magenta and teal clouds, scattered stars,
> and a distant planet crescent in the upper right. Subtle scanline / HUD grid in the
> foreground. No text, no logos, dramatic but clean, 16:9 aspect.

---

### 2. `assets/units/kx47.png` — KX-47 "Scaler" (Engineering Drone)

> Square portrait of a boxy industrial engineering drone robot. Orange paint with
> weathered scuff marks, a single glowing cyan sensor eye in a square visor, articulated
> tool arms folded at the chest, magnetic grip pads on the shoulders. Exposed hydraulic
> cabling and yellow safety stripes around the base of the head. Dark teal background
> with cyan rim light. Industrial, functional, not humanoid. 512×512, 1:1.

---

### 3. `assets/units/veyra.png` — Dr. Veyra Sol (Xeno-Material Analyst)

> Square portrait of a sharp-featured woman scientist, mid 30s, olive skin, angular
> cheekbones, black hair pulled back, wearing a dark indigo lab overcoat with a
> holographic teal lapel insignia and a headset curving over one ear. Intelligent,
> slightly skeptical expression. Cool cyan rim light, warm amber under-light from a
> hidden console. Shallow depth, dark teal blurred lab background. 512×512, 1:1.

---

### 4. `assets/units/swarm.png` — Swarm Cluster B-12 (Drone Swarm)

> Square portrait of a compact hovering swarm of four to six small geometric drones
> arranged in a loose diamond cluster against a dark teal starfield. Each drone is a
> matte black faceted hexagonal body with a single cyan pinpoint LED and thin orange
> stripe. Soft cyan motion trails suggest they are actively hovering. No operator,
> no humanoid. Industrial clean look. 512×512, 1:1.

---

### 5. `assets/units/rook.png` — Rook "Security" Unit (Security Android)

> Square portrait of a heavy security android, matte charcoal armor plating with
> orange hazard chevrons on the shoulders, a helmet-like head with a horizontal
> glowing cyan visor slit, reinforced neck collar, no mouth. Broad shouldered,
> imposing, slight head tilt forward. Cool cyan rim light on the right side, warm
> amber emergency light on the left. Dark blue-gray backdrop. 512×512, 1:1.

---

### 6. `assets/units/jace.png` — Pilot Jace Durn (Expedition Pilot)

> Square portrait of a rugged male pilot in his late 30s, short dark brown hair,
> light stubble, tanned skin, a small scar across one eyebrow. Wearing a pressurized
> flight suit in deep navy with orange accent panels, a cyan visor helmet tucked under
> his arm — only the high collar and comms piece are visible in frame. Confident
> half-smirk. Cool cyan rim light, warm amber fill. 512×512, 1:1.

---

### 7. `assets/units/echo7.png` — AI Node: ECHO-7 (Support AI)

> Square portrait of an abstract AI presence represented as a floating faceted holographic
> sphere made of translucent cyan geometric facets, a softly rotating inner core of
> orange light, and fine circuit-glyph particles orbiting it. No humanoid features.
> Dark teal void background with faint grid lines. Ethereal, clean, sci-fi interface
> icon energy, but painterly not flat. 512×512, 1:1.

---

### 8. `assets/units/kira.png` — Tech Kira Lenz (Systems Technician)

> Square portrait of an energetic young woman in her mid 20s, East Asian features,
> cropped black hair with a bleached streak, light freckles, wearing a gray-and-cyan
> technician jumpsuit with rolled sleeves and an orange utility harness. Holographic
> cyan data glyphs hover faintly near her temple (subtle, not costume-y). Warm,
> curious expression, slightly smiling. Cool cyan rim light. 512×512, 1:1.

---

### 9. `assets/units/nix.png` — Nix "Signal" Ortega (Signal Tech)

> Square portrait of a wiry middle-aged man, Latin features, silver-streaked black hair
> tied back, hawkish eyes, wearing dark headphones with cyan LED accents around his neck,
> a gray-green utility vest with patch cables looped over one shoulder. Listening
> intently, head slightly tilted. Dark teal static / signal-interference background.
> Cool cyan rim light. 512×512, 1:1.

---

### 10. `assets/units/mek3.png` — Hauler Mek-3 (Recovery Crew)

> Square portrait of an industrial cargo mech / hauler robot. Yellow-and-gray blocky
> chassis with heavy grip claws folded down, a low head-unit with two horizontal cyan
> scanner slits, a glowing orange warning light on the right shoulder, and chunky
> tracked or walker legs visible at the bottom of the frame. Utilitarian, heavy-duty,
> no humanoid face. Dark teal hangar backdrop. 512×512, 1:1.

---

### 11. `assets/units/velraz.png` — Scout Vel Raz (Exploration Unit)

> Square portrait of a slim androgynous explorer in a sleek black-and-cyan recon suit
> with a soft cowl hood pulled up, only pale skin, sharp violet eyes, and a cyan
> augment line along one cheekbone visible. A small orange sensor drone hovers by
> their shoulder. Quiet, watchful expression. Dark teal rocky cavern blur in background.
> Cool cyan rim light, warm amber fill from below. 512×512, 1:1.

---

## Optional Extras

These would enhance the experience but are not required for launch.

### A. `assets/bg/station-hero.png` (center panel background)

Currently the center station is CSS+SVG drawn. If you want a richer center background
drop this at `assets/bg/station-hero.png` and update the `.station-bg` rule in
`index.html` to reference it.

> Wide cinematic view of a complex deep-space mining platform from a slightly elevated
> oblique angle: central illuminated command spire, habitat ring rotating at left,
> ore refinery towers venting orange plasma at right, solar arrays, connecting trusses.
> Scattered drone lights, distant asteroids, swirling cyan-magenta nebula backdrop. No
> text, no HUD elements overlaid — UI will layer on top. 1920×1080, 16:9.

### B. `assets/ai-advisor.png` (AI Advisor portrait)

Currently uses a CSS fallback with "AI" glyph. A proper portrait would upgrade the
bottom advisor panel.

> Close-up of the same holographic cyan faceted AI sphere from the ECHO-7 portrait,
> but with a more defined forward-facing "presence" — like the AI is looking back
> at the viewer. Glowing core flickers with orange accent. 256×256, 1:1, dark teal
> circular vignette.

### C. Placeholder fallback behaviour

The game already handles missing images gracefully: every `<img>` tag falls back to
an initials-based text placeholder if the PNG fails to load. You can ship without
any PNGs and the game will look intentional — portraits will just be monogram chips
instead of photos.

## Credits

Built for Milgie.com. Art prompts intended for use with image generation tools (e.g.
Midjourney, DALL-E, SDXL). Generated images should be saved as PNG at the paths above
— the game will pick them up automatically with no code changes.
