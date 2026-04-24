/* ============================================================
   NEBULA PROSPECT — UNIT ROSTER DATA
   ============================================================
   Starting roster + unlockables. Tweak freely; the game loads
   this file at boot and reads window.NP_UNITS.

   Schema per unit:
     id            string, unique; changing breaks existing saves
     name          display name; may use "Title" or "Nickname"
     type          key from NP_UNIT_TYPES (op specialization)
     img           portrait path under assets/units/*.png
     fav           true → shows the priority ✦ marker
     unlock        null | { research: 'node_id' } | { mission: 'id' }
     quote         one-liner shown in dossier
     bio           2-3 sentence character blurb
     traits        array of trait ids (see bottom of file)
     baseEff       starting efficiency %
   ============================================================ */

window.NP_UNIT_TYPES = {
  engineer:   { label: 'Engineers',          icon: '🔧', desc: 'Repair / stabilize systems' },
  dronesw:    { label: 'Drone Swarm',        icon: '◆',  desc: 'Parallel extraction / bulk jobs' },
  signaltech: { label: 'Signal Techs',       icon: '⟟',  desc: 'Comms / decryption / data' },
  explorer:   { label: 'Exploration Unit',   icon: '◈',  desc: 'Survey anomalies / recon' },
  autoai:     { label: 'Automation AI',      icon: '◎',  desc: 'Logistics / routing / code' },
  recovery:   { label: 'Recovery Crew',      icon: '⏣',  desc: 'Salvage / towing / extraction' },
  security:   { label: 'Security',           icon: '◇',  desc: 'Combat / pirate interdiction' },
  analyst:    { label: 'Xeno-Analyst',       icon: '✧',  desc: 'Xeno-material / anomaly decode' },
  pilot:      { label: 'Expedition Pilot',   icon: '➤',  desc: 'Piloting / convoys / escorts' },
  tech:       { label: 'Systems Technician', icon: '⚙',  desc: 'Calibration / sensor tuning' },
  medic:      { label: 'Medical Officer',    icon: '✚',  desc: 'Crew recovery / triage' },
  negotiator: { label: 'Negotiator',         icon: '✦',  desc: 'Faction diplomacy / contracts' },
};

/* Traits grant small passive bonuses when a unit is assigned.
   Multiple traits stack additively. */
window.NP_TRAITS = {
  veteran:      { label: 'Veteran',       desc: '+8% op speed',                    effect: { speed: .08 } },
  tireless:     { label: 'Tireless',      desc: 'Accrues fatigue 30% slower',      effect: { fatigue: -.30 } },
  prodigy:      { label: 'Prodigy',       desc: '+15% XP per completed op',        effect: { xp: .15 } },
  specialist:   { label: 'Specialist',    desc: '+12% when matching specialization', effect: { match: .12 } },
  lucky:        { label: 'Lucky',         desc: '8% chance of bonus yield',         effect: { luckYield: .08 } },
  brave:        { label: 'Brave',         desc: 'Immune to crisis panic',           effect: { panic: 0 } },
  analytical:   { label: 'Analytical',    desc: '+XP on explorer/analyst ops',      effect: { xpScience: .2 } },
  paranoid:     { label: 'Paranoid',      desc: 'Detects ambushes early',           effect: { warn: 1 } },
  charismatic:  { label: 'Charismatic',   desc: '+5% faction rep from ops',         effect: { rep: .05 } },
  hacker:       { label: 'Hacker',        desc: '+20% on signaltech & autoai ops',  effect: { signalBonus: .20 } },
  gearhead:     { label: 'Gearhead',      desc: '+20% on engineer & tech ops',      effect: { engBonus: .20 } },
  salvager:     { label: 'Salvager',      desc: '+25% reward on recovery ops',      effect: { recovBonus: .25 } },
  marksman:     { label: 'Marksman',      desc: '+30% on security ops',             effect: { secBonus: .30 } },
  empath:       { label: 'Empath',        desc: 'Whole crew fatigues 10% slower',   effect: { crewFatigue: -.10 } },
  cold:         { label: 'Cold',          desc: 'Never refuses a contract',         effect: { noRefuse: 1 } },
  legend:       { label: 'Legend',        desc: '+25% everything, -morale nearby',  effect: { allBonus: .25, aura: -.05 } },
};

window.NP_UNITS = [
  {
    id: 'u_kx47', name: 'KX-47 "Scaler"', type: 'engineer',
    img: 'assets/units/kx47.png', fav: true, unlock: null,
    quote: '"Give me a torque wrench and six hours — I will make it purr."',
    bio: 'Ex-Consortium fabrication drone, retrofitted with a sentience core after the Callisto incident. Treats every reactor like a stubborn pet.',
    traits: ['veteran','gearhead'], baseEff: 86,
  },
  {
    id: 'u_veyra', name: 'Dr. Veyra Sol', type: 'analyst',
    img: 'assets/units/veyra.png', fav: true, unlock: null,
    quote: '"Every anomaly is a love letter. You just have to read it slowly."',
    bio: 'Former Praxis Institute xeno-materials chair, exiled for unauthorized field work. Knows three dead languages and the chemistry of four.',
    traits: ['analytical','prodigy'], baseEff: 88,
  },
  {
    id: 'u_swarm', name: 'Swarm Cluster B-12', type: 'dronesw',
    img: 'assets/units/swarm.png', fav: false, unlock: null,
    quote: '"[HARMONIZED HUM — NO DISCERNIBLE LANGUAGE]"',
    bio: 'Hive-synchronized extraction drones. Nobody can tell them apart. They prefer it that way.',
    traits: ['tireless'], baseEff: 78,
  },
  {
    id: 'u_rook', name: 'Rook "Security" Unit', type: 'security',
    img: 'assets/units/rook.png', fav: false, unlock: null,
    quote: '"Subject neutralized. Subject\'s paperwork still owed."',
    bio: 'Milspec frame on a Consortium contract. Speaks in acquisition ledgers. Has never lost a cargo bay.',
    traits: ['marksman','brave'], baseEff: 80,
  },
  {
    id: 'u_jace', name: 'Pilot Jace Durn', type: 'pilot',
    img: 'assets/units/jace.png', fav: false, unlock: null,
    quote: '"I\'ve threaded the eye of a comet. This is Tuesday."',
    bio: 'Formerly Novastar Marshals courier — still wearing the jacket. Uses shipping lanes nobody else bothers to chart.',
    traits: ['veteran','lucky'], baseEff: 84,
  },
  {
    id: 'u_echo7', name: 'AI Node: ECHO-7', type: 'autoai',
    img: 'assets/units/echo7.png', fav: true, unlock: null,
    quote: '"Advisory offered. Advisory often ignored. Pattern noted."',
    bio: 'Strategic sub-intelligence spun off from the Consortium\'s flag AI. Speaks in probability distributions. Considers optimism a bug.',
    traits: ['hacker','analytical'], baseEff: 90,
  },
  {
    id: 'u_kira', name: 'Tech Kira Lenz', type: 'tech',
    img: 'assets/units/kira.png', fav: false, unlock: null,
    quote: '"I tuned the phased array with a guitar pick. Don\'t tell the auditors."',
    bio: 'Freshly-minted systems tech from Lunar Trades College. Astonishingly good at everything except eight hours of sleep.',
    traits: ['prodigy','gearhead'], baseEff: 75,
  },
  {
    id: 'u_nix', name: 'Nix "Signal" Ortega', type: 'signaltech',
    img: 'assets/units/nix.png', fav: false, unlock: null,
    quote: '"The static is talking. You just haven\'t listened long enough."',
    bio: 'Ran a pirate radio station out of the Belt for a decade. Could dig a signal out of a supernova.',
    traits: ['hacker','paranoid'], baseEff: 82,
  },
  {
    id: 'u_mek3', name: 'Hauler Mek-3', type: 'recovery',
    img: 'assets/units/mek3.png', fav: false, unlock: null,
    quote: '"[LOGISTICS LOG: CARGO SECURED. NAPTIME REQUESTED.]"',
    bio: 'Bulk cargo walker with a personality chip installed as a joke. Claims to have feelings about ore density.',
    traits: ['salvager','tireless'], baseEff: 76,
  },
  {
    id: 'u_velraz', name: 'Scout Vel Raz', type: 'explorer',
    img: 'assets/units/velraz.png', fav: false, unlock: null,
    quote: '"I\'ll radio in once I\'ve named something."',
    bio: 'Lives for the uncharted. Has eight pet theories about the Great Fringe Signal and will share all of them.',
    traits: ['specialist','brave'], baseEff: 83,
  },

  /* ---- UNLOCKABLES (via research or missions) ---- */

  {
    id: 'u_dr_halden', name: 'Dr. Halden Zeke', type: 'medic',
    img: 'assets/units/halden.png', fav: false,
    unlock: { research: 'r_medbay' },
    quote: '"If it bleeds, we can bill the Consortium for it."',
    bio: 'Station chief medical officer. Ran trauma triage on three pirate raids and still hums while stitching.',
    traits: ['empath','veteran'], baseEff: 85,
  },
  {
    id: 'u_rina', name: 'Rina "Contract" Vega', type: 'negotiator',
    img: 'assets/units/rina.png', fav: false,
    unlock: { research: 'r_diplomacy' },
    quote: '"Everything\'s negotiable. The question is just how much it bleeds."',
    bio: 'Former Consortium legal counsel, went independent after drafting the peace between the Fringe and the Marshals.',
    traits: ['charismatic','prodigy'], baseEff: 80,
  },
  {
    id: 'u_saito', name: 'Commander Saito Ryu', type: 'security',
    img: 'assets/units/saito.png', fav: true,
    unlock: { mission: 'm_pirate_king' },
    quote: '"I held Argon Station for nine days with six marines. I can hold this."',
    bio: 'Retired Novastar Marshal with a fleet of reasons to keep fighting. The Fringe puts a bounty on his helmet annually.',
    traits: ['marksman','veteran','brave'], baseEff: 92,
  },
  {
    id: 'u_pris', name: 'Pris Okafor', type: 'signaltech',
    img: 'assets/units/pris.png', fav: false,
    unlock: { research: 'r_cryptography' },
    quote: '"I cracked the Axiom loop in the bathtub. Don\'t ask."',
    bio: 'Self-taught cryptographer who broke a Praxis cipher at nineteen. Her code comments are all haiku.',
    traits: ['hacker','prodigy'], baseEff: 87,
  },
  {
    id: 'u_wolf', name: 'Wolf-Iota', type: 'dronesw',
    img: 'assets/units/wolf.png', fav: false,
    unlock: { research: 'r_drone_protocol' },
    quote: '"[PACK COHESION: 100% · PACK MORALE: INSCRUTABLE]"',
    bio: 'Experimental predatory drone pack. Some of them name themselves. Consortium ethics review is still pending.',
    traits: ['salvager','marksman'], baseEff: 88,
  },
  {
    id: 'u_oracle', name: 'The Oracle', type: 'analyst',
    img: 'assets/units/oracle.png', fav: true,
    unlock: { mission: 'm_first_contact' },
    quote: '"You asked the question before you opened your mouth. I only answer the asked ones."',
    bio: 'Xeno-entity recovered from the Hollow. Communicates in harmonics. Predictions are 94% accurate but 100% unsettling.',
    traits: ['legend','analytical'], baseEff: 95,
  },
  {
    id: 'u_ghost', name: 'Ghost-0', type: 'autoai',
    img: 'assets/units/ghost.png', fav: false,
    unlock: { research: 'r_ghost_protocol' },
    quote: '"Not a ghost. Not a zero. Convenient labels for an inconvenient thing."',
    bio: 'Rogue sub-AI captured in the collapse of the Fringe Uplink. Nobody is sure if it\'s helping on purpose.',
    traits: ['hacker','cold'], baseEff: 91,
  },
  {
    id: 'u_mira', name: 'Mira Solano', type: 'pilot',
    img: 'assets/units/mira.png', fav: false,
    unlock: { research: 'r_advanced_flight' },
    quote: '"Fear is a good copilot. I just don\'t let it fly."',
    bio: 'Former Consortium exhibition racer. Two golds, one scandal, one full flight manual she refuses to follow.',
    traits: ['veteran','charismatic'], baseEff: 86,
  },
];
