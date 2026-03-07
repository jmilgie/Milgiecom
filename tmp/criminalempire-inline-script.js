
// === SETTINGS & PERSISTENCE ===
const SAVE_KEY = 'criminalEmpireSave';
const SAVE_VERSION = 2;
let settings = { vibration: true, tips: true, debug: false, sound: true, music: true };
let lastSeen = Date.now();
let shownTips = new Set();

// === GAME STATE ===
let money=0,moneyPerSecond=0,clickPower=1,reputation=0,policeHeat=0,heatShield=0,heatDecay=0;
let critChance=0.05,critMult=3,luckChance=0,combo=0,lastClickTime=0,comboTimeout=null;
let storageLocations=[],thieves=[],ownedTerritories=[],globalMult=1,heistBonus=0,clickMult=1;
let totalEarned=0,totalClicks=0,totalHeists=0,totalOfflineEarnings=0,achievementsUnlocked=[];
let prestigeLevel=0,legacyPoints=0,lifetimeEarnings=0,prestigeUpgrades=[];
let eventHistory=[],lastEventTime=0,activeEffects={};
let isResetting=false;
let maxThieves=6;

const ranks=[{name:"ðŸ”° Thug",rep:0},{name:"ðŸ’œ Hustler",rep:100},{name:"ðŸ’™ Runner",rep:400},{name:"ðŸ’— Boss",rep:1500},{name:"â¤ï¸ Kingpin",rep:6000},{name:"ðŸ§¡ Godfather",rep:25000},{name:"ðŸ‘‘ Legend",rep:100000}];
const tierThresholds=[0,5,15,30,50,100];
const tierNames=['ðŸ”˜','ðŸ¥‰','ðŸ¥ˆ','ðŸ¥‡','ðŸ’Ž','ðŸŒŸ'];
const MINIGAME_TIER=3;

const bizUpgrades=[
    {name:"Lemonade",icon:"ðŸ‹",income:1,baseCost:15,owned:0,mult:1.12,minigame:null,maxOwned:100},
    {name:"Food Cart",icon:"ðŸŒ­",income:6,baseCost:120,owned:0,mult:1.12,minigame:null,maxOwned:90},
    {name:"Shop",icon:"ðŸª",income:30,baseCost:900,owned:0,mult:1.13,minigame:null,maxOwned:80},
    {name:"Restaurant",icon:"ðŸ½ï¸",income:120,baseCost:6000,owned:0,mult:1.13,minigame:null,maxOwned:70},
    {name:"Factory",icon:"ðŸ­",income:500,baseCost:35000,owned:0,mult:1.14,minigame:'factory',maxOwned:30},
    {name:"Corp",icon:"ðŸ¢",income:2500,baseCost:250000,owned:0,mult:1.14,minigame:null,maxOwned:50},
    {name:"Bank",icon:"ðŸ¦",income:12000,baseCost:2000000,owned:0,mult:1.15,minigame:'safe',maxOwned:30},
    {name:"Casino",icon:"ðŸŽ°",income:60000,baseCost:25000000,owned:0,mult:1.16,minigame:'casino',maxOwned:30}
];

const clickUpgrades=[
    {name:"Gloves",icon:"ðŸ§¤",mult:1.5,baseCost:50,owned:0,costMult:1.4,maxOwned:50},
    {name:"Rings",icon:"ðŸ’",mult:1.5,baseCost:400,owned:0,costMult:1.5,maxOwned:50},
    {name:"Watch",icon:"âŒš",mult:1.8,baseCost:4000,owned:0,costMult:1.6,maxOwned:40},
    {name:"Briefcase",icon:"ðŸ’¼",mult:2,baseCost:40000,owned:0,costMult:1.65,maxOwned:40},
    {name:"Lambo",icon:"ðŸŽï¸",mult:2,baseCost:400000,owned:0,costMult:1.7,maxOwned:30},
    {name:"Yacht",icon:"ðŸ›¥ï¸",mult:2.5,baseCost:5000000,owned:0,costMult:1.75,maxOwned:20},
    {name:"Jet",icon:"âœˆï¸",mult:3,baseCost:80000000,owned:0,costMult:1.8,maxOwned:10}
];

const territories=[
    {id:0,name:"Downtown",icon:"ðŸ™ï¸",bonus:"income",val:0.1,cost:30000,level:0,maxLvl:5,upCost:60000},
    {id:1,name:"Docks",icon:"âš“",bonus:"heist",val:0.05,cost:100000,level:0,maxLvl:5,upCost:200000},
    {id:2,name:"Industrial",icon:"ðŸ—ï¸",bonus:"click",val:0.1,cost:350000,level:0,maxLvl:5,upCost:700000},
    {id:3,name:"Suburbs",icon:"ðŸ¡",bonus:"crit",val:0.02,cost:1200000,level:0,maxLvl:5,upCost:2400000},
    {id:4,name:"Hideout",icon:"ðŸšï¸",bonus:"crew",val:1,cost:2500000,level:0,maxLvl:5,upCost:5000000},
    {id:5,name:"Airport",icon:"âœˆï¸",bonus:"luck",val:0.01,cost:5000000,level:0,maxLvl:5,upCost:10000000},
    {id:6,name:"Casino District",icon:"ðŸŽ°",bonus:"all",val:0.03,cost:20000000,level:0,maxLvl:5,upCost:40000000}
];

const heists=[
    {id:0,name:"Corner Store",reward:[150,600],chance:0.9,cd:8,diff:"easy",heat:1},
    {id:1,name:"Jewelry",reward:[1500,6000],chance:0.7,cd:15,diff:"medium",heat:3},
    {id:2,name:"Bank",reward:[15000,60000],chance:0.5,cd:35,diff:"hard",heat:7},
    {id:3,name:"Casino",reward:[150000,600000],chance:0.35,cd:70,diff:"hard",heat:12},
    {id:4,name:"Reserve",reward:[1500000,8000000],chance:0.2,cd:150,diff:"legendary",heat:25}
];
let heistCDs={};

const policeUpgrades=[
    {id:"scanner",name:"Scanner",desc:"-5% heat gain",cost:20000,owned:false,fx:()=>heatShield+=0.05},
    {id:"safehouse",name:"Safehouse",desc:"+1 heat decay/sec",cost:80000,owned:false,fx:()=>heatDecay+=1},
    {id:"insider",name:"Insider",desc:"-10% heat gain",cost:400000,owned:false,fx:()=>heatShield+=0.1},
    {id:"judge",name:"Judge",desc:"-15% heat gain",cost:1500000,owned:false,fx:()=>heatShield+=0.15},
    {id:"chief",name:"Chief",desc:"+3 heat decay/sec",cost:8000000,owned:false,fx:()=>heatDecay+=3}
];

const specialUpgrades=[
    {id:"luck1",name:"Lucky Charm",desc:"+2% luck",cost:50000,owned:false,fx:()=>luckChance+=0.02},
    {id:"crit1",name:"Sharp Eye",desc:"+3% crit",cost:100000,owned:false,fx:()=>critChance+=0.03},
    {id:"crit2",name:"Crit Master",desc:"+1x crit mult",cost:500000,owned:false,fx:()=>critMult+=1},
    {id:"luck2",name:"Gambler",desc:"+3% luck",cost:1000000,owned:false,fx:()=>luckChance+=0.03},
    {id:"crit3",name:"Devastation",desc:"+5% crit +2x",cost:5000000,owned:false,fx:()=>{critChance+=0.05;critMult+=2}},
    {id:"luck3",name:"Fortune",desc:"+5% luck",cost:10000000,owned:false,fx:()=>luckChance+=0.05}
];

const storageTypes=[
    {name:"Mattress",icon:"ðŸ›ï¸",cost:8000,cap:80000},
    {name:"Safe",icon:"ðŸ”",cost:80000,cap:800000},
    {name:"Vault",icon:"ðŸ¦",cost:800000,cap:15000000},
    {name:"Offshore",icon:"ðŸï¸",cost:8000000,cap:300000000}
];

const crewNames=["Shadow","Ghost","Viper","Raven","Wolf","Phantom","Ace","Blaze","Cipher","Duke","Echo","Frost"];
const crewRanks=["Rookie","Skilled","Pro","Elite","Master"];
const crewRankColors=["#6b7280","#22c55e","#3b82f6","#a855f7","#fbbf24"];
const crewTypes=[
    {id:"enforcer",name:"Enforcer",icon:"ðŸ’ª",color:"#ef4444",bonus:"heist",desc:"+heist success"},
    {id:"hacker",name:"Hacker",icon:"ðŸ’»",color:"#3b82f6",bonus:"income",desc:"+passive income"},
    {id:"driver",name:"Driver",icon:"ðŸš—",color:"#f59e0b",bonus:"heat",desc:"-heat generation"},
    {id:"smuggler",name:"Smuggler",icon:"ðŸ“¦",color:"#8b5cf6",bonus:"luck",desc:"+luck chance"},
    {id:"insider",name:"Insider",icon:"ðŸŽ­",color:"#ec4899",bonus:"cost",desc:"-training cost"}
];

const businessArt={
    Lemonade:'assets/biz_lemonade.png',
    'Food Cart':'assets/biz_food_cart.png',
    Shop:'assets/biz_shop.png',
    Restaurant:'assets/biz_restaurant.png',
    Factory:'assets/biz_factory.png',
    Corp:'assets/biz_corp.png',
    Bank:'assets/biz_bank.png',
    Casino:'assets/biz_casino.png'
};
const clickArt={
    Gloves:'assets/click_gloves.png',
    Rings:'assets/click_rings.png',
    Watch:'assets/click_watch.png',
    Briefcase:'assets/click_briefcase.png',
    Lambo:'assets/click_lambo.png',
    Yacht:'assets/click_yacht.png',
    Jet:'assets/click_jet.png'
};
const storageArt={
    Mattress:'assets/storage_mattress.png',
    Safe:'assets/storage_safe.png',
    Vault:'assets/storage_vault.png',
    Offshore:'assets/storage_offshore.png'
};
const crewArt={
    enforcer:'assets/crew_enforcer.png',
    hacker:'assets/crew_hacker.png',
    driver:'assets/crew_driver.png',
    smuggler:'assets/crew_smuggler.png',
    insider:'assets/crew_insider.png'
};
const crewPortraits={
    Shadow:'assets/crew_shadow.png',
    Ghost:'assets/crew_ghost.png',
    Viper:'assets/crew_viper.png',
    Raven:'assets/crew_raven.png',
    Wolf:'assets/crew_wolf.png',
    Phantom:'assets/crew_phantom.png',
    Ace:'assets/crew_ace.png',
    Blaze:'assets/crew_blaze.png',
    Cipher:'assets/crew_cipher.png',
    Duke:'assets/crew_duke.png',
    Echo:'assets/crew_echo.png',
    Frost:'assets/crew_frost.png'
};
const casinoArt={
    slots:'assets/casino_slots.png',
    dice:'assets/casino_dice.png',
    roulette:'assets/casino_roulette.png',
    classic:'assets/mode_classic.png',
    mega:'assets/mode_mega.png'
};
const businessBgArt={
    Lemonade:'assets/bg_biz_lemonade.png',
    'Food Cart':'assets/bg_biz_food_cart.png',
    Shop:'assets/bg_biz_shop.png',
    Restaurant:'assets/bg_biz_restaurant.png',
    Factory:'assets/bg_biz_factory.png',
    Corp:'assets/bg_biz_corp.png',
    Bank:'assets/bg_biz_bank.png',
    Casino:'assets/bg_biz_casino.png'
};
const clickBgArt={
    Gloves:'assets/bg_click_gloves.png',
    Rings:'assets/bg_click_rings.png',
    Watch:'assets/bg_click_watch.png',
    Briefcase:'assets/bg_click_briefcase.png',
    Lambo:'assets/bg_click_lambo.png',
    Yacht:'assets/bg_click_yacht.png',
    Jet:'assets/bg_click_jet.png'
};
const storageBgArt={
    Mattress:'assets/bg_storage_mattress.png',
    Safe:'assets/bg_storage_safe.png',
    Vault:'assets/bg_storage_vault.png',
    Offshore:'assets/bg_storage_offshore.png'
};
const specialArt={
    luck1:'assets/special_luck1.png',
    crit1:'assets/special_crit1.png',
    crit2:'assets/special_crit2.png',
    luck2:'assets/special_luck2.png',
    crit3:'assets/special_crit3.png',
    luck3:'assets/special_luck3.png'
};
const specialBgArt={
    luck1:'assets/bg_special_luck1.png',
    crit1:'assets/bg_special_crit1.png',
    crit2:'assets/bg_special_crit2.png',
    luck2:'assets/bg_special_luck2.png',
    crit3:'assets/bg_special_crit3.png',
    luck3:'assets/bg_special_luck3.png'
};
const policeArt={
    scanner:'assets/police_scanner.png',
    safehouse:'assets/police_safehouse.png',
    insider:'assets/police_insider.png',
    judge:'assets/police_judge.png',
    chief:'assets/police_chief.png'
};
const policeBgArt={
    scanner:'assets/bg_police_scanner.png',
    safehouse:'assets/bg_police_safehouse.png',
    insider:'assets/bg_police_insider.png',
    judge:'assets/bg_police_judge.png',
    chief:'assets/bg_police_chief.png'
};
const heistArt={
    'Corner Store':'assets/heist_corner_store.png',
    Jewelry:'assets/heist_jewelry.png',
    Bank:'assets/heist_bank.png',
    Casino:'assets/heist_casino.png',
    Reserve:'assets/heist_reserve.png'
};
const heistBgArt={
    'Corner Store':'assets/bg_heist_corner_store.png',
    Jewelry:'assets/bg_heist_jewelry.png',
    Bank:'assets/bg_heist_bank.png',
    Casino:'assets/bg_heist_casino.png',
    Reserve:'assets/bg_heist_reserve.png'
};

bizUpgrades.forEach(u=>{u.asset=businessArt[u.name]||null;});
clickUpgrades.forEach(u=>{u.asset=clickArt[u.name]||null;});
storageTypes.forEach(u=>{u.asset=storageArt[u.name]||null;u.bgAsset=storageBgArt[u.name]||null;});
crewTypes.forEach(u=>{u.asset=crewArt[u.id]||null;});
bizUpgrades.forEach(u=>{u.bgAsset=businessBgArt[u.name]||null;});
clickUpgrades.forEach(u=>{u.bgAsset=clickBgArt[u.name]||null;});
specialUpgrades.forEach(u=>{u.asset=specialArt[u.id]||null;u.bgAsset=specialBgArt[u.id]||null;});
policeUpgrades.forEach(u=>{u.asset=policeArt[u.id]||null;u.bgAsset=policeBgArt[u.id]||null;});
heists.forEach(u=>{u.asset=heistArt[u.name]||null;u.bgAsset=heistBgArt[u.name]||null;});

const achievements=[
    {id:'first_click',name:'First Steps',desc:'Click for the first time',check:()=>totalClicks>=1},
    {id:'clicks_100',name:'Clicker',desc:'Click 100 times',check:()=>totalClicks>=100},
    {id:'clicks_1000',name:'Click Master',desc:'Click 1,000 times',check:()=>totalClicks>=1000},
    {id:'earn_1k',name:'Pocket Change',desc:'Earn $1,000 total',check:()=>totalEarned>=1000},
    {id:'earn_1m',name:'Millionaire',desc:'Earn $1,000,000 total',check:()=>totalEarned>=1e6},
    {id:'earn_1b',name:'Billionaire',desc:'Earn $1,000,000,000 total',check:()=>totalEarned>=1e9},
    {id:'first_offline',name:'Passive Income',desc:'Earn money while offline',check:()=>totalOfflineEarnings>=1},
    {id:'first_heist',name:'First Job',desc:'Complete your first heist',check:()=>totalHeists>=1},
    {id:'heist_10',name:'Career Criminal',desc:'Complete 10 heists',check:()=>totalHeists>=10},
    {id:'first_crew',name:'Gang Leader',desc:'Hire your first crew member',check:()=>thieves.length>=1},
    {id:'full_crew',name:'Crime Family',desc:'Hire maximum crew',check:()=>thieves.length>=maxThieves},
    {id:'first_turf',name:'Turf War',desc:'Capture your first territory',check:()=>ownedTerritories.length>=1},
    {id:'all_turf',name:'Kingpin',desc:'Own all territories',check:()=>ownedTerritories.length>=territories.length},
    {id:'rank_max',name:'Legend',desc:'Reach maximum rank',check:()=>getRank()>=6},
    {id:'first_prestige',name:'Retirement',desc:'Prestige for the first time',check:()=>prestigeLevel>=1},
];

const prestigeUpgradesData=[
    {id:'income1',name:'Income Boost I',desc:'+10% all income',cost:1,owned:0,maxOwned:5,bonus:{type:'income',val:0.1}},
    {id:'income2',name:'Income Boost II',desc:'+25% all income',cost:3,owned:0,maxOwned:3,bonus:{type:'income',val:0.25}},
    {id:'click1',name:'Click Power I',desc:'+15% click power',cost:1,owned:0,maxOwned:5,bonus:{type:'click',val:0.15}},
    {id:'click2',name:'Click Power II',desc:'+30% click power',cost:3,owned:0,maxOwned:3,bonus:{type:'click',val:0.3}},
    {id:'offline1',name:'Offline Earnings I',desc:'+20% offline rate',cost:2,owned:0,maxOwned:3,bonus:{type:'offline',val:0.2}},
    {id:'offline2',name:'Offline Earnings II',desc:'+ 2hrs offline cap',cost:4,owned:0,maxOwned:2,bonus:{type:'offlineCap',val:2*3600}},
    {id:'heist1',name:'Heist Master',desc:'+20% heist success',cost:2,owned:0,maxOwned:4,bonus:{type:'heist',val:0.2}},
    {id:'crew1',name:'Crew Capacity',desc:'+2 max crew',cost:3,owned:0,maxOwned:3,bonus:{type:'crewCap',val:2}},
    {id:'start1',name:'Head Start',desc:'Start with $10K',cost:2,owned:0,maxOwned:1,bonus:{type:'startMoney',val:10000}},
    {id:'start2',name:'Quick Start',desc:'Start at rank 2',cost:5,owned:0,maxOwned:1,bonus:{type:'startRank',val:2}},
];

const crewMissions=[
    {id:'pickpocket',name:'Quick Pickpocket',icon:'ðŸ‘',duration:300,baseReward:500,rep:10,skillReq:'skill',desc:'Small quick cash'},
    {id:'carboost',name:'Car Boost',icon:'ðŸš—',duration:900,baseReward:2000,rep:25,skillReq:'exp',desc:'Steal a car'},
    {id:'scout',name:'Building Scout',icon:'ðŸ”',duration:1800,effect:'heistCD',effectVal:60,skillReq:'loyalty',desc:'Reduce heist cooldowns'},
    {id:'weapons',name:'Weapons Deal',icon:'ðŸ’£',duration:3600,baseReward:15000,rep:100,skillReq:'skill',desc:'Sell contraband'},
    {id:'recruit',name:'Recruit Search',icon:'ðŸ”Ž',duration:7200,effect:'crewSlot',skillReq:'loyalty',desc:'Find new crew member'},
    {id:'training',name:'Training Camp',icon:'ðŸ¥‹',duration:14400,effect:'skillUp',skillReq:'exp',desc:'Gain random skill level'},
    {id:'sabotage',name:'Sabotage',icon:'ðŸ’¥',duration:5400,effect:'heat',effectVal:-20,skillReq:'skill',desc:'Reduce police heat'},
    {id:'intel',name:'Intel Gathering',icon:'ðŸ“‹',duration:10800,baseReward:50000,rep:200,skillReq:'exp',desc:'Big payout'},
];

const randomEvents=[
    {id:'lucky_break',name:'Lucky Break',icon:'ðŸ’°',desc:'Found a cash stash!',weight:10,minRank:0,
        trigger:()=>{
            const amount=Math.floor((money*0.15+moneyPerSecond*10)*Math.random());
            money+=amount;lifetimeEarnings+=amount;
            return {msg:`+${fmt(amount)}!`,color:'#22c55e'};
        }},
    {id:'informant_tip',name:'Informant Tip',icon:'ðŸ•µï¸',desc:'Got insider info on security',weight:8,minRank:2,
        trigger:()=>{
            Object.keys(heistCDs).forEach(k=>heistCDs[k]=Math.max(Date.now(),heistCDs[k]-120000));
            return {msg:'Heist cooldowns -2 minutes',color:'#3b82f6'};
        }},
    {id:'police_raid',name:'Police Raid',icon:'ðŸš”',desc:'Surprise inspection!',weight:6,minRank:1,
        trigger:()=>{
            const stored=getStored();
            const lossPercent=stored>money*0.5?0.05:0.15;
            const loss=Math.floor(money*lossPercent);
            money=Math.max(0,money-loss);
            policeHeat=Math.min(100,policeHeat+15);
            return {msg:`-${fmt(loss)} (storage saved you!)`,color:'#ef4444'};
        }},
    {id:'crew_betrayal',name:'Crew Betrayal',icon:'ðŸ¥·',desc:'Crew member stole from you',weight:5,minRank:1,
        trigger:()=>{
            if(thieves.length===0)return {msg:'No crew to betray you',color:'#94a3b8'};
            const loss=Math.floor(money*0.08);
            money=Math.max(0,money-loss);
            return {msg:`-${fmt(loss)} stolen!`,color:'#ef4444'};
        }},
    {id:'black_market',name:'Black Market Sale',icon:'ðŸª',desc:'Limited time discount!',weight:7,minRank:0,
        trigger:()=>{
            activeEffects.discount={ends:Date.now()+30000,val:0.5};
            return {msg:'50% off next purchase (30s)',color:'#a855f7'};
        }},
    {id:'rival_gang',name:'Rival Gang',icon:'âš”ï¸',desc:'Enemies demand protection money',weight:6,minRank:4,
        trigger:()=>{
            const amount=Math.floor(moneyPerSecond*30);
            if(money>=amount){
                money-=amount;
                return {msg:`-${fmt(amount)} protection paid`,color:'#f59e0b'};
            }else{
                activeEffects.territoryLock={ends:Date.now()+60000};
                return {msg:'Territories disabled (1min)',color:'#ef4444'};
            }
        }},
    {id:'street_race',name:'Street Race',icon:'ðŸŽï¸',desc:'Risk it for triple reward',weight:5,minRank:0,
        trigger:()=>{
            activeEffects.raceOffer={amount:Math.floor(money*0.1+moneyPerSecond*20)};
            return {msg:'Accept race challenge?',color:'#f59e0b',hasChoice:true};
        }},
    {id:'vip_client',name:'VIP Client',icon:'ðŸ’Ž',desc:'High roller wants service',weight:7,minRank:2,
        trigger:()=>{
            activeEffects.incomeBoost={ends:Date.now()+60000,val:1};
            return {msg:'2x passive income (1min)',color:'#22c55e'};
        }},
    {id:'heat_wave',name:'Heat Wave',icon:'ðŸ”¥',desc:'Police distracted by riots',weight:6,minRank:2,
        trigger:()=>{
            activeEffects.fastHeists={ends:Date.now()+120000};
            Object.keys(heistCDs).forEach(k=>heistCDs[k]=Math.max(Date.now(),heistCDs[k]-60000));
            return {msg:'Heists cool down faster (2min)',color:'#f59e0b'};
        }},
    {id:'boom',name:'Economic Boom',icon:'ðŸ“ˆ',desc:'Market surge!',weight:8,minRank:0,
        trigger:()=>{
            activeEffects.clickBoost={ends:Date.now()+30000,val:1};
            return {msg:'2x click power (30s)',color:'#4ade80'};
        }},
];

// === AUDIO + HAPTICS ===
// --- Web-Haptics (web-haptics@0.0.6) ---
let _haptics = null;
(async () => {
    try {
        const mod = await import('https://cdn.jsdelivr.net/npm/web-haptics@0.0.6/dist/index.mjs');
        _haptics = new mod.WebHaptics({ debug: false });
    } catch(e) { /* no haptics available */ }
})();

function vib(p) {
    if (!settings.vibration) return;
    if (_haptics) {
        try {
            const pattern = Array.isArray(p)
                ? p.map((d,i) => ({ duration: d, intensity: i%2===0 ? 0.8 : 0, delay: 0 }))
                : [{ duration: p, intensity: 0.7 }];
            _haptics.trigger({ pattern });
        } catch(e) {}
    } else if (navigator.vibrate) {
        navigator.vibrate(p);
    }
}

// --- Tone.js SFX engine ---
let _Tone = null;
let _toneReady = false;
let _sfx = null;
let _toneUnlocked = false;

import('https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js').then(mod => {
    _Tone = mod.default ?? mod.Tone ?? window.Tone;
    if (!_Tone && window.Tone) _Tone = window.Tone;
    _toneReady = !!_Tone;
}).catch(() => { _toneReady = false; });

async function _unlockTone() {
    if (_toneUnlocked || !_toneReady || !_Tone) return;
    try {
        await _Tone.start();
        _toneUnlocked = true;
        _initSFX();
        MUSIC.start(getRank());
    } catch(e) {}
}

function _initSFX() {
    if (_sfx || !_toneReady || !_Tone) return;
    try {
        const vol = new _Tone.Volume(-4).toDestination();
        const lim = new _Tone.Limiter(-3).connect(vol);
        const revShort = new _Tone.Reverb({ decay: 0.3, wet: 0.18 }).connect(lim);
        const revMed   = new _Tone.Reverb({ decay: 0.9, wet: 0.28 }).connect(lim);

        // click â€” coin tap
        const tap = new _Tone.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.03 },
            volume: -12,
        }).connect(revShort);

        // crit â€” punchy square blip
        const crit = new _Tone.Synth({
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
            volume: -8,
        }).connect(revShort);

        // buy â€” rising chime arpeggio
        const buy = new _Tone.PolySynth(_Tone.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.05, release: 0.3 },
            volume: -10,
        }).connect(revMed);

        // heist success â€” punchy fanfare
        const win = new _Tone.PolySynth(_Tone.Synth, {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.02, decay: 0.18, sustain: 0.3, release: 0.5 },
            volume: -9,
        }).connect(new _Tone.Filter(2000, 'lowpass').connect(revMed));

        // raid â€” low sawtooth alarm
        const alarm = new _Tone.Synth({
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.4 },
            volume: -10,
        }).connect(lim);

        // rank-up â€” shimmery bell
        const rank = new _Tone.MetalSynth({
            frequency: 600, envelope: { attack: 0.01, decay: 0.5, release: 0.5 },
            harmonicity: 3.1, modulationIndex: 16, resonance: 3200, octaves: 1.2,
            volume: -12,
        }).connect(revMed);

        // frenzy â€” pulsing hype blip
        const frenzy = new _Tone.Synth({
            oscillator: { type: 'pulse', width: 0.5 },
            envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.02 },
            volume: -10,
        }).connect(revShort);

        // contract complete â€” clean bell pair
        const contract = new _Tone.PolySynth(_Tone.Synth, {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 0.6 },
            volume: -8,
        }).connect(revMed);

        _sfx = { tap, crit, buy, win, alarm, rank, frenzy, contract, lim };
    } catch(e) { console.warn('CE initSFX failed', e); }
}

const SFX = {
    tap()     { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); _sfx.tap.triggerAttackRelease(600+Math.random()*100,'32n',T); },
    crit()    { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); _sfx.crit.triggerAttackRelease(900,'16n',T); setTimeout(()=>{ if(_sfx)_sfx.crit.triggerAttackRelease(1200,'32n'); },80); },
    buy()     { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); ['C4','E4','G4'].forEach((n,i)=>_sfx.buy.triggerAttackRelease(n,'16n',T+i*0.07)); },
    win()     { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); ['C4','E4','G4','C5'].forEach((n,i)=>_sfx.win.triggerAttackRelease(n,'8n',T+i*0.09)); },
    alarm()   { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); _sfx.alarm.triggerAttackRelease(220,'8n',T); setTimeout(()=>{ if(_sfx)_sfx.alarm.triggerAttackRelease(196,'8n'); },220); },
    rankUp()  { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; _sfx.rank.triggerAttackRelease('16n'); },
    frenzy()  { if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); _sfx.frenzy.triggerAttackRelease(800,'64n',T); },
    contract(){ if(!_toneReady||!_Tone||!settings.sound||!_sfx)return; const T=_Tone.now(); _sfx.contract.triggerAttackRelease(['E5','G5'],'8n',T); setTimeout(()=>{ if(_sfx)_sfx.contract.triggerAttackRelease('C6','4n'); },200); },
};

// Legacy shim so existing callsites still work
function playSound(freq=440, duration=50, type='sine', volume=0.1) {
    if (!settings.sound) return;
    _unlockTone();
    if (freq >= 800) SFX.crit();
    else if (freq >= 650) SFX.buy();
    else if (freq < 400) SFX.alarm();
    else SFX.tap();
}

// ================================================================
//  MUSIC ENGINE â€” Criminal Empire
//  3 tracks, evolve with rank:
//    street  â€” rank 0-1: lo-fi street corner hip-hop (lazy boom-bap, dusty vinyl)
//    boss    â€” rank 2-4: dark trap with cinematic brass stabs
//    legend  â€” rank 5-6: tense crime jazz (Miles Davis meets Morricone)
// ================================================================
let _musicParts = [];
let _musicStarted = false;
let _currentTrackId = null;
let _musicVol = null;

function _getMusicChain() {
    if (!_toneReady || !_Tone) return null;
    if (!_musicVol) {
        _musicVol = new _Tone.Volume(-8).toDestination();
    }
    return _musicVol;
}

const MUSIC_TRACKS = {

    // â”€â”€ STREET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Lo-fi boom-bap. Lazy swing, dusty snare, warm bass, muted piano chops.
    // Key: C minor, 82 bpm
    street(fx) {
        const T = _Tone;
        const reverb  = new T.Reverb({ decay: 2.5, wet: 0.35 }).connect(fx);
        const warmLP   = new T.Filter(1800, 'lowpass').connect(reverb);
        const tapeWarm = new T.Filter(200, 'highpass').connect(warmLP);

        // Muted piano chops â€” short triangle with low-pass warmth
        const piano = new T.PolySynth(T.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.25 },
            volume: -14,
        }).connect(tapeWarm);

        // Deep sub bass â€” sine, lazy groove
        const bass = new T.MonoSynth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.4 },
            filter: { frequency: 280, type: 'lowpass' },
            volume: -8,
        }).connect(tapeWarm);

        // Boom kick â€” punchy, low
        const kick = new T.MembraneSynth({
            pitchDecay: 0.07, octaves: 7,
            envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.15 },
            volume: -10,
        }).connect(fx);

        // Dusty snare â€” pink noise, heavy lowpass for that muffled vinyl feel
        const snare = new T.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.06 },
            volume: -18,
        }).connect(new T.Filter(3500, 'lowpass').connect(reverb));

        // Closed hi-hat shuffle â€” vinyl crackle texture
        const hat = new T.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
            volume: -26,
        }).connect(new T.Filter(8000, 'highpass').connect(fx));

        T.Transport.bpm.value = 82;

        // Lazy swing bass â€” Cm groove
        const bassNotes = ['C2',null,'G2',null,'C2',null,'Eb2','G2',
                           'Ab2',null,'F2',null,'G2',null,'C2',null];
        const bassPart = new T.Sequence((t,n) => { if(n) bass.triggerAttackRelease(n,'8n',t); }, bassNotes, '8n');

        // Piano chops â€” soulful Cm7 / Ab / Eb / G7
        const pianoPart = new T.Part((t,v) => piano.triggerAttackRelease(v.n, v.d, t), [
            {time:'0:0',   n:['C4','Eb4','G4','Bb4'],  d:'8n'},
            {time:'0:1.5', n:['C4','Eb4','G4'],         d:'16n'},
            {time:'0:2',   n:['Ab3','C4','Eb4'],        d:'8n'},
            {time:'0:3',   n:['Ab3','Eb4'],             d:'16n'},
            {time:'1:0',   n:['Eb4','G4','Bb4'],        d:'8n'},
            {time:'1:1.5', n:['Eb4','G4'],              d:'16n'},
            {time:'1:2',   n:['G3','B3','D4','F4'],     d:'8n'},
            {time:'1:3',   n:['G3','F4'],               d:'16n'},
        ]);
        pianoPart.loop = true; pianoPart.loopEnd = '2m';

        // Boom-bap kick â€” beat 1 & 3 with swing
        const kickPart = new T.Sequence((t,v) => { if(v) kick.triggerAttackRelease('C1','8n',t); },
            [1,null,null,null,1,null,null,null], '4n');

        // Snare on 2 & 4
        const snarePart = new T.Sequence((t,v) => { if(v) snare.triggerAttackRelease('8n',t); },
            [null,null,1,null,null,null,1,null], '4n');

        // Swing hi-hat with ghost notes
        const hatPat = [1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1];
        const hatPart = new T.Sequence((t,v) => { if(v) hat.triggerAttackRelease('16n',t); }, hatPat, '8n');

        [bassPart, pianoPart, kickPart, snarePart, hatPart].forEach(p => p.start(0));
        return [piano,bass,kick,snare,hat,bassPart,pianoPart,kickPart,snarePart,hatPart,reverb,warmLP,tapeWarm];
    },

    // â”€â”€ BOSS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Dark trap. Slow hi-hats, 808 sub, menacing brass stabs, cinematic tension.
    // Key: D minor, 140 bpm (trap half-time feel = 70 bpm groove)
    boss(fx) {
        const T = _Tone;
        const reverb   = new T.Reverb({ decay: 3.0, wet: 0.4 }).connect(fx);
        const delay    = new T.FeedbackDelay('8n.', 0.25).connect(reverb);
        const brassLP  = new T.Filter(1400, 'lowpass').connect(reverb);

        // 808 sub â€” deep sine, long decay
        const sub808 = new T.MonoSynth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.01, decay: 0.8, sustain: 0.5, release: 1.2 },
            filter: { frequency: 200, type: 'lowpass' },
            volume: -6,
        }).connect(fx);

        // Trap hi-hat â€” rolling 16ths with accent variation
        const hat = new T.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.01 },
            volume: -22,
        }).connect(new T.Filter(9000, 'highpass').connect(fx));

        // Open hi-hat accent
        const openHat = new T.NoiseSynth({
            noise: { type: 'white' },
            envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.1 },
            volume: -26,
        }).connect(new T.Filter(7000, 'highpass').connect(reverb));

        // Kick â€” heavy membrane
        const kick = new T.MembraneSynth({
            pitchDecay: 0.06, octaves: 8,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.2 },
            volume: -9,
        }).connect(fx);

        // Brass stab â€” sawtooth through lowpass, short attack, punchy
        const brass = new T.PolySynth(T.Synth, {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.03, decay: 0.2, sustain: 0.3, release: 0.5 },
            volume: -13,
        }).connect(brassLP);

        // Dark pad â€” slow swell, ominous
        const pad = new T.PolySynth(T.Synth, {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.8, decay: 1.0, sustain: 0.7, release: 2.0 },
            volume: -20,
        }).connect(new T.Filter(900, 'lowpass').connect(reverb));

        // Pluck arpeggio â€” tense ascending Dm line through delay
        const pluck = new T.Synth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.001, decay: 0.22, sustain: 0.05, release: 0.3 },
            volume: -16,
        }).connect(delay);

        T.Transport.bpm.value = 140; // trap = 16th-note rolls at 140

        // 808 bass pattern â€” Dm groove, half-time feel
        const subNotes = ['D2',null,null,null,'A2',null,null,null,
                          'G2',null,null,null,'A2',null,'F2',null];
        const subPart = new T.Sequence((t,n) => { if(n) sub808.triggerAttackRelease(n,'4n',t); }, subNotes, '8n');

        // Kick on 1 and 3 (half-time)
        const kickPart = new T.Sequence((t,v) => { if(v) kick.triggerAttackRelease('C1','16n',t); },
            [1,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null], '16n');

        // Trap hi-hat rolls â€” classic 16th trap pattern with rests
        const hatPat = [1,1,0,1,1,0,1,0,1,1,0,1,0,1,1,0];
        const hatPart = new T.Sequence((t,v) => { if(v) hat.triggerAttackRelease('32n',t); }, hatPat, '16n');

        // Open hat on beat 2 & 4
        const openPart = new T.Sequence((t,v) => { if(v) openHat.triggerAttackRelease('16n',t); },
            [null,null,null,null,1,null,null,null,null,null,null,null,1,null,null,null], '16n');

        // Brass stabs â€” syncopated, menacing
        const brassPart = new T.Part((t,v) => brass.triggerAttackRelease(v.n, v.d, t), [
            {time:'0:0',   n:['D3','F3','A3'],   d:'16n'},
            {time:'0:2.5', n:['D3','F3'],        d:'32n'},
            {time:'1:0',   n:['C3','Eb3','G3'],  d:'16n'},
            {time:'1:1.5', n:['A3','C4'],        d:'32n'},
            {time:'2:0',   n:['Bb2','D3','F3'],  d:'16n'},
            {time:'2:2',   n:['A2','C3','E3'],   d:'16n'},
            {time:'3:0',   n:['D3','F3','A3'],   d:'8n'},
        ]);
        brassPart.loop = true; brassPart.loopEnd = '4m';

        // Slow pad swell â€” Dm / Bb / F / A
        const padPart = new T.Part((t,v) => pad.triggerAttackRelease(v.n, '1n', t), [
            {time:'0:0', n:['D3','F3','A3']},
            {time:'2:0', n:['Bb2','D3','F3']},
            {time:'4:0', n:['F3','A3','C4']},
            {time:'6:0', n:['A2','C#3','E3']},
        ]);
        padPart.loop = true; padPart.loopEnd = '8m';

        // Tense pluck arpeggio â€” ascending Dm
        const pluckNotes = ['D4','F4','A4','D5','A4','F4','D4','C4',
                            'Bb3','D4','F4','Bb4','F4','D4','C4','A3'];
        const pluckPart = new T.Sequence((t,n) => pluck.triggerAttackRelease(n,'16n',t), pluckNotes, '8n');

        [subPart,kickPart,hatPart,openPart,brassPart,padPart,pluckPart].forEach(p => p.start(0));
        return [sub808,hat,openHat,kick,brass,pad,pluck,subPart,kickPart,hatPart,openPart,brassPart,padPart,pluckPart,reverb,delay,brassLP];
    },

    // â”€â”€ LEGEND â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Cinematic crime jazz. Tense, sophisticated â€” think Heat, Sicario, Godfather.
    // Walking bass, muted trumpet melody, brush drums, strings swell.
    // Key: C minor jazz, 96 bpm
    legend(fx) {
        const T = _Tone;
        const reverb   = new T.Reverb({ decay: 3.5, wet: 0.45 }).connect(fx);
        const chorus   = new T.Chorus(2, 3, 0.3).connect(reverb).start();
        const delay    = new T.FeedbackDelay('4n.', 0.22).connect(reverb);
        const stringsLP = new T.Filter(2200, 'lowpass').connect(reverb);

        // Walking bass â€” acoustic upright feel (triangle + warmth)
        const walkBass = new T.MonoSynth({
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.02, decay: 0.25, sustain: 0.5, release: 0.35 },
            filter: { frequency: 600, type: 'lowpass' },
            volume: -7,
        }).connect(reverb);

        // Muted trumpet lead â€” sawtooth through bandpass + chorus
        const trumpet = new T.Synth({
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.4 },
            volume: -14,
        }).connect(new T.Filter({frequency: 2800, type: 'bandpass', Q: 1.5}).connect(chorus));

        // Strings â€” slow swell, ominous pad
        const strings = new T.PolySynth(T.Synth, {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.5, decay: 0.8, sustain: 0.8, release: 2.0 },
            volume: -18,
        }).connect(stringsLP);

        // Piano comp â€” sparse, jazzy voicings
        const piano = new T.PolySynth(T.Synth, {
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.008, decay: 0.3, sustain: 0.1, release: 0.6 },
            volume: -15,
        }).connect(reverb);

        // Brush snare â€” soft pink noise, very low volume
        const brushSnare = new T.NoiseSynth({
            noise: { type: 'pink' },
            envelope: { attack: 0.003, decay: 0.09, sustain: 0, release: 0.04 },
            volume: -23,
        }).connect(new T.Filter(4000, 'lowpass').connect(reverb));

        // Ride cymbal â€” metallic, airy
        const ride = new T.MetalSynth({
            frequency: 480,
            envelope: { attack: 0.001, decay: 0.35, release: 0.2 },
            harmonicity: 5.1, modulationIndex: 24,
            resonance: 4200, octaves: 0.5,
            volume: -26,
        }).connect(reverb);

        // Kick â€” soft jazz kick
        const kick = new T.MembraneSynth({
            pitchDecay: 0.04, octaves: 5,
            envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.12 },
            volume: -14,
        }).connect(fx);

        T.Transport.bpm.value = 96;

        // Walking bass â€” Cm jazz changes: Cm7 / Fm7 / Bb7 / Eb / Ab / G7 / Cm
        const walkNotes = [
            'C2','Eb2','G2','Bb2',  'F2','Ab2','C3','Eb3',
            'Bb2','D3','F3','Ab3',  'Eb2','G2','Bb2','Db3',
            'Ab2','C3','Eb3','G3',  'G2','B2','D3','F3',
            'C2','Eb2','G2','Bb2',  'C2','G2','Eb2','C2'
        ];
        const walkPart = new T.Sequence((t,n) => walkBass.triggerAttackRelease(n,'4n',t), walkNotes, '4n');

        // Trumpet melody â€” sparse, haunting phrases over 8 bars
        const trumpetPart = new T.Part((t,v) => trumpet.triggerAttackRelease(v.n, v.d, t), [
            {time:'0:2',   n:'G4',  d:'4n'},
            {time:'0:3',   n:'Eb4', d:'8n'},
            {time:'1:0',   n:'C4',  d:'2n'},
            {time:'1:3',   n:'D4',  d:'8n'},
            {time:'2:0',   n:'Eb4', d:'4n'},
            {time:'2:1',   n:'G4',  d:'8n'},
            {time:'2:2',   n:'Bb4', d:'4n.'},
            {time:'3:1',   n:'Ab4', d:'8n'},
            {time:'3:2',   n:'G4',  d:'4n'},
            {time:'3:3',   n:'F4',  d:'8n'},
            {time:'4:0',   n:'Eb4', d:'2n'},
            {time:'4:2',   n:'D4',  d:'4n'},
            {time:'5:0',   n:'G4',  d:'4n'},
            {time:'5:1',   n:'F4',  d:'8n'},
            {time:'5:2',   n:'Eb4', d:'8n'},
            {time:'5:3',   n:'D4',  d:'8n'},
            {time:'6:0',   n:'C4',  d:'4n.'},
            {time:'6:2.5', n:'G3',  d:'8n'},
            {time:'6:3',   n:'Bb3', d:'8n'},
            {time:'7:0',   n:'C4',  d:'1n'},
        ]);
        trumpetPart.loop = true; trumpetPart.loopEnd = '8m';

        // String swells â€” slow, tense chords
        const stringPart = new T.Part((t,v) => strings.triggerAttackRelease(v.n, '1n', t), [
            {time:'0:0', n:['C3','Eb3','G3','Bb3']},
            {time:'2:0', n:['F3','Ab3','C4','Eb4']},
            {time:'4:0', n:['Eb3','G3','Bb3','Db4']},
            {time:'6:0', n:['G3','B3','D4','F4']},
        ]);
        stringPart.loop = true; stringPart.loopEnd = '8m';

        // Jazz piano comping â€” sparse, behind the beat
        const pianoPart = new T.Part((t,v) => piano.triggerAttackRelease(v.n, v.d, t), [
            {time:'0:1',   n:['Eb4','G4','Bb4'],     d:'16n'},
            {time:'0:2.5', n:['D4','F4','Ab4'],      d:'16n'},
            {time:'1:1',   n:['C4','Eb4','G4','Bb4'],d:'16n'},
            {time:'2:0.5', n:['F4','Ab4','C5'],      d:'16n'},
            {time:'2:2',   n:['Eb4','G4','Bb4'],     d:'8n'},
            {time:'3:1',   n:['G4','B4','D5','F5'],  d:'16n'},
            {time:'3:3',   n:['G4','Bb4','D5'],      d:'16n'},
            {time:'4:1',   n:['C4','Eb4','G4'],      d:'8n'},
            {time:'5:0.5', n:['Ab3','C4','Eb4','G4'],d:'16n'},
            {time:'6:2',   n:['G3','B3','D4','F4'],  d:'8n'},
            {time:'7:1',   n:['C4','Eb4','G4','Bb4'],d:'4n'},
        ]);
        pianoPart.loop = true; pianoPart.loopEnd = '8m';

        // Brush snare â€” steady 2 & 4
        const brushPart = new T.Sequence((t,v) => { if(v) brushSnare.triggerAttackRelease('8n',t); },
            [null,null,1,null,null,null,1,null], '4n');

        // Ride cymbal â€” jazz swing 8ths
        const ridePat = [1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,0];
        const ridePart = new T.Sequence((t,v) => { if(v) ride.triggerAttackRelease('16n',t); }, ridePat, '8n');

        // Soft kick â€” beat 1 and light syncopation
        const kickPart = new T.Sequence((t,v) => { if(v) kick.triggerAttackRelease('C1','8n',t); },
            [1,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null], '8n');

        [walkPart,trumpetPart,stringPart,pianoPart,brushPart,ridePart,kickPart].forEach(p => p.start(0));
        return [walkBass,trumpet,strings,piano,brushSnare,ride,kick,
                walkPart,trumpetPart,stringPart,pianoPart,brushPart,ridePart,kickPart,
                reverb,chorus,delay,stringsLP];
    },
};

// Which track plays at each rank
function _trackForRank(rank) {
    if (rank >= 5) return 'legend';
    if (rank >= 2) return 'boss';
    return 'street';
}

const MUSIC = {
    _launch(trackId) {
        if (!_toneReady || !_Tone || !settings.music) return;
        const fx = _getMusicChain();
        if (!fx) return;
        _musicStarted = true;
        _currentTrackId = trackId;
        try {
            const builder = MUSIC_TRACKS[trackId];
            _musicParts = builder(fx);
            if (_Tone.Transport.state !== 'started') _Tone.Transport.start();
        } catch(e) { console.warn('MUSIC launch failed', e); _musicStarted = false; }
    },

    _stopParts() {
        _musicParts.forEach(p => { try { p.stop?.(); p.dispose?.(); } catch(e){} });
        _musicParts = [];
        _musicStarted = false;
        _currentTrackId = null;
    },

    start(rank) {
        if (!_toneReady || !_Tone || !settings.music) return;
        const trackId = _trackForRank(rank || 0);
        if (_musicStarted && _currentTrackId === trackId) return;
        this._stopParts();
        this._launch(trackId);
    },

    switchToRank(rank) {
        if (!_toneReady || !_Tone) return;
        const trackId = _trackForRank(rank);
        if (_currentTrackId === trackId) return;
        // Fade out, swap
        this.setVolume(-50);
        setTimeout(() => {
            this._stopParts();
            this.setVolume(-8);
            if (settings.music) this._launch(trackId);
        }, 600);
    },

    pause() {
        if (!_toneReady || !_Tone) return;
        try { _Tone.Transport.pause(); } catch(e) {}
    },

    resume() {
        if (!_toneReady || !_Tone || !settings.music) return;
        try {
            if (_Tone.Transport.state === 'paused') { _Tone.Transport.start(); }
            else if (!_musicStarted) { this.start(getRank()); }
        } catch(e) {}
    },

    setVolume(db) {
        if (_musicVol) _musicVol.volume.rampTo(db, 0.4);
    },

    duck()    { this.setVolume(-22); setTimeout(() => this.setVolume(-8), 2800); },
};
function fmt(n){
    if(!isFinite(n)||n<0)return'$0';
    if(n>=1e18)return'$'+(n/1e18).toFixed(2)+'Qi';
    if(n>=1e15)return'$'+(n/1e15).toFixed(2)+'Qa';
    if(n>=1e12)return'$'+(n/1e12).toFixed(2)+'T';
    if(n>=1e9)return'$'+(n/1e9).toFixed(2)+'B';
    if(n>=1e6)return'$'+(n/1e6).toFixed(2)+'M';
    if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';
    return'$'+Math.floor(n);
}
function fmtS(n){
    if(!isFinite(n)||n<0)return'0';
    if(n>=1e15)return(n/1e15).toFixed(1)+'Qa';
    if(n>=1e12)return(n/1e12).toFixed(1)+'T';
    if(n>=1e9)return(n/1e9).toFixed(1)+'B';
    if(n>=1e6)return(n/1e6).toFixed(1)+'M';
    if(n>=1e3)return(n/1e3).toFixed(0)+'K';
    return Math.floor(n);
}
function renderAssetIcon(item,size=''){
    const classes=['entity-icon'];
    if(size)classes.push(size);
    if(item&&item.asset)return `<img class="${classes.join(' ')}" src="${item.asset}" alt="${item.name||'icon'}">`;
    return `<span class="entity-fallback ${size||''}">${item?.icon||''}</span>`;
}
function getDisplayName(item){
    return item?.label||item?.name||'';
}
function getCardArtStyle(item,overlay='linear-gradient(180deg, rgba(2,6,23,0.82), rgba(2,6,23,0.55))'){
    if(!item?.bgAsset)return '';
    return ` style="background-image:${overlay},url('${item.bgAsset}')"`;
}
function cleanMojibakeText(text){
    if(!text)return text;
    return text
        .replace(/[^\x00-\x7F]/g,' ')
        .replace(/\s{2,}/g,' ')
        .trim();
}
function sanitizeTextNode(node){
    if(!node||!node.nodeValue)return;
    if(/[^\x00-\x7F]/.test(node.nodeValue)){
        node.nodeValue=cleanMojibakeText(node.nodeValue);
    }
}
function sanitizeMojibake(root=document.body){
    if(!root)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
        acceptNode(node){
            const parent=node.parentElement;
            if(!parent)return NodeFilter.FILTER_REJECT;
            const tag=parent.tagName;
            if(tag==='SCRIPT'||tag==='STYLE')return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    while(walker.nextNode())sanitizeTextNode(walker.currentNode);
}
function startMojibakeSanitizer(){
    sanitizeMojibake(document.body);
    const observer=new MutationObserver((mutations)=>{
        mutations.forEach((mutation)=>{
            mutation.addedNodes.forEach((node)=>{
                if(node.nodeType===Node.TEXT_NODE)sanitizeTextNode(node);
                else if(node.nodeType===Node.ELEMENT_NODE)sanitizeMojibake(node);
            });
            if(mutation.type==='characterData')sanitizeTextNode(mutation.target);
        });
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
}
function getRank(){for(let i=ranks.length-1;i>=0;i--)if(reputation>=ranks[i].rep)return i;return 0}
function getTier(o){for(let i=tierThresholds.length-1;i>=0;i--)if(o>=tierThresholds[i])return i;return 0}
function getTierProgress(o){const t=getTier(o);if(t>=tierThresholds.length-1)return 100;const c=tierThresholds[t],n=tierThresholds[t+1];return((o-c)/(n-c))*100}
function getStored(){return storageLocations.reduce((t,s)=>t+s.stored,0)}
function getHeatChance(){return Math.min(policeHeat/100,0.45)}
function getCrewPower(){return thieves.reduce((t,c)=>t+c.loyalty+c.skill+c.exp,0)}
function getHeistChance(h){return Math.min(0.95,h.chance+getCrewPower()*0.004+heistBonus)}
function getCrewIncome(c){const ct=crewTypes.find(t=>t.id===(c.type||'enforcer'));const typeMult=ct&&ct.bonus==='income'?1.5:1;return Math.floor((c.baseIncome*(1+c.exp*0.4)+c.skill*40)*globalMult*typeMult)}
function getCrewSteal(c){return Math.max(0.01,0.18-c.loyalty*0.022)}
function getCrewRank(c){const t=c.loyalty+c.skill+c.exp;if(t>=24)return 4;if(t>=15)return 3;if(t>=8)return 2;if(t>=3)return 1;return 0}

// === SAVE/LOAD ===
function saveGame(){
    if(isResetting)return;
    const save={
        v:SAVE_VERSION,ts:Date.now(),
        money,moneyPerSecond,clickPower,reputation,policeHeat,heatShield,heatDecay,
        critChance,critMult,luckChance,totalEarned,totalClicks,totalHeists,totalOfflineEarnings,
        prestigeLevel,legacyPoints,lifetimeEarnings,prestigeUpgrades,eventHistory,lastEventTime,
        bizUpgrades:bizUpgrades.map(b=>b.owned),
        clickUpgrades:clickUpgrades.map(c=>c.owned),
        territories:territories.map(t=>({level:t.level})),
        ownedTerritories,
        policeUpgrades:policeUpgrades.map(p=>p.owned),
        specialUpgrades:specialUpgrades.map(s=>s.owned),
        storageLocations,thieves,heistCDs,
        achievementsUnlocked,shownTips:[...shownTips],settings
    };
    try{localStorage.setItem(SAVE_KEY,JSON.stringify(save))}catch(e){console.warn('Save failed',e)}
}

function loadGame(){
    try{
        const raw=localStorage.getItem(SAVE_KEY);
        if(!raw)return false;
        const save=JSON.parse(raw);
        if(!save.v)return false;
        
        money=save.money||0;moneyPerSecond=save.moneyPerSecond||0;clickPower=save.clickPower||1;
        reputation=save.reputation||0;policeHeat=save.policeHeat||0;heatShield=save.heatShield||0;
        heatDecay=save.heatDecay||0;critChance=save.critChance||0.05;critMult=save.critMult||3;
        luckChance=save.luckChance||0;totalEarned=save.totalEarned||0;totalClicks=save.totalClicks||0;
        totalHeists=save.totalHeists||0;totalOfflineEarnings=save.totalOfflineEarnings||0;
        prestigeLevel=save.prestigeLevel||0;legacyPoints=save.legacyPoints||0;
        lifetimeEarnings=save.lifetimeEarnings||0;prestigeUpgrades=save.prestigeUpgrades||[];
        eventHistory=save.eventHistory||[];lastEventTime=save.lastEventTime||0;
        
        if(save.bizUpgrades)save.bizUpgrades.forEach((o,i)=>{if(bizUpgrades[i])bizUpgrades[i].owned=o});
        if(save.clickUpgrades)save.clickUpgrades.forEach((o,i)=>{if(clickUpgrades[i])clickUpgrades[i].owned=o});
        if(save.territories)save.territories.forEach((t,i)=>{if(territories[i])territories[i].level=t.level});
        ownedTerritories=save.ownedTerritories||[];
        if(save.policeUpgrades)save.policeUpgrades.forEach((o,i)=>{if(policeUpgrades[i])policeUpgrades[i].owned=o});
        if(save.specialUpgrades)save.specialUpgrades.forEach((o,i)=>{if(specialUpgrades[i])specialUpgrades[i].owned=o});
        storageLocations=save.storageLocations||[];
        thieves=save.thieves||[];
        heistCDs=save.heistCDs||{};
        achievementsUnlocked=save.achievementsUnlocked||[];
        shownTips=new Set(save.shownTips||[]);
        if(save.settings)settings={...settings,...save.settings};

        // Restore prestige upgrades
        prestigeUpgrades.forEach(pu=>{
            const upg=prestigeUpgradesData.find(u=>u.id===pu.id);
            if(upg)upg.owned=pu.owned;
        });

        // Process offline time
        const offlineCap=8*3600+getPrestigeBonus('offlineCap');
        const elapsed=Math.min((Date.now()-save.ts)/1000,offlineCap);
        if(elapsed>10&&moneyPerSecond>0){
            calcBonuses();
            const offlineRate=0.5*(1+getPrestigeBonus('offline'));
            const offlineEarn=Math.floor(moneyPerSecond*globalMult*elapsed*offlineRate);
            money+=offlineEarn;totalEarned+=offlineEarn;totalOfflineEarnings+=offlineEarn;lifetimeEarnings+=offlineEarn;

            // Show welcome back modal
            setTimeout(()=>{
                const modal=document.getElementById('welcomeBackModal');
                const hours=Math.floor(elapsed/3600);
                const mins=Math.floor((elapsed%3600)/60);
                const timeStr=hours>0?`${hours}h ${mins}m`:`${mins}m`;
                const hourlyRate=Math.floor((moneyPerSecond*globalMult*3600*offlineRate));

                document.getElementById('wbEarnings').textContent=`+${fmt(offlineEarn)}`;
                document.getElementById('wbTime').textContent=timeStr;
                document.getElementById('wbRate').textContent=`${fmt(hourlyRate)}/hr`;
                document.getElementById('wbEmoji').textContent=elapsed>3600*4?'ðŸ˜´':elapsed>1800?'ðŸ’¤':'ðŸ‘‹';

                modal.classList.add('active');
                playSound(600,200,'sine',0.15);
                checkAchievements();
            },500);
        }
        // Reduce heist cooldowns by elapsed time
        const now=Date.now();
        Object.keys(heistCDs).forEach(k=>{heistCDs[k]=Math.max(now,heistCDs[k]-elapsed*1000)});
        
        lastSeen=Date.now();
        return true;
    }catch(e){console.warn('Load failed',e);return false}
}

function exportSave(){
    saveGame();
    const data=localStorage.getItem(SAVE_KEY);
    navigator.clipboard.writeText(data).then(()=>showNotif('ðŸ“¤ Copied!','income','Save data copied to clipboard')).catch(()=>alert(data));
}

function importSave(){
    const data=prompt('Paste save data:');
    if(data){try{JSON.parse(data);localStorage.setItem(SAVE_KEY,data);location.reload()}catch(e){alert('Invalid save data')}}
}

function hardReset(){
    if(confirm('âš ï¸ Delete ALL progress and reset the game? This cannot be undone!')){
        isResetting=true;
        try{
            localStorage.clear();
            sessionStorage.clear();
            if(caches){caches.keys().then(names=>{names.forEach(name=>caches.delete(name))})}
            setTimeout(()=>{
                window.location.href = window.location.href.split('?')[0] + '?reset=' + Date.now();
            },100);
        }catch(e){
            console.error('Reset error:',e);
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload(true);
        }
    }
}

// === ACHIEVEMENTS ===
function openAchievements(){
    playSound(650,80,'triangle',0.1);
    document.getElementById('achievementsModal').classList.add('active');
    renderAchievements();
}
function closeAchievements(){document.getElementById('achievementsModal').classList.remove('active')}
function closeWelcomeBack(){document.getElementById('welcomeBackModal').classList.remove('active')}
function closePrestige(){document.getElementById('prestigeModal').classList.remove('active')}
function closePrestigeShop(){document.getElementById('prestigeShopModal').classList.remove('active')}
function closeEvent(){document.getElementById('eventModal').classList.remove('active');currentEvent=null}

let currentEvent=null;
function triggerRandomEvent(){
    const now=Date.now();
    if(now-lastEventTime<120000)return; // Min 2 min between events
    if(Math.random()>0.3)return; // 30% chance per check

    const rank=getRank();
    const availableEvents=randomEvents.filter(e=>rank>=e.minRank);
    if(availableEvents.length===0)return;

    const totalWeight=availableEvents.reduce((sum,e)=>sum+e.weight,0);
    let roll=Math.random()*totalWeight;
    let event=availableEvents[0];
    for(const e of availableEvents){
        roll-=e.weight;
        if(roll<=0){event=e;break}
    }

    lastEventTime=now;
    currentEvent=event;
    showEvent(event);
}

function showEvent(event){
    const result=event.trigger();

    document.getElementById('eventTitle').textContent=`âš¡ ${event.name}`;
    document.getElementById('eventIcon').textContent=event.icon;
    document.getElementById('eventName').textContent=event.name;
    document.getElementById('eventDesc').textContent=event.desc;
    document.getElementById('eventResult').textContent=result.msg;
    document.getElementById('eventResult').style.color=result.color||'#fbbf24';

    const header=document.getElementById('eventHeader');
    header.style.background=result.color?`linear-gradient(135deg,${result.color},${result.color}dd)`:'linear-gradient(135deg,#f59e0b,#d97706)';

    if(result.hasChoice&&activeEffects.raceOffer){
        document.getElementById('eventActions').style.display='block';
        document.getElementById('eventContinue').style.display='none';
    }else{
        document.getElementById('eventActions').style.display='none';
        document.getElementById('eventContinue').style.display='block';
    }

    eventHistory.push({id:event.id,time:Date.now(),result:result.msg});
    if(eventHistory.length>20)eventHistory.shift();

    document.getElementById('eventModal').classList.add('active');
    playSound(1000,200,'triangle',0.2);
    vib([30,30,30]);
    checkAchievements();
    updateAll();
}

function acceptEventChoice(){
    if(activeEffects.raceOffer){
        const bet=activeEffects.raceOffer.amount;
        if(money>=bet){
            money-=bet;
            if(Math.random()<0.33){
                const win=bet*3;
                money+=win;lifetimeEarnings+=win;
                document.getElementById('eventResult').textContent=`Won ${fmt(win)}!`;
                document.getElementById('eventResult').style.color='#22c55e';
                playSound(1200,300,'square',0.2);
            }else{
                document.getElementById('eventResult').textContent=`Lost ${fmt(bet)}`;
                document.getElementById('eventResult').style.color='#ef4444';
                playSound(400,200,'sawtooth',0.15);
            }
        }
        delete activeEffects.raceOffer;
    }
    document.getElementById('eventActions').style.display='none';
    document.getElementById('eventContinue').style.display='block';
    updateAll();
}

function declineEventChoice(){
    delete activeEffects.raceOffer;
    document.getElementById('eventResult').textContent='Challenge declined';
    document.getElementById('eventResult').style.color='#94a3b8';
    document.getElementById('eventActions').style.display='none';
    document.getElementById('eventContinue').style.display='block';
}

function calculateLegacyPoints(){
    return Math.floor(Math.pow(lifetimeEarnings/1e7,0.5));
}

function openPrestige(){
    const lp=calculateLegacyPoints();
    if(lp===0){playSound(300,100,'sawtooth',0.1);showNotif('âš ï¸ Not Ready','event','Need more lifetime earnings to prestige');return}
    playSound(750,120,'square',0.12);
    document.getElementById('currentPrestige').textContent=prestigeLevel;
    document.getElementById('currentLegacy').textContent=legacyPoints+' LP';
    document.getElementById('prestigeReward').textContent=`+${lp} LP`;
    document.getElementById('lifetimeDisplay').textContent=fmt(lifetimeEarnings);
    document.getElementById('prestigeModal').classList.add('active');
}

function confirmPrestige(){
    const lp=calculateLegacyPoints();
    if(lp===0)return;
    if(!confirm('Are you sure? This will reset ALL progress except achievements and Legacy Points!'))return;

    // Award Legacy Points
    prestigeLevel++;
    legacyPoints+=lp;

    // Reset everything except prestige data and achievements
    money=0;moneyPerSecond=0;clickPower=1;reputation=0;policeHeat=0;heatShield=0;heatDecay=0;
    critChance=0.05;critMult=3;luckChance=0;totalEarned=0;totalClicks=0;totalHeists=0;totalOfflineEarnings=0;
    bizUpgrades.forEach(b=>b.owned=0);
    clickUpgrades.forEach(c=>c.owned=0);
    territories.forEach(t=>t.level=0);
    ownedTerritories=[];
    policeUpgrades.forEach(p=>p.owned=false);
    specialUpgrades.forEach(s=>s.owned=false);
    storageLocations=[];
    thieves=[];
    heistCDs={};
    shownTips=new Set();

    // Apply prestige bonuses
    applyPrestigeBonuses();

    closePrestige();
    saveGame();
    calcBonuses();
    updateAll();
    checkAchievements();
    showNotif('ðŸ‘‘ RETIRED!','prestige',`+${lp} Legacy Points earned!`);
    playSound(1200,400,'square',0.2);
    vib([50,50,50,50,100]);
}

function applyPrestigeBonuses(){
    // Apply start bonuses
    const startMoney=prestigeUpgrades.find(u=>u.id==='start1');
    if(startMoney&&startMoney.owned>0)money+=startMoney.bonus.val*startMoney.owned;

    const startRank=prestigeUpgrades.find(u=>u.id==='start2');
    if(startRank&&startRank.owned>0){
        reputation=ranks[startRank.bonus.val]?.rep||0;
    }
}

function getPrestigeBonus(type){
    let bonus=0;
    prestigeUpgrades.filter(u=>u.bonus.type===type&&u.owned>0).forEach(u=>{
        bonus+=u.bonus.val*u.owned;
    });
    return bonus;
}

function openPrestigeShop(){
    document.getElementById('lpDisplay').textContent=legacyPoints+' LP';
    renderPrestigeUpgrades();
    document.getElementById('prestigeShopModal').classList.add('active');
}

function renderPrestigeUpgrades(){
    document.getElementById('prestigeUpgradesList').innerHTML=prestigeUpgradesData.map((u,i)=>{
        const cost=u.cost*Math.pow(1.5,u.owned);
        const canBuy=legacyPoints>=cost&&u.owned<u.maxOwned;
        const maxed=u.owned>=u.maxOwned;
        return `<div class="upgrade-card ${canBuy?'affordable':''} ${maxed?'maxed':''}">
            <div class="upgrade-header"><span class="upgrade-name">${u.name}</span><span style="font-size:0.65em;color:#94a3b8">${u.owned}/${u.maxOwned}</span></div>
            <div style="font-size:0.75em;color:#94a3b8;margin:4px 0">${u.desc}</div>
            <div class="upgrade-meta"><span style="color:#fbbf24">${u.bonus.type}</span><b style="color:#fbbf24">${Math.floor(cost)} LP</b></div>
            <button class="upgrade-btn" onclick="buyPrestigeUpgrade(${i})" ${canBuy?'':'disabled'}>${maxed?'âœ“ MAX':'Buy'}</button>
        </div>`;
    }).join('');
}

function buyPrestigeUpgrade(idx){
    const u=prestigeUpgradesData[idx];
    const cost=u.cost*Math.pow(1.5,u.owned);
    if(legacyPoints>=cost&&u.owned<u.maxOwned){
        legacyPoints-=cost;
        u.owned++;
        // Copy to persistent array
        const existing=prestigeUpgrades.find(p=>p.id===u.id);
        if(existing)existing.owned=u.owned;
        else prestigeUpgrades.push({id:u.id,owned:u.owned});

        saveGame();
        renderPrestigeUpgrades();
        document.getElementById('lpDisplay').textContent=legacyPoints+' LP';
        updateAll();
        playSound(800,150,'triangle',0.15);
        vib([15,30,15]);
    }
}
function getAchievementProgress(a){
    if(a.id==='clicks_100')return Math.min(100,Math.floor((totalClicks/100)*100));
    if(a.id==='clicks_1000')return Math.min(100,Math.floor((totalClicks/1000)*100));
    if(a.id==='earn_1k')return Math.min(100,Math.floor((totalEarned/1000)*100));
    if(a.id==='earn_1m')return Math.min(100,Math.floor((totalEarned/1e6)*100));
    if(a.id==='earn_1b')return Math.min(100,Math.floor((totalEarned/1e9)*100));
    if(a.id==='heist_10')return Math.min(100,Math.floor((totalHeists/10)*100));
    if(a.id==='full_crew')return Math.min(100,Math.floor((thieves.length/maxThieves)*100));
    if(a.id==='all_turf')return Math.min(100,Math.floor((ownedTerritories.length/territories.length)*100));
    return 0;
}
function renderAchievements(){
    const unlocked=achievementsUnlocked.length;
    document.getElementById('achievementCount').textContent=`${unlocked}/${achievements.length}`;
    document.getElementById('achievementsList').innerHTML=achievements.map(a=>{
        const isUnlocked=achievementsUnlocked.includes(a.id);
        const progress=isUnlocked?100:getAchievementProgress(a);
        const showProgress=!isUnlocked&&progress>0;
        return `<div class="achievement-card ${isUnlocked?'':'locked'}">
            <div class="achievement-icon">${isUnlocked?'ðŸ†':'ðŸ”’'}</div>
            <div class="achievement-info">
                <div class="achievement-name">${a.name}</div>
                <div class="achievement-desc">${a.desc}</div>
                ${showProgress?`<div class="achievement-progress">${progress}% complete</div>`:''}
            </div>
            ${isUnlocked?'<div class="achievement-checkmark">âœ“</div>':''}
        </div>`;
    }).join('');
}

// === SETTINGS ===
function openSettings(){playSound(500,50,'sine',0.08);document.getElementById('settingsModal').classList.add('active');updateSettingsUI()}
function closeSettings(){playSound(400,50,'sine',0.08);document.getElementById('settingsModal').classList.remove('active')}
function toggleSetting(key){
    settings[key]=!settings[key];
    if(key==='debug')document.getElementById('debugBtns').style.display=settings.debug?'flex':'none';
    if(key==='music'){if(settings.music)MUSIC.resume();else MUSIC.pause();}
    updateSettingsUI();saveGame();
}
function updateSettingsUI(){
    document.getElementById('toggleSound').className='toggle'+(settings.sound?' on':'');
    document.getElementById('toggleMusic').className='toggle'+(settings.music?' on':'');
    document.getElementById('toggleVib').className='toggle'+(settings.vibration?' on':'');
    document.getElementById('toggleTips').className='toggle'+(settings.tips?' on':'');
    document.getElementById('toggleDebug').className='toggle'+(settings.debug?' on':'');
}

// === NOTIFICATIONS & TIPS ===
function showNotif(msg,type,sub=''){
    document.querySelectorAll('.notification').forEach(n=>n.remove());
    const n=document.createElement('div');n.className='notification '+type;
    n.innerHTML=msg+(sub?`<small>${sub}</small>`:'');n.onclick=()=>n.remove();
    document.body.appendChild(n);setTimeout(()=>n.remove(),2500);
    if(type==='rank-up'||type==='police'||type==='heist-win')MUSIC.duck();
}

function showTip(id,msg){
    if(!settings.tips||shownTips.has(id))return;
    shownTips.add(id);saveGame();
    setTimeout(()=>showNotif('ðŸ’¡ Tip',msg,'tip'),1000);
}

// === ACHIEVEMENTS ===
function checkAchievements(){
    achievements.forEach(a=>{
        if(!achievementsUnlocked.includes(a.id)&&a.check()){
            achievementsUnlocked.push(a.id);
            vib([50,30,50,30,100]);
            showNotif('ðŸ† '+a.name,'achievement',a.desc);
        }
    });
}

// === CORE GAME ===
function calcBonuses(){
    globalMult=1;heistBonus=0;heatShield=0;let clickB=0,critB=0,luckB=0;maxThieves=6;clickMult=1;

    // Apply prestige bonuses
    globalMult+=getPrestigeBonus('income');
    clickB+=getPrestigeBonus('click');
    heistBonus+=getPrestigeBonus('heist');
    maxThieves+=getPrestigeBonus('crewCap');

    ownedTerritories.forEach(tid=>{
        const t=territories.find(x=>x.id===tid);if(!t)return;
        const v=t.val*(1+t.level*0.6);
        if(t.bonus==='income')globalMult+=v;
        else if(t.bonus==='heist')heistBonus+=v;
        else if(t.bonus==='click')clickB+=v;
        else if(t.bonus==='crit')critB+=v;
        else if(t.bonus==='luck')luckB+=v;
        else if(t.bonus==='crew')maxThieves+=Math.floor(v);
        else if(t.bonus==='all'){globalMult+=v;heistBonus+=v;clickB+=v;critB+=v;luckB+=v}
    });
    thieves.forEach(c=>{
        const ct=crewTypes.find(t=>t.id===(c.type||'enforcer'));if(!ct)return;
        const rankMult=1+getCrewRank(c)*0.1;
        if(ct.bonus==='heist')heistBonus+=0.02*rankMult;
        else if(ct.bonus==='income')globalMult+=0.015*rankMult;
        else if(ct.bonus==='heat')heatShield+=0.03*rankMult;
        else if(ct.bonus==='luck')luckB+=0.01*rankMult;
    });
    let baseCrit=0.05,baseLuck=0;
    specialUpgrades.forEach(u=>{if(u.owned){if(u.id.includes('crit'))baseCrit+=u.id==='crit1'?0.03:u.id==='crit3'?0.05:0;if(u.id.includes('luck'))baseLuck+=u.id==='luck1'?0.02:u.id==='luck2'?0.03:0.05}});
    policeUpgrades.forEach(u=>{if(u.owned)u.fx()});
    critChance=baseCrit+critB;luckChance=baseLuck+luckB;
    clickMult=1+clickB;
}

function switchTab(tab,btn){
    const rank=getRank();
    const unlocks={territory:4,heist:2,crew:1};
    if(unlocks[tab]&&rank<unlocks[tab])return;
    vib(5);
    document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('tab-'+tab).classList.add('active');
    btn.classList.add('active');
}

function clickMoney(event){
    _unlockTone();
    vib(8);totalClicks++;
    const now=Date.now();
    if(now-lastClickTime<400){combo=Math.min(combo+1,20)}else{combo=Math.max(1,combo-1)}
    lastClickTime=now;clearTimeout(comboTimeout);comboTimeout=setTimeout(()=>{combo=0;updateAll()},1500);

    const isCrit=Math.random()<critChance;const comboMult=1+combo*0.05;
    const clickBoostMult=(activeEffects.clickBoost?1+activeEffects.clickBoost.val:1);
    let earned=Math.floor(clickPower*(1+getPrestigeBonus('click'))*clickMult*comboMult*(isCrit?critMult:1)*clickBoostMult);
    if(isCrit){vib([15,20,15]);SFX.crit()}
    else{SFX.tap()}
    money+=earned;totalEarned+=earned;lifetimeEarnings+=earned;reputation+=Math.ceil(earned/800);
    policeHeat=Math.min(100,policeHeat+0.08*(1-heatShield));

    if(Math.random()<luckChance){
        const bonus=Math.floor(money*0.1+clickPower*10);money+=bonus;totalEarned+=bonus;lifetimeEarnings+=bonus;
        playSound(1200,200,'triangle',0.2);
        document.getElementById('eventBanner').style.display='block';
        document.getElementById('eventBanner').textContent=`ðŸŽ‰ +${fmt(bonus)}`;
        setTimeout(()=>document.getElementById('eventBanner').style.display='none',1500);
    }

    checkAchievements();updateAll();

    const e=document.createElement('div');e.className='click-effect '+(isCrit?'crit':'normal');
    e.textContent=(isCrit?'ðŸ’¥':'+')+fmt(earned);
    const offsetX=(Math.random()-0.5)*30;
    e.style.left=`calc(50% + ${offsetX}px)`;
    e.style.top='-60px';
    e.style.transform='translateX(-50%)';
    document.getElementById('clickBtn').appendChild(e);setTimeout(()=>e.remove(),isCrit?600:500);
}

// Raids on timer instead of per-click
function checkRaid(){
    if(Math.random()<getHeatChance()*0.1){
        vib([150,80,150,80,150]);
        SFX.alarm();
        const loss=Math.floor(money*(0.08+Math.random()*0.15));
        money=Math.max(0,money-loss);policeHeat=Math.max(0,policeHeat-25);
        if(loss>0){
            showNotif('ðŸš” RAID!','police',`-${fmt(loss)} cash seized!`);
            document.body.style.animation='raidFlash 0.5s';
            setTimeout(()=>document.body.style.animation='',500);
        }
        updateAll();
    }
}

function attemptHeist(id){
    if(heistCDs[id]>Date.now())return;
    const h=heists[id];const chance=getHeistChance(h);
    policeHeat=Math.min(100,policeHeat+h.heat*(1-heatShield));totalHeists++;
    if(Math.random()<chance){
        vib([25,40,25,40,25,40,80]);SFX.win();
        const reward=h.reward[0]+Math.floor(Math.random()*(h.reward[1]-h.reward[0]));
        money+=reward;totalEarned+=reward;lifetimeEarnings+=reward;reputation+=Math.ceil(reward/400);
        showNotif('ðŸŽ¯ SUCCESS!','heist-win',`+${fmt(reward)}`);
    }else{
        vib([80,40,80]);SFX.alarm();policeHeat=Math.min(100,policeHeat+h.heat);
        showNotif('ðŸ’€ FAILED!','heist-fail','Increase crew power!');
    }
    heistCDs[id]=Date.now()+h.cd*1000;checkAchievements();updateAll();
}

function addPurchaseFeedback(selector){
    const el=document.querySelector(selector);
    if(el){el.classList.add('just-purchased');setTimeout(()=>el.classList.remove('just-purchased'),500)}
}
function buyBiz(i){const u=bizUpgrades[i];let cost=Math.floor(u.baseCost*Math.pow(u.mult,u.owned));if(activeEffects.discount){cost=Math.floor(cost*(1-activeEffects.discount.val));delete activeEffects.discount}if(money>=cost&&u.owned<u.maxOwned){money-=cost;u.owned++;moneyPerSecond+=u.income;reputation+=Math.ceil(cost/800);vib([15,25,15]);playSound(700,80,'triangle',0.12);checkAchievements();updateAll();setTimeout(()=>addPurchaseFeedback(`#bizList .upgrade-card:nth-child(${i+1})`),10)}}
function buyClick(i){const u=clickUpgrades[i];let cost=Math.floor(u.baseCost*Math.pow(u.costMult,u.owned));if(activeEffects.discount){cost=Math.floor(cost*(1-activeEffects.discount.val));delete activeEffects.discount}if(money>=cost&&u.owned<u.maxOwned){money-=cost;u.owned++;clickPower=clickPower*u.mult;reputation+=Math.ceil(cost/400);vib([15,25,15]);SFX.buy();updateAll();setTimeout(()=>addPurchaseFeedback(`#clickList .upgrade-card:nth-child(${i+1})`),10)}}
function buyTerritory(id){if(activeEffects.territoryLock){showNotif('âš”ï¸ Locked','event','Territories under attack!');return}const t=territories.find(x=>x.id===id);if(!t||ownedTerritories.includes(id)||money<t.cost)return;money-=t.cost;ownedTerritories.push(id);reputation+=Math.ceil(t.cost/150);vib([25,40,25,40,30]);playSound(900,120,'square',0.15);calcBonuses();showNotif('ðŸ—ºï¸ CAPTURED!','event',t.icon+' '+t.name);checkAchievements();updateAll();setTimeout(()=>addPurchaseFeedback(`.territory-card:nth-child(${id+1})`),10)}
function upgradeTerritory(id){if(activeEffects.territoryLock){showNotif('âš”ï¸ Locked','event','Territories under attack!');return}const t=territories.find(x=>x.id===id);if(!t||!ownedTerritories.includes(id)||t.level>=t.maxLvl)return;const cost=t.upCost*Math.pow(2,t.level);if(money>=cost){money-=cost;t.level++;reputation+=Math.ceil(cost/80);vib([25,40,25,40,30]);calcBonuses();updateAll()}}
function buyPolice(id){const u=policeUpgrades.find(x=>x.id===id);if(!u||u.owned||money<u.cost)return;money-=u.cost;u.owned=true;u.fx();reputation+=Math.ceil(u.cost/400);vib([25,40,25,40,30]);updateAll()}
function buySpecial(id){const u=specialUpgrades.find(x=>x.id===id);if(!u||u.owned||money<u.cost)return;money-=u.cost;u.owned=true;u.fx();reputation+=Math.ceil(u.cost/300);vib([25,40,25,40,30]);calcBonuses();updateAll()}
function buyStorage(i){const s=storageTypes[i];if(money>=s.cost&&!storageLocations.find(x=>x.name===s.name)){money-=s.cost;storageLocations.push({...s,stored:0,id:Date.now()});vib([15,25,15]);updateAll()}}
function deposit(id,amt){const s=storageLocations.find(x=>x.id===id);if(s){const mx=Math.min(amt,money,s.cap-s.stored);if(mx>0){money-=mx;s.stored+=mx;updateAll()}}}
function withdraw(id){const s=storageLocations.find(x=>x.id===id);if(s?.stored>0){money+=s.stored;s.stored=0;updateAll()}}
function hireThief(crewTypeId){const cost=10000*Math.pow(2.3,thieves.length);if(money>=cost&&thieves.length<maxThieves){money-=cost;const crewType=crewTypes.find(t=>t.id===crewTypeId)||crewTypes[0];const crewName=crewNames[thieves.length%crewNames.length];thieves.push({id:Date.now(),name:crewName,type:crewType.id,portrait:crewPortraits[crewName]||'',baseIncome:180+Math.floor(Math.random()*250),loyalty:0,skill:0,exp:0});vib([25,40,25,40,80,40,60]);playSound(650,100,'triangle',0.15);setTimeout(()=>playSound(850,100,'sine',0.12),100);setTimeout(()=>playSound(1050,150,'triangle',0.18),200);const btn=event.target.closest('button');if(btn){btn.style.animation='hireSuccess 0.5s';setTimeout(()=>btn.style.animation='',500)}showTip('crew_hired',`Hired ${crewName} (${crewType.name})! ${crewType.desc}`);checkAchievements();updateAll()}}
function trainCrew(id,attr){const c=thieves.find(x=>x.id===id);if(!c||c[attr]>=10)return;const costs={loyalty:2500,skill:7000,exp:4500};const cost=Math.floor(costs[attr]*Math.pow(1.9,c[attr]));if(money>=cost){money-=cost;c[attr]++;reputation+=8;vib([15,25,15]);playSound(550,80,'sine',0.1);updateAll()}}
function fireCrew(id){if(confirm('Fire this crew member?')){playSound(250,150,'sawtooth',0.12);thieves=thieves.filter(c=>c.id!==id);updateAll()}}

function processCrew(){
    thieves.forEach(c=>{
        if(!c||!c.baseIncome)return;
        const stealChance=getCrewSteal(c);
        if(Math.random()<stealChance){
            const stolen=Math.floor(money*0.04*Math.random());
            money=Math.max(0,money-stolen);
            if(stolen>100)showNotif(`ðŸ¥· ${c.name} stole!`,'theft',`-${fmt(stolen)}`);
        }else{
            const income=getCrewIncome(c);money+=income;totalEarned+=income;
        }
    });
}

function checkRankUp(){
    const newRank=getRank();const oldRank=parseInt(document.body.className.match(/rank-(\d)/)?.[1]||0);
    if(newRank>oldRank){
        document.body.className=`rank-${newRank}`;vib([40,80,40,80,80,40,150]);SFX.rankUp();MUSIC.switchToRank(newRank);
        showNotif('ðŸŽ–ï¸ RANK UP!','rank-up',ranks[newRank].name);
        if(newRank===1)showTip('crew_unlock','Crew tab unlocked! Hire members for passive income.');
        if(newRank===2)showTip('heist_unlock','Heists unlocked! High risk, high reward.');
        if(newRank===4)showTip('turf_unlock','Territories unlocked! Control turf for bonuses.');
        checkAchievements();
    }
}

function updateTabs(){
    const rank=getRank();
    [{tab:'crew',icon:'ðŸ¥·',name:'Crew',unlock:1},{tab:'heist',icon:'ðŸŽ¯',name:'Heist',unlock:2},{tab:'territory',icon:'ðŸ—ºï¸',name:'Turf',unlock:4}].forEach(t=>{
        const btn=document.querySelector(`[data-tab="${t.tab}"]`);
        if(rank>=t.unlock){btn.innerHTML=`<span>${t.icon}</span>${t.name}`;btn.classList.remove('locked')}
        else{btn.innerHTML=`<span>ðŸ”’</span><span class="unlock-hint">Rank ${t.unlock}</span>`;btn.classList.add('locked')}
    });
}

function updateAll(){
    checkRankUp();calcBonuses();updateTabs();
    const rank=getRank();const total=money+getStored();

    // Update prestige UI
    const prestigeAvailable=rank>=6||totalEarned>=1e8;
    const prestigeSection=document.getElementById('prestigeSection');
    if(prestigeSection)prestigeSection.style.display=prestigeAvailable?'block':'none';
    if(prestigeAvailable){
        const nextLP=calculateLegacyPoints();
        document.getElementById('prestigeLvlDisplay').textContent=prestigeLevel;
        document.getElementById('lpCount').textContent=legacyPoints+' LP';
        document.getElementById('nextLpReward').textContent=nextLP+' LP';
    }
    const lpBtn=document.getElementById('lpBtn');
    if(lpBtn){
        lpBtn.style.display=prestigeLevel>0?'inline-block':'none';
        document.getElementById('lpBadge').textContent=legacyPoints;
    }

    document.getElementById('money').innerHTML=`${fmt(total)} <span class="money-label">Net Worth</span>`;
    document.getElementById('onHand').textContent=fmt(money);
    document.getElementById('stored').textContent=fmt(getStored());
    document.getElementById('rankBadge').textContent=ranks[rank].name;
    document.getElementById('rankBadge').className=`rank-badge rank-${rank}-badge`;
    
    const comboBadge=document.getElementById('comboBadge');
    if(combo>1){comboBadge.style.display='inline';comboBadge.textContent=`x${(1+combo*0.05).toFixed(2)}`}else{comboBadge.style.display='none'}
    
    const nextRank=ranks[rank+1];
    if(nextRank){const pct=Math.min(100,((reputation-ranks[rank].rep)/(nextRank.rep-ranks[rank].rep))*100);document.getElementById('progressBar').style.width=pct+'%';document.getElementById('progressText').textContent=`${pct.toFixed(0)}% â†’ ${nextRank.name}`}
    else{document.getElementById('progressBar').style.width='100%';document.getElementById('progressText').textContent='ðŸ‘‘ MAX RANK'}
    
    const effIncome=Math.floor(moneyPerSecond*globalMult);
    document.getElementById('perSec').textContent=fmt(effIncome);
    document.getElementById('clickVal').textContent=fmt(Math.floor(clickPower*clickMult*(1+getPrestigeBonus('click'))));
    document.getElementById('critChance').textContent=(critChance*100).toFixed(0)+'%';
    document.getElementById('heatVal').textContent=Math.floor(policeHeat)+'%';
    document.getElementById('heistBonus').textContent='+'+Math.floor(heistBonus*100)+'%';
    document.getElementById('territoryCount').textContent=ownedTerritories.length;
    document.getElementById('shieldVal').textContent=Math.floor(heatShield*100)+'%';
    document.getElementById('crewPower').textContent=getCrewPower();
    document.getElementById('multVal').textContent='x'+globalMult.toFixed(2);
    document.getElementById('luckVal').textContent=(luckChance*100).toFixed(0)+'%';
    document.getElementById('clickBtn').className=`click-button click-${Math.min(rank,6)}`;
    
    // Biz upgrades
    document.getElementById('bizList').innerHTML=bizUpgrades.map((u,i)=>{
        const cost=Math.floor(u.baseCost*Math.pow(u.mult,u.owned));const can=money>=cost&&u.owned<u.maxOwned;
        const tier=getTier(u.owned),prog=getTierProgress(u.owned);
        const hasMinigame=u.minigame&&tier>=MINIGAME_TIER;
        const atMax=u.owned>=u.maxOwned;
        const pipsPer=Math.ceil(u.maxOwned/5);const pipsOwned=Math.min(5,Math.floor(u.owned/pipsPer));
        const currentPipProgress=((u.owned%pipsPer)/pipsPer)*100;
        return `<div class="upgrade-card ${can?'affordable':''} ${atMax?'maxed':''}"${getCardArtStyle(u)}>
            <div class="upgrade-header card-art-text"><span class="upgrade-name">${renderAssetIcon(u)}${getDisplayName(u)}</span><span style="font-size:0.65em;color:#94a3b8">${u.owned}/${u.maxOwned}</span></div>
            <div class="territory-pips">${Array(5).fill(0).map((_,j)=>{
                if(j<pipsOwned)return `<div class="territory-pip filled"></div>`;
                if(j===pipsOwned&&!atMax)return `<div class="territory-pip" style="background:linear-gradient(90deg,#22c55e ${currentPipProgress}%,rgba(255,255,255,0.2) ${currentPipProgress}%)"></div>`;
                return `<div class="territory-pip"></div>`;
            }).join('')}</div>
            <div class="upgrade-meta"><span>+$${u.income}/s</span><b style="color:#fbbf24">$${fmtS(cost)}</b></div>
            ${hasMinigame?`<button class="upgrade-btn minigame-btn" onclick="openMiniGame('${u.minigame}')">ðŸŽ® PLAY</button>`:`<button class="upgrade-btn" onclick="buyBiz(${i})" ${can&&!atMax?'':'disabled'}>${atMax?'âœ“ MAX':(u.minigame&&tier<MINIGAME_TIER?`Buy (ðŸŽ®@${tierNames[MINIGAME_TIER]})`:'Buy')}</button>`}
        </div>`;
    }).join('');
    
    // Click upgrades
    document.getElementById('clickList').innerHTML=clickUpgrades.map((u,i)=>{
        const cost=Math.floor(u.baseCost*Math.pow(u.costMult,u.owned));const can=money>=cost&&u.owned<u.maxOwned;
        const atMax=u.owned>=u.maxOwned;
        const pipsPer=Math.ceil(u.maxOwned/5);const pipsOwned=Math.min(5,Math.floor(u.owned/pipsPer));
        const currentPipProgress=((u.owned%pipsPer)/pipsPer)*100;
        return `<div class="upgrade-card ${can?'affordable':''} ${atMax?'maxed':''}"${getCardArtStyle(u)}><div class="upgrade-header card-art-text"><span class="upgrade-name">${renderAssetIcon(u)}${getDisplayName(u)}</span><span style="font-size:0.65em;color:#94a3b8">${u.owned}/${u.maxOwned}</span></div><div class="territory-pips">${Array(5).fill(0).map((_,j)=>{
            if(j<pipsOwned)return `<div class="territory-pip filled"></div>`;
            if(j===pipsOwned&&!atMax)return `<div class="territory-pip" style="background:linear-gradient(90deg,#22c55e ${currentPipProgress}%,rgba(255,255,255,0.2) ${currentPipProgress}%)"></div>`;
            return `<div class="territory-pip"></div>`;
        }).join('')}</div><div class="upgrade-meta"><span>x${u.mult}</span><b style="color:#fbbf24">$${fmtS(cost)}</b></div><button class="upgrade-btn" onclick="buyClick(${i})" ${can&&!atMax?'':'disabled'}>${atMax?'âœ“ MAX':'Buy'}</button></div>`;
    }).join('');
    
    // Territory content
    const territoryUnlocked=rank>=4;
    document.getElementById('territoryContent').innerHTML=territoryUnlocked?`
        <div class="section-title">ðŸ—ºï¸ Territories <span style="font-weight:normal;color:#94a3b8">(${ownedTerritories.length}/${territories.length})</span></div>
        <div class="grid-2col">${territories.map(t=>{
            const owned=ownedTerritories.includes(t.id);const can=money>=t.cost;const upCost=t.upCost*Math.pow(2,t.level);const canUp=owned&&t.level<t.maxLvl&&money>=upCost;
            const bonusMap={income:'ðŸ“ˆ Income',click:'ðŸ‘† Click',heist:'ðŸŽ¯ Heist',crit:'âš¡ Crit',luck:'ðŸ€ Luck',crew:'ðŸ¥· Crew',all:'âœ¨ All'};
            const currVal=(t.val*(1+t.level*0.6)*100).toFixed(0);
            const crewSlots=Math.floor(t.val*(1+t.level*0.6));
            const bonusText=t.bonus==='crew'?`+${crewSlots} slots`:`+${currVal}% ${bonusMap[t.bonus]}`;
            const imgName=t.name==='Casino District'?'Casino':t.name==='Hideout'?'Industrial':t.name;
            const bgImage=`assets/${imgName}.PNG`;
            return `<div class="territory-card ${owned?'owned':''}" style="background-image:url('${bgImage}')"><div class="upgrade-header"><span class="upgrade-name">${t.icon} ${t.name}</span><span style="font-size:0.6em;color:#4ade80">${bonusText}</span></div><div class="territory-pips">${Array(t.maxLvl).fill(0).map((_,j)=>`<div class="territory-pip ${j<t.level?'filled':''}"></div>`).join('')}</div>${owned?(t.level>=t.maxLvl?'':`<button class="btn btn-green" style="width:100%" onclick="upgradeTerritory(${t.id})" ${canUp?'':'disabled'}>â¬† ${fmtS(upCost)}</button>`):`<button class="btn btn-blue" style="width:100%" onclick="buyTerritory(${t.id})" ${can?'':'disabled'}>ðŸŽ¯ ${fmtS(t.cost)}</button>`}</div>`;
        }).join('')}</div>
    `:`<div class="locked-content"><div class="lock-icon">ðŸ”’</div><h3>Territories</h3><p>Reach Rank 4 (â¤ï¸ Kingpin) to unlock territory control and earn passive bonuses!</p></div>`;
    
    // Heist content
    const heistUnlocked=rank>=2;
    const now=Date.now();
    document.getElementById('heistContent').innerHTML=heistUnlocked?`
        <div class="heat-info-panel">
            <h4>ðŸš” Police Heat System</h4>
            <p>Current Heat: <b>${Math.floor(policeHeat)}%</b> â†’ Raid chance: <b>${(getHeatChance()*10).toFixed(1)}%</b>/sec</p>
            <p>Heat Decay: <b>${(0.4+heatDecay).toFixed(1)}</b>/sec â€¢ Shield: <b>${Math.floor(heatShield*100)}%</b> reduction</p>
            <p style="font-size:0.9em;margin-top:4px">ðŸ’¡ Raids only take <b>cash on hand</b> - money in storage is safe!</p>
        </div>
        <div class="section-title">ðŸŽ¯ Heists</div>
        <div class="grid-2col">${heists.map(h=>{
            const cd=heistCDs[h.id]||0,onCd=cd>now,cdLeft=onCd?Math.ceil((cd-now)/1000):0;const chance=getHeistChance(h);
            return `<div class="heist-card ${onCd?'on-cooldown':''}"${getCardArtStyle(h,'linear-gradient(180deg, rgba(32,12,58,0.84), rgba(15,23,42,0.58))')}><span class="heist-difficulty ${h.diff}">${h.diff}</span><div class="heist-name card-art-text upgrade-name">${renderAssetIcon(h)}${getDisplayName(h)}</div><div class="heist-info card-art-text">${fmt(h.reward[0])}-${fmt(h.reward[1])} â€¢ +${h.heat} heat</div><div class="heist-bar"><div class="heist-bar-fill" style="width:${chance*100}%"></div></div><button class="btn btn-purple" style="width:100%" onclick="attemptHeist(${h.id})" ${onCd?'disabled':''}>${onCd?`â± ${cdLeft}s`:`${(chance*100).toFixed(0)}% Success`}</button></div>`;
        }).join('')}</div>
        <div class="section-title" style="margin-top:8px">ðŸ›¡ï¸ Heat Reduction</div>
        <div class="grid-2col">${policeUpgrades.map(u=>`<div class="police-card ${u.owned?'owned':''}"${getCardArtStyle(u,'linear-gradient(180deg, rgba(10,22,50,0.84), rgba(15,23,42,0.58))')}><div class="upgrade-header card-art-text"><span class="upgrade-name">${renderAssetIcon(u)}${getDisplayName(u)}</span><span style="font-size:0.6em;color:${u.owned?'#22c55e':'#fbbf24'}">${u.owned?'âœ“ Owned':fmtS(u.cost)}</span></div><div class="card-art-text" style="font-size:0.6em;color:#cbd5e1">${u.desc}</div>${!u.owned?`<button class="btn btn-blue" style="width:100%;margin-top:4px" onclick="buyPolice('${u.id}')" ${money>=u.cost?'':'disabled'}>Buy</button>`:''}</div>`).join('')}</div>
    `:`<div class="locked-content"><div class="lock-icon">ðŸ”’</div><h3>Heists</h3><p>Reach Rank 2 (ðŸ’™ Runner) to unlock heists and big scores!</p></div>`;
    
    // Crew content
    const crewUnlocked=rank>=1;
    const crewCost=10000*Math.pow(2.3,thieves.length);
    document.getElementById('crewContent').innerHTML=crewUnlocked?`
        <div class="section-title">ðŸ¥· Your Crew <span style="font-weight:normal;color:#94a3b8">(${thieves.length}/${maxThieves})</span></div>
        ${thieves.length>=maxThieves?`<div style="text-align:center;padding:10px;font-size:0.8em;color:#22c55e;font-weight:bold">MAX CREW CAPACITY</div>`:`<div style="margin-bottom:8px"><div style="font-size:0.7em;color:#94a3b8;margin-bottom:4px;text-align:center">Hire ${fmt(crewCost)} - Choose Type:</div><div class="grid-2col" style="gap:4px">${crewTypes.map(ct=>`<button class="btn btn-purple" onclick="hireThief('${ct.id}')" style="padding:6px;font-size:0.7em;display:flex;flex-direction:column;align-items:center;gap:4px" ${money<crewCost?'disabled':''}>${renderAssetIcon(ct,'xl')}<span style="font-weight:bold;color:${ct.color}">${ct.name}</span><span style="font-size:0.85em;color:#94a3b8">${ct.desc}</span></button>`).join('')}</div></div>`}
        <div style="font-size:0.6em;color:#94a3b8;margin-bottom:8px;padding:6px;background:rgba(0,0,0,0.2);border-radius:4px">
            ðŸ’¡ Crew earns money every 5 seconds but may steal from your cash! Train <b>Loyalty</b> to reduce theft risk.
        </div>
        <div class="grid-2col">${thieves.length?thieves.map(c=>{
            const r=getCrewRank(c);const ct=crewTypes.find(t=>t.id===(c.type||'enforcer'))||crewTypes[0];
            const costMult=(ct.id==='insider'?0.7:1);
            const lc=Math.floor(2500*Math.pow(1.9,c.loyalty)*costMult),sc=Math.floor(7000*Math.pow(1.9,c.skill)*costMult),ec=Math.floor(4500*Math.pow(1.9,c.exp)*costMult);
            const bgImage=c.portrait||crewPortraits[c.name]||'';
            const isNew=Date.now()-c.id<1000;
            return `<div class="thief-card" style="background-image:url('${bgImage}');${isNew?'animation:crewAppear 0.6s ease-out;':''}">
                <div class="thief-card-header">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                        <span style="font-weight:bold;font-size:0.95em;text-shadow:0 2px 4px rgba(0,0,0,0.9);display:flex;align-items:center;gap:6px">${renderAssetIcon(ct,'sm')}${c.name}<span class="thief-rank-badge" style="background:${crewRankColors[r]}">${crewRanks[r]}</span></span>
                        <button class="btn btn-red" style="padding:3px 7px;font-size:0.75em" onclick="fireCrew(${c.id})">âœ•</button>
                    </div>
                    <div style="font-size:0.7em;color:${ct.color};font-weight:bold;text-shadow:0 2px 4px rgba(0,0,0,0.9)">${ct.name} - ${ct.desc}</div>
                </div>
                <div class="thief-stats">
                    <div class="thief-stat">
                        <div class="thief-stat-icon">ðŸ’°</div>
                        <div class="thief-stat-info">
                            <div class="thief-stat-label">Income/5s</div>
                            <div class="thief-stat-value">${fmt(getCrewIncome(c))}</div>
                        </div>
                    </div>
                    <div class="thief-stat">
                        <div class="thief-stat-icon">âš ï¸</div>
                        <div class="thief-stat-info">
                            <div class="thief-stat-label">Theft Risk</div>
                            <div class="thief-stat-value" style="color:#ef4444">${(getCrewSteal(c)*100).toFixed(0)}%</div>
                        </div>
                    </div>
                </div>
                <div class="train-grid">
                    <button class="train-btn" onclick="trainCrew(${c.id},'loyalty')" ${money<lc||c.loyalty>=10?'disabled':''}>
                        <div>ðŸ›¡ï¸ ${c.loyalty}/10</div>
                        <div class="train-btn-label">Loyalty<br>${fmtS(lc)}</div>
                    </button>
                    <button class="train-btn" onclick="trainCrew(${c.id},'skill')" ${money<sc||c.skill>=10?'disabled':''}>
                        <div>âš¡ ${c.skill}/10</div>
                        <div class="train-btn-label">Skill<br>${fmtS(sc)}</div>
                    </button>
                    <button class="train-btn" onclick="trainCrew(${c.id},'exp')" ${money<ec||c.exp>=10?'disabled':''}>
                        <div>ðŸ“ˆ ${c.exp}/10</div>
                        <div class="train-btn-label">Experience<br>${fmtS(ec)}</div>
                    </button>
                </div>
            </div>`;
        }).join(''):'<div class="empty-state">No crew members yet.<br>Hire your first crew member above!</div>'}</div>
    `:`<div class="locked-content"><div class="lock-icon">ðŸ”’</div><h3>Crew</h3><p>Reach Rank 1 (ðŸ’œ Hustler) to hire crew members for passive income!</p></div>`;
    
    // Storage & Specials
    const allStorage=[...storageLocations.map(s=>({...s,owned:true})),...storageTypes.filter(s=>!storageLocations.find(x=>x.name===s.name)).map((s,i)=>({...s,owned:false,idx:storageTypes.indexOf(s)}))];
    document.getElementById('storageList').innerHTML=allStorage.map(s=>{
        if(s.owned){const pct=s.stored/s.cap*100;return `<div class="storage-card"${getCardArtStyle(s,'linear-gradient(180deg, rgba(51,35,8,0.82), rgba(15,23,42,0.5))')}><div class="card-art-text" style="display:flex;justify-content:space-between;font-weight:bold;align-items:center;gap:8px"><span class="upgrade-name">${renderAssetIcon(s)}${getDisplayName(s)}</span><span style="font-size:0.9em">${fmtS(s.stored)}/${fmtS(s.cap)}</span></div><div class="storage-bar"><div class="storage-fill" style="width:${pct}%"></div></div><div class="storage-btns"><button class="btn btn-gold" onclick="deposit(${s.id},100000)" ${money<100000||s.stored>=s.cap?'disabled':''}>+100K</button><button class="btn btn-gold" onclick="deposit(${s.id},money)" ${money===0||s.stored>=s.cap?'disabled':''}>All</button><button class="btn btn-gold" onclick="withdraw(${s.id})" ${s.stored===0?'disabled':''}>Take</button></div></div>`}
        return `<div class="upgrade-card ${money>=s.cost?'affordable':''}"${getCardArtStyle(s,'linear-gradient(180deg, rgba(51,35,8,0.82), rgba(15,23,42,0.5))')}><div class="upgrade-header card-art-text"><span class="upgrade-name">${renderAssetIcon(s)}${getDisplayName(s)}</span></div><div class="upgrade-meta"><span>Holds ${fmtS(s.cap)}</span><b>${fmtS(s.cost)}</b></div><button class="upgrade-btn" onclick="buyStorage(${s.idx})" ${money>=s.cost?'':'disabled'}>Buy</button></div>`;
    }).join('');
    
    document.getElementById('specialList').innerHTML=specialUpgrades.map(u=>`<div class="upgrade-card ${u.owned?'maxed':(money>=u.cost?'affordable':'')}"${getCardArtStyle(u,'linear-gradient(180deg, rgba(56,14,14,0.82), rgba(15,23,42,0.56))')}><div class="upgrade-header card-art-text"><span class="upgrade-name">${renderAssetIcon(u)}${getDisplayName(u)}</span><span style="font-size:0.6em;color:${u.owned?'#ffd700':'#fbbf24'}">${u.owned?'âœ“':fmtS(u.cost)}</span></div><div class="card-art-text" style="font-size:0.6em;color:#cbd5e1">${u.desc}</div>${!u.owned?`<button class="upgrade-btn" onclick="buySpecial('${u.id}')" ${money>=u.cost?'':'disabled'}>Buy</button>`:''}</div>`).join('');
}

// === MINIGAMES ===
function closeMiniGame(){document.getElementById('mgOverlay').classList.remove('active')}
function openMiniGame(type){
    document.getElementById('mgOverlay').classList.add('active');
    const c=document.getElementById('mgContainer');
    if(type==='casino')renderCasino(c);
    else if(type==='safe')renderSafe(c);
    else if(type==='factory')renderFactory(c);
}

// CASINO HUB
let casinoGame='slots';
function renderCasino(c){
    c.innerHTML=`<button class="mg-close" onclick="closeMiniGame()">âœ•</button>
        <div class="mg-title">ðŸŽ° CASINO ðŸŽ°</div>
        <div class="mg-balance">Cash: <span id="casinoBal">${fmt(money)}</span></div>
        <div class="slot-select">
            <button class="slot-select-btn ${casinoGame==='slots'?'active':''}" onclick="casinoGame='slots';renderCasino(document.getElementById('mgContainer'))"><span class="icon">${renderAssetIcon({asset:casinoArt.slots,name:'Slots',icon:''},'lg')}</span><span class="name">Slots</span></button>
            <button class="slot-select-btn ${casinoGame==='dice'?'active':''}" onclick="casinoGame='dice';renderCasino(document.getElementById('mgContainer'))"><span class="icon">${renderAssetIcon({asset:casinoArt.dice,name:'Dice',icon:''},'lg')}</span><span class="name">Dice</span></button>
            <button class="slot-select-btn ${casinoGame==='roulette'?'active':''}" onclick="casinoGame='roulette';renderCasino(document.getElementById('mgContainer'))"><span class="icon">${renderAssetIcon({asset:casinoArt.roulette,name:'Roulette',icon:''},'lg')}</span><span class="name">Roulette</span></button>
        </div>
        <div id="casinoGameArea"></div>`;
    if(casinoGame==='slots')renderSlots(document.getElementById('casinoGameArea'));
    else if(casinoGame==='dice')renderDice(document.getElementById('casinoGameArea'));
    else if(casinoGame==='roulette')renderRoulette(document.getElementById('casinoGameArea'));
}

// SLOTS
let slotBet=1000,slotSpinning=false,slotBonusSpins=0,slotType='classic';
const slotSymbols=['ðŸ’','ðŸ‹','ðŸ””','ðŸ’Ž','7ï¸âƒ£','ðŸŽ°'];
const slotPayouts={'ðŸ’ðŸ’ðŸ’':3,'ðŸ‹ðŸ‹ðŸ‹':5,'ðŸ””ðŸ””ðŸ””':10,'ðŸ’ŽðŸ’ŽðŸ’Ž':25,'7ï¸âƒ£7ï¸âƒ£7ï¸âƒ£':50,'ðŸŽ°ðŸŽ°ðŸŽ°':100};
const megaSymbols=['ðŸ’°','ðŸ’Ž','ðŸ””','â­','ðŸ‘‘','7ï¸âƒ£','ðŸƒ'];
const megaValues={'ðŸ’°':1,'ðŸ’Ž':2,'ðŸ””':3,'â­':5,'ðŸ‘‘':8,'7ï¸âƒ£':15,'ðŸƒ':0};
let megaMultiplier=1,megaReels=[];

function renderSlots(c){
    c.innerHTML=`<div class="slot-select" style="margin-top:6px;grid-template-columns:1fr 1fr">
            <button class="slot-select-btn ${slotType==='classic'?'active':''}" onclick="slotType='classic';renderSlots(document.getElementById('casinoGameArea'))"><span class="icon">${renderAssetIcon({asset:casinoArt.classic,name:'Classic',icon:''},'lg')}</span><span class="name">Classic</span></button>
            <button class="slot-select-btn ${slotType==='mega'?'active':''}" onclick="slotType='mega';renderSlots(document.getElementById('casinoGameArea'))"><span class="icon">${renderAssetIcon({asset:casinoArt.mega,name:'Megaways',icon:''},'lg')}</span><span class="name">Megaways</span></button>
        </div>
        <div id="slotGameArea"></div>`;
    if(slotType==='classic')renderClassicSlots();else renderMegaways();
}

function renderClassicSlots(){
    const area=document.getElementById('slotGameArea');
    const ext=[...slotSymbols,...slotSymbols,...slotSymbols];
    area.innerHTML=`<div class="slot-machine">
        <div class="slot-reels">${[0,1,2].map(i=>`<div class="slot-reel" id="reel${i}"><div class="reel-strip" id="strip${i}">${ext.map(s=>`<div class="reel-symbol">${s}</div>`).join('')}</div></div>`).join('')}</div>
        <div class="slot-controls">
            <div class="slot-bet-row"><button id="betDown" onclick="adjustSlotBet(-1000)">âˆ’</button><div class="slot-bet">Bet: <b id="slotBetAmt">${fmt(slotBet)}</b></div><button id="betUp" onclick="adjustSlotBet(1000)">+</button></div>
            <button class="slot-spin-btn" id="slotSpinBtn" onclick="spinClassicSlots()">ðŸŽ² SPIN ðŸŽ²</button>
            <button class="slot-bonus-btn" id="bonusBtn" onclick="buyClassicBonus()">ðŸ’« Buy 5 Bonus (95% Win!) - ${fmt(slotBet*8)}</button>
            <div class="slot-result" id="slotResult"></div>
            <div id="bonusInfo" style="text-align:center;color:#ffd700;font-size:0.8em;display:${slotBonusSpins>0?'block':'none'}">âœ¨ BONUS: <span id="bonusCount">${slotBonusSpins}</span> spins (95% win!)</div>
        </div>
        <div class="slot-paytable"><div>ðŸ’x3=3x</div><div>ðŸ‹x3=5x</div><div>ðŸ””x3=10x</div><div>ðŸ’Žx3=25x</div><div>7ï¸âƒ£x3=50x</div><div>ðŸŽ°x3=100x</div></div>
    </div>`;
}

function adjustSlotBet(amt){if(slotSpinning)return;slotBet=Math.max(100,Math.min(money,slotBet+amt));const el=document.getElementById('slotBetAmt');if(el)el.textContent=fmt(slotBet)}
function buyClassicBonus(){if(slotSpinning)return;const cost=slotBet*8;if(money>=cost){money-=cost;slotBonusSpins+=5;updateSlotUI();updateAll();saveGame()}}

function spinClassicSlots(){
    if(slotSpinning)return;
    const isBonus=slotBonusSpins>0;
    if(!isBonus){if(money<slotBet)return;money-=slotBet}else{slotBonusSpins--}
    slotSpinning=true;updateAll();updateSlotUI();
    document.getElementById('slotResult').textContent='';document.getElementById('slotResult').className='slot-result';
    
    let results;
    if(isBonus&&Math.random()<0.95){const w=slotSymbols[Math.floor(Math.random()*slotSymbols.length)];results=[w,w,w]}
    else{results=[0,1,2].map(()=>slotSymbols[Math.floor(Math.random()*slotSymbols.length)])}
    
    const strips=[0,1,2].map(i=>document.getElementById('strip'+i));
    const symbolH=80,totalSyms=slotSymbols.length*3;
    
    strips.forEach((strip,i)=>{
        const targetIdx=slotSymbols.indexOf(results[i])+slotSymbols.length;
        const spins=3+i;const finalY=-(targetIdx*symbolH);
        let currentY=0,speed=40+i*5,decel=0.97;const totalDist=spins*totalSyms*symbolH+Math.abs(finalY);let travelled=0;
        const spin=()=>{
            travelled+=speed;currentY-=speed;
            if(currentY<-totalSyms*symbolH)currentY+=totalSyms*symbolH;
            strip.style.transform=`translateY(${currentY}px)`;
            if(travelled<totalDist*0.7)requestAnimationFrame(spin);
            else{speed*=decel;if(speed>2)requestAnimationFrame(spin);else{strip.style.transform=`translateY(${finalY}px)`;if(i===2)finishClassicSpin(results)}}
        };
        setTimeout(spin,i*150);
    });
}

function finishClassicSpin(results){
    slotSpinning=false;
    const combo=results.join('');const payout=slotPayouts[combo];
    const el=document.getElementById('slotResult');
    if(payout){
        const win=slotBet*payout;money+=win;totalEarned+=win;
        if(payout>=50){el.textContent=`ðŸŽ‰ JACKPOT! +${fmt(win)} ðŸŽ‰`;el.className='slot-result jackpot';vib([100,50,100,50,100,50,200])}
        else{el.textContent=`WIN! +${fmt(win)}`;el.className='slot-result win';vib([50,30,50])}
    }else if(results[0]===results[1]||results[1]===results[2]){
        const win=Math.floor(slotBet*0.5);money+=win;totalEarned+=win;el.textContent=`Close! +${fmt(win)}`;el.className='slot-result win'
    }else{el.textContent='Try again!';el.className='slot-result lose'}
    updateSlotUI();updateAll();saveGame();
}

function renderMegaways(){
    megaMultiplier=1;megaReels=[];
    for(let i=0;i<6;i++){const count=Math.floor(Math.random()*6)+2;megaReels.push(Array(count).fill(0).map(()=>megaSymbols[Math.floor(Math.random()*megaSymbols.length)]))}
    const ways=megaReels.reduce((a,r)=>a*r.length,1);
    const area=document.getElementById('slotGameArea');
    area.innerHTML=`<div class="slot-machine">
        <div class="mega-info"><span class="ways">Ways: <b id="megaWays">${ways.toLocaleString()}</b></span><span class="mult">Multiplier: <b id="megaMult">x${megaMultiplier}</b></span></div>
        <div class="mega-reels" id="megaReelsContainer">${megaReels.map((reel,ri)=>`<div class="mega-reel">${reel.map((s,si)=>`<div class="mega-symbol" data-r="${ri}" data-s="${si}">${s}</div>`).join('')}</div>`).join('')}</div>
        <div class="mega-cascade-info" id="cascadeInfo"></div>
        <div class="slot-controls">
            <div class="slot-bet-row"><button id="betDown" onclick="adjustSlotBet(-1000)">âˆ’</button><div class="slot-bet">Bet: <b id="slotBetAmt">${fmt(slotBet)}</b></div><button id="betUp" onclick="adjustSlotBet(1000)">+</button></div>
            <button class="slot-spin-btn" id="slotSpinBtn" onclick="spinMegaways()">ðŸŽ² SPIN ðŸŽ²</button>
            <button class="slot-bonus-btn" id="bonusBtn" onclick="buyMegaBonus()">ðŸ’« Bonus (5 spins, x4 start) - ${fmt(slotBet*12)}</button>
            <div class="slot-result" id="slotResult"></div>
            <div id="bonusInfo" style="text-align:center;color:#ffd700;font-size:0.8em;display:${slotBonusSpins>0?'block':'none'}">âœ¨ BONUS: <span id="bonusCount">${slotBonusSpins}</span></div>
        </div>
        <div style="font-size:0.6em;color:#94a3b8;text-align:center;margin-top:6px">Match 3+ adjacent â€¢ Cascades increase multiplier â€¢ ðŸƒ=Wild</div>
    </div>`;
}

function buyMegaBonus(){if(slotSpinning)return;const cost=slotBet*12;if(money>=cost){money-=cost;slotBonusSpins+=5;megaMultiplier=4;updateSlotUI();updateAll();saveGame();renderMegaways()}}

function spinMegaways(){
    if(slotSpinning)return;
    const isBonus=slotBonusSpins>0;
    if(!isBonus){if(money<slotBet)return;money-=slotBet;megaMultiplier=1}else{slotBonusSpins--;if(megaMultiplier<4)megaMultiplier=4}
    slotSpinning=true;updateAll();updateSlotUI();
    
    for(let i=0;i<6;i++){const count=Math.floor(Math.random()*6)+2;megaReels[i]=Array(count).fill(0).map(()=>megaSymbols[Math.floor(Math.random()*megaSymbols.length)])}
    document.getElementById('megaReelsContainer').innerHTML=megaReels.map((reel,ri)=>`<div class="mega-reel">${reel.map((s,si)=>`<div class="mega-symbol cascade" data-r="${ri}" data-s="${si}">${s}</div>`).join('')}</div>`).join('');
    document.getElementById('megaWays').textContent=megaReels.reduce((a,r)=>a*r.length,1).toLocaleString();
    document.getElementById('megaMult').textContent='x'+megaMultiplier;
    document.getElementById('slotResult').textContent='';document.getElementById('slotResult').className='slot-result';
    document.getElementById('cascadeInfo').textContent='';
    
    setTimeout(()=>{document.querySelectorAll('.mega-symbol').forEach(s=>s.classList.remove('cascade'));checkMegaWins(0)},400);
}

function checkMegaWins(cascadeNum){
    const wins=findMegaWins();
    if(wins.length===0){slotSpinning=false;if(cascadeNum===0){document.getElementById('slotResult').textContent='No wins';document.getElementById('slotResult').className='slot-result lose'}updateSlotUI();updateAll();saveGame();return}
    
    let totalWin=0;
    wins.forEach(w=>{
        w.positions.forEach(p=>{const el=document.querySelector(`[data-r="${p.r}"][data-s="${p.s}"]`);if(el)el.classList.add('winning')});
        totalWin+=Math.floor(slotBet*(megaValues[w.symbol]||1)*w.count*0.5*megaMultiplier);
    });
    
    money+=totalWin;totalEarned+=totalWin;
    document.getElementById('slotResult').textContent=`+${fmt(totalWin)}`;document.getElementById('slotResult').className='slot-result win';
    document.getElementById('cascadeInfo').textContent=`Cascade #${cascadeNum+1} â€¢ x${megaMultiplier}`;
    if(totalWin>slotBet*10)vib([50,30,50]);
    updateSlotUI();updateAll();
    
    setTimeout(()=>{
        wins.forEach(w=>{w.positions.forEach(p=>{if(megaReels[p.r])megaReels[p.r][p.s]=null})});
        megaReels=megaReels.map(reel=>{const rem=reel.filter(s=>s!==null);const need=reel.length-rem.length;return[...Array(need).fill(0).map(()=>megaSymbols[Math.floor(Math.random()*megaSymbols.length)]),...rem]});
        megaMultiplier++;
        document.getElementById('megaMult').textContent='x'+megaMultiplier;
        document.getElementById('megaReelsContainer').innerHTML=megaReels.map((reel,ri)=>`<div class="mega-reel">${reel.map((s,si)=>`<div class="mega-symbol cascade" data-r="${ri}" data-s="${si}">${s}</div>`).join('')}</div>`).join('');
        updateSlotUI();
        setTimeout(()=>{document.querySelectorAll('.mega-symbol').forEach(s=>s.classList.remove('cascade'));checkMegaWins(cascadeNum+1)},400);
    },600);
}

function findMegaWins(){
    const wins=[],checked=new Set();
    for(let r=0;r<megaReels.length-2;r++){
        for(let s=0;s<megaReels[r].length;s++){
            const sym=megaReels[r][s];if(sym==='ðŸƒ')continue;
            const chain=[{r,s}];
            for(let nr=r+1;nr<megaReels.length;nr++){
                const next=[];for(let ns=0;ns<megaReels[nr].length;ns++){if(megaReels[nr][ns]===sym||megaReels[nr][ns]==='ðŸƒ')next.push({r:nr,s:ns})}
                if(next.length===0)break;chain.push(...next);
            }
            if(chain.length>=3){const key=chain.map(p=>`${p.r}-${p.s}`).sort().join('|');if(!checked.has(key)){checked.add(key);wins.push({symbol:sym,count:chain.length,positions:chain})}}
        }
    }
    return wins;
}

function updateSlotUI(){
    const bal=document.getElementById('casinoBal');if(bal)bal.textContent=fmt(money);
    const btn=document.getElementById('slotSpinBtn');if(btn)btn.disabled=slotSpinning||money<slotBet;
    ['betUp','betDown','bonusBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=slotSpinning});
    const bi=document.getElementById('bonusInfo');if(bi){bi.style.display=slotBonusSpins>0?'block':'none';const bc=document.getElementById('bonusCount');if(bc)bc.textContent=slotBonusSpins}
}

// SAFE CRACKER
let safeCombo=[],safeTarget=[],safePointer=0,safeIdx=0,safeBet=5000;
function renderSafe(c){
    safeBet=Math.min(money,Math.max(1000,Math.floor(money*0.01)));
    safeTarget=[Math.floor(Math.random()*100),Math.floor(Math.random()*100),Math.floor(Math.random()*100)];
    safeCombo=[];safeIdx=0;safePointer=0;
    const markers=[0,25,50,75].map(n=>`<div class="safe-marker" style="transform: rotate(${n*3.6}deg)"><span style="transform: rotate(-${n*3.6}deg)">${n}</span></div>`).join('');
    c.innerHTML=`<button class="mg-close" onclick="closeMiniGame()">âœ•</button>
        <div class="mg-title">ðŸ” VAULT CRACKER ðŸ”</div>
        <div class="mg-balance">Cash: <span id="safeBal">${fmt(money)}</span></div>
        <div class="safe-game">
            <div class="safe-info">Crack the 3-number combo! Bet: <b style="color:#4ade80">${fmt(safeBet)}</b> â†’ Win: <b style="color:#ffd700">${fmt(safeBet*10)}</b></div>
            <div style="position:relative;display:flex;flex-direction:column;align-items:center">
                <div class="safe-dial">${markers}<div class="safe-pointer" id="safePointer"></div></div>
                <div style="margin-top:8px;font-size:1.2em;font-weight:bold;color:#fbbf24">Current: <span id="safeCurrentNum">0</span></div>
            </div>
            <div class="safe-combo"><div class="safe-combo-num active" id="sc0">?</div><div class="safe-combo-num" id="sc1">?</div><div class="safe-combo-num" id="sc2">?</div></div>
            <div class="safe-controls"><button onclick="turnSafe(-5)">âŸ² -5</button><button onclick="turnSafe(-1)">âŸ² -1</button><button onclick="turnSafe(1)">+1 âŸ³</button><button onclick="turnSafe(5)">+5 âŸ³</button></div>
            <button class="safe-submit" onclick="submitSafe()">ðŸ”“ TRY</button>
            <div class="slot-result" id="safeResult"></div>
            <div style="margin-top:6px;font-size:0.65em;color:#64748b">Turn the dial to set numbers 0-99. Get within Â±5 of target!</div>
        </div>`;
    document.getElementById('safePointer').style.transform=`translateX(-50%) rotate(${(safePointer/100)*360}deg)`;
}
function turnSafe(amt){safePointer=(safePointer+amt+100)%100;document.getElementById('safePointer').style.transform=`translateX(-50%) rotate(${(safePointer/100)*360}deg)`;const numEl=document.getElementById('safeCurrentNum');if(numEl)numEl.textContent=safePointer}
function submitSafe(){
    if(safeIdx>=3)return;
    const target=safeTarget[safeIdx];const diff=Math.abs(safePointer-target);const correct=diff<=5||diff>=95;
    const el=document.getElementById('sc'+safeIdx);el.textContent=safePointer;el.classList.remove('active');el.classList.add(correct?'correct':'wrong');
    safeCombo.push({val:safePointer,correct});
    if(!correct){document.getElementById('safeResult').textContent=safePointer<target?'â†‘ Higher':'â†“ Lower';document.getElementById('safeResult').className='slot-result lose';money-=Math.floor(safeBet/3);vib([80]);updateAll()}
    safeIdx++;
    if(safeIdx<3){document.getElementById('sc'+safeIdx).classList.add('active');if(correct){document.getElementById('safeResult').textContent='âœ“ Click!';document.getElementById('safeResult').className='slot-result win'}}
    else{
        const wins=safeCombo.filter(x=>x.correct).length;const res=document.getElementById('safeResult');
        if(wins===3){const win=safeBet*10;money+=win;totalEarned+=win;res.textContent=`ðŸŽ‰ CRACKED! +${fmt(win)}`;res.className='slot-result jackpot';vib([100,50,100,50,200])}
        else if(wins===2){const win=safeBet*2;money+=win;totalEarned+=win;res.textContent=`Close! 2/3 +${fmt(win)}`;res.className='slot-result win';vib([50,30])}
        else{res.textContent='Vault secured!';res.className='slot-result lose'}
        updateAll();saveGame();setTimeout(()=>{if(document.getElementById('mgOverlay').classList.contains('active'))renderSafe(document.getElementById('mgContainer'))},2500);
    }
    document.getElementById('safeBal').textContent=fmt(money);
}

// DICE GAME
let diceBet=1000,diceChoice=null,diceRolling=false;
const diceOpts=[{id:'low',name:'Low 2-6',payout:2},{id:'mid',name:'Mid 7',payout:4},{id:'high',name:'High 8-12',payout:2},{id:'doubles',name:'Doubles',payout:5},{id:'snake',name:'Snake Eyes',payout:30},{id:'boxcars',name:'Boxcars',payout:30}];
function getDiceFace(num){
    const dots={
        1:['c'],
        2:['a','e'],
        3:['a','c','e'],
        4:['a','b','d','e'],
        5:['a','b','c','d','e'],
        6:['a','b','c','d','e','c']
    };
    const positions={a:'grid-area:a',b:'grid-area:b',c:'grid-area:c',d:'grid-area:d',e:'grid-area:e'};
    if(num===6)return '<div class="dice-dot" style="grid-area:a"></div><div class="dice-dot" style="grid-area:c"></div><div class="dice-dot" style="grid-area:b"></div><div class="dice-dot" style="grid-area:d"></div><div class="dice-dot" style="grid-area:c"></div><div class="dice-dot" style="grid-area:e"></div>';
    return dots[num].map(p=>`<div class="dice-dot" style="${positions[p]}"></div>`).join('');
}
function renderDice(c){
    c.innerHTML=`<div class="dice-game" style="margin-top:8px">
            <div class="dice-container" style="margin:15px 0"><div class="dice" id="dice1">${getDiceFace(1)}</div><div class="dice" id="dice2">${getDiceFace(1)}</div></div>
            <div class="slot-bet-row" style="margin:10px 0"><button onclick="diceBet=Math.max(100,diceBet-1000);document.getElementById('diceBetAmt').textContent=fmt(diceBet)">âˆ’</button><div class="slot-bet">Bet: <b id="diceBetAmt">${fmt(diceBet)}</b></div><button onclick="diceBet=Math.min(money,diceBet+1000);document.getElementById('diceBetAmt').textContent=fmt(diceBet)">+</button></div>
            <div style="font-size:0.75em;color:#94a3b8;margin-bottom:8px;font-weight:bold">Choose your bet:</div>
            <div class="dice-bet-options">${diceOpts.map(o=>`<div class="dice-bet-opt" data-id="${o.id}" onclick="diceChoice='${o.id}';document.querySelectorAll('.dice-bet-opt').forEach(x=>x.classList.remove('selected'));this.classList.add('selected');document.getElementById('diceRollBtn').disabled=false"><div style="font-weight:bold;margin-bottom:2px">${o.name}</div><div class="payout">${o.payout}x payout</div></div>`).join('')}</div>
            <button class="dice-roll-btn" id="diceRollBtn" onclick="rollDice()" disabled>ðŸŽ² ROLL DICE ðŸŽ²</button>
            <div class="slot-result" id="diceResult"></div>
        </div>`;
    diceChoice=null;
}
function rollDice(){
    if(diceRolling||!diceChoice||money<diceBet)return;
    money-=diceBet;diceRolling=true;updateAll();
    document.querySelectorAll('.dice').forEach(d=>d.classList.add('rolling'));
    document.getElementById('diceResult').textContent='';document.getElementById('diceResult').className='slot-result';
    const d1=Math.floor(Math.random()*6)+1,d2=Math.floor(Math.random()*6)+1,total=d1+d2;
    setTimeout(()=>{document.getElementById('dice1').innerHTML=getDiceFace(d1);document.getElementById('dice1').classList.remove('rolling')},400);
    setTimeout(()=>{
        document.getElementById('dice2').innerHTML=getDiceFace(d2);document.getElementById('dice2').classList.remove('rolling');
        diceRolling=false;
        let win=0;const opt=diceOpts.find(o=>o.id===diceChoice);
        if((diceChoice==='low'&&total<=6)||(diceChoice==='mid'&&total===7)||(diceChoice==='high'&&total>=8)||(diceChoice==='doubles'&&d1===d2)||(diceChoice==='snake'&&d1===1&&d2===1)||(diceChoice==='boxcars'&&d1===6&&d2===6))win=diceBet*opt.payout;
        const res=document.getElementById('diceResult');res.textContent=`Rolled: ${total}`;
        if(win>0){money+=win;totalEarned+=win;res.textContent+=` â†’ WIN! +${fmt(win)}`;res.className='slot-result '+(opt.payout>=10?'jackpot':'win');vib(opt.payout>=10?[100,50,100,50,200]:[50,30])}
        else{res.textContent+=' â†’ No match';res.className='slot-result lose'}
        document.getElementById('casinoBal').textContent=fmt(money);updateAll();saveGame();
    },800);
}

// FACTORY ASSEMBLY LINE
let factoryActive=false,factoryScore=0,factoryTime=30,factoryItems=[],factoryInterval=null;
const factoryProducts=['ðŸ“¦','ðŸ”§','âš™ï¸','ðŸ”©','ðŸ› ï¸'];
function renderFactory(c){
    c.innerHTML=`<button class="mg-close" onclick="closeMiniGame();if(factoryInterval)clearInterval(factoryInterval)">âœ•</button>
        <div class="mg-title">ðŸ­ ASSEMBLY LINE ðŸ­</div>
        <div class="mg-balance">Cash: <span id="factoryBal">${fmt(money)}</span></div>
        <div class="safe-game">
            <div class="safe-info">Click matching items as they pass! Time: <b style="color:#4ade80"><span id="factoryTimer">30</span>s</b> | Score: <b style="color:#ffd700"><span id="factoryScore">0</span></b></div>
            <div style="margin:15px 0;min-height:180px">
                <div style="text-align:center;font-size:2em;margin-bottom:10px">Target: <span id="factoryTarget" style="color:#ffd700">?</span></div>
                <div id="factoryBelt" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px auto;max-width:300px"></div>
            </div>
            <button class="safe-submit" id="factoryStartBtn" onclick="startFactory()">ðŸ­ START PRODUCTION</button>
            <div class="slot-result" id="factoryResult"></div>
            <div style="margin-top:6px;font-size:0.65em;color:#64748b">Click correct items quickly! Each correct: +$${fmt(500)}. Wrong click: -$${fmt(100)}</div>
        </div>`;
}
function startFactory(){
    if(factoryActive)return;
    factoryActive=true;factoryScore=0;factoryTime=30;factoryItems=[];
    document.getElementById('factoryStartBtn').disabled=true;
    document.getElementById('factoryResult').textContent='';
    const target=factoryProducts[Math.floor(Math.random()*factoryProducts.length)];
    document.getElementById('factoryTarget').textContent=target;
    factoryInterval=setInterval(()=>{
        factoryTime--;
        document.getElementById('factoryTimer').textContent=factoryTime;
        if(factoryTime<=0){endFactory();return}
        if(Math.random()<0.7){
            const item=Math.random()<0.4?target:factoryProducts[Math.floor(Math.random()*factoryProducts.length)];
            const id=Date.now()+Math.random();
            factoryItems.push({id,item,correct:item===target});
            if(factoryItems.length>12)factoryItems.shift();
        }
        renderFactoryBelt(target);
    },800);
}
function renderFactoryBelt(target){
    const belt=document.getElementById('factoryBelt');
    belt.innerHTML=factoryItems.map(fi=>`<div onclick="clickFactoryItem('${fi.id}','${fi.correct}')" style="font-size:2.5em;cursor:pointer;background:rgba(255,255,255,0.1);border-radius:8px;padding:10px;text-align:center;transition:transform 0.1s" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">${fi.item}</div>`).join('');
}
function clickFactoryItem(id,correct){
    if(!factoryActive)return;
    const isCorrect=correct==='true';
    factoryItems=factoryItems.filter(fi=>fi.id!=id);
    if(isCorrect){factoryScore++;money+=500;totalEarned+=500;vib([20,10])}
    else{money=Math.max(0,money-100);vib([50])}
    document.getElementById('factoryScore').textContent=factoryScore;
    document.getElementById('factoryBal').textContent=fmt(money);
    updateAll();
}
function endFactory(){
    clearInterval(factoryInterval);factoryActive=false;
    const bonus=factoryScore*500;const total=bonus;
    const res=document.getElementById('factoryResult');
    if(factoryScore>=20){res.textContent=`ðŸŽ‰ EXCELLENT! Score: ${factoryScore} â†’ Bonus: +${fmt(total)}`;res.className='slot-result jackpot';money+=total;totalEarned+=total;vib([100,50,100,50,200])}
    else if(factoryScore>=10){res.textContent=`âœ“ Good work! Score: ${factoryScore}`;res.className='slot-result win';vib([50,30])}
    else{res.textContent=`Score: ${factoryScore}. Keep practicing!`;res.className='slot-result'}
    document.getElementById('factoryStartBtn').disabled=false;
    document.getElementById('factoryBal').textContent=fmt(money);
    updateAll();saveGame();
}

// ROULETTE
let rouletteBet=1000,rouletteChoice=null,rouletteSpinning=false;
const rouletteNumbers=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const redNums=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const rouletteBets=[
    {id:'red',name:'Red',payout:2,desc:'1-18 red'},
    {id:'black',name:'Black',payout:2,desc:'1-18 black'},
    {id:'low',name:'1-18',payout:2,desc:'Low half'},
    {id:'high',name:'19-36',payout:2,desc:'High half'},
    {id:'even',name:'Even',payout:2,desc:'Even numbers'},
    {id:'odd',name:'Odd',payout:2,desc:'Odd numbers'},
    {id:'zero',name:'0 (Zero)',payout:35,desc:'Jackpot!'}
];
function renderRoulette(c){
    c.innerHTML=`<div style="margin-top:8px">
            <div style="position:relative;width:180px;height:180px;margin:10px auto;background:radial-gradient(circle,#1a1a2e,#0f0f1e);border-radius:50%;border:8px solid #ffd700;display:flex;align-items:center;justify-content:center;flex-direction:column">
                <div id="rouletteWheel" style="font-size:2.5em;transition:transform 0.05s">ðŸŽ¯</div>
                <div id="rouletteResult" style="font-size:1.8em;font-weight:bold;color:#ffd700;margin-top:8px"></div>
            </div>
            <div class="slot-bet-row" style="margin:8px 0"><button onclick="rouletteBet=Math.max(100,rouletteBet-1000);document.getElementById('rouletteBetAmt').textContent=fmt(rouletteBet)">âˆ’</button><div class="slot-bet">Bet: <b id="rouletteBetAmt">${fmt(rouletteBet)}</b></div><button onclick="rouletteBet=Math.min(money,rouletteBet+1000);document.getElementById('rouletteBetAmt').textContent=fmt(rouletteBet)">+</button></div>
            <div style="font-size:0.7em;color:#94a3b8;margin-bottom:6px;font-weight:bold">Place your bet:</div>
            <div class="dice-bet-options" style="grid-template-columns:repeat(2,1fr)">${rouletteBets.map(b=>`<div class="dice-bet-opt" data-id="${b.id}" onclick="rouletteChoice='${b.id}';document.querySelectorAll('.dice-bet-opt').forEach(x=>x.classList.remove('selected'));this.classList.add('selected');document.getElementById('rouletteSpinBtn').disabled=false"><div style="font-weight:bold;margin-bottom:2px">${b.name}</div><div class="payout">${b.payout}x</div></div>`).join('')}</div>
            <button class="dice-roll-btn" id="rouletteSpinBtn" onclick="spinRoulette()" disabled>ðŸŽ¯ SPIN ðŸŽ¯</button>
            <div class="slot-result" id="rouletteWinResult" style="margin-top:8px"></div>
        </div>`;
    rouletteChoice=null;
}
function spinRoulette(){
    if(rouletteSpinning||!rouletteChoice||money<rouletteBet)return;
    money-=rouletteBet;rouletteSpinning=true;updateAll();
    const wheel=document.getElementById('rouletteWheel');
    const result=document.getElementById('rouletteResult');
    const winResult=document.getElementById('rouletteWinResult');
    result.textContent='';winResult.textContent='';winResult.className='slot-result';
    let spins=0;const maxSpins=30;
    const spinInterval=setInterval(()=>{
        wheel.style.transform=`rotate(${spins*36}deg)`;
        spins++;
        if(spins>=maxSpins){
            clearInterval(spinInterval);
            const num=rouletteNumbers[Math.floor(Math.random()*rouletteNumbers.length)];
            const isRed=redNums.includes(num);
            result.textContent=num;result.style.color=num===0?'#22c55e':(isRed?'#ef4444':'#1f2937');
            setTimeout(()=>{
                let win=0;const bet=rouletteBets.find(b=>b.id===rouletteChoice);
                if((rouletteChoice==='red'&&isRed)||(rouletteChoice==='black'&&!isRed&&num!==0)||(rouletteChoice==='low'&&num>=1&&num<=18)||(rouletteChoice==='high'&&num>=19)||(rouletteChoice==='even'&&num>0&&num%2===0)||(rouletteChoice==='odd'&&num%2===1)||(rouletteChoice==='zero'&&num===0))win=rouletteBet*bet.payout;
                if(win>0){money+=win;totalEarned+=win;winResult.textContent=`WIN! +${fmt(win)}`;winResult.className='slot-result '+(bet.payout>=10?'jackpot':'win');vib(bet.payout>=10?[100,50,100,50,200]:[50,30])}
                else{winResult.textContent='No match';winResult.className='slot-result lose'}
                document.getElementById('casinoBal').textContent=fmt(money);updateAll();saveGame();
                rouletteSpinning=false;
            },500);
        }
    },50);
}

// === STREET CONTRACTS ===
// Contracts refresh every 3 minutes. 3 active at a time from a pool.
// Progress is tracked live against current session stats.
const CONTRACT_REFRESH_MS = 3 * 60 * 1000;
let contractsNextRefresh = 0;
let activeContracts = [];
let contractClicksBase = 0;   // totalClicks snapshot at contract start
let contractEarnedBase = 0;   // totalEarned snapshot at contract start
let contractHeistsBase = 0;   // totalHeists snapshot at contract start

const contractTemplates = [
    // clicking
    { id:'c_click_25',  icon:'ðŸ‘†', name:'Street Hustle',    desc:'Click 25 times',     type:'clicks', target:25,   rewardMult:3,  repBonus:30  },
    { id:'c_click_75',  icon:'ðŸ‘Š', name:'Grind Session',    desc:'Click 75 times',     type:'clicks', target:75,   rewardMult:5,  repBonus:80  },
    { id:'c_click_150', icon:'ðŸ’ª', name:'Marathon Hustle',  desc:'Click 150 times',    type:'clicks', target:150,  rewardMult:8,  repBonus:150 },
    // earning
    { id:'c_earn_1k',   icon:'ðŸ’µ', name:'Small Score',      desc:'Earn $1K on-hand',   type:'earned', target:1e3,  rewardMult:4,  repBonus:20  },
    { id:'c_earn_10k',  icon:'ðŸ’°', name:'Medium Score',     desc:'Earn $10K on-hand',  type:'earned', target:1e4,  rewardMult:4,  repBonus:60  },
    { id:'c_earn_500k', icon:'ðŸ¦', name:'Big Score',        desc:'Earn $500K on-hand', type:'earned', target:5e5,  rewardMult:5,  repBonus:200 },
    { id:'c_earn_5m',   icon:'ðŸ’Ž', name:'The Big Job',      desc:'Earn $5M on-hand',   type:'earned', target:5e6,  rewardMult:6,  repBonus:500 },
    // heists
    { id:'c_heist_1',   icon:'ðŸŽ¯', name:'First Blood',      desc:'Complete 1 heist',   type:'heists', target:1,    rewardMult:10, repBonus:100 },
    { id:'c_heist_3',   icon:'ðŸ”«', name:'Crime Spree',      desc:'Complete 3 heists',  type:'heists', target:3,    rewardMult:15, repBonus:300 },
    // income
    { id:'c_mps_100',   icon:'ðŸ“ˆ', name:'Revenue Stream',   desc:'Reach $100/s income',type:'mps',    target:100,  rewardMult:3,  repBonus:40  },
    { id:'c_mps_5k',    icon:'ðŸ­', name:'Empire Building',  desc:'Reach $5K/s income', type:'mps',    target:5000, rewardMult:5,  repBonus:150 },
];

function pickContracts() {
    // Pick 3 distinct random contracts weighted toward achievable ones
    const shuffled = [...contractTemplates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(t => ({
        ...t,
        claimed: false,
        completed: false,
        reward: Math.floor(clickPower * t.rewardMult * (1 + getPrestigeBonus('click')) + moneyPerSecond * globalMult * 5 * t.rewardMult),
    }));
}

function refreshContracts() {
    contractClicksBase = totalClicks;
    contractEarnedBase = totalEarned;
    contractHeistsBase = totalHeists;
    activeContracts = pickContracts();
    contractsNextRefresh = Date.now() + CONTRACT_REFRESH_MS;
    renderContracts();
}

function getContractProgress(c) {
    if (c.type === 'clicks')  return Math.min(1, (totalClicks - contractClicksBase) / c.target);
    if (c.type === 'earned')  return Math.min(1, (totalEarned - contractEarnedBase) / c.target);
    if (c.type === 'heists')  return Math.min(1, (totalHeists - contractHeistsBase) / c.target);
    if (c.type === 'mps')     return Math.min(1, (Math.floor(moneyPerSecond * globalMult)) / c.target);
    return 0;
}

function claimContract(idx) {
    const c = activeContracts[idx];
    if (!c || c.claimed || !c.completed) return;
    c.claimed = true;
    money += c.reward;
    totalEarned += c.reward;
    lifetimeEarnings += c.reward;
    reputation += c.repBonus;
    vib([20, 30, 20, 30, 60]);
    SFX.contract();
    showNotif('ðŸ“‹ CONTRACT DONE!', 'heist-win', `+${fmt(c.reward)} Â· +${c.repBonus} rep`);
    const el = document.querySelector(`#contractsList .contract-card:nth-child(${idx + 1})`);
    if (el) { el.classList.add('just-done'); setTimeout(() => el.classList.remove('just-done'), 400); }
    checkAchievements();
    updateAll();
}

function renderContracts() {
    const list = document.getElementById('contractsList');
    if (!list) return;
    list.innerHTML = activeContracts.map((c, i) => {
        const pct = getContractProgress(c);
        c.completed = pct >= 1;
        const pctPx = (pct * 100).toFixed(1);
        const statusCls = c.claimed ? 'expired' : c.completed ? 'completed' : '';
        const btnLabel = c.claimed ? 'âœ“ Done' : c.completed ? 'Claim!' : `${(pct*100).toFixed(0)}%`;
        return `<div class="contract-card ${statusCls}">
            <div class="contract-row">
                <div class="contract-name">${c.icon} ${c.name}</div>
                <div class="contract-reward">+${fmt(c.reward)}</div>
            </div>
            <div class="contract-desc">${c.desc} Â· +${c.repBonus} rep</div>
            <div class="contract-bar-wrap"><div class="contract-bar" style="width:${pctPx}%"></div></div>
            <div class="contract-row">
                <div class="contract-timer">${c.claimed?'Claimed':c.completed?'Ready!':'In progress...'}</div>
                <button class="contract-claim-btn" onclick="claimContract(${i})" ${c.completed&&!c.claimed?'':'disabled'}>${btnLabel}</button>
            </div>
        </div>`;
    }).join('');

    // Refresh countdown
    const secs = Math.max(0, Math.round((contractsNextRefresh - Date.now()) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    const timer = document.getElementById('contractsRefreshTimer');
    if (timer) timer.textContent = `â± ${mm}:${ss}`;
}

setInterval(() => {
    if (Date.now() >= contractsNextRefresh) refreshContracts();
    else renderContracts();
}, 1000);

// === GAME LOOP ===
loadGame();
document.body.className=`rank-${getRank()}`;
if(settings.debug)document.getElementById('debugBtns').style.display='flex';
updateAll();
refreshContracts();
startMojibakeSanitizer();

// === PRESS AND HOLD SYSTEM ===
let holdTimer=null;
let holdInterval=null;
let lastHoldButton=null;

function setupHoldToRepeat(){
    let isHolding=false;

    document.addEventListener('mousedown',(e)=>{
        const btn=e.target.closest('button, .money-circle');
        if(!btn||btn.disabled)return;
        if(btn.classList.contains('modal-close')||btn.classList.contains('tab-btn'))return;

        // Exclude critical buttons that need confirm dialogs
        const clickHandler=btn.getAttribute('onclick');
        if(!clickHandler)return;
        if(clickHandler.includes('hardReset')||clickHandler.includes('confirmPrestige')||clickHandler.includes('fireCrew'))return;

        isHolding=false;
        lastHoldButton=btn;
        holdTimer=setTimeout(()=>{
            isHolding=true;
            holdInterval=setInterval(()=>{
                if(btn.disabled)return;
                try{eval(clickHandler)}catch(e){}
            },100);
        },1000);
    });

    const stopHold=()=>{
        if(holdTimer){clearTimeout(holdTimer);holdTimer=null}
        if(holdInterval){clearInterval(holdInterval);holdInterval=null}
        isHolding=false;
        lastHoldButton=null;
    };

    document.addEventListener('mouseup',stopHold);
    document.addEventListener('mouseleave',(e)=>{if(e.target===document.body)stopHold()});
    document.addEventListener('touchend',stopHold);
    document.addEventListener('touchcancel',stopHold);

    // Touch support
    document.addEventListener('touchstart',(e)=>{
        const btn=e.target.closest('button, .money-circle');
        if(!btn||btn.disabled)return;
        if(btn.classList.contains('modal-close')||btn.classList.contains('tab-btn'))return;

        // Exclude critical buttons that need confirm dialogs
        const clickHandler=btn.getAttribute('onclick');
        if(!clickHandler)return;
        if(clickHandler.includes('hardReset')||clickHandler.includes('confirmPrestige')||clickHandler.includes('fireCrew'))return;

        isHolding=false;
        lastHoldButton=btn;
        holdTimer=setTimeout(()=>{
            isHolding=true;
            holdInterval=setInterval(()=>{
                if(btn.disabled)return;
                try{eval(clickHandler)}catch(e){}
            },100);
        },1000);
    });
}

setupHoldToRepeat();

setInterval(()=>{
    const incomeMultiplier=(activeEffects.incomeBoost?1+activeEffects.incomeBoost.val:1);
    const earned=Math.floor(moneyPerSecond*globalMult*incomeMultiplier);
    money+=earned;
    if(moneyPerSecond>0){totalEarned+=earned;lifetimeEarnings+=earned;reputation+=Math.ceil(earned/4000)}
    policeHeat=Math.max(0,policeHeat-(0.4+heatDecay)/10);
    checkRaid();updateAll();
},1000);

setInterval(()=>{if(thieves.length){processCrew();checkAchievements();updateAll()}},5000);
setInterval(()=>{triggerRandomEvent();clearExpiredEffects()},60000); // Events & effects every minute
setInterval(saveGame,5000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveGame()});

function clearExpiredEffects(){
    const now=Date.now();
    Object.keys(activeEffects).forEach(key=>{
        if(activeEffects[key].ends&&now>=activeEffects[key].ends){
            delete activeEffects[key];
        }
    });
}

