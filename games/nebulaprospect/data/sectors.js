/* ============================================================
   NEBULA PROSPECT — SECTOR MAP
   ============================================================
   Nodes on the bottom-left sector panel. A "scan" on a node
   generates ops at a bias toward that node's specialty.

   Schema:
     id, name, x, y (in viewBox 240x180 coords), icon glyph,
     type: 'scan' | 'core' | 'event',
     bias: op category bias for scans,
     desc: flavor for the modal
   ============================================================ */

window.NP_SECTOR_NODES = [
  { id:'s_core',    x:110, y:30,  icon:'◆', type:'core',  name:'Nebula Prospect',
    desc:'Home station. You are here.' },

  { id:'s_k9',      x:40,  y:60,  icon:'A', type:'scan',  name:'K-9',
    bias:'explorer', desc:'Listening post. Home of the Axiom Loop echo.' },
  { id:'s_b9',      x:80,  y:40,  icon:'M', type:'scan',  name:'B-9',
    bias:'dronesw',  desc:'Asteroid field, heavy with nickel-iron and one unsolved heat signature.' },
  { id:'s_d4',      x:130, y:70,  icon:'E', type:'scan',  name:'D-4',
    bias:'dronesw',  desc:'Primary extraction belt. Iridion-rich. Always busy.' },
  { id:'s_h1',      x:180, y:50,  icon:'D', type:'scan',  name:'H-1',
    bias:'analyst',  desc:'Drift wake from the Hollow. Origin of the bio-samples.' },
  { id:'s_c3',      x:50,  y:110, icon:'R', type:'scan',  name:'C-3',
    bias:'recovery', desc:'Debris field of old Marshal incidents.' },
  { id:'s_e7',      x:100, y:120, icon:'S', type:'scan',  name:'E-7',
    bias:'security', desc:'Edge of known pirate patrol routes.' },
  { id:'s_f5',      x:160, y:110, icon:'N', type:'scan',  name:'F-5',
    bias:'engineer', desc:'Outpost 7 proximity. Power infrastructure sprawl.' },
  { id:'s_j9',      x:200, y:130, icon:'O', type:'scan',  name:'J-9',
    bias:'signaltech', desc:'Novastar Mapping Drive archives.' },
];

window.NP_SECTOR_EDGES = [
  [1,2],[2,3],[3,4],[1,5],[5,6],[6,7],[7,8],[6,3],
  [2,0],[3,0],[4,8],
];
