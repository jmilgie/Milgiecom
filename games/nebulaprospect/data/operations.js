/* ============================================================
   NEBULA PROSPECT — OPERATION TEMPLATES
   ============================================================
   Ops are drawn randomly when the sensor scan fires. Each has
   a preferred unit type, priority tier, duration (seconds), base
   reward, and flavor text shown in the op detail modal.

   Tags control faction reputation effects (e.g. a 'security'
   op with 'fringe:-5' drops Fringe rep by 5 on completion).

   Schema:
     id         string, unique
     title      ≤ 45 chars, shown in queue
     type       unit specialization (see units.js)
     prio       critical | high | medium | low
     etaS       base duration in in-game seconds (scaled by variance)
     reward     base Quantum Yield payout
     flavor     1-3 sentence description for the modal
     tags       optional: faction rep, story hooks, research gates
     require    optional research id that must be completed to roll this op
     outcome    optional: extra side-effects on completion (fields below)
                  threat   +/- threat index delta
                  signal   +/- signal integrity delta
                  fatigue  +/- global fatigue delta
                  codex    id of codex entry unlocked on complete
                  lootRoll true → random bonus cache
   ============================================================ */

window.NP_OP_TEMPLATES = [
  /* === ENGINEER === */
  { id:'op_drill_stab',   title:'Stabilize Plasma Drill Array',   type:'engineer',   prio:'critical', etaS:2700, reward:120_000,
    flavor:'The drill array is oscillating outside safe tolerance. If it shears, we lose four shifts of ore and probably a drone.',
    tags:{ consortium: 4 }, outcome:{ signal:+2 } },
  { id:'op_coolant',      title:'Resolve Coolant Pressure Fault', type:'engineer',   prio:'high',     etaS:2200, reward:100_000,
    flavor:'Reactor coolant loop is running hot. Run the manual purge before the automated failsafe vents half our deuterium.',
    outcome:{ signal:+1 } },
  { id:'op_struct',       title:'Reinforce Habitat Truss',        type:'engineer',   prio:'medium',   etaS:1800, reward:75_000,
    flavor:'Micro-fractures in the outer truss. Not urgent, but ignoring it is how Callisto happened.' },
  { id:'op_vent',         title:'Seal Atmospheric Micro-Breach',  type:'engineer',   prio:'high',     etaS:1200, reward:60_000,
    flavor:'Level three corridor is leaking a liter of atmosphere every minute. Crew taped a boot over it. Please fix before someone gets creative.',
    outcome:{ fatigue:+2 } },
  { id:'op_drone_refit',  title:'Refit Extraction Drone Fleet',   type:'engineer',   prio:'low',      etaS:3600, reward:110_000,
    flavor:'Swap out the B-series drill bits for the C-series. The C-series eats iridium like it\'s lunch.',
    outcome:{ codex:'c_drone_refit' } },
  { id:'op_kinetic',      title:'Calibrate Kinetic Dampers',      type:'engineer',   prio:'medium',   etaS:2400, reward:85_000,
    flavor:'Habitat ring spin is 0.7 degrees off. Crew is getting "mystery headaches." Fix before morale officer files a memo.' },
  { id:'op_storm',        title:'Mitigate Neutron Storm Damage',  type:'engineer',   prio:'critical', etaS:3300, reward:140_000,
    flavor:'Neutron wash cooked three relays. Swap the assemblies before something important fails in a galaxy of bad ways.',
    outcome:{ signal:-3, threat:+2, codex:'c_neutron_storm' } },

  /* === DRONE SWARM === */
  { id:'op_deep_core',    title:'Deploy Deep Core Extractor',      type:'dronesw',    prio:'high',     etaS:3600, reward:160_000,
    flavor:'Deep core extractor deployment requires 12 drones in perfect harmony. Sound like an army; move like a rumor.',
    outcome:{ codex:'c_deep_core' } },
  { id:'op_iridion',      title:'Extract Iridion Vein (D-4)',      type:'dronesw',    prio:'medium',   etaS:3900, reward:170_000,
    flavor:'Iridion fetches four times its weight in refined isotopes. Fragile. Radioactive. Worth it.',
    outcome:{ lootRoll:true } },
  { id:'op_asteroid',     title:'Strip-Mine Asteroid BX-7',        type:'dronesw',    prio:'low',      etaS:4500, reward:190_000,
    flavor:'BX-7 is a candy bar of nickel-iron wrapped in basalt. Send the drones. Collect the change.' },
  { id:'op_swarm_maint',  title:'Re-Hive Drone Cluster',           type:'dronesw',    prio:'low',      etaS:1500, reward:55_000,
    flavor:'Cluster cohesion is drifting. Re-sync their hive key before they start arguing.',
    outcome:{ fatigue:-2 } },
  { id:'op_belt_survey',  title:'Survey Ore Belt for Tungsten',    type:'dronesw',    prio:'medium',   etaS:3000, reward:115_000,
    flavor:'The refinery wants tungsten and it wants tungsten now. The drones can sniff it out six belts over.' },

  /* === SIGNAL TECH === */
  { id:'op_comms',        title:'Patch Comms Relay Interference',  type:'signaltech', prio:'high',     etaS:1700, reward:90_000,
    flavor:'Relay 7 is receiving whispers from the Axiom Loop again. Scrub the signal, document the pattern, and don\'t listen too long.',
    outcome:{ signal:+4, codex:'c_axiom_loop' } },
  { id:'op_decrypt',      title:'Decrypt Intercepted Manifest',    type:'signaltech', prio:'medium',   etaS:2400, reward:105_000,
    flavor:'Caught a Fringe smuggler\'s manifest mid-burst. Whoever decrypts it first gets to decide if we sell them out to the Marshals.',
    tags:{ fringe:-4, marshal:+4 } },
  { id:'op_handshake',    title:'Spoof Fleet Handshake',           type:'signaltech', prio:'low',      etaS:1800, reward:70_000,
    flavor:'If we echo a Consortium supply fleet handshake, nearby pirates will read us as not-dinner for a week.',
    outcome:{ threat:-6 } },
  { id:'op_encrypt',      title:'Encrypt Outbound Payload',        type:'signaltech', prio:'low',      etaS:1500, reward:65_000,
    flavor:'Monthly Consortium yield report. Encrypting it keeps the auditors out of our business and our business out of the courts.',
    tags:{ consortium:+3 } },
  { id:'op_jammer',       title:'Disable Fringe Jammer Array',     type:'signaltech', prio:'high',     etaS:2800, reward:130_000,
    flavor:'A rogue jammer is eating our long-range scans. Nix has "ideas". Rina has "objections". Do it anyway.',
    tags:{ fringe:-6 }, outcome:{ threat:-4 } },
  { id:'op_beacon',       title:'Install Lost-Probe Beacon',       type:'signaltech', prio:'low',      etaS:1200, reward:50_000,
    flavor:'Piggy-back a beacon onto the old Novastar mapping satellite. Free coverage forever.',
    outcome:{ codex:'c_lost_probes' } },

  /* === EXPLORER === */
  { id:'op_signal_echo',  title:'Investigate Signal Echo (K-9)',    type:'explorer',   prio:'medium',   etaS:3000, reward:110_000,
    flavor:'A signal in K-9 has been echoing the station\'s own diagnostic ping. With a 0.4 second delay. We didn\'t send it.',
    outcome:{ codex:'c_k9_echo' } },
  { id:'op_anomaly',      title:'Catalog Anomaly Signature',        type:'explorer',   prio:'medium',   etaS:2700, reward:100_000,
    flavor:'Whatever the sensors are picking up, it isn\'t in any catalog. That\'s either a discovery or a very bad day.',
    outcome:{ codex:'c_anomaly_alpha' } },
  { id:'op_scout_bx9',    title:'Scout Sector B-9 Asteroid Field',  type:'explorer',   prio:'low',      etaS:2700, reward:95_000,
    flavor:'B-9 is mostly rocks, one or two wrecks, and a single persistent heat signature that won\'t stop moving.' },
  { id:'op_probe_recover',title:'Recover Lost Probe 44-B',          type:'explorer',   prio:'medium',   etaS:3000, reward:115_000,
    flavor:'Probe 44-B went silent forty years ago. Its last ping is only now reaching us. Go say hello.',
    outcome:{ codex:'c_probe_44b', lootRoll:true } },
  { id:'op_derelict',     title:'Board Derelict Freighter',         type:'explorer',   prio:'high',     etaS:3600, reward:165_000,
    flavor:'A freighter drifted out of the Fringe with no crew and the lights still on. Proceed carefully. Extract everything.',
    tags:{ fringe:-2 }, outcome:{ lootRoll:true, codex:'c_derelict_freighter' } },
  { id:'op_hollow',       title:'Probe the Hollow Resonance',       type:'explorer',   prio:'critical', etaS:4800, reward:260_000,
    flavor:'The Hollow has a heartbeat. We heard it. We\'d like Vel Raz to confirm we\'re not losing our minds.',
    require:'r_xeno_theory', outcome:{ codex:'c_hollow_heartbeat' } },

  /* === AUTO AI === */
  { id:'op_reroute',      title:'Reroute Drone Logistics Network',  type:'autoai',     prio:'low',      etaS:1800, reward:65_000,
    flavor:'ECHO-7 wants to rewrite the drone traffic graph. Let it. Watch throughput jump ten percent.',
    outcome:{ signal:+1 } },
  { id:'op_power',        title:'Redirect Power to Outpost 7',      type:'autoai',     prio:'low',      etaS:2100, reward:80_000,
    flavor:'Outpost 7 is brownout-adjacent. A simple routing change buys them another quarter cycle.' },
  { id:'op_ai_patch',     title:'Patch Command Kernel Exploit',     type:'autoai',     prio:'high',     etaS:2400, reward:120_000,
    flavor:'A kernel-level exploit dropped in the Fringe chatter. Patch ours before a joker tries it.',
    tags:{ fringe:-2 }, outcome:{ signal:+3 } },
  { id:'op_fleet_auto',   title:'Automate Convoy Routing',          type:'autoai',     prio:'medium',   etaS:2700, reward:105_000,
    flavor:'Rip the human out of the routing loop. Our pilots are free. The convoys are faster. Everyone wins.',
    require:'r_fleet_ai' },
  { id:'op_self_opt',     title:'Self-Optimize Refinery Code',      type:'autoai',     prio:'low',      etaS:3300, reward:130_000,
    flavor:'Let ECHO-7 edit the refinery firmware. What could possibly go wrong. (Probably nothing.)',
    outcome:{ signal:+2, codex:'c_self_opt' } },

  /* === RECOVERY === */
  { id:'op_salvage',      title:'Salvage Wreck: ID 73C-X',          type:'recovery',   prio:'medium',   etaS:4200, reward:180_000,
    flavor:'Marshal-class wreck hulking in the dust. Old. Empty. Rich in bent metal and incident paperwork.',
    outcome:{ lootRoll:true } },
  { id:'op_tow_convoy',   title:'Tow Stranded Convoy to Safety',    type:'recovery',   prio:'high',     etaS:3000, reward:125_000,
    flavor:'A Consortium convoy lost a thruster. If the pirates get there first we\'ll have a very awkward memo.',
    tags:{ consortium:+5, fringe:-3 } },
  { id:'op_debris',       title:'Clear Debris from Hangar Approach',type:'recovery',   prio:'low',      etaS:1500, reward:50_000,
    flavor:'Someone\'s junk drifted into our approach lane. Sweep it. Sell it. Forget it.' },
  { id:'op_scrap_run',    title:'Scrap Run — Abandoned Station',    type:'recovery',   prio:'medium',   etaS:3600, reward:155_000,
    flavor:'Old Fringe hideout, freshly abandoned. Take what\'s bolted down. Leave the graffiti.',
    tags:{ fringe:-3 }, outcome:{ lootRoll:true, codex:'c_abandoned_station' } },
  { id:'op_black_box',    title:'Retrieve Black Box — Vessel 7A',   type:'recovery',   prio:'high',     etaS:2400, reward:140_000,
    flavor:'Marshal courier went down in the debris field. The Marshals will pay to read the box. The Fringe will pay more not to.',
    outcome:{ codex:'c_vessel_7a' } },

  /* === SECURITY === */
  { id:'op_pirate',       title:'Intercept Pirate Skiff',           type:'security',   prio:'high',     etaS:2400, reward:95_000,
    flavor:'Single skiff in our exclusion zone. Send them a message. Make it loud.',
    tags:{ fringe:-5, marshal:+2 }, outcome:{ threat:-10 } },
  { id:'op_boarding',     title:'Repel Boarding Party',             type:'security',   prio:'critical', etaS:1200, reward:160_000,
    flavor:'A boarding tube just mag-locked to the supply depot. This op pays when the last boarder is unconscious or unretrievable.',
    tags:{ fringe:-8 }, outcome:{ threat:-18 } },
  { id:'op_patrol',       title:'Escort Ore Convoy Run',            type:'security',   prio:'medium',   etaS:3000, reward:110_000,
    flavor:'Convoy Charlie is the scheduled victim of the month. Make it a bad month for the pirates.',
    tags:{ consortium:+3, fringe:-4 }, outcome:{ threat:-6 } },
  { id:'op_bounty',       title:'Claim Marshal Bounty — Bell Skane',type:'security',   prio:'high',     etaS:3900, reward:220_000,
    flavor:'Bell Skane, the "Ash Captain," boarded the Veresh two weeks ago. Marshals are paying for a body or a confession.',
    tags:{ marshal:+10, fringe:-10 }, outcome:{ threat:-12, codex:'c_bell_skane' } },
  { id:'op_dead_drop',    title:'Ambush Dead Drop Exchange',        type:'security',   prio:'medium',   etaS:2100, reward:120_000,
    flavor:'The dead drop between the Hollow and the Fringe goes live once every twenty cycles. This is one of those cycles.',
    tags:{ fringe:-6 }, outcome:{ lootRoll:true } },

  /* === ANALYST === */
  { id:'op_xeno_cache',   title:'Decode Xeno-Material Cache',       type:'analyst',    prio:'medium',   etaS:3300, reward:140_000,
    flavor:'Crystalline lattice with a crystalline script carved in. Dr. Sol is insisting we do this one personally.',
    outcome:{ codex:'c_xeno_script' } },
  { id:'op_isotope',      title:'Isolate Rare Isotope — Calciren',  type:'analyst',    prio:'high',     etaS:3600, reward:190_000,
    flavor:'Calciren decays every eight hours. If we hesitate we miss it. If we don\'t, the black market pays in favors.',
    outcome:{ lootRoll:true } },
  { id:'op_artifact',     title:'Study Recovered Artifact',         type:'analyst',    prio:'medium',   etaS:4200, reward:175_000,
    flavor:'A shard, a reading, a low hum. The shard is humming. That\'s new.',
    require:'r_xeno_theory', outcome:{ codex:'c_humming_shard' } },
  { id:'op_geology',      title:'Map Sector Geology Deep Scan',     type:'analyst',    prio:'low',      etaS:2400, reward:75_000,
    flavor:'Nothing exciting. Just a clean geological map. Which is exciting, for a geologist.' },
  { id:'op_biosample',    title:'Contain Bio-Sample from Drift',    type:'analyst',    prio:'high',     etaS:2700, reward:150_000,
    flavor:'Something living drifted through the dust. We have it. We would like it to remain contained.',
    outcome:{ codex:'c_driftborn' } },

  /* === PILOT === */
  { id:'op_convoy',       title:'Pilot Supply Convoy to Outpost 7', type:'pilot',      prio:'medium',   etaS:3600, reward:150_000,
    flavor:'Standard Outpost 7 run. Standard means nothing here, but this time the weather is on our side.',
    tags:{ consortium:+4 } },
  { id:'op_extraction',   title:'Extract Team from Asteroid Shelf', type:'pilot',      prio:'high',     etaS:2400, reward:170_000,
    flavor:'Team Omicron is pinned under a micrometeor shower. Needle-threading required. Casualties prohibited.',
    outcome:{ fatigue:-3 } },
  { id:'op_race',         title:'Exhibition Cup — Orion Circuit',   type:'pilot',      prio:'low',      etaS:3000, reward:100_000,
    flavor:'A tournament with a modest prize and a disproportionate amount of press. Mira would like a word.',
    require:'r_advanced_flight', tags:{ consortium:+3 } },
  { id:'op_defector',     title:'Run a Defector Through the Lanes', type:'pilot',      prio:'high',     etaS:4200, reward:230_000,
    flavor:'A Fringe captain wants out. The Fringe wants him in. The Marshals want him dead. Choose one.',
    tags:{ fringe:-6, marshal:+4 } },

  /* === TECH === */
  { id:'op_calibrate',    title:'Calibrate Sensor Phased Array',    type:'tech',       prio:'low',      etaS:1800, reward:70_000,
    flavor:'Tune the array one more time. The coverage number goes up. The morale report quotes you by name.' },
  { id:'op_firmware',     title:'Deploy Firmware Hardening Pack',   type:'tech',       prio:'medium',   etaS:2100, reward:95_000,
    flavor:'Closes four exploits we haven\'t been hit with yet. Stops a fifth we definitely have.',
    outcome:{ signal:+3 } },
  { id:'op_spin_recal',   title:'Recalibrate Habitat Ring Spin',    type:'tech',       prio:'medium',   etaS:1500, reward:80_000,
    flavor:'Fine-tune the gravity. Crew will notice immediately. They will not say thank you.',
    outcome:{ fatigue:-3 } },
  { id:'op_beacon_tune',  title:'Tune Navigation Beacons',          type:'tech',       prio:'low',      etaS:1200, reward:55_000,
    flavor:'Beacons are fine. They could be finer. We don\'t pay you to tolerate "fine."' },
  { id:'op_hull',         title:'Swap Faulty Hull Sensor Plate',    type:'tech',       prio:'high',     etaS:1800, reward:105_000,
    flavor:'Plate 114 is lying to us about the pressure. Trust is earned. Replace the plate.' },

  /* === MEDIC === */
  { id:'op_triage',       title:'Run Crew Triage After Raid',       type:'medic',      prio:'critical', etaS:2100, reward:140_000,
    flavor:'Three crew in medbay. Fourth went missing. First priority is the ones still bleeding.',
    require:'r_medbay', outcome:{ fatigue:-10 } },
  { id:'op_outbreak',     title:'Contain Microbial Outbreak',       type:'medic',      prio:'high',     etaS:2700, reward:150_000,
    flavor:'Something hitched in with the Drift sample. We would like it to stay in the medbay and nowhere else.',
    require:'r_medbay', tags:{}, outcome:{ fatigue:-6 } },
  { id:'op_therapy',      title:'Rotating Crew Therapy Program',    type:'medic',      prio:'low',      etaS:3000, reward:60_000,
    flavor:'Low morale kills yield. Halden\'s running sessions. Even Rook is attending. Yes, really.',
    require:'r_medbay', outcome:{ fatigue:-14 } },

  /* === NEGOTIATOR === */
  { id:'op_contract',     title:'Negotiate Consortium Extension',   type:'negotiator', prio:'medium',   etaS:2400, reward:150_000,
    flavor:'Base contract was expiring. Not anymore. Signed, sealed, slightly worse terms than last year.',
    require:'r_diplomacy', tags:{ consortium:+8 } },
  { id:'op_truce',        title:'Broker Fringe Non-Aggression',     type:'negotiator', prio:'high',     etaS:3300, reward:220_000,
    flavor:'One captain on a station drinking station-swill. If Rina can get a signature, threats drop 20%.',
    require:'r_diplomacy', tags:{ fringe:+8, marshal:-4 }, outcome:{ threat:-25 } },
  { id:'op_marshal_reg',  title:'Register Under Marshal Codex',     type:'negotiator', prio:'medium',   etaS:1800, reward:100_000,
    flavor:'File the paperwork, get the green stripe, and the Marshals stop pulling us over for "routine checks."',
    require:'r_diplomacy', tags:{ marshal:+8, fringe:-3 } },
  { id:'op_science_accord',title:'Sign Praxis Research Accord',      type:'negotiator', prio:'low',      etaS:2100, reward:95_000,
    flavor:'Data share. Reputation boost. Minor royalties. Rina wants to make it a recurring thing.',
    require:'r_diplomacy', tags:{ praxis:+8 }, outcome:{ codex:'c_praxis_accord' } },
];
