/* ============================================================
   NEBULA PROSPECT — STATION MODULE DEFINITIONS
   ============================================================
   Nine modules make up the central station. Each has a floating
   info card positioned over the station art, a set of display
   stats, and an upgrade bonus type.

   Positions (x, y) are in % of the station panel. Tune if the
   art is swapped out.
   ============================================================ */

window.NP_MODULES = [
  {
    id: 'fab',      name: 'Plasma Fabrication Bay',  sub: 'Fabrication',
    pos: { x: 18, y: 52 },
    desc: 'Primary fabrication of drill bits, drone chassis, and sensor plates. When it hums, the station prospers.',
    stats: [
      ['Active Jobs','jobs','int',7],
      ['Efficiency','eff','pct',114],
      ['Queue','queue','int',14],
      ['Faults','faults','int',1]
    ],
    upgrade: { level: 1, cost: 500_000, bonus: 'op_speed',
      bonusLabel: '+15% progress speed on Engineer & Drone Swarm ops' }
  },
  {
    id: 'sensor',   name: 'Orbital Sensor Array',   sub: 'Scanning / Alerts',
    pos: { x: 48, y: 12 },
    desc: 'Phased scan arrays that reveal new operations, track inbound signatures, and occasionally hear things we wish they wouldn\'t.',
    stats: [
      ['Threats Detected','threats','int',3],
      ['Scan Coverage','cov','pct',78],
      ['Anomalies','anom','int',2],
      ['Signal Strength','sig','pct',92]
    ],
    upgrade: { level: 1, cost: 700_000, bonus: 'scan_rate',
      bonusLabel: '+1 op per scan · +coverage · earlier raid warnings' }
  },
  {
    id: 'datacore', name: 'Data Core Nexus',        sub: 'Data / Research',
    pos: { x: 78, y: 28 },
    desc: 'Station brain and research vault. Stores codex entries, hosts ECHO-7, and runs research when funded.',
    stats: [
      ['Data Flow','flow','raw','1.2 TB/s'],
      ['Integrity','integ','pct',98],
      ['Research Progress','rsrch','int',3],
      ['Backups','bk','int',2]
    ],
    upgrade: { level: 1, cost: 900_000, bonus: 'research',
      bonusLabel: '+30% research speed · +signal integrity regen' }
  },
  {
    id: 'supply',   name: 'Supply Depot',            sub: 'Logistics / Storage',
    pos: { x: 20, y: 34 },
    desc: 'Where everything that matters eventually lives. Theft attempts against it have never succeeded. Theft attempts against it continue.',
    stats: [
      ['Inventory Level','inv','pct',81],
      ['Critical Shortages','short','int',2],
      ['Incoming','inc','int',3],
      ['Outgoing','out','int',2]
    ],
    upgrade: { level: 1, cost: 400_000, bonus: 'cap',
      bonusLabel: '+capacity · +reward on recovery ops' }
  },
  {
    id: 'cmd',      name: 'Command Spire',           sub: 'Command / Control',
    pos: { x: 42, y: 40 },
    desc: 'The top of the station, and the top of the org chart. You work here. The plants wilt under your desk.',
    stats: [
      ['Network Load','load','pct',62],
      ['Latency','lat','raw','48ms'],
      ['Directives','dir','int',5],
      ['System Status','sys','raw','Nominal']
    ],
    upgrade: { level: 1, cost: 800_000, bonus: 'ops_cap',
      bonusLabel: '+1 concurrent operation slot · +directive count' }
  },
  {
    id: 'habitat',  name: 'Crew Habitat Ring',       sub: 'Crew / Morale',
    pos: { x: 68, y: 40 },
    desc: 'Where the crew lives when they\'re not on shift. Coffee is good. Showers are short. Reports of morale are always "Good."',
    stats: [
      ['Crew Assigned','crew','int',38],
      ['Morale','morale','raw','Good'],
      ['Fatigue','fat','pct',24],
      ['Incidents','inc','int',1]
    ],
    upgrade: { level: 1, cost: 600_000, bonus: 'morale',
      bonusLabel: '-crew fatigue gain · +unit efficiency passively' }
  },
  {
    id: 'reactor',  name: 'Fusion Reactor Core',     sub: 'Power Generation',
    pos: { x: 14, y: 74 },
    desc: 'A controlled star at the base of the station. When it sings, you sell yield. When it screams, you evacuate.',
    stats: [
      ['Output','out','raw','2.48 GW'],
      ['Demand','dem','raw','2.12 GW'],
      ['Stability','stab','pct',91],
      ['Temperature','temp','raw','Nominal']
    ],
    upgrade: { level: 1, cost: 1_100_000, bonus: 'power',
      bonusLabel: '+processing capacity (PF) · +stability regen' }
  },
  {
    id: 'hangar',   name: 'Deployment Hangar',        sub: 'Launch / Recovery',
    pos: { x: 42, y: 76 },
    desc: 'Drones launch here. Drones come back here. Most of them, anyway.',
    stats: [
      ['Active Deployments','dep','int',3],
      ['Drones In Bay','bay','int',12],
      ['Ship Readiness','ready','pct',86],
      ['Bay Capacity','cap','pct',75]
    ],
    upgrade: { level: 1, cost: 650_000, bonus: 'deploy',
      bonusLabel: '-deployment time on pilot & recovery ops · +bay cap' }
  },
  {
    id: 'refinery', name: 'Astro Refinery',           sub: 'Processing',
    pos: { x: 76, y: 74 },
    desc: 'Raw ore in one side. Purified isotopes out the other. The smell is a trade secret.',
    stats: [
      ['Input Rate','ir','raw','420 t/h'],
      ['Yield Efficiency','ye','pct',89],
      ['Backlog','bl','raw','1,250 t'],
      ['Purity','pur','raw','Average']
    ],
    upgrade: { level: 1, cost: 1_000_000, bonus: 'refine',
      bonusLabel: '+refinery pipeline efficiency · +passive yield' }
  },
];

window.NP_PIPELINE_STAGES = [
  { key: 'scan',      label: 'Scan',      icon: 'radar',
    blurb: 'Orbital sensor sweep. Upgrade the Sensor Array to boost.' },
  { key: 'deploy',    label: 'Deploy',    icon: 'rocket',
    blurb: 'Hangar launches. Upgrade the Deployment Hangar to boost.' },
  { key: 'extract',   label: 'Extract',   icon: 'drill',
    blurb: 'Drones on-site. Upgrade the Fabrication Bay to boost.' },
  { key: 'refine',    label: 'Refine',    icon: 'flask',
    blurb: 'Raw ore → isotopes. Upgrade the Astro Refinery to boost.' },
  { key: 'transport', label: 'Transport', icon: 'truck',
    blurb: 'Convoys out. Upgrade the Deployment Hangar and run pilot ops.' },
  { key: 'store',     label: 'Store',     icon: 'box',
    blurb: 'Final holding. Upgrade the Supply Depot to boost.' },
];
