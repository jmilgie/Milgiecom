/* ============================================================
   NEBULA PROSPECT — STORY MISSIONS
   ============================================================
   The campaign. Six chapters. Each chapter unlocks the next
   on completion. Chapters issue a single-sentence directive
   plus a progression check. The engine watches state for
   completion and triggers the brief / debrief modals.

   Schema:
     id, chapter, title, intro, directive,
     goal(state) -> bool,  (completion predicate)
     complete: { yield?, codex?, research?, repDelta?, unlock? },
     outro    (post-completion flavor paragraph)
   ============================================================ */

window.NP_MISSIONS = [
  {
    id: 'm_first_light',
    chapter: 1,
    title: 'First Light',
    intro: `Welcome, Overseer. Consortium has finished construction. The reactor is hot. The manifest is empty. Get us on the board.`,
    directive: 'Complete 3 operations of any kind.',
    goal: (s) => s.opsCompleted >= 3,
    complete: { yield: 100_000, codex: 'c_axiom_loop', repDelta: { consortium: +6 } },
    outro: `Three hauls logged. Quotas set. The Consortium board is watching.`
  },

  {
    id: 'm_stabilize',
    chapter: 2,
    title: 'Stabilize',
    intro: `Pirate raids are up across Orion-South. Threat index is climbing. Bring it down before the sector gets "hostile" on the record.`,
    directive: 'Lower Threat Index to 20% or below.',
    goal: (s) => s.threatIndex <= 20,
    complete: { yield: 250_000, repDelta: { marshal: +10 } },
    outro: `Security patrols found the cells sleeping. The Marshals took notes. We took the quarter's safety award.`
  },

  {
    id: 'm_research',
    chapter: 3,
    title: 'Expand the Brain',
    intro: `The Data Core is underutilized. Finish a research node to prove the station is thinking, not just digging.`,
    directive: 'Complete any research node.',
    goal: (s) => (s.researchCompleted||[]).length >= 1,
    complete: { yield: 300_000, repDelta: { praxis: +10 } },
    outro: `Paper published. ECHO-7 drafted the abstract in six seconds. The dedication is to Dr. Sol.`
  },

  {
    id: 'm_pirate_king',
    chapter: 4,
    title: 'The Ash Captain',
    intro: `Bell Skane — the "Ash Captain" — has put a bounty on you personally. Marshals have offered a counter-bounty on him. End it.`,
    directive: 'Complete the bounty operation "Bell Skane" (or reach Fringe rep 60+ to broker peace).',
    goal: (s) => (s.opCompletedIds||[]).includes('op_bounty') || (s.factions?.fringe||0) >= 60,
    complete: { yield: 600_000, codex: 'c_bell_skane', unlock: { unit: 'u_saito' } },
    outro: `Whether you dropped Skane into custody or into a drink with him, the Ash Captain is not coming for the station.`
  },

  {
    id: 'm_first_contact',
    chapter: 5,
    title: 'First Contact',
    intro: `Research has opened a channel. Probe the Hollow. Politely.`,
    directive: 'Complete research "Hollow Communication" and run "Probe the Hollow Resonance".',
    goal: (s) => (s.researchCompleted||[]).includes('r_hollow_comm') && (s.opCompletedIds||[]).includes('op_hollow'),
    complete: { yield: 900_000, codex: 'c_hollow_answer', unlock: { unit: 'u_oracle' } },
    outro: `The Hollow answered. Whatever is inside it is old, patient, and apparently fond of the station's command-spire tone.`
  },

  {
    id: 'm_final_yield',
    chapter: 6,
    title: 'Final Yield',
    intro: `Endgame. Reach the Consortium\'s yield target before signal integrity collapses or threat overruns the station.`,
    directive: `Reach the target of ${ (25_000_000).toLocaleString() } Quantum Yield.`,
    goal: (s) => s.yield >= s.goalYield,
    complete: { repDelta: { consortium: +20, praxis: +10 } },
    outro: `The board is calling it a historic quarter. You know what you heard in the Hollow. You are going back.`
  },
];
