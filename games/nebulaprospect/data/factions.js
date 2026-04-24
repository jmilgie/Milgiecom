/* ============================================================
   NEBULA PROSPECT — FACTIONS
   ============================================================
   Four major factions. Each has a running reputation -100..+100.
   Ops with faction tags nudge rep on completion. Rep gates
   certain ops and dilemmas, and at high rep you get periodic
   boons; at low rep you get harassment.
   ============================================================ */

window.NP_FACTIONS = [
  {
    id: 'consortium',
    name: 'Deep-Space Mining Consortium',
    short: 'Consortium',
    color: '#00cfff',
    desc: 'Your patron. Corporate, litigious, enormous. Pays the bills. Audits with a grin.',
    rewards: {
      40: 'Quarterly yield bonuses (+8%)',
      70: 'Priority shipping lanes (-deployment time)',
      100: 'Full charter — station recognized as Consortium soil',
    },
    penalties: {
      '-40': 'Audit pressure: periodic yield siphons',
      '-80': 'Contract revocation threatened',
    },
  },
  {
    id: 'fringe',
    name: 'The Fringe Syndicates',
    short: 'Fringe',
    color: '#ff6a00',
    desc: 'Pirates with uniforms, smugglers with standards, a coalition nobody admits exists.',
    rewards: {
      40: 'Dead-drops with free cargo pallets',
      70: 'No-pirate zone around the station',
      100: 'Fringe captains pass along Consortium intel',
    },
    penalties: {
      '-40': 'More pirate raids (weight +2)',
      '-80': 'Fringe captains issue bounty on station operations',
    },
  },
  {
    id: 'marshal',
    name: 'Novastar Marshals',
    short: 'Marshals',
    color: '#00ff88',
    desc: 'Inter-system peacekeeping body. Mostly ex-military. Mostly honest. Good copilot on paper.',
    rewards: {
      40: 'Marshal patrols reduce raid frequency',
      70: 'Marshal bounty ops pay 2x',
      100: 'Marshal reserve fleet jumps in during crises',
    },
    penalties: {
      '-40': 'Mandatory inspections (fatigue spikes)',
      '-80': 'Station flagged "uncooperative" — op reward -10%',
    },
  },
  {
    id: 'praxis',
    name: 'Praxis Institute',
    short: 'Praxis',
    color: '#cc88ff',
    desc: 'Open-science research collective. Operates out of university hulls. Publishes too much, too publicly.',
    rewards: {
      40: 'Research grants (+RP periodically)',
      70: 'Codex entries share across crew',
      100: 'Praxis volunteers bolster exploration ops',
    },
    penalties: {
      '-40': 'Science community frosty, research is slower',
      '-80': 'Praxis publishes open critique of your ops',
    },
  },
];
