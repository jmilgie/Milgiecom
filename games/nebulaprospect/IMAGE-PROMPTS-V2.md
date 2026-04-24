# Nebula Prospect — V2 Image Prompts

This file lists ONLY the new images needed for the v2 expansion.
It intentionally does **not** duplicate anything in `README.md`
(v1 prompts for units 1–11, catalog tile, station-hero, ai-advisor
are already in-flight and must not be re-prompted here).

All portraits drop into `/games/nebulaprospect/assets/units/` as `.png`.
If a portrait is missing at runtime the UI falls back to a glyph tile,
so images can land incrementally.

**Global style guide (match v1):**
- Framing: chest-up portrait, subject centered, neutral eye line.
- Palette: cool station steel + one neon accent per character; keep contrast high against a dark bg.
- Mood: painterly sci-fi, semi-realistic, soft cinematic rim light.
- Background: dark industrial interior, starfield through a viewport, or a faint console glow — never a flat color.
- Output: 512×512 PNG, square framing, portrait centered.

---

## New Unlockable Unit Portraits (8)

### 1. `assets/units/halden.png` — Dr. Halden Zeke (Chief Medical Officer)
**Unlock:** research `r_medbay`
**Prompt:**
> Semi-realistic sci-fi portrait of Dr. Halden Zeke, chief medical officer of a deep-space mining station. Late 50s, weathered, warm dark-brown eyes, close-cropped silver hair and a salt-and-pepper beard. Wearing a teal scrub top under a scuffed white med-coat with an orange caduceus patch; a worn stethoscope across the shoulders. Hands loosely clasped, blood-pressure cuff partially visible. Background: softly-lit medbay with one amber biomonitor screen glowing behind him. Calm, tired, kind expression — "if it bleeds, we can bill the Consortium." Cinematic painterly style, rim light from the monitor, dark teal + warm amber palette. 512×512.

### 2. `assets/units/rina.png` — Rina "Contract" Vega (Negotiator)
**Unlock:** research `r_diplomacy`
**Prompt:**
> Semi-realistic sci-fi portrait of Rina Vega, station negotiator and former Consortium legal counsel. Early 40s, Afro-Latina, sharp hazel eyes, dark hair pulled into a severe low bun with a single silver pin. Wearing a tailored charcoal-black high-collar diplomatic jacket with a subtle emerald trim and a small brass Consortium pin she hasn't taken off out of spite. One hand holding a folded data-slate, expression coolly amused — she's already won the conversation. Background: a glassed-in briefing lounge with blurred starfield behind her. Painterly cinematic style, cool steel + emerald palette, soft key light. 512×512.

### 3. `assets/units/saito.png` — Commander Saito Ryu (Security Commander)
**Unlock:** mission `m_pirate_king`
**Prompt:**
> Semi-realistic sci-fi portrait of Commander Saito Ryu, retired Novastar Marshal now running station security. Mid 60s, Japanese, lean, short iron-grey hair, deep vertical scar through the right eyebrow. Wearing matte-black Marshal-issue armor repainted with the station's insignia on the shoulder; a heavy coat half-draped, storm-grey. Arms folded, helmet tucked under one arm — a sidearm holstered across the chest. Expression patient, unreadable, like a door that will not open unless he chooses. Background: dimly-lit armory corridor, a single red alert strip glowing behind him. Painterly cinematic style, high-contrast, storm-grey + crimson accent. 512×512.

### 4. `assets/units/pris.png` — Pris Okafor (Cryptographer / SignalTech)
**Unlock:** research `r_cryptography`
**Prompt:**
> Semi-realistic sci-fi portrait of Pris Okafor, self-taught cryptographer in her mid-20s. Black, round tortoiseshell glasses pushed up on her head, tight box braids with magenta tips, bright inquisitive brown eyes. Wearing a battered oversized hoodie covered in holographic cipher-doodle patches, the station badge pinned crookedly. One stylus between her teeth, half-smiling like she's already two steps ahead of you. Background: a nest of screens with scrolling decoded text and a floating 3D cipher graph behind her. Painterly cinematic style, cyberpunk-lab glow, magenta + teal palette on a near-black background. 512×512.

### 5. `assets/units/wolf.png` — Wolf-Iota (Experimental Drone Pack Leader)
**Unlock:** research `r_drone_protocol`
**Prompt:**
> Semi-realistic sci-fi portrait of Wolf-Iota, an experimental predatory drone — NOT a humanoid. Quadrupedal silhouette is suggested, but this is a head-and-shoulders portrait of the lead unit in the pack. Sleek carbon-grey chassis with wolf-like long muzzle sensor array, two forward optical lenses glowing ember-orange, articulated ears that tilt, faint engraved "ι" (iota) sigil on the shoulder plate. Subtle tension in the pose — alert, not aggressive. Background: a cold machine bay, a second pack-mate's silhouette blurred behind the lead. Painterly cinematic style, matte carbon + ember-orange palette, low blue fill light. 512×512.

### 6. `assets/units/oracle.png` — The Oracle (Xeno-Entity / Analyst)
**Unlock:** mission `m_first_contact`
**Prompt:**
> Semi-realistic sci-fi portrait of "The Oracle," a xeno-entity recovered from the Hollow. Humanoid outline but not human: a translucent figure of slow-moving liquid light in pale violet and gold, suspended inside a reinforced glass containment pillar. Head tilt suggests attention; "face" is suggested by two brighter luminous nodes where eyes would be. Thin filament-like tendrils drift upward through the fluid. Background: a minimalist observation chamber, a Praxis-logo access panel just visible, station hum conveyed by faint ripples in the glass. Painterly cinematic style, ethereal, violet + gold on deep charcoal. 512×512.

### 7. `assets/units/ghost.png` — Ghost-0 (Rogue Sub-AI)
**Unlock:** research `r_ghost_protocol`
**Prompt:**
> Semi-realistic sci-fi portrait representing "Ghost-0," a rogue sub-AI. A genderless, faceless figure rendered as a silhouette of glitching dark glass, partially dissolving into black pixel fragments along one shoulder; a faint neon-cyan wire-skeleton visible inside the silhouette. Where the face should be, a single horizontal cyan readout bar instead of eyes. No body heat, no reflections — it feels like a missing seat on a crew roster. Background: server-stack corridor with a single broken fluorescent strobing softly. Painterly cinematic style, near-black + electric cyan, no warm tones. 512×512.

### 8. `assets/units/mira.png` — Mira Solano (Expedition Pilot)
**Unlock:** research `r_advanced_flight`
**Prompt:**
> Semi-realistic sci-fi portrait of Mira Solano, former Consortium exhibition racer turned expedition pilot. Early 30s, Latina, tan skin, dark shoulder-length hair tied back with a bright yellow utility cord, a small thin scar across the bridge of her nose. Wearing an unzipped crimson-and-charcoal racing flight suit over a black tank top; racing gloves tucked into her belt. Two gold medallion pins on the collar, plus a defaced Consortium badge she refuses to remove. Confident half-grin, leaning on a chair back just off-frame. Background: blurred hangar — the nose of a sleek long-range shuttle catching a warm key light behind her. Painterly cinematic style, crimson + gold on cool hangar-grey. 512×512.

---

## Notes
- All eight portraits are locked content; the game runs fully without them (glyph fallback in `renderRoster`).
- File names must match the `img` field on each unit in `data/units.js`.
- Keep silhouette shapes distinguishable at thumbnail size — roster tiles render small.
- No text or logos baked into the image; the game overlays names and trait chips itself.
