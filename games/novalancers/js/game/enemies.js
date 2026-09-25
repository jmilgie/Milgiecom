// Nova Lancers — enemy roster (the Choir).
//
// Definition fields (all optional unless noted):
//   spr (required)   sprite name            hp, r (collision radius), score, z (draw order)
//   move             default path name (params may override with p.path)
//   rot              true: sprite uses baked direction frames following the heading
//   fps / frame(e,t,sim)                    animation
//   fire: [{ at, every, times, pat, args, aim=true, target:'near'|'rand', jitter, from:[dx,dy], when(e,sim,t), maxY }]
//   brain(e, sim, t)  HOST ONLY per-tick logic (use sim.fire / sim.setParams / sim.setPhase / sim.spawn / sim.cue)
//   onKill(e, sim, by) HOST ONLY, when killed (e.g. split an asteroid: sim.spawn(...) children)
//   deathFire: { pat, args, aim, from } | [...]   HOST fires this pattern from the death position
//   onSpawn(e, sim) / onPhase(e, ph, sim) / onDeath(e, sim)   run on EVERY peer (cosmetic + deterministic state)
//   cues: { name(e, sim, data) }            run on every peer via sim.cue(name, data, e)
//   drops: { gem, gemL, power, bomb, od, life }  (counts / probabilities)
//   explode: 'tiny'|'small'|'medium'|'large'|'huge'|'boss'   palette: fx palette
//   ground (drawn under, no body collision), armor (bullets bounce), noHit, noCollide,
//   ignoreClear (doesn't block wait:'clear'), boss, midboss, bar (show HP bar), name, hpScale:false,
//   maxLife (s), warp (warp-in fx), draw(e,ctx,lctx,sim,env) / drawOver(...)

export const ENEMIES = {
  mite: {
    spr: 'en_mite', hp: 2, r: 5, score: 60, move: 'sine', fps: 12,
    drops: { gem: 0 }, explode: 'small', palette: 'magenta',
  },
  dart: {
    spr: 'en_dart', hp: 5, r: 6, score: 150, move: 'bezier', rot: true,
    fire: [{ at: 0.9, every: 0, pat: 'shot', args: { v: 1.7, spr: 'eb_needle_p' } }],
    drops: { gem: 1 }, explode: 'small', palette: 'magenta',
  },
  eye: {
    spr: 'en_eye', hp: 30, r: 8, score: 400, move: 'hold', fps: 6,
    fire: [{ at: 1.4, every: 1.8, pat: 'fan', args: { n: 5, spread: 0.9, v: 1.3, spr: 'eb_orb_p' } }],
    drops: { gem: 3, power: 0.25 }, explode: 'medium', palette: 'magenta',
  },
  carapace: {
    spr: 'en_carapace', hp: 60, r: 11, score: 800, move: 'hold', fps: 4,
    fire: [
      { at: 1.2, every: 2.2, pat: 'shotgun', args: { n: 5, spread: 0.7, v: 1.1, spr: 'eb_small_o' } },
      { at: 2.0, every: 2.2, pat: 'ring', aim: false, args: { n: 14, v: 1.0, spr: 'eb_small_v' } },
    ],
    drops: { gem: 4, gemL: 1, power: 0.35, bomb: 0.08 }, explode: 'large', palette: 'fire',
  },
  bastion: {
    spr: 'en_bastion', hp: 700, r: 20, score: 8000, move: 'hold', midboss: true, boss: true, bar: true,
    name: 'BASTION FRIGATE', z: 1,
    fire: [
      { at: 1.5, every: 2.6, pat: 'rings', aim: false, args: { n: 18, count: 3, every: 14, v: 1.1, spr: 'eb_orb_v' } },
      { at: 2.8, every: 2.6, pat: 'stream', args: { count: 10, every: 5, v: 2.2, spr: 'eb_needle_p', n: 3, spread: 0.3 } },
    ],
    drops: { gem: 8, gemL: 4, power: 1, bomb: 0.5 }, explode: 'huge', palette: 'fire',
  },
};

export function registerEnemies(obj) { Object.assign(ENEMIES, obj); }
