/* ============================================================
   NEBULA PROSPECT — RESEARCH TREE
   ============================================================
   Research nodes unlock new operations, units, modules' upgrade
   bonuses, and story beats. Research Points accrue passively
   based on Data Core level, plus random events.

   Schema:
     id              unique
     name            short display name
     col             1..4 — tree column (lets UI layout automatically)
     row             row index in column
     cost            research points required
     pre             array of prereq ids
     desc            flavor text
     effect          compact label displayed on card
     apply(state)    runs on completion (engine calls it)
   ============================================================ */

window.NP_RESEARCH = [
  /* === Column 1: Foundations === */
  {
    id: 'r_adv_fabrication', name: 'Advanced Fabrication',
    col: 1, row: 1, cost: 60, pre: [],
    desc: 'Retool the Fabrication Bay assemblers for sub-millimeter tolerance work.',
    effect: '+10% Engineer op speed globally',
    apply: (s) => { s.researchBonuses.engineer = (s.researchBonuses.engineer||1) * 1.10; }
  },
  {
    id: 'r_signal_theory', name: 'Signal Theory Deep Dive',
    col: 1, row: 2, cost: 75, pre: [],
    desc: 'Catalogues the ways signals can lie to you. Fewer comm glitches.',
    effect: '+12% signal integrity regen',
    apply: (s) => { s.signalRegenBonus = (s.signalRegenBonus||0) + 0.12; }
  },
  {
    id: 'r_logistics', name: 'Logistics Kernel',
    col: 1, row: 3, cost: 90, pre: [],
    desc: 'ECHO-7 compiles its own supply-routing firmware. Supplies move faster.',
    effect: '+8% passive yield',
    apply: (s) => { s.yieldMultiplier = (s.yieldMultiplier || 1) * 1.08; }
  },

  /* === Column 2: Specialization === */
  {
    id: 'r_diplomacy', name: 'Consortium Diplomacy',
    col: 2, row: 1, cost: 140, pre: ['r_adv_fabrication'],
    desc: 'Rina Vega joins the station, opens Negotiator ops, and unlocks faction contracts.',
    effect: 'Unlocks Negotiator · opens faction ops',
    apply: (s, api) => {
      api.unlockUnit('u_rina');
      api.toast('Rina Vega reporting in', 'ok');
    }
  },
  {
    id: 'r_cryptography', name: 'Applied Cryptography',
    col: 2, row: 2, cost: 160, pre: ['r_signal_theory'],
    desc: 'Pris Okafor joins the station with a portfolio of Fringe cipher trophies.',
    effect: 'Unlocks Pris Okafor · +15% signaltech ops',
    apply: (s, api) => {
      api.unlockUnit('u_pris');
      s.researchBonuses.signaltech = (s.researchBonuses.signaltech||1) * 1.15;
    }
  },
  {
    id: 'r_drone_protocol', name: 'Predatory Drone Protocol',
    col: 2, row: 3, cost: 180, pre: ['r_logistics'],
    desc: 'Custom hive kernel that blurs the line between drone swarm and guard dog.',
    effect: 'Unlocks Wolf-Iota · +20% drone swarm',
    apply: (s, api) => {
      api.unlockUnit('u_wolf');
      s.researchBonuses.dronesw = (s.researchBonuses.dronesw||1) * 1.20;
    }
  },
  {
    id: 'r_medbay', name: 'Expanded Medbay',
    col: 2, row: 4, cost: 120, pre: [],
    desc: 'Dr. Halden Zeke takes the contract. Crew fatigue falls. Triage ops open up.',
    effect: 'Unlocks Medical Officer · -crew fatigue gain',
    apply: (s, api) => {
      api.unlockUnit('u_dr_halden');
      s.crewFatigueMul = (s.crewFatigueMul || 1) * 0.85;
    }
  },

  /* === Column 3: Advanced === */
  {
    id: 'r_fleet_ai', name: 'Fleet Autonomy Suite',
    col: 3, row: 1, cost: 260, pre: ['r_diplomacy','r_cryptography'],
    desc: 'Fully autonomous convoy routing. Outcome: fewer crashes, more paranoia.',
    effect: '+15% pilot & auto-AI op rewards',
    apply: (s) => {
      s.rewardBonuses.pilot = (s.rewardBonuses.pilot||1) * 1.15;
      s.rewardBonuses.autoai = (s.rewardBonuses.autoai||1) * 1.15;
    }
  },
  {
    id: 'r_xeno_theory', name: 'Xeno-Resonance Theory',
    col: 3, row: 2, cost: 280, pre: ['r_cryptography','r_drone_protocol'],
    desc: 'Publishes enough to get invited to the Hollow. Opens Hollow-adjacent ops.',
    effect: 'Unlocks "Probe the Hollow" · +anomaly yield',
    apply: (s) => {
      s.rewardBonuses.analyst = (s.rewardBonuses.analyst||1) * 1.20;
      s.rewardBonuses.explorer = (s.rewardBonuses.explorer||1) * 1.20;
    }
  },
  {
    id: 'r_ghost_protocol', name: 'Ghost Protocol',
    col: 3, row: 3, cost: 310, pre: ['r_drone_protocol','r_medbay'],
    desc: 'Rehabilitates the captured Ghost-0 subroutine. Dangerous. Useful. Not the same.',
    effect: 'Unlocks Ghost-0 · +25% autoai ops',
    apply: (s, api) => {
      api.unlockUnit('u_ghost');
      s.researchBonuses.autoai = (s.researchBonuses.autoai||1) * 1.25;
    }
  },
  {
    id: 'r_advanced_flight', name: 'Advanced Flight Mechanics',
    col: 3, row: 4, cost: 240, pre: ['r_medbay'],
    desc: 'Mira Solano signs. Exhibition circuit opens. So does a very bad idea or two.',
    effect: 'Unlocks Mira · opens pilot exhibition ops',
    apply: (s, api) => {
      api.unlockUnit('u_mira');
      s.researchBonuses.pilot = (s.researchBonuses.pilot||1) * 1.15;
    }
  },

  /* === Column 4: Endgame === */
  {
    id: 'r_consortium_charter', name: 'Consortium Charter',
    col: 4, row: 1, cost: 420, pre: ['r_fleet_ai'],
    desc: 'Formal charter. The station is no longer a contractor. It is Consortium soil.',
    effect: '+12% all ops · threat -20% permanent',
    apply: (s) => {
      s.allBonus = (s.allBonus||1) * 1.12;
      s.threatMul = (s.threatMul||1) * 0.80;
    }
  },
  {
    id: 'r_hollow_comm', name: 'Hollow Communication',
    col: 4, row: 2, cost: 480, pre: ['r_xeno_theory'],
    desc: 'A working channel to the Hollow. Nobody is sure who is talking.',
    effect: 'Unlocks First Contact mission · passive research',
    apply: (s) => { s.researchRegen = (s.researchRegen||0) + 2; }
  },
  {
    id: 'r_autonomy', name: 'Station Autonomy',
    col: 4, row: 3, cost: 500, pre: ['r_ghost_protocol','r_advanced_flight'],
    desc: 'Station runs itself for hours at a time. Crew takes shore leave on the station.',
    effect: 'Time speed 3x available · -25% fatigue globally',
    apply: (s) => {
      s.maxSpeed = 3;
      s.crewFatigueMul = (s.crewFatigueMul || 1) * 0.75;
    }
  },
];
