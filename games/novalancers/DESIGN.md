# NOVA LANCERS — Design & Module Contracts

Co-op pixel-art vertical starfighter (shmup) for milgie.com. **Mobile-first**, portrait,
1–4 players online (WebRTC P2P with public-relay fallback), no build step, pure ES modules,
static hosting (GitHub Pages at `https://milgie.com/games/novalancers/`).

This document is the single source of truth. Every module owner implements the exact
exported API described here so pieces written in parallel snap together.

---

## 1. Pitch

> 2291. A dying star collapsed into a singularity and something sang back: **the Choir**,
> a crystalline machine swarm that eats worlds. Aurora Station launches its last squadron —
> the **Nova Lancers** — to punch through five sectors and silence the **Choir Heart**
> at the event horizon.

* Portrait vertical scroller. Auto-fire. Drag anywhere to fly (relative "trackpad" control,
  your finger never covers your ship). Two on-screen buttons: **NOVA** (bomb) and
  **OVERDRIVE**.
* 4 Lancer ships with distinct weapons. Up to 4 players co-op; team-colored ships
  (P1 cyan, P2 gold, P3 lime, P4 violet).
* 5 sectors, each a visually distinct biome with a unique multi-part boss.
* Scoring: kill chain multiplier, grazing (bullets that pass close), gems.
* Co-op revive: a downed pilot with no lives left becomes a **beacon**; a teammate who
  hovers over it for 1.5 s revives them.

### Art direction

* Crisp pixel art at a low internal resolution scaled up with nearest-neighbour; soft
  **bloom only on emissive pixels** (engines, cores, bullets, explosions) through a
  WebGL post pass. This contrast (crisp pixels + soft light) is the signature look.
* Sprites: 1-px dark outline (`C.outline`), 3–5 tone ramps from `js/art/palette.js`,
  top-left key light, selective highlights (bright rim on upper-left edges), dithering
  only on large surfaces. No anti-aliasing, no rotated-at-runtime pixel art (rotations are
  pre-baked as direction frames).
* Player ships: silver steel hulls + team-color energy accents (cockpit, engine, wing
  stripes). Enemies (the Choir): obsidian/plum carapace with glowing magenta cores, some
  crystal. Enemy bullets are **always** the most readable thing on screen: bright core,
  white-hot center, dark 1-px rim, glow. Player bullets are team-colored and slightly
  translucent/less saturated so enemy bullets pop.
* Every sector has its own color grade and background set-pieces (see §6).

### Audio direction

* All sound is synthesized in WebAudio (no audio files): layered, physically-inspired
  SFX pre-rendered into AudioBuffers with `OfflineAudioContext` at boot (multiple variants
  per effect + pitch jitter so nothing sounds repetitive), stereo-panned by x position.
* Music: an original sequenced soundtrack (synthwave / cinematic electronic) played by a
  lookahead scheduler through sampled-at-boot instruments, reverb and delay sends,
  sidechain-style ducking. One theme per sector + boss + final boss + title + victory.

---

## 2. Coordinates, timing, rendering

* **Field**: `FIELD_W = 240`, `FIELD_H = 400` art pixels, origin top-left. All gameplay
  (sim, enemies, bullets, pickups, FX positions) lives in field coordinates.
* The **internal canvas** is sized to the whole viewport in art pixels (`R.W × R.H`,
  always ≥ field). The field sits at `(R.fx, R.fy)` inside it: horizontally centered, with
  room for a top HUD strip and a bottom control strip on tall phones. Backgrounds cover the
  entire internal canvas (they are decorative beyond the field); gameplay layers are
  clipped to the field rect.
* **Sim**: fixed 60 Hz ticks (`DT = 1/60`). Stage time `t = tick / 60` seconds.
* Two 2D canvases at internal resolution:
  * `R.ctx`  — main color layer.
  * `R.lctx` — **light layer**: cleared to black each frame; anything drawn here is added
    on top of the main layer AND fed to bloom. Draw emissive stuff here (bullet glows,
    engine flames, cores, explosions, beams).
* Post (WebGL) composites `main + light + bloom(light)` with distortion, vignette,
  chromatic aberration, scanlines, color grade and upscales to the screen.
  Without WebGL the renderer falls back to 2D (`light` blended with `lighter`).

Draw order (game layer): background → ground enemies → enemies → pickups → player bullets
→ players → particles/explosions → **enemy bullets** → HUD.

---

## 3. File layout & ownership

```
games/novalancers/
  index.html                  core (lead)
  DESIGN.md                   this file
  css/style.css               UI agent
  vendor/peerjs.min.js        net agent (vendored PeerJS 1.5.x UMD build)
  js/main.js                  lead: boot, loading, screen flow
  js/config.js                lead: constants
  js/util.js                  lead: RNG, math helpers
  js/engine/renderer.js       lead
  js/engine/input.js          lead
  js/engine/haptics.js        lead
  js/game/*.js                lead (sim core) + gameplay agents (content)
  js/art/palette.js           lead (shared, read-only for others)
  js/art/pixel.js             sprite agent (helpers; others may import)
  js/art/sprites.js           sprite agent
  js/art/bossart.js           boss-art agent
  js/art/backgrounds.js       background agent
  js/art/font.js              UI agent
  js/fx/particles.js          fx agent
  js/fx/post.js               fx agent
  js/audio/audio.js           lead (shared core, read-only for others)
  js/audio/sfx.js             sfx agent
  js/audio/music.js           music agent
  js/audio/songs/*.js         music agent
  js/net/*.js                 net agent
  js/ui/screens.js            UI agent
  js/ui/hud.js                UI agent
  dev/*.html                  per-agent test harness pages (not shipped to players)
```

**Never edit a file you do not own.** If you need something from another module that
isn't in its contract, write a small local shim in your own file and mention it in your
report.

General code rules: plain modern JS (ES2020 modules, no TypeScript, no bundler, no npm
runtime deps). Must run in iOS Safari 16+, Android Chrome, desktop Chrome/Firefox/Safari.
No `eval`, no external network at runtime except: Google Fonts CSS, PeerJS signaling
(`0.peerjs.com`), public STUN servers, public MQTT-over-WSS brokers (net only).

---

## 4. Shared modules (already written, read-only)

### `js/art/palette.js`
`RAMPS` (named color ramps dark→light), `TEAM` (ramp names per player slot),
`TEAM_HEX`, `C` (single colors), `hexToRgb`, `rgba`, `nearest`.

### `js/audio/audio.js`
`AudioSys` singleton: `ctx`, `master`, `sfxBus`, `musicBus`, `init()`, `unlock()`
(call from a user gesture), `onUnlock(fn)`, `setVolume(kind, v)`, `setPaused(bool)`,
`now`. SFX connect to `AudioSys.sfxBus`; music to `AudioSys.musicBus`.

---

## 5. Sprite contract — `js/art/sprites.js` (+ `js/art/bossart.js`)

```js
// sprites.js
export async function buildSprites(onProgress /* (0..1) => void */)  // generate everything
export function spr(name)            // -> Sprite (unknown name -> a visible magenta placeholder, logs once)
export function hasSprite(name)      // -> boolean
export function drawSprite(ctx, name, frame, x, y, opt)
export function drawSpriteEmissive(lctx, name, frame, x, y, opt)   // draws emissive layer if the sprite has one
export function registerSprite(name, spriteDef)   // used by bossart.js (and fx if needed)
// Sprite: { name, w, h, frames /*count*/, dirs /*rotation frames, 1 = none*/, fps /*suggested anim fps*/, emissive: bool, teamed: bool }
// opt: { team: 0..3 (for teamed sprites), dir: radians (picks nearest baked direction; 0 = pointing UP/north, clockwise positive),
//        flipX: bool, white: bool (solid-white silhouette for hit flash), alpha: 0..1 }
```

* `registerSprite(name, def)` accepts this exact shape (boss art is built against it):

  ```js
  def = {
    w, h,                        // frame size in px
    frameCount,                  // animation frames per direction
    dirs,                        // baked rotation directions (1 = none); dir index 0 = pointing up, clockwise
    fps,                         // suggested animation fps
    frames: HTMLCanvasElement[], // length frameCount*dirs, index = dirIndex*frameCount + frame
    emissive: HTMLCanvasElement[] | null,   // same indexing, or null
    white: HTMLCanvasElement[] | undefined, // optional; registerSprite bakes it if missing
  }
  ```
  (sprites.js may convert this into its own internal/atlas representation.)
* `x, y` = sprite center (integer-rounded when drawn). `frame` wraps modulo frames.
* Build all sprites into offscreen canvases (atlas packing optional). `buildSprites` must
  finish in < 1 s on a mid-range phone; yield (`await new Promise(r => setTimeout(r))`)
  between chunks so the loading bar animates.
* Direction frames: for `dirs > 1`, pre-rotate the base art with a pixel-art friendly
  rotation (e.g. RotSprite-style 8× upscale → rotate → downsample, or nearest-neighbour on
  a 2×/3× upscaled copy) so rotated sprites keep clean 1-px outlines.
* `white` variant: pre-baked per frame (cheap to draw).
* Teamed sprites are pre-baked per team 0..3 (recolor the energy ramp to `TEAM[team]`).
* Emissive layer: pixels that should glow (engine ports, cores, eyes, bullet cores) in
  their glow colors, everything else transparent.
* `bossart.js` exports `async function buildBossArt(onProgress)` which calls
  `registerSprite()` for every boss sprite. Import `registerSprite` from `sprites.js`
  (sprites.js must not import bossart.js).

### Sprite roster (names are the contract; sizes are targets, odd sizes keep a center pixel)

Player ships — teamed, emissive, `frames = 5` bank frames (0 = hard left … 2 = level … 4 = hard right):

| name | size | description |
|---|---|---|
| `ship_aurora` | 21×23 | balanced gunship, forward-swept wings, twin wing cannons |
| `ship_tempest` | 17×25 | slim needle interceptor, long nose emitter (laser) |
| `ship_seraph` | 25×21 | broad heavy frame, wing missile pods |
| `ship_valkyrie` | 23×23 | delta with twin prongs that arc plasma |
| `flame_s` | 5×9 | engine flame, 4 frames, teamed, emissive (drawn under ship engines) |
| `option_drone` | 9×9 | satellite drone, 4 frames spin, teamed, emissive |
| `beacon` | 15×15 | downed-pilot beacon, 6 frames pulse, teamed, emissive |
| `shield_bubble` | 31×31 | respawn invulnerability bubble, 4 frames, teamed, emissive (drawn semi-transparent) |

Player bullets — teamed, emissive:

| name | size | notes |
|---|---|---|
| `pb_vulcan` | 3×10 | dirs 16 |
| `pb_vulcan_big` | 5×12 | dirs 16 |
| `pb_laser_body` | 7×8 | vertical tileable beam segment, 4 frames shimmer |
| `pb_laser_head` | 11×11 | beam tip flare, 4 frames |
| `pb_missile` | 5×9 | dirs 16 |
| `pb_wave` | 17×7 | plasma crescent, 3 frames |
| `pb_wave_l` | 25×9 | bigger crescent, 3 frames |
| `pb_option` | 3×7 | drone shot |

Enemy bullets — emissive, NOT teamed (suffix = color: `p` magenta, `o` ember orange, `v` plasma violet, `c` crystal teal):

| name | size | notes |
|---|---|---|
| `eb_small_p` / `_o` / `_v` / `_c` | 5×5 | 2 frames flicker |
| `eb_orb_p` / `_o` / `_v` / `_c` | 9×9 | 2 frames |
| `eb_big_p` / `_o` / `_v` | 15×15 | 4 frames swirl |
| `eb_needle_p` / `_o` / `_c` | 3×9 | dirs 32 |
| `eb_star_o` | 9×9 | 4 frames spin |
| `eb_ring_v` | 11×11 | hollow ring, 2 frames |

Enemies (the Choir) — emissive cores:

| name | size | frames/dirs | description |
|---|---|---|---|
| `en_mite` | 11×9 | 2 frames | tiny swarm drone, wing flicker |
| `en_dart` | 13×15 | dirs 16 | arrowhead fighter |
| `en_wisp` | 13×13 | 4 frames | pulsing orb with tendrils |
| `en_lancet` | 15×21 | dirs 16 | dive-bomber spike |
| `en_eye` | 17×17 | 4 frames (eye open→closed) | floating turret eye |
| `en_carapace` | 25×21 | 2 frames | armored beetle gunship |
| `en_weaver` | 23×15 | 2 frames | wide strafing bomber |
| `en_mine` | 13×13 | 2 frames blink | spiked mine |
| `en_hornet` | 19×19 | 3 frames | stop-and-spin turret craft |
| `en_seeker` | 9×9 | 2 frames | small homing kamikaze |
| `en_bastion` | 49×37 | 1 frame | mid-boss frigate (multi-gun) |
| `en_shard` | 13×21 | 2 frames | crystal enemy (Veil) |
| `en_phantom` | 19×17 | 4 frames | phase-shifting ghost (Veil) |
| `en_turret` | 19×19 | 1 frame | ground turret base (Wreck), drawn on hull |
| `en_turret_gun` | 11×11 | dirs 16 | turret barrel overlay |
| `en_rock_s` | 11×11 | 4 frames = 4 variants | small molten asteroid (Cinder) |
| `en_rock_m` | 19×17 | 4 variants | medium asteroid |
| `en_rock_l` | 31×27 | 4 variants | large asteroid |
| `en_sentinel` | 21×21 | 4 frames | rotating halo guardian (Horizon) |

Pickups — emissive:

| name | size | notes |
|---|---|---|
| `pk_power` | 11×11 | 6 frames spin, orange capsule with "P" |
| `pk_bomb` | 11×11 | 6 frames, red capsule "B" |
| `pk_overdrive` | 11×11 | 6 frames, cyan capsule, lightning glyph |
| `pk_life` | 13×11 | 6 frames, 1UP |
| `pk_gem_s` | 5×7 | 4 frames, emerald |
| `pk_gem_l` | 7×9 | 4 frames, sapphire |

UI sprites:

| name | size | notes |
|---|---|---|
| `ui_life` | 9×9 | teamed mini ship icon |
| `ui_bomb` | 7×7 | nova bomb icon |
| `ui_power` | 5×5 | power pip |
| `logo` | ~200×56 | "NOVA LANCERS" pixel-art logo, emissive, 8 frames of a light sweep |
| `logo_sub` | ~120×9 | "CO-OP STARFIGHTER" small caps |

### Boss sprites — `js/art/bossart.js` (all emissive, big, lavish, multi-part)

| name | size | notes |
|---|---|---|
| `boss_warden` | 129×81 | S1 shipyard carrier hull (arms detach), 2 frames (lights) |
| `boss_warden_arm` | 37×57 | crane arm (flipX for right arm) |
| `boss_warden_turret` | 15×15 | dirs 16 |
| `boss_warden_core` | 21×17 | 4 frames glow |
| `boss_wyrm_head` | 41×45 | S2 magma serpent head, dirs 32, 2 frames (jaw closed/open) → frame index = `open ? 1 : 0` |
| `boss_wyrm_seg` | 29×29 | round armored segment, 2 frames (plates / cracked molten) |
| `boss_wyrm_tail` | 21×21 | dirs 32 |
| `boss_prism` | 45×61 | S3 crystal core, 4 frames refract shimmer |
| `boss_prism_shard` | 17×35 | orbiting crystal, dirs 16 |
| `boss_dread` | 177×97 | S4 dreadnought bridge section, 2 frames (lights) |
| `boss_dread_cannon` | 33×45 | main cannon, 4 frames (idle → full charge glow) |
| `boss_dread_turret` | 17×17 | dirs 16 |
| `boss_dread_hatch` | 21×13 | 2 frames (closed/open) |
| `boss_heart` | 63×63 | S5 Choir Heart eye, 6 frames: 0-3 iris pulse, 4 half-closed, 5 closed |
| `boss_heart_halo` | 111×111 | rotating halo ring, 8 frames (one 1/8 symmetric turn) |
| `boss_heart_petal` | 25×41 | wing/petal blade, dirs 16 |
| `boss_heart_core2` | 41×41 | exposed final-phase core, 4 frames |

---

## 6. Backgrounds — `js/art/backgrounds.js`

```js
export async function buildBackgrounds(onProgress)       // optional pre-generation (may be lazy)
export function createBackground(key)                     // -> BG
// BG:
//   resize(W, H, fieldX, fieldY)   internal canvas size (art px) and field origin
//   update(dt)                      animation step (twinkle, lightning, drifting clouds)
//   draw(ctx, lctx, scrollY, t)     scrollY = total ground distance scrolled in px (deterministic), t = seconds
//   scrollSpeed                     px/s the "ground"/near layer moves (sim uses it to compute scrollY)
//   grade                           { tint:[r,g,b] 0..1 multipliers, lift:[r,g,b] additive 0..0.1, sat: 0..2, contrast: 0..2 } for post
//   lensing(W,H) -> null | { x, y, r, strength }   (only 'horizon'; internal-canvas coords)
//   flash()                         optional: trigger a background lightning/light flash (boss events)
```

Keys and required set-pieces (each must look gorgeous, multi-layer parallax, animated):

* `title` — menu backdrop: huge dawn-lit ocean planet curving across the bottom with
  atmosphere glow, a sun flare, the Aurora Station ring silhouette, twinkling star field,
  slow drifting nebula wisps. Designed to sit behind the logo and menus.
* `aurora` (S1, "Aurora Ring") — orbital shipyard above a blue ocean planet at dawn:
  planet limb far below, cloud bands, sunlit ring-station girders/scaffolds and docking
  cranes sliding past as near parallax layers, blinking beacon lights.
* `cinder` (S2, "Cinder Belt") — asteroid mining belt near a red giant sun: huge red
  sun glow, dust lanes, mid-layer rock silhouettes with glowing molten cracks, mining rig
  platforms with lights, sparks.
* `veil` (S3, "Veil Nebula") — dense magenta/teal nebula clouds (dithered fbm), crystal
  spires drifting, internal lightning flashes lighting the clouds, star nurseries.
* `wreck` (S4, "Leviathan Wreck") — flying low over the hull of a colossal derelict
  dreadnought: top-down hull plating, trenches, pipes, vents with steam, running lights,
  burn scars, giant hull numbers. The hull is the ground layer moving at `scrollSpeed`
  (ground turrets are positioned in hull space).
* `horizon` (S5, "Event Horizon") — black hole with bright accretion disk, photon ring,
  relativistic jets, stars streaking/being lensed; `lensing()` returns the hole position so
  post-fx can warp space around it.

Performance: pre-render big static layers once to offscreen canvases (tileable vertically
where scrolling), animate with cheap draws. `draw` must stay < 2 ms on a phone at
~240×520 internal resolution. Deterministic scrolling from `scrollY` (multiplayer peers
must see the same terrain at the same time; clouds/twinkle can be free-running).

---

## 7. FX — `js/fx/particles.js` and `js/fx/post.js`

```js
// particles.js
export function createFX()   // -> FX (all coordinates are FIELD coordinates)
// FX:
//   update(dt)
//   draw(ctx, lctx)                              called with ctx/lctx already translated to the field origin
//   explode(x, y, size, opt)                     size: 'tiny'|'small'|'medium'|'large'|'huge'|'boss'; opt {palette:'fire'|'magenta'|'crystal'|'ember'|'plasma', vx, vy}
//   hit(x, y, palette)                           bullet impact sparks on enemy
//   spark(x, y, angle, palette, n)
//   muzzle(x, y, team)
//   trail(x, y, palette, size)                   engine / missile trail puff (call every frame or two)
//   debris(x, y, n, palette)
//   shockwave(x, y, radius, palette)             expanding ring + registers a post-fx distortion
//   nova(x, y, team)                             player bomb: screen-filling expanding nova, long and glorious (~1.2 s)
//   overdrive(x, y, team)                        overdrive activation burst
//   graze(x, y)                                  tiny bright spark
//   warp(x, y, palette)                          enemy warp-in effect
//   pickup(x, y, palette)                        collect sparkle
//   text(x, y, str, color)                       floating score text (use font.js drawText if present, else fillText)
//   drawBeam(ctx, lctx, x1, y1, x2, y2, width, phase, t, palette)   enemy/boss laser: phase 'warn' (thin flickering guide line) | 'fire' (thick core + glow + edge sparks)
//   drawPlayerBeam(ctx, lctx, x, y1, y2, width, team, t)            player laser column (Tempest)
//   clear()
//   postState()                                  -> { waves:[{x,y,r,strength}], flash:0..1, flashColor:[r,g,b], chroma:0..1 } in field coords
//   flash(amount, color), chroma(amount)         screen flash / chromatic aberration kick
//   setTextRenderer(fn)                          fn(ctx, str, x, y, color) — main wires font.js in; fall back to a tiny built-in digit font
//   count                                        live particle count (for perf overlay)
```

Budget: up to ~1500 live particles with object pooling, no per-frame allocations.
Explosions are the showpiece: flash core on light layer, fireball flipbook (procedurally
pre-rendered frames with fire ramp dithering), smoke that lingers and drifts, sparks,
debris chunks with trails, shockwave ring. Boss death = chained explosions over ~2.5 s.

```js
// post.js
export function createPost(canvas)   // canvas: the on-screen <canvas>; returns null if WebGL unsupported
// Post:
//   resize(cssW, cssH, dpr, W, H)    display size and internal size
//   render(mainCanvas, lightCanvas, s)
//     s = { grade, waves:[{x,y,r,strength}] (internal-canvas coords), flash, flashColor, chroma,
//           lensing: null|{x,y,r,strength}, time, quality: 'high'|'medium'|'low', scanlines: bool }
//   quality                           current quality (auto-downgrades if frame time is poor)
```

The upscale must stay pixel-crisp (nearest sampling of the main layer, aligned to the art
grid); bloom is computed at low resolution (downsample + separable blur, 2–3 mips) from
the light layer. Distortion waves offset UVs radially. Keep it 60 fps on a mid-range
phone at DPR capped to 2.

---

## 8. Audio

### `js/audio/sfx.js`

```js
export async function buildSfx(onProgress)          // render all buffers (OfflineAudioContext), < ~1.5 s total; call after AudioSys.init()
export function sfx(name, opt)                      // one-shot; opt { x: field x (0..240) → stereo pan, vol: 0..1.5, pitch: semitones, when: ctx time }
export function sfxLoop(name, opt)                  // -> { stop(fadeSec), setVol(v), setPitch(semi), setX(x) } looping sound
```

Required names (each with 3–6 rendered variants, auto per-name voice limiting and
rate-limiting so auto-fire never machine-guns the mix):

`shot_aurora` `shot_tempest_loop` (laser hum loop) `shot_seraph` (missile launch whoosh)
`shot_valkyrie` (plasma wave) `shot_option` `hit_enemy` (bullet on armor tick) `hit_armor`
(deflect, invulnerable part) `explode_small` `explode_medium` `explode_large` `explode_boss`
(huge, long tail) `enemy_shot` `enemy_shot_heavy` `enemy_laser_charge` `enemy_laser_fire`
(loop-friendly one-shot) `player_hit` `player_explode` `shield_up` `respawn`
`pickup_power` `pickup_bomb` `pickup_gem` `pickup_life` `pickup_overdrive` `powerup_max`
`nova` (bomb: swelling whoosh + deep boom + long reverb tail) `overdrive_on` `overdrive_off`
`graze` `chain_up` `warning` (boss siren, ~2 s) `boss_roar` (deep synthetic creature/machine roar)
`boss_phase` `warp_in` `revive` `beacon_ping` `player_join` `player_leave`
`ui_move` `ui_select` `ui_back` `ui_start` `ui_error` `countdown` `stage_clear_whoosh`.

"Unique, realistic": layered synthesis (transient + body + tail), filtered noise with
envelopes, FM/metallic resonances, pitch sweeps, sub-bass thumps on explosions, a short
procedurally generated convolution reverb for space, subtle distortion/saturation.

### `js/audio/music.js`

```js
export const Music = {
  async init(onProgress),            // build instruments (render samples), call after AudioSys.init()
  play(track, opt),                  // opt { fade: seconds (default 1.0), restart: bool }; crossfades from the current track
  stop(fade),
  setIntensity(x),                   // 0..1 optional layer control (e.g. 1 during boss)
  duck(amount, seconds),             // temporary duck (0..1) for big moments
  stinger(name),                     // 'stage_clear' | 'game_over' | 'boss_defeated' | 'extend' (short musical one-shots)
  current,                           // current track name or null
};
```

Tracks: `title` `aurora` `cinder` `veil` `wreck` `horizon` `boss` `finalboss` `victory`
`gameover` `lobby`. Every sector track has its own identity (tempo, key, instruments) but
the whole score shares motifs (a "Lancers" theme heard in title, victory, and reprised in
the final boss). Songs live in `js/audio/songs/*.js` as data.

---

## 9. Networking — `js/net/`

Transport: **PeerJS** (vendored UMD at `vendor/peerjs.min.js`, loaded lazily by
`js/net/session.js` via a `<script>` tag) over the free PeerJS cloud signaling server,
public STUN servers. **Fallback relay**: MQTT 3.1.1 over secure WebSocket to public
brokers (`wss://broker.emqx.io:8084/mqtt`, `wss://broker.hivemq.com:8884/mqtt`,
`wss://test.mosquitto.org:8081/mqtt`) with a tiny hand-written QoS-0 client
(`js/net/mqtt.js`) — used automatically when a P2P data channel can't be opened in ~6 s
(symmetric NAT on cellular, etc.) or signaling is down. Star topology: host is the hub.
Host migration is out of scope (host leaving ends the session for others, gracefully).

Room codes: 5 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Host PeerJS id:
`nvl1-room-<CODE>`. Quick Match: public slot ids `nvl1-pub-<0..11>`; a quick-matcher
probes slots for an open, not-started, public room; if none, hosts on the first free slot
and waits. Join link: `https://milgie.com/games/novalancers/?room=<CODE>`.
For local testing, `?peerhost=localhost&peerport=9000&peerpath=/` overrides the
signaling server and `?mqtt=ws://localhost:9001` overrides the broker list.

```js
// js/net/session.js
export async function hostSession({ name, ship, isPublic }) // -> Session (host); resolves when room is open
export async function joinSession(code, { name, ship })     // -> Session (client); resolves after lobby handshake; rejects with Error('ROOM_NOT_FOUND'|'ROOM_FULL'|'ALREADY_STARTED'|'NETWORK')
export async function quickMatch({ name, ship })            // -> Session (host or client)
export function makeInviteUrl(code)
export function parseRoomFromUrl()                          // -> code | null

// Session
//   isHost, code, isPublic, selfSlot (0..3; host = 0)
//   lobby            { players: [{ slot, name, ship, ready, connected, ping }], started: bool }
//   setInfo({ name?, ship?, ready? })   update own lobby entry (client -> host -> broadcast)
//   startGame(payload)                  host only: marks started, broadcasts {payload}
//   send(msg)                           client: to host; host: broadcast to all clients
//   sendTo(slot, msg)                   host only
//   on(event, fn) / off(event, fn)
//       'lobby'   (lobby)                lobby changed
//       'start'   (payload)              game starting (fires on host too)
//       'message' (msg, fromSlot)        game message (host receives client msgs; clients receive host msgs)
//       'peerjoin' (slot, info) / 'peerleave' (slot, info)
//       'close'   (reason)               session ended ('HOST_LEFT', 'KICKED', 'NETWORK', 'LEFT')
//       'transport' ({ slot, kind: 'p2p'|'relay' })
//   hostTime()                          estimated host clock in ms (clients sync via ping/pong; host = performance.now())
//   ping(slot?)                         last RTT in ms
//   transportKind                       'p2p' | 'relay' | 'mixed'
//   close()
```

Messages are plain JSON-serializable objects `{ k: 'type', ... }` (keep them compact).
Session internals (hello/lobby/ping/start) use keys prefixed with `_` so they never collide
with game messages. Validate every inbound message (type checks, size < 16 KB); never
trust or execute content.

---

## 10. UI — `js/ui/screens.js`, `js/ui/hud.js`, `js/art/font.js`, `css/style.css`

HTML overlay screens over the live canvas (the title background keeps animating behind).
Pixel aesthetic: Google Font **"Pixelify Sans"** for headings + **"Silkscreen"** for
small caps labels (loaded in index.html), chunky 2-px borders, glowing team-colored accents,
big thumb-friendly buttons (≥ 48 px), safe-area insets respected, no hover-only affordances.

```js
// screens.js
export const UI = {
  init(root, handlers),   // root = #ui element; handlers listed below
  show(name, data),       // 'loading'|'title'|'menu'|'hangar'|'coop'|'join'|'lobby'|'pause'|'gameover'|'results'|'victory'|'settings'|'howto'|'credits'|'none'
  current,
  setLoading(p, label),   // 0..1
  updateLobby(lobby, session),
  toast(msg, ms),
  banner(title, sub, ms), // big in-game banner (e.g. "SECTOR 2 — CINDER BELT")
};
// handlers (called by UI, implemented by main.js):
//   onSolo({ ship })            onHost({ ship, isPublic })    onJoin({ code })     onQuickMatch({ ship })
//   onLobbyReady(ready)         onLobbyShip(ship)             onLaunch()           onLeaveLobby()
//   onResume()                  onQuitToMenu()                onRetry()            onContinue()
//   onSettings(settings)        onShare(code)                 onSectorSelect(n)    onFullscreen()
//   getSettings() -> settings   getProfile() -> { name, ship, bestScore, unlockedSector, stats }
// settings = { name, music:0..1, sfx:0..1, haptics:bool, shake:bool, quality:'auto'|'high'|'low', sensitivity:0.6..2.0, scanlines:bool }

// hud.js
export function drawHUD(ctx, lctx, hud, R)   // canvas HUD in INTERNAL canvas coords (not translated)
// hud = { score, hiScore, chain, chainTimer, players:[{slot,name,ship,lives,alive,beacon,power,ping,isLocal}],
//         bombs, power, powerMax, overdrive (0..1), overdriveActive, boss: null|{ name, hp (0..1), phase },
//         sector, sectorName, fps, warning (0..1 anim), net: null|{ kind, ping } }
// Use the top strip (R.fy area) and bottom strip when available; overlay inside the field edges when not.

// font.js — bitmap pixel fonts
export function drawText(ctx, str, x, y, opt)  // opt { color, align:'left'|'center'|'right', size:1|2|3, font:'small'|'big', shadow: color|null, lctx: glow ctx|null, glow: color }
export function measureText(str, opt)          // -> width in art px
```

The in-game touch buttons `#btnNova` and `#btnOver` exist in index.html; UI styles them
(round, translucent, icon + label, cooldown/charge ring via CSS custom property
`--charge` 0..1 and class `ready`). `engine/input.js` owns their event listeners.

Screens:

* **title**: logo (canvas `logo` sprite drawn by main behind UI, or CSS text fallback), "TAP TO
  START" pulse, version, back link to milgie.com games.
* **menu**: SOLO SORTIE · CO-OP SQUAD · HANGAR · SETTINGS · HOW TO PLAY · CREDITS; shows best score.
* **hangar**: ship select (4 ships, stat bars: POWER / SPEED / SPREAD, weapon description,
  big animated preview canvas using `drawSprite`), confirm → returns to caller.
* **coop**: CREATE SQUAD (private) · QUICK MATCH (public) · JOIN WITH CODE; explains
  "share the link, friends tap it, you're in".
* **join**: 5-char code input (auto uppercase, big letters), JOIN.
* **lobby**: room code huge + SHARE (navigator.share / copy link) + QR code (optional),
  4 player slots with team color, ship, name, ready ✓, ping; ship picker; READY toggle;
  host LAUNCH (enabled when everyone ready); LEAVE.
* **pause**: RESUME · SETTINGS · QUIT (in multiplayer the game keeps running).
* **gameover**: score, CONTINUE (solo; resets score) · RETRY · MENU.
* **results** (sector clear): kills, accuracy, grazes, max chain, gems, per-player in co-op, NEXT.
* **victory**: ending text + credits roll + final score.
* **settings**, **howto** (illustrated controls for touch & keyboard), **credits**.

---

## 11. Gameplay rules (sim, owned by lead + gameplay agents)

* Lives 3, bombs 2 (max 5), power 1..8 (team-shared power level; drops on death by 2),
  overdrive meter fills from kills and grazes; activating gives 6 s of ×2 damage, bigger
  shots, ×2 score, gold aura.
* Chain: kills within 1.5 s of each other raise the chain (×1 → ×16 score multiplier).
* Graze: enemy bullet passing within 10 px of the ship center (hitbox radius 2.5 px) gives
  score + overdrive.
* Pickups are team-wide: whoever touches it, every player gets the effect.
* Difficulty scales with player count (enemy HP ×(1 + 0.55·(n−1)), slightly denser
  patterns).
* Sector flow: intro banner → waves (~2–2.5 min) → mid-boss (S2–S5) → waves → WARNING →
  boss → results → next sector.

### Netcode model (for reference; sim implements it)

Host-authoritative events + deterministic local simulation: the host runs the stage
script and enemy brains and broadcasts compact events (`spawn`, `fire`, `kill`, `phase`,
`pickup`); every peer simulates enemy motion (closed-form paths) and bullets locally from
those events, fast-forwarding by the latency. Each peer is authoritative for its own ship
(movement, getting hit) and for the damage its own bullets deal (reported to the host).
Player states stream at 20 Hz and are interpolated.
