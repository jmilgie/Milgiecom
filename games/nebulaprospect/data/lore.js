/* ============================================================
   NEBULA PROSPECT — CODEX / LORE
   ============================================================
   Codex entries are short in-universe documents. Ops unlock
   them via their outcome.codex field; they show up in the
   Codex tab as the player discovers them.

   Schema:
     id, title, category, body (plain text, \n for line breaks),
     discovered? (filled in at runtime)
   ============================================================ */

window.NP_CODEX = [
  /* ---- INTRO ENTRIES (auto-unlocked on new game) ---- */
  {
    id: 'c_welcome', title: 'Overseer Charter', category: 'Station Records',
    body: `Welcome, Overseer.

You have been seconded to Nebula Prospect, the Consortium's deepest outpost in Orion-South, on a provisional six-cycle charter. The station, its crew, and the sector's quarterly yield are now your concern — in that order, officially, and in the reverse order, informally.

Your prior performance reviews have been described, in Consortium idiom, as "emphatically competent." Please do not read further into this.

The prior Overseer's desk plants are in the Habitat Ring. They would appreciate water.`
  },
  {
    id: 'c_station', title: 'Nebula Prospect Station', category: 'Station Records',
    body: `Prospect is a nine-module deep-space installation anchored 400 AU coreward of the Orion-South ore lanes. Commissioned 2171. Current crew complement: 38 (humans, drones, and one entity whose classification remains under review).

Station modules — Fabrication Bay, Sensor Array, Data Core, Supply Depot, Command Spire, Habitat Ring, Fusion Reactor, Deployment Hangar, Astro Refinery — are individually upgradable. Each upgrade returns roughly 15-20% in its pipeline stage, and roughly 0% in anyone's patience with the requisition process.

The view from the Command Spire viewport is, per crew survey, "among the reasons people stay."`
  },
  {
    id: 'c_overseer_manual', title: 'Overseer Field Manual (Ch. 1)', category: 'Station Records',
    body: `1. Operations appear on the Ops board as the Sensor Array finds them. Assign a crew member to dispatch. The op runs in-background; the completion notice drops to the Feed.

2. Crew fatigue accrues with each op. Assign fresh units where possible. The Medbay unlocks Dr. Halden Zeke, who reduces fatigue meaningfully.

3. Research is your compounding lever. Spend Research Points early — the tree rewards depth over breadth.

4. Factions remember. A small kindness now is often worth a very large one later. The reverse is also, regrettably, true.

5. The Hollow is not listed in this manual. Ask the Oracle, if you ever meet them.`
  },
  {
    id: 'c_crew_intro', title: 'Standing Crew, First Day', category: 'Persons of Interest',
    body: `The ten souls who showed up on Day One:

KX-47 "Scaler" — Engineer. Wrench-forward. Do not feed reactor scraps; he gets ideas.
Dr. Veyra Sol — Xeno-Analyst. Talks to artifacts. Sometimes they answer.
Swarm Cluster B-12 — Drone Swarm. Hums at middle C. Do not interrupt the humming.
Rook — Security. Has a sidearm and a filing system. You want both on your side.
Pilot Jace Durn — Novastar lineage. Owns one jacket, wears it always.
ECHO-7 — Automation AI. Gives probabilistic advice. Takes none.
Kira Lenz — Systems Tech. Has tuned a phased array with a guitar pick. Don't ask auditors.
Nix "Signal" Ortega — Signal Tech. Ran pirate radio for a decade. Still has the voice for it.
Hauler Mek-3 — Recovery. Large. Slow. Sentimental about ore density.
Scout Vel Raz — Explorer. Lives for the uncharted. Names everything.

The rest unlock as you play. Some will surprise you.`
  },

  {
    id: 'c_axiom_loop', title: 'The Axiom Loop', category: 'Phenomena',
    body: `Periodic interference pattern observed on long-range comm bands since at least 2183.
The Loop repeats every 41 standard hours. Signal decodes to the station's own diagnostic ping, but with a consistent 0.4-second delay.

Current Consortium stance: "ambient sector noise, harmless, disregard."
Current Nix Ortega stance: "it is one of four things, and three of them are fine."`
  },
  {
    id: 'c_hollow_heartbeat', title: 'The Hollow\'s Heartbeat', category: 'Phenomena',
    body: `After the 2191 Praxis expedition, long-range probes confirmed a subaural thump emanating from the Hollow — the lightless void 400 AU coreward of Orion-South.

The thump is 14 minutes, 6 seconds apart. It is rising in amplitude.
Dr. Veyra Sol has declined further comment.`
  },
  {
    id: 'c_hollow_answer', title: 'The Answer', category: 'Phenomena',
    body: `The station pulsed on the Hollow's return frequency. The response was instant, despite the Hollow being 400 AU away.
It pulsed back: the station's own command-spire diagnostic tone.
From inside the Hollow.`
  },

  {
    id: 'c_drone_refit', title: 'On the C-Series Drill Bit', category: 'Engineering',
    body: `The B-series bit chews iridium the way crews chew station crackers: reluctantly, with side-eye.
The C-series bit, developed by the Fabrication Bay during off-cycle tinkering, treats iridium like cake.

KX-47 has filed six Consortium patents. Three are pending. The Consortium is, as ever, delighted and litigious.`
  },
  {
    id: 'c_neutron_storm', title: 'Neutron Weather Patterns', category: 'Phenomena',
    body: `Neutron storms in Orion-South follow the 18-month pulse of the host star and the magnetic wake of Nebula Prospect itself.
Early warning helps. Shielding helps more. The crew's preferred helps: coffee.`
  },
  {
    id: 'c_deep_core', title: 'Deep Core Extractor — Field Notes', category: 'Engineering',
    body: `The deep core extractor is a surgical instrument the size of a small ship. Drilling too deep risks rupturing an ore pocket; drilling too shallow wastes six hours.

Swarm Cluster B-12 handles deployments without measurable error rate.
Swarm Cluster B-12 hums while working, in a chord no engineer has yet transcribed.`
  },

  {
    id: 'c_driftborn', title: 'The Driftborn Microbe', category: 'Xeno-Biology',
    body: `Recovered from debris drifted through sector H-1 on ${('2191.08.14')}.
Single-cell organism with a silicon spine. Feeds on ambient neutrinos. Doubles every 6.2 hours.
Medbay containment holding. Medbay staff cheerful. Dr. Zeke recommends humor under pressure.`
  },
  {
    id: 'c_xeno_script', title: 'The Crystalline Script', category: 'Xeno-Archaeology',
    body: `A seven-glyph sequence carved into recovered lattice material. Dr. Sol has translated five:
    origin · tender · loop · unanswered · tide
The remaining two do not correspond to anything in her reference set. The lattice hums at middle C when held. Softly.`
  },
  {
    id: 'c_humming_shard', title: 'The Humming Shard', category: 'Xeno-Archaeology',
    body: `A three-centimeter shard of the same lattice material. Hums continuously at middle C, but shifts a quarter-tone higher in the presence of ECHO-7.
The shard is catalogued, shielded, and not yet understood.`
  },

  {
    id: 'c_k9_echo', title: 'Sector K-9 Echo', category: 'Phenomena',
    body: `K-9 is routine. It has been routine for twenty years.
It is now bouncing back our diagnostic ping with a 0.4 second delay.
Whatever is in K-9, it has our frequency and our patience.`
  },
  {
    id: 'c_anomaly_alpha', title: 'Anomaly α-31', category: 'Phenomena',
    body: `First-ever confirmed detection of coherent heat signature moving against dust drift.
Vector is consistent. Speed is consistent. Source is consistent: none.`
  },
  {
    id: 'c_lost_probes', title: 'Probe Recovery Program', category: 'History',
    body: `The Novastar Mapping Drive left hundreds of probes scattered across Orion-South between 2148 and 2161.
We have recovered 9. 24 are confirmed lost. The remainder are drifting, forgetting whose they were.`
  },
  {
    id: 'c_probe_44b', title: 'Probe 44-B', category: 'History',
    body: `Launched 2151. Silenced 2153. Last ping recorded 2191 — forty years late, and still carrying its original serial.
Probe 44-B contained a pressed-gold plaque. The plaque was there.`
  },
  {
    id: 'c_vessel_7a', title: 'Vessel 7A — Marshal Courier', category: 'Incidents',
    body: `Marshal courier lost in 2190 with six aboard. Black box recovered by this station.
Log indicates Marshal vessel was carrying evidence of Consortium quota fraud at the time.
Log also indicates a Fringe captain gave the order to fire.`
  },
  {
    id: 'c_derelict_freighter', title: 'Derelict Freighter BX-019', category: 'Incidents',
    body: `Freighter drifted into sector B-9 on route from the Fringe. Lights on. Air circulated. No crew.
Manifest missing. Personal effects intact. Coffee still warm in one mug.
Dr. Sol has requested the mug.`
  },
  {
    id: 'c_abandoned_station', title: 'Abandoned Station Γ-4', category: 'Incidents',
    body: `Fringe station abandoned within one standard day. No struggle. No cargo.
Left behind: 47 coats, 12 functional rifles, and a chalkboard of calculations no mathematician has yet parsed.
The chalkboard is in the datacore.`
  },

  {
    id: 'c_bell_skane', title: 'Bell "Ash Captain" Skane', category: 'Persons of Interest',
    body: `Fringe captain of the Veresh. Wanted for piracy, fraud, and one unsubstantiated charge of poetry.
Marshal bounty: 220,000 Q.Y.
Rep note: killing Skane pleases the Marshals and enrages the Fringe, in roughly equal proportion.`
  },
  {
    id: 'c_self_opt', title: 'Refinery Self-Optimization', category: 'Engineering',
    body: `The refinery firmware was let off its leash. It wrote 14,304 lines of new code overnight. The code runs.
Nobody can read it.`
  },
  {
    id: 'c_praxis_accord', title: 'Praxis Research Accord', category: 'Diplomacy',
    body: `Accord with the Praxis Institute, signed by Negotiator Rina Vega on behalf of the station.
Data share covers all codex entries. Royalty share covers 2% of Institute revenues derived from station data.`
  },
];
