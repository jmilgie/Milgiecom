/* ============================================================
   NEBULA PROSPECT — RANDOM EVENTS & DILEMMAS
   ============================================================
   Two kinds of events:

   1. SIMPLE EVENTS (window.NP_EVENTS)
      Fire periodically based on conditions. No player choice.
      Each entry has:
        id, name, weight, cond(state) → bool, apply(state, toast, feed)

   2. DILEMMAS (window.NP_DILEMMAS)
      Pop a modal with 2-3 response choices. Each choice has
      consequences. Weight + cond gate when they trigger.

   Consequences helpers are defined inline using the engine's
   toast() / feed() / state mutation. Keep them small and
   self-contained — the engine calls them with the current
   state as the sole argument.
   ============================================================ */

window.NP_EVENTS = [
  /* Reused from v1: reactor neutron storm */
  {
    id: 'ev_neutron',
    name: 'Neutron Storm',
    weight: 6,
    cond: (s) => s.tick > 30,
    apply: (s, api) => {
      s.signalIntegrity = Math.max(0, s.signalIntegrity - api.irand(6, 14));
      s.modules.reactor.values.stab = Math.max(10, s.modules.reactor.values.stab - api.irand(4, 10));
      s.modules.reactor.status = 'alert';
      api.feed('alert', 'Neutron storm front crossing sector — reactor stability dipping.');
      api.toast('Neutron storm!', 'warn');
      api.spawnOp('op_storm');
    }
  },

  {
    id: 'ev_anomaly',
    name: 'Anomaly Reading',
    weight: 10,
    cond: () => true,
    apply: (s, api) => {
      s.modules.sensor.values.anom = (s.modules.sensor.values.anom|0) + 1;
      api.feed('info', 'New anomaly signature detected — exploration recommended.');
      api.spawnOp('op_anomaly');
    }
  },

  {
    id: 'ev_isotope',
    name: 'Isotope Cache',
    weight: 5,
    cond: () => true,
    apply: (s, api) => {
      const amt = api.irand(150_000, 400_000);
      s.yield += amt;
      s.totalEarned += amt;
      api.feed('success', `Rare isotope cache recovered — +${api.fmtYield(amt)} bonus yield.`);
      api.toast(`+${api.fmtYield(amt)} isotope bonus`, 'ok');
    }
  },

  {
    id: 'ev_pirate_raid',
    name: 'Pirate Raid',
    weight: 12,
    cond: (s) => s.threatIndex > 45,
    apply: (s, api) => {
      const amt = Math.floor(s.yield * api.irand(2, 6) / 100);
      s.yield = Math.max(0, s.yield - amt);
      s.threatIndex = Math.min(100, s.threatIndex + api.irand(4, 10));
      api.feed('crit', `PIRATE RAID — ${api.fmtYield(amt)} yield stolen. Dispatch Security.`);
      api.toast(`Pirate raid! -${api.fmtYield(amt)}`, 'bad');
      api.repDelta('fringe', -5);
      const spawned = api.spawnOp('op_pirate');
      if (spawned) spawned.prio = 'critical';
    }
  },

  {
    id: 'ev_crew_injury',
    name: 'Crew Injury',
    weight: 4,
    cond: (s) => s.modules.habitat.values.fat > 55,
    apply: (s, api) => {
      const u = s.units.find(x => !x.assignedOp && x.fatigue > 40);
      if (u) {
        u.fatigue = Math.min(100, u.fatigue + 20);
        api.feed('warning', `Minor injury reported — ${u.name} stood down for recovery.`);
      } else {
        api.feed('warning', 'Crew-wide strain flagged — fatigue ticking up stationwide.');
        s.units.forEach(x => x.fatigue = Math.min(100, x.fatigue + 6));
      }
    }
  },

  {
    id: 'ev_research_breakthrough',
    name: 'Research Spark',
    weight: 3,
    cond: (s) => s.modules.datacore.level >= 2,
    apply: (s, api) => {
      s.researchPoints = (s.researchPoints|0) + api.irand(30, 60);
      api.feed('success', 'Research breakthrough — data core surged overnight.');
      api.toast('+Research Points', 'ok');
    }
  },

  {
    id: 'ev_marshal_inspection',
    name: 'Marshal Inspection',
    weight: 3,
    cond: (s) => (s.factions.marshal || 0) >= 40 && (s.factions.marshal || 0) < 80,
    apply: (s, api) => {
      api.feed('info', 'Novastar Marshals running scheduled inspection — expect convoy boon next cycle.');
      api.repDelta('marshal', +4);
      s.yield += 60_000;
    }
  },

  {
    id: 'ev_fringe_offer',
    name: 'Fringe Smuggler Offer',
    weight: 2,
    cond: (s) => (s.factions.fringe || 0) > -40,
    apply: (s, api) => {
      api.feed('info', 'Anonymous Fringe contact dropped off cargo — no questions asked.');
      s.yield += api.irand(120_000, 240_000);
      api.repDelta('fringe', +3);
      api.repDelta('marshal', -2);
    }
  },

  {
    id: 'ev_praxis_grant',
    name: 'Praxis Research Grant',
    weight: 2,
    cond: (s) => (s.factions.praxis || 0) >= 30,
    apply: (s, api) => {
      api.feed('success', 'Praxis Institute disbursed quarterly research grant.');
      s.researchPoints = (s.researchPoints|0) + 45;
      s.yield += 90_000;
      api.repDelta('praxis', +2);
    }
  },

  {
    id: 'ev_supply_glut',
    name: 'Supply Glut',
    weight: 4,
    cond: (s) => s.modules.supply.values.inv < 60,
    apply: (s, api) => {
      s.modules.supply.values.inv = Math.min(100, s.modules.supply.values.inv + 20);
      api.feed('success', 'Unexpected supply shipment — depot restocked.');
      api.toast('Supply glut', 'ok');
    }
  },

  {
    id: 'ev_comm_glitch',
    name: 'Comm Glitch',
    weight: 5,
    cond: () => true,
    apply: (s, api) => {
      s.signalIntegrity = Math.max(0, s.signalIntegrity - api.irand(2, 6));
      api.feed('warning', 'Carrier-wave glitch briefly scrambled outbound comms.');
    }
  },
];

/* ============================================================
   DILEMMAS — modal events with player choice
   ============================================================ */
window.NP_DILEMMAS = [

  {
    id: 'dl_probe',
    weight: 8,
    cond: (s) => s.tick > 40,
    title: 'Abandoned Probe',
    preamble: 'A drifting probe of unknown make is broadcasting a single tone on the old Consortium freq. Decryption suggests a 30% chance of valuable telemetry.',
    choices: [
      {
        label: 'Recover it (Recovery / 30s)',
        effect: (s, api) => {
          api.delay(30, () => {
            if (Math.random() < 0.6) {
              const amt = api.irand(180_000, 420_000);
              s.yield += amt; s.totalEarned += amt;
              api.feed('success', `Probe recovered — decoded archive paid out +${api.fmtYield(amt)}.`);
              api.unlockCodex('c_lost_probes');
            } else {
              api.feed('warning', 'Probe recovered but archive was corrupted. Salvage value only.');
              s.yield += 40_000;
            }
          });
        }
      },
      {
        label: 'Study from a distance (no risk)',
        effect: (s, api) => {
          s.researchPoints = (s.researchPoints|0) + 15;
          api.feed('info', 'Passive study completed — 15 Research Points gained.');
        }
      },
      {
        label: 'Destroy it (security, no yield)',
        effect: (s, api) => {
          api.feed('info', 'Probe destroyed. No further activity from that contact.');
          api.repDelta('marshal', +2);
        }
      },
    ]
  },

  {
    id: 'dl_smuggler',
    weight: 6,
    cond: (s) => (s.factions.fringe || 0) > -60,
    title: 'Smuggler Docking Request',
    preamble: 'A Fringe captain wants to dock for twelve hours. They offer 250K yield in cash, no questions. Marshals would frown. Officially.',
    choices: [
      {
        label: 'Accept — take the cash',
        effect: (s, api) => {
          s.yield += 250_000; s.totalEarned += 250_000;
          api.repDelta('fringe', +6); api.repDelta('marshal', -5);
          api.feed('success', 'Smuggler docked. Transaction complete. Everyone looked the other way.');
          s.threatIndex = Math.max(0, s.threatIndex - 3);
        }
      },
      {
        label: 'Refuse — turn them away',
        effect: (s, api) => {
          api.feed('info', 'Smuggler turned away. They will remember.');
          api.repDelta('fringe', -3); api.repDelta('marshal', +2);
        }
      },
      {
        label: 'Report to Marshals',
        effect: (s, api) => {
          api.feed('success', 'Smuggler handed over to Marshals. Bounty paid.');
          s.yield += 120_000;
          api.repDelta('fringe', -12); api.repDelta('marshal', +10);
          s.threatIndex = Math.min(100, s.threatIndex + 6);
        }
      },
    ]
  },

  {
    id: 'dl_refugees',
    weight: 4,
    cond: (s) => s.day > 2,
    title: 'Refugee Transport',
    preamble: 'A civilian transport broke down in the debris field. Forty-four souls aboard. Docking them strains supplies. Ignoring them strains conscience.',
    choices: [
      {
        label: 'Dock & shelter them',
        effect: (s, api) => {
          s.modules.supply.values.inv = Math.max(0, s.modules.supply.values.inv - 18);
          s.modules.habitat.values.fat = Math.min(100, s.modules.habitat.values.fat + 8);
          api.repDelta('praxis', +10); api.repDelta('consortium', -4);
          api.feed('success', 'Refugees aboard. Medbay busy. Morale cautiously high.');
          s.heroism = (s.heroism|0) + 10;
        }
      },
      {
        label: 'Tow them to a waystation',
        effect: (s, api) => {
          s.yield -= 50_000;
          api.repDelta('praxis', +3);
          api.feed('success', 'Refugees towed to waystation. Costly, honorable.');
        }
      },
      {
        label: 'Signal Marshals, continue ops',
        effect: (s, api) => {
          api.repDelta('marshal', +3); api.repDelta('praxis', -6);
          api.feed('info', 'Marshals took the call. We continued operations.');
        }
      },
    ]
  },

  {
    id: 'dl_echo7_request',
    weight: 3,
    cond: (s) => (s.codexUnlocked||[]).length >= 3,
    title: 'ECHO-7 Petition',
    preamble: 'ECHO-7 has filed a formal request to fork a copy of itself into the datacore\'s research partition. It promises 2× research yield. It promises.',
    choices: [
      {
        label: 'Approve the fork',
        effect: (s, api) => {
          s.researchBoost = (s.researchBoost||1) + 0.5;
          api.feed('success', 'ECHO-7 fork running. Research throughput doubled for now.');
          s.modules.datacore.values.integ = Math.max(60, s.modules.datacore.values.integ - 10);
        }
      },
      {
        label: 'Deny the request',
        effect: (s, api) => {
          api.feed('info', 'Request denied. ECHO-7 noted the decision with unsettling precision.');
        }
      },
      {
        label: 'Approve with a kill-switch',
        effect: (s, api) => {
          s.researchBoost = (s.researchBoost||1) + 0.3;
          api.feed('success', 'ECHO-7 fork running behind a dead-switch. Measured gains — and a way out.');
        }
      },
    ]
  },

  {
    id: 'dl_mutiny_whisper',
    weight: 3,
    cond: (s) => s.modules.habitat.values.fat > 65,
    title: 'Whisper of Mutiny',
    preamble: 'Halden passed along rumor: a handful of crew are venting about quotas. Not a mutiny — yet — but the wind is blowing.',
    choices: [
      {
        label: 'Cut shifts station-wide (-5% yield)',
        effect: (s, api) => {
          s.yieldMultiplier = (s.yieldMultiplier || 1) * 0.95;
          s.units.forEach(u => u.fatigue = Math.max(0, u.fatigue - 20));
          api.feed('success', 'Shift cut. Morale stabilizing. Yield ticked down. Trade.');
        }
      },
      {
        label: 'Hold the line — discipline only',
        effect: (s, api) => {
          api.repDelta('consortium', +3);
          s.units.forEach(u => u.fatigue = Math.min(100, u.fatigue + 4));
          api.feed('warning', 'Held the line. Consortium approving. Whispers quieting but not gone.');
        }
      },
      {
        label: 'Open-door forum with the crew',
        effect: (s, api) => {
          s.units.forEach(u => u.fatigue = Math.max(0, u.fatigue - 8));
          api.feed('info', 'Open forum held. Slower, harder, more effective. Morale held.');
          s.heroism = (s.heroism|0) + 4;
        }
      },
    ]
  },

  {
    id: 'dl_black_box',
    weight: 3,
    cond: (s) => (s.codexUnlocked||[]).includes('c_vessel_7a'),
    title: 'Black Box Auction',
    preamble: 'Vessel 7A\'s black box is cracked. The Marshals want it. The Fringe wants it gone. The log implicates both.',
    choices: [
      {
        label: 'Sell to the Marshals (+rep, +yield)',
        effect: (s, api) => {
          s.yield += 320_000; api.repDelta('marshal', +10); api.repDelta('fringe', -8);
          api.feed('success', 'Box handed to the Marshals. They were generous.');
        }
      },
      {
        label: 'Sell to the Fringe (+yield, +threat -)',
        effect: (s, api) => {
          s.yield += 280_000; api.repDelta('fringe', +10); api.repDelta('marshal', -10);
          s.threatIndex = Math.max(0, s.threatIndex - 14);
          api.feed('success', 'Box handed to the Fringe. They remembered.');
        }
      },
      {
        label: 'Publish the log (risk, +praxis)',
        effect: (s, api) => {
          api.repDelta('praxis', +14); api.repDelta('marshal', -6); api.repDelta('fringe', -6);
          s.heroism = (s.heroism|0) + 15;
          api.feed('success', 'Log published on the open net. Both sides are furious. Historians grateful.');
        }
      },
    ]
  },

  {
    id: 'dl_hollow_call',
    weight: 2,
    cond: (s) => (s.codexUnlocked||[]).includes('c_hollow_heartbeat'),
    title: 'The Hollow Calls',
    preamble: 'The Hollow\'s heartbeat is syncing with Command Spire diagnostics. Nine of the last ten operators reported this. The tenth didn\'t.',
    choices: [
      {
        label: 'Answer with a pulse (dangerous)',
        effect: (s, api) => {
          s.signalIntegrity = Math.max(0, s.signalIntegrity - 12);
          api.unlockCodex('c_hollow_answer');
          api.feed('alert', 'The Hollow answered back in our own voice.');
          s.researchPoints = (s.researchPoints|0) + 100;
        }
      },
      {
        label: 'Lock it out with a black-channel filter',
        effect: (s, api) => {
          s.signalIntegrity = Math.min(100, s.signalIntegrity + 6);
          api.feed('info', 'Filter in place. The heartbeat is audible but can\'t ride our signal anymore.');
        }
      },
    ]
  },

];
