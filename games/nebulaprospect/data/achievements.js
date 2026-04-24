/* ============================================================
   NEBULA PROSPECT — ACHIEVEMENTS
   ============================================================
   Each achievement has:
     id, name, desc, icon (emoji/symbol), check(state) → bool

   When check returns true on a tick, the engine unlocks it,
   posts a toast, and logs to the feed. No rewards; bragging
   rights and juice only.
   ============================================================ */

window.NP_ACHIEVEMENTS = [
  { id:'a_first_op',      name:'First Haul',           icon:'◆', desc:'Complete your first operation.',
    check:(s)=>s.opsCompleted >= 1 },
  { id:'a_ten_ops',       name:'Working Shift',        icon:'⚙', desc:'Complete 10 operations.',
    check:(s)=>s.opsCompleted >= 10 },
  { id:'a_fifty_ops',     name:'Old Hand',             icon:'⚒', desc:'Complete 50 operations.',
    check:(s)=>s.opsCompleted >= 50 },
  { id:'a_hundred_ops',   name:'Consortium Lifer',     icon:'✦', desc:'Complete 100 operations.',
    check:(s)=>s.opsCompleted >= 100 },

  { id:'a_first_million', name:'First Million',        icon:'◆', desc:'Earn 1,000,000 Quantum Yield total.',
    check:(s)=>s.totalEarned >= 1_000_000 },
  { id:'a_ten_million',   name:'Ten Million Club',     icon:'◆', desc:'Earn 10,000,000 Quantum Yield total.',
    check:(s)=>s.totalEarned >= 10_000_000 },
  { id:'a_prospect_won',  name:'Prospect Secured',     icon:'★', desc:'Reach the yield target.',
    check:(s)=>s.won },

  { id:'a_first_upgrade', name:'First Upgrade',        icon:'⚞', desc:'Upgrade any module.',
    check:(s)=>Object.values(s.modules||{}).some(m=>m.level>1) },
  { id:'a_all_lv3',       name:'Fully Kitted',         icon:'⚞', desc:'Get every module to Level 3.',
    check:(s)=>Object.values(s.modules||{}).length >= 9 && Object.values(s.modules||{}).every(m=>m.level>=3) },

  { id:'a_pirate_killer', name:'Pirate Killer',        icon:'◇', desc:'Complete 5 security operations.',
    check:(s)=>(s.opTypeCompleted && s.opTypeCompleted.security >= 5) },
  { id:'a_data_miner',    name:'Data Miner',           icon:'⚈', desc:'Complete 5 explorer operations.',
    check:(s)=>(s.opTypeCompleted && s.opTypeCompleted.explorer >= 5) },
  { id:'a_engineer_pro',  name:'Engineer Pro',         icon:'🔧', desc:'Complete 10 engineer operations.',
    check:(s)=>(s.opTypeCompleted && s.opTypeCompleted.engineer >= 10) },

  { id:'a_research_1',    name:'Research Initiated',   icon:'⚛', desc:'Complete your first research node.',
    check:(s)=>(s.researchCompleted||[]).length >= 1 },
  { id:'a_research_5',    name:'Tech-Forward',         icon:'⚛', desc:'Complete 5 research nodes.',
    check:(s)=>(s.researchCompleted||[]).length >= 5 },
  { id:'a_research_all',  name:'Omniscient',           icon:'⚛', desc:'Complete all research nodes.',
    check:(s, all)=>s.researchCompleted && all.research && s.researchCompleted.length >= all.research.length },

  { id:'a_rep_consortium',name:'Corporate Darling',    icon:'◆', desc:'Reach Consortium rep 70+.',
    check:(s)=>(s.factions&&s.factions.consortium>=70) },
  { id:'a_rep_fringe',    name:'Friend of the Fringe', icon:'◈', desc:'Reach Fringe rep 70+.',
    check:(s)=>(s.factions&&s.factions.fringe>=70) },
  { id:'a_rep_marshal',   name:'Badge Buddy',          icon:'✦', desc:'Reach Marshal rep 70+.',
    check:(s)=>(s.factions&&s.factions.marshal>=70) },
  { id:'a_rep_praxis',    name:'Peer-Reviewed',        icon:'⚛', desc:'Reach Praxis rep 70+.',
    check:(s)=>(s.factions&&s.factions.praxis>=70) },

  { id:'a_codex_10',      name:'Archivist',            icon:'⚈', desc:'Unlock 10 codex entries.',
    check:(s)=>(s.codexUnlocked||[]).length >= 10 },
  { id:'a_codex_all',     name:'Loremaster',           icon:'⚈', desc:'Unlock every codex entry.',
    check:(s, all)=>all.codex && s.codexUnlocked && s.codexUnlocked.length >= all.codex.length },

  { id:'a_full_roster',   name:'Full Roster',          icon:'◈', desc:'Unlock every recruitable unit.',
    check:(s, all)=>all.units && s.units && s.units.length >= all.units.length },

  { id:'a_no_hull_loss',  name:'Untouchable',          icon:'◇', desc:'Complete a mission without signal dropping below 50.',
    check:(s)=>s.runWithoutSignalDrop },

  { id:'a_pacifist',      name:'Pacifist',             icon:'✚', desc:'Win with fewer than 5 security ops.',
    check:(s)=>s.won && (s.opTypeCompleted?.security||0) < 5 },

  { id:'a_warlord',       name:'Warlord',              icon:'◇', desc:'Complete 20 security ops.',
    check:(s)=>(s.opTypeCompleted?.security||0) >= 20 },

  { id:'a_hero',          name:'Overseer of Repute',   icon:'★', desc:'Accumulate 50 heroism points via dilemmas.',
    check:(s)=>(s.heroism||0) >= 50 },
];
