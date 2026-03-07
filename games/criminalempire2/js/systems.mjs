import {
  CITY_BEATS,
  CONTRACT_TEMPLATES,
  CREW_ARCHETYPES,
  DISTRICTS,
  DOSSIERS,
  FACTIONS,
  LEGACY_UPGRADES,
  NEGATIVE_TRAITS,
  PANEL_TABS,
  POSITIVE_TRAITS,
  RANKS,
} from "./data.mjs";
import { createRecruitPool } from "./state.mjs";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function chance(ratePerSecond, dtSeconds) {
  return Math.random() < clamp(ratePerSecond * dtSeconds, 0, 1);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomItem(list) {
  if (!list.length) {
    return null;
  }
  return list[Math.floor(Math.random() * list.length)];
}

export function getArchetype(id) {
  return CREW_ARCHETYPES.find((entry) => entry.id === id) || CREW_ARCHETYPES[0];
}

export function getFaction(id) {
  return FACTIONS[id] || Object.values(FACTIONS)[0];
}

export function getDistrictDef(id) {
  return DISTRICTS.find((entry) => entry.id === id) || DISTRICTS[0];
}

function getPositiveTrait(id) {
  return POSITIVE_TRAITS.find((entry) => entry.id === id) || POSITIVE_TRAITS[0];
}

function getNegativeTrait(id) {
  return NEGATIVE_TRAITS.find((entry) => entry.id === id) || NEGATIVE_TRAITS[0];
}

function getTraitEffects(crew) {
  const effects = {
    heatGain: 0,
    heatMitigation: 0,
    cleanEff: 0,
    stressGain: 0,
    stressRecovery: 0,
    promotionBonus: 0,
    promotionCost: 0,
    frontBonus: 0,
    heistPenalty: 0,
    assaultReward: 0,
    loyaltyShift: 0,
    intelHeist: 0,
  };

  switch (crew.positiveTraitId) {
    case "connected":
      effects.intelHeist = 1;
      break;
    case "ice_cold":
      effects.stressGain -= 0.18;
      break;
    case "velvet_touch":
      effects.cleanEff += 0.12;
      effects.frontBonus += 0.08;
      break;
    case "ghosted":
      effects.heatMitigation += 0.08;
      break;
    case "loyal":
      effects.loyaltyShift += 1;
      break;
    case "prodigy":
      effects.promotionBonus += 1;
      break;
    default:
      break;
  }

  switch (crew.negativeTraitId) {
    case "greedy":
      effects.heatGain += 0.06;
      effects.promotionCost += 0.22;
      break;
    case "flashy":
      effects.heatGain += 0.1;
      break;
    case "burned":
      effects.stressGain += 0.18;
      break;
    case "reckless":
      effects.assaultReward += 0.08;
      effects.heistPenalty += 0.04;
      break;
    case "frayed":
      effects.heistPenalty += 0.06;
      break;
    case "drifter":
      effects.loyaltyShift -= 1;
      break;
    default:
      break;
  }

  return effects;
}

export function getRankIndex(state) {
  let index = 0;
  for (let current = 0; current < RANKS.length; current += 1) {
    if (state.notoriety >= RANKS[current].threshold) {
      index = current;
    }
  }
  return index;
}

export function getRank(state) {
  return RANKS[getRankIndex(state)];
}

export function getManhuntStage(globalHeat) {
  if (globalHeat >= 75) {
    return { id: "redline", label: "Redline", accent: "#ff6d6d", penalty: 0.14 };
  }
  if (globalHeat >= 50) {
    return { id: "hunted", label: "Hunted", accent: "#ff9f47", penalty: 0.08 };
  }
  if (globalHeat >= 25) {
    return { id: "noticed", label: "Noticed", accent: "#ffd86b", penalty: 0.03 };
  }
  return { id: "quiet", label: "Quiet", accent: "#98ffa2", penalty: 0 };
}

export function getLegacyBonuses(state) {
  return LEGACY_UPGRADES.reduce((accumulator, upgrade) => {
    const count = state.legacyUpgrades?.[upgrade.id] || 0;
    Object.entries(upgrade.bonus).forEach(([key, value]) => {
      accumulator[key] = (accumulator[key] || 0) + value * count;
    });
    return accumulator;
  }, {});
}

function getControlledDistrictBonuses(state) {
  return state.districts.reduce((accumulator, districtState) => {
    if (!districtState.controlled) {
      return accumulator;
    }
    const districtDef = getDistrictDef(districtState.id);
    Object.entries(districtDef.bonus.effect).forEach(([key, value]) => {
      accumulator[key] = (accumulator[key] || 0) + value;
    });
    return accumulator;
  }, {});
}

export function getAssetCost(definition, level, kind) {
  const dirtyScale = kind === "front" ? 2.55 : 2.35;
  const cleanScale = kind === "front" ? 2.25 : 2.15;
  return {
    dirty: Math.floor(definition.costDirty * Math.pow(dirtyScale, level)),
    clean: Math.floor(definition.costClean * Math.pow(cleanScale, level)),
  };
}

export function getRecruitCost(state, candidate) {
  const crewCount = state.crew.length;
  return {
    dirty: Math.floor(340 + crewCount * 180 + (candidate.rank - 1) * 280),
    clean: Math.floor(60 + crewCount * 35 + (candidate.rank - 1) * 80),
    intel: 1 + Math.max(0, candidate.rank - 1),
  };
}

export function getPromotionCost(crew) {
  const nextRank = crew.rank + 1;
  const traitEffects = getTraitEffects(crew);
  const clean = Math.floor((200 + nextRank * 120 + crew.xp * 25) * (1 + traitEffects.promotionCost));
  return {
    clean,
    intel: Math.max(1, nextRank - 1),
  };
}

export function estimateLegacyGain(state) {
  const districtPoints = (state.stats?.districtsSeized || 0) * 2;
  const heistPoints = Math.floor((state.stats?.heistsWon || 0) / 5);
  const cleanPoints = Math.floor((state.stats?.cleanLaundered || 0) / 28000);
  const dirtyPoints = Math.floor((state.stats?.lifetimeDirty || 0) / 140000);
  const bonus = Math.floor(((getControlledDistrictBonuses(state).legacyBoost || 0) + (getLegacyBonuses(state).legacyBoost || 0)) * 4);
  return Math.max(0, districtPoints + heistPoints + cleanPoints + dirtyPoints + bonus);
}

function createAlert(state, tone, title, detail, now) {
  return {
    id: state.nextAlertId++,
    tone,
    title,
    detail,
    at: now,
  };
}

export function pushAlert(state, tone, title, detail, now = Date.now()) {
  state.alerts.unshift(createAlert(state, tone, title, detail, now));
  state.alerts = state.alerts.slice(0, 18);
}

function addDirtyRevenue(state, amount) {
  state.dirtyCash += amount;
  state.stats.dirtyEarned += amount;
  state.stats.lifetimeDirty += amount;
}

function addCleanRevenue(state, amount) {
  state.cleanCash += amount;
  state.stats.cleanEarned += amount;
  state.stats.lifetimeClean += amount;
}

function addLaunderedRevenue(state, amount) {
  addCleanRevenue(state, amount);
  state.stats.cleanLaundered += amount;
}

function addIntel(state, amount) {
  state.intel += amount;
  state.stats.intelEarned += amount;
}

function addNotoriety(state, amount) {
  state.notoriety += amount;
}

function findDistrictState(state, districtId) {
  return state.districts.find((entry) => entry.id === districtId);
}

function findAssetState(state, districtId, kind, assetId) {
  const districtState = findDistrictState(state, districtId);
  if (!districtState) {
    return null;
  }
  const collection = kind === "front" ? districtState.fronts : districtState.rackets;
  return collection.find((entry) => entry.id === assetId) || null;
}

function getAssignmentKey(kind, districtId, assetId) {
  return `${kind}:${districtId}:${assetId}`;
}

function buildAssignmentMap(state, now) {
  return state.crew.reduce((accumulator, crew) => {
    if (crew.busyUntil > now) {
      return accumulator;
    }
    if (crew.assignmentKey && crew.assignmentKey !== "idle" && crew.assignmentKey !== "rest") {
      accumulator[crew.assignmentKey] = crew;
    }
    return accumulator;
  }, {});
}

function getCrewEffectiveLoyalty(crew) {
  return crew.loyalty + getTraitEffects(crew).loyaltyShift;
}

function getCrewAssignmentLabel(state, crew, now) {
  if (crew.busyUntil > now) {
    return crew.busyType === "prep" ? "On prep" : "Busy";
  }
  if (crew.assignmentKey === "rest") {
    return "Cooling off";
  }
  if (!crew.assignmentKey || crew.assignmentKey === "idle") {
    return "At HQ";
  }
  const [kind, districtId, assetId] = crew.assignmentKey.split(":");
  const districtDef = getDistrictDef(districtId);
  const assetDef = kind === "front"
    ? districtDef.fronts.find((entry) => entry.id === assetId)
    : districtDef.rackets.find((entry) => entry.id === assetId);
  return `${assetDef?.name || "Assigned"} / ${districtDef.shortName}`;
}

function getCrewAssetBonus(crew, kind, definition) {
  const effects = getTraitEffects(crew);
  const archetype = getArchetype(crew.archetypeId);
  const specialtyMatch = definition.specialty === archetype.id ? 0.18 : 0;
  if (kind === "front") {
    return {
      outputMult: 1 + crew.rank * 0.08 + crew.cunning * 0.025 + crew.loyalty * 0.03 + specialtyMatch + effects.frontBonus,
      heatMitigation: effects.heatMitigation + (archetype.id === "cleaner" ? 0.1 : 0),
      cleanEff: effects.cleanEff + (archetype.id === "fixer" ? 0.04 : 0),
    };
  }
  return {
    outputMult: 1 + crew.rank * 0.09 + crew.cunning * 0.035 + crew.nerve * 0.022 + specialtyMatch,
    heatMitigation: effects.heatMitigation + (archetype.id === "cleaner" ? 0.06 : 0),
    cleanEff: 0,
  };
}

function getDistrictBonusAggregate(state) {
  const combined = { ...getLegacyBonuses(state) };
  Object.entries(getControlledDistrictBonuses(state)).forEach(([key, value]) => {
    combined[key] = (combined[key] || 0) + value;
  });
  return combined;
}

function getCityBeatMods(state, now) {
  if (!state.cityBeat || state.cityBeat.endsAt <= now) {
    return {};
  }
  return state.cityBeat.mods || {};
}

function generateContractReward(contract, tier, contractCleanBonus) {
  const rewardBase = 1 + tier * 0.28;
  switch (contract.type) {
    case "dirty":
      return { dirty: Math.floor(contract.target * 0.45), clean: Math.floor(contract.target * 0.12 * (1 + contractCleanBonus)), intel: 1 };
    case "clean":
      return { dirty: Math.floor(contract.target * 0.2), clean: Math.floor(contract.target * 0.32 * rewardBase * (1 + contractCleanBonus)), intel: 1 };
    case "intel":
      return { dirty: Math.floor(400 * rewardBase), clean: Math.floor(220 * rewardBase * (1 + contractCleanBonus)), intel: Math.max(2, contract.target) };
    case "prep":
      return { dirty: Math.floor(900 * rewardBase), clean: Math.floor(420 * rewardBase * (1 + contractCleanBonus)), intel: 1 + Math.floor(tier / 2) };
    case "heist":
      return { dirty: Math.floor(2200 * rewardBase), clean: Math.floor(1200 * rewardBase * (1 + contractCleanBonus)), intel: 2 + Math.floor(tier / 2) };
    case "upgrade":
      return { dirty: Math.floor(1100 * rewardBase), clean: Math.floor(600 * rewardBase * (1 + contractCleanBonus)), intel: 1 };
    default:
      return { dirty: 0, clean: 0, intel: 0 };
  }
}

export function rollContracts(state, now = Date.now()) {
  const controlled = state.stats.districtsSeized || 0;
  const tier = controlled + getRankIndex(state);
  const availableDistricts = state.districts.filter((district) => district.unlocked).map((district) => district.id);
  const contractCleanBonus = getLegacyBonuses(state).contractClean || 0;
  const pool = [...CONTRACT_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 3);

  state.contracts = pool.map((template, index) => {
    let target = template.base;
    if (template.type === "dirty" || template.type === "clean") {
      target = Math.floor(template.base * Math.pow(template.scale, tier * 0.45 + 1));
    } else if (template.type === "intel") {
      target = Math.max(2, Math.floor(template.base + tier * 0.6));
    } else if (template.type === "upgrade") {
      target = Math.max(2, Math.floor(template.base + tier * 0.25));
    } else {
      target = Math.max(1, Math.floor(template.base + tier * 0.16));
    }

    const contract = {
      id: `contract-${now}-${index}`,
      templateId: template.id,
      name: template.name,
      desc: template.desc,
      type: template.type,
      districtId: randomItem(availableDistricts) || DISTRICTS[0].id,
      target,
      reward: {},
      claimed: false,
      startedAt: now,
      baseline: {
        dirty: state.stats.dirtyEarned,
        clean: state.stats.cleanLaundered,
        intel: state.stats.intelEarned,
        prep: state.stats.prepsDone,
        heist: state.stats.heistsWon,
        upgrade: state.stats.upgradesBought,
      },
      control: template.control,
    };
    contract.reward = generateContractReward(contract, tier, contractCleanBonus);
    return contract;
  });
  state.nextContractRefreshAt = now + 240000;
}

export function getContractProgress(state, contract) {
  const deltas = {
    dirty: state.stats.dirtyEarned - contract.baseline.dirty,
    clean: state.stats.cleanLaundered - contract.baseline.clean,
    intel: state.stats.intelEarned - contract.baseline.intel,
    prep: state.stats.prepsDone - contract.baseline.prep,
    heist: state.stats.heistsWon - contract.baseline.heist,
    upgrade: state.stats.upgradesBought - contract.baseline.upgrade,
  };
  const current = deltas[contract.type] || 0;
  return {
    current,
    ratio: clamp(current / contract.target, 0, 1),
    ready: current >= contract.target,
  };
}

function cityBeatSummary(state, now) {
  if (!state.cityBeat || state.cityBeat.endsAt <= now) {
    return null;
  }
  const beat = CITY_BEATS.find((entry) => entry.id === state.cityBeat.id);
  if (!beat) {
    return null;
  }
  return {
    ...beat,
    remainingMs: state.cityBeat.endsAt - now,
  };
}

function computeHeistChance(state, districtState, heistDef, approach, crewIds, performanceScore, now) {
  const districtBonuses = getDistrictBonusAggregate(state);
  const cityBeatMods = getCityBeatMods(state, now);
  const crew = crewIds
    .map((crewId) => state.crew.find((member) => member.id === crewId))
    .filter(Boolean);

  if (crew.length < approach.minCrew) {
    return 0;
  }

  const prepDone = districtState.heist.prepDone || {};
  const prepEffects = heistDef.preps.reduce(
    (accumulator, prep) => {
      if (prepDone[prep.id]) {
        accumulator.success += prep.effect.success || 0;
      }
      return accumulator;
    },
    { success: 0 },
  );

  const performanceMod = (performanceScore - 0.5) * 0.18;
  const averageStress = crew.reduce((total, member) => total + member.stress, 0) / crew.length;
  const preferredMatches = crew.filter((member) => approach.preferred.includes(member.archetypeId)).length;
  const crewScore = crew.reduce((total, member) => {
    const effects = getTraitEffects(member);
    const weighted =
      member.cunning * approach.weights.cunning +
      member.nerve * approach.weights.nerve +
      getCrewEffectiveLoyalty(member) * approach.weights.loyalty +
      member.rank * 0.55;
    return total + weighted / 14 - effects.heistPenalty;
  }, 0) / crew.length;

  return clamp(
    approach.baseSuccess +
      crewScore * 0.18 +
      preferredMatches * 0.04 +
      prepEffects.success +
      (districtBonuses.heistBonus || 0) +
      (cityBeatMods.heistBonus || 0) +
      performanceMod -
      averageStress / 520 -
      districtState.heat / 320 -
      state.globalHeat / 500,
    0.08,
    0.95,
  );
}

function getCrewAssignmentOptions(state, crew, assignmentsByKey) {
  const options = [
    { value: "idle", label: "HQ standby" },
    { value: "rest", label: "Rest and cool off" },
  ];

  state.districts
    .filter((district) => district.unlocked)
    .forEach((districtState) => {
      const districtDef = getDistrictDef(districtState.id);
      districtState.rackets.forEach((assetState) => {
        if (assetState.level <= 0) {
          return;
        }
        const key = getAssignmentKey("racket", districtState.id, assetState.id);
        const occupant = assignmentsByKey[key];
        if (occupant && occupant.id !== crew.id) {
          return;
        }
        const assetDef = districtDef.rackets.find((entry) => entry.id === assetState.id);
        options.push({ value: key, label: `${districtDef.shortName} / ${assetDef.name}` });
      });
      districtState.fronts.forEach((assetState) => {
        if (assetState.level <= 0) {
          return;
        }
        const key = getAssignmentKey("front", districtState.id, assetState.id);
        const occupant = assignmentsByKey[key];
        if (occupant && occupant.id !== crew.id) {
          return;
        }
        const assetDef = districtDef.fronts.find((entry) => entry.id === assetState.id);
        options.push({ value: key, label: `${districtDef.shortName} / ${assetDef.name}` });
      });
    });

  return options;
}

export function calculateDerived(state, now = Date.now()) {
  const rank = getRank(state);
  const legacyBonuses = getLegacyBonuses(state);
  const districtBonuses = getControlledDistrictBonuses(state);
  const bonusStack = getDistrictBonusAggregate(state);
  const beat = cityBeatSummary(state, now);
  const beatMods = getCityBeatMods(state, now);
  const manhunt = getManhuntStage(state.globalHeat);
  const assignmentsByKey = buildAssignmentMap(state, now);
  const surgeActive = state.surgeUntil > now;
  const crewCap = state.crewCapBase + (bonusStack.crewCap || 0);
  const operations = [...state.operations].sort((a, b) => a.endsAt - b.endsAt);
  const crewById = Object.fromEntries(state.crew.map((crew) => [crew.id, crew]));

  const districts = state.districts.map((districtState) => {
    const districtDef = getDistrictDef(districtState.id);
    const districtFaction = getFaction(districtDef.factionId);

    const rackets = districtDef.rackets.map((assetDef) => {
      const assetState = districtState.rackets.find((entry) => entry.id === assetDef.id);
      const cost = getAssetCost(assetDef, assetState.level, "racket");
      const assignmentKey = getAssignmentKey("racket", districtState.id, assetDef.id);
      const assignedCrew = assignmentsByKey[assignmentKey] || null;
      const crewBonus = assignedCrew ? getCrewAssetBonus(assignedCrew, "racket", assetDef) : { outputMult: 1, heatMitigation: 0, cleanEff: 0 };

      let dirtyPerSec = 0;
      let heatGain = 0;
      if (assetState.level > 0) {
        dirtyPerSec = assetDef.dirtyRate * assetState.level;
        dirtyPerSec *= 1 + (bonusStack.dirtyMult || 0) + (beatMods.dirtyMult || 0);
        dirtyPerSec *= 1 + (districtState.controlled ? 0.08 : 0);
        dirtyPerSec *= surgeActive ? 1.6 + (legacyBonuses.hustleMult || 0) : 1;
        dirtyPerSec *= manhunt.id === "redline" ? 0.84 : manhunt.id === "hunted" ? 0.92 : 1;
        dirtyPerSec *= districtState.lockUntil > now ? 0.56 : 1;
        dirtyPerSec *= crewBonus.outputMult;

        heatGain = assetDef.heat * assetState.level;
        heatGain *= 1 + (beatMods.heatGain || 0);
        heatGain *= 1 - clamp((bonusStack.heatMitigation || 0) + crewBonus.heatMitigation, 0, 0.55);
      }

      return {
        def: assetDef,
        state: assetState,
        cost,
        assignedCrew,
        dirtyPerSec,
        heatGain,
        assignmentKey,
      };
    });

    const fronts = districtDef.fronts.map((assetDef) => {
      const assetState = districtState.fronts.find((entry) => entry.id === assetDef.id);
      const cost = getAssetCost(assetDef, assetState.level, "front");
      const assignmentKey = getAssignmentKey("front", districtState.id, assetDef.id);
      const assignedCrew = assignmentsByKey[assignmentKey] || null;
      const crewBonus = assignedCrew ? getCrewAssetBonus(assignedCrew, "front", assetDef) : { outputMult: 1, heatMitigation: 0, cleanEff: 0 };

      let launderPerSec = 0;
      let cleanPerSec = 0;
      let coverPerSec = 0;
      if (assetState.level > 0) {
        launderPerSec = assetDef.launderRate * assetState.level;
        launderPerSec *= 1 + (bonusStack.cleanEff || 0) * 0.25;
        launderPerSec *= crewBonus.outputMult;

        const efficiency = clamp(assetDef.efficiency + (bonusStack.cleanEff || 0) + (beatMods.cleanEff || 0) + crewBonus.cleanEff, 0.68, 0.96);
        cleanPerSec = launderPerSec * efficiency;
        coverPerSec = assetDef.cover * assetState.level;
        coverPerSec *= 1 + (beatMods.heatDecayMult || 0);
        coverPerSec += crewBonus.heatMitigation;
      }

      return {
        def: assetDef,
        state: assetState,
        cost,
        assignedCrew,
        launderPerSec,
        cleanPerSec,
        coverPerSec,
        assignmentKey,
      };
    });

    const dirtyPerSec = rackets.reduce((total, asset) => total + asset.dirtyPerSec, 0);
    const launderPerSec = fronts.reduce((total, asset) => total + asset.launderPerSec, 0);
    const cleanPerSec = fronts.reduce((total, asset) => total + asset.cleanPerSec, 0);
    const coverPerSec = fronts.reduce((total, asset) => total + asset.coverPerSec, 0);
    const heistDraft = state.heistDrafts[districtState.id] || { approachId: districtDef.heist.approaches[0].id, crewIds: [] };
    const selectedApproach = districtDef.heist.approaches.find((entry) => entry.id === heistDraft.approachId) || districtDef.heist.approaches[0];
    const cleanedCrewIds = heistDraft.crewIds.filter((crewId) => {
      const member = crewById[crewId];
      return member && member.busyUntil <= now;
    });
    const heistChance = computeHeistChance(state, districtState, districtDef.heist, selectedApproach, cleanedCrewIds, 0.5, now);
    const prepDoneCount = Object.values(districtState.heist.prepDone || {}).filter(Boolean).length;
    const prepEffects = districtDef.heist.preps.reduce(
      (accumulator, prep) => {
        if (districtState.heist.prepDone[prep.id]) {
          accumulator.reward += prep.effect.reward || 0;
          accumulator.clean += prep.effect.clean || 0;
          accumulator.heat += prep.effect.heat || 0;
        }
        return accumulator;
      },
      { reward: 0, clean: 0, heat: 0 },
    );
    const previousDistrict = DISTRICTS[DISTRICTS.findIndex((entry) => entry.id === districtDef.id) - 1];
    const previousState = previousDistrict ? findDistrictState(state, previousDistrict.id) : null;
    const canUnlock =
      !districtState.unlocked &&
      (!previousDistrict || previousState?.controlled);
    const canSeize =
      districtState.unlocked &&
      !districtState.controlled &&
      districtState.control >= 100 &&
      state.cleanCash >= districtDef.seizeCost.clean &&
      state.intel >= districtDef.seizeCost.intel;

    const heistBlockers = [];
    if (districtState.heist.cooldownUntil > now) {
      heistBlockers.push({ tone: "warn", label: "Cooling down" });
    }
    if (state.intel < districtDef.heist.intelCost) {
      heistBlockers.push({ tone: "warn", label: `Need ${districtDef.heist.intelCost - state.intel} more intel` });
    }
    if (cleanedCrewIds.length < selectedApproach.minCrew) {
      heistBlockers.push({ tone: "warn", label: `Need ${selectedApproach.minCrew - cleanedCrewIds.length} more crew` });
    }
    if (!heistBlockers.length && prepDoneCount < districtDef.heist.preps.length) {
      heistBlockers.push({ tone: "good", label: `${districtDef.heist.preps.length - prepDoneCount} prep slots still optional` });
    }

    const dirtyPreviewMin = Math.floor(districtDef.heist.dirtyReward[0] * selectedApproach.rewardMult * (1 + prepEffects.reward));
    const dirtyPreviewMax = Math.floor(districtDef.heist.dirtyReward[1] * selectedApproach.rewardMult * (1.24 + prepEffects.reward));
    const cleanPreviewMin = Math.floor(districtDef.heist.cleanReward[0] * (1 + prepEffects.clean));
    const cleanPreviewMax = Math.floor(districtDef.heist.cleanReward[1] * (1.2 + prepEffects.clean));
    const heatPreview = districtDef.heist.heat * selectedApproach.heatMult * (1 + prepEffects.heat);

    return {
      def: districtDef,
      faction: districtFaction,
      state: districtState,
      rackets,
      fronts,
      dirtyPerSec,
      launderPerSec,
      cleanPerSec,
      coverPerSec,
      heist: {
        def: districtDef.heist,
        draft: {
          ...heistDraft,
          crewIds: cleanedCrewIds,
          approachId: selectedApproach.id,
        },
        chance: heistChance,
        prepDoneCount,
        ready: districtState.heist.cooldownUntil <= now && state.intel >= districtDef.heist.intelCost && cleanedCrewIds.length >= selectedApproach.minCrew,
        cooldownRemainingMs: Math.max(0, districtState.heist.cooldownUntil - now),
        blockers: heistBlockers,
        preview: {
          dirtyMin: dirtyPreviewMin,
          dirtyMax: dirtyPreviewMax,
          cleanMin: cleanPreviewMin,
          cleanMax: cleanPreviewMax,
          heat: heatPreview,
        },
      },
      canUnlock,
      canSeize,
    };
  });

  const totals = districts.reduce(
    (accumulator, district) => {
      accumulator.dirtyPerSec += district.dirtyPerSec;
      accumulator.cleanPerSec += district.cleanPerSec;
      accumulator.launderPerSec += district.launderPerSec;
      accumulator.coverPerSec += district.coverPerSec;
      accumulator.averageHeat += district.state.heat;
      return accumulator;
    },
    { dirtyPerSec: 0, cleanPerSec: 0, launderPerSec: 0, coverPerSec: 0, averageHeat: 0 },
  );
  totals.averageHeat = districts.length ? totals.averageHeat / districts.length : 0;

  const crew = state.crew.map((member) => ({
    crew: member,
    archetype: getArchetype(member.archetypeId),
    positiveTrait: getPositiveTrait(member.positiveTraitId),
    negativeTrait: getNegativeTrait(member.negativeTraitId),
    statusLabel: getCrewAssignmentLabel(state, member, now),
    effectiveLoyalty: getCrewEffectiveLoyalty(member),
    promotionCost: getPromotionCost(member),
    assignmentOptions: getCrewAssignmentOptions(state, member, assignmentsByKey),
    isBusy: member.busyUntil > now,
  }));

  const recruitPool = state.recruitPool.map((candidate) => ({
    candidate,
    archetype: getArchetype(candidate.archetypeId),
    positiveTrait: getPositiveTrait(candidate.positiveTraitId),
    negativeTrait: getNegativeTrait(candidate.negativeTraitId),
    cost: getRecruitCost(state, candidate),
  }));

  const contracts = state.contracts.map((contract) => ({
    contract,
    ...getContractProgress(state, contract),
  }));

  const dossiers = DOSSIERS.map((dossier) => {
    let current = 0;
    switch (dossier.type) {
      case "districtsSeized":
        current = state.stats.districtsSeized;
        break;
      case "lifetimeClean":
        current = state.stats.lifetimeClean;
        break;
      case "cleanLaundered":
        current = state.stats.cleanLaundered;
        break;
      case "crewCount":
        current = state.crew.length;
        break;
      case "heistsWon":
        current = state.stats.heistsWon;
        break;
      case "lifetimeDirty":
        current = state.stats.lifetimeDirty;
        break;
      default:
        break;
    }
    return {
      dossier,
      current,
      ratio: clamp(current / dossier.goal, 0, 1),
      complete: current >= dossier.goal,
    };
  });

  const legacyUpgrades = LEGACY_UPGRADES.map((upgrade) => ({
    upgrade,
    count: state.legacyUpgrades?.[upgrade.id] || 0,
    canBuy:
      state.legacyPoints >= upgrade.cost &&
      (state.legacyUpgrades?.[upgrade.id] || 0) < upgrade.max,
  }));

  return {
    now,
    rank,
    rankIndex: getRankIndex(state),
    legacyBonuses,
    controlledBonuses: districtBonuses,
    beat,
    beatMods,
    manhunt,
    surgeActive,
    surgeRemainingMs: Math.max(0, state.surgeUntil - now),
    crewCap,
    panelTabs: PANEL_TABS,
    assignmentsByKey,
    operations,
    districts,
    totals,
    crew,
    recruitPool,
    contracts,
    dossiers,
    legacyUpgrades,
    projectedLegacy: estimateLegacyGain(state),
  };
}

export function setPanel(state, panelId) {
  if (PANEL_TABS.some((tab) => tab.id === panelId)) {
    state.currentPanel = panelId;
  }
}

export function selectDistrict(state, districtId) {
  if (findDistrictState(state, districtId)) {
    state.selectedDistrictId = districtId;
  }
}

export function hustle(state, now = Date.now()) {
  const derived = calculateDerived(state, now);
  const base = 18 + derived.rankIndex * 4;
  const gain = Math.floor(base * (1 + (derived.legacyBonuses.hustleMult || 0)) * (1 + (derived.beatMods.hustleMult || 0)) * (derived.surgeActive ? 1.4 : 1));
  addDirtyRevenue(state, gain);
  addNotoriety(state, 3);
  state.stats.hustleClicks += 1;
  state.surge = clamp(
    state.surge + 12 * (1 + (derived.legacyBonuses.surgeGain || 0)),
    0,
    100,
  );
  if (!derived.surgeActive && state.surge >= 100) {
    state.surge = 0;
    state.surgeUntil = now + 15000;
    pushAlert(state, "surge", "Surge live", "For 15 seconds, the whole grid runs hotter and richer.", now);
  }
  if (Math.random() < 0.1 + (derived.beatMods.intelGain || 0)) {
    addIntel(state, 1);
    pushAlert(state, "intel", "Lucky line", "+1 intel off a hustled contact.", now);
  }
}

export function buyAsset(state, districtId, kind, assetId, now = Date.now()) {
  const districtDef = getDistrictDef(districtId);
  const districtState = findDistrictState(state, districtId);
  if (!districtState?.unlocked) {
    return false;
  }
  const definition = kind === "front"
    ? districtDef.fronts.find((entry) => entry.id === assetId)
    : districtDef.rackets.find((entry) => entry.id === assetId);
  const assetState = findAssetState(state, districtId, kind, assetId);
  if (!definition || !assetState || assetState.level >= definition.maxLevel) {
    return false;
  }
  const cost = getAssetCost(definition, assetState.level, kind);
  if (state.dirtyCash < cost.dirty || state.cleanCash < cost.clean) {
    return false;
  }
  state.dirtyCash -= cost.dirty;
  state.cleanCash -= cost.clean;
  assetState.level += 1;
  districtState.control = clamp(districtState.control + definition.control, 0, 100);
  state.stats.upgradesBought += 1;
  addNotoriety(state, 12 + definition.control);
  pushAlert(
    state,
    kind === "front" ? "clean" : "dirty",
    `${definition.name} upgraded`,
    `${districtDef.shortName} control climbs to ${Math.floor(districtState.control)}%.`,
    now,
  );
  return true;
}

export function unlockDistrict(state, districtId, now = Date.now()) {
  const index = DISTRICTS.findIndex((entry) => entry.id === districtId);
  const districtDef = DISTRICTS[index];
  const districtState = findDistrictState(state, districtId);
  if (!districtDef || !districtState || districtState.unlocked) {
    return false;
  }
  const previous = index > 0 ? findDistrictState(state, DISTRICTS[index - 1].id) : null;
  if (previous && !previous.controlled) {
    return false;
  }
  if (state.cleanCash < districtDef.unlockCost.clean || state.intel < districtDef.unlockCost.intel) {
    return false;
  }
  state.cleanCash -= districtDef.unlockCost.clean;
  state.intel -= districtDef.unlockCost.intel;
  districtState.unlocked = true;
  districtState.control = clamp(districtState.control + 16, 0, 100);
  state.selectedDistrictId = districtId;
  addNotoriety(state, 80 + index * 20);
  pushAlert(state, "district", `${districtDef.name} unlocked`, "A fresh district opens up under the neon haze.", now);
  return true;
}

export function seizeDistrict(state, districtId, now = Date.now()) {
  const districtDef = getDistrictDef(districtId);
  const districtState = findDistrictState(state, districtId);
  if (!districtState?.unlocked || districtState.controlled || districtState.control < 100) {
    return false;
  }
  if (state.cleanCash < districtDef.seizeCost.clean || state.intel < districtDef.seizeCost.intel) {
    return false;
  }
  state.cleanCash -= districtDef.seizeCost.clean;
  state.intel -= districtDef.seizeCost.intel;
  districtState.controlled = true;
  districtState.heat = Math.min(districtState.heat, 28);
  state.stats.districtsSeized += 1;
  addNotoriety(state, 260);
  pushAlert(state, "district", `${districtDef.name} secured`, districtDef.bonus.label, now);
  return true;
}

export function setHeistApproach(state, districtId, approachId) {
  const draft = state.heistDrafts[districtId];
  const heistDef = getDistrictDef(districtId).heist;
  if (!draft || !heistDef.approaches.some((entry) => entry.id === approachId)) {
    return false;
  }
  draft.approachId = approachId;
  return true;
}

export function toggleHeistCrew(state, districtId, crewId, now = Date.now()) {
  const draft = state.heistDrafts[districtId];
  const crew = state.crew.find((member) => member.id === crewId);
  if (!draft || !crew || crew.busyUntil > now) {
    return false;
  }
  if (draft.crewIds.includes(crewId)) {
    draft.crewIds = draft.crewIds.filter((entry) => entry !== crewId);
    return true;
  }
  if (draft.crewIds.length >= 3) {
    return false;
  }
  draft.crewIds = [...draft.crewIds, crewId];
  return true;
}

export function assignCrew(state, crewId, assignmentKey, now = Date.now()) {
  const crew = state.crew.find((member) => member.id === crewId);
  if (!crew || crew.busyUntil > now) {
    return false;
  }
  if (assignmentKey !== "idle" && assignmentKey !== "rest") {
    state.crew.forEach((member) => {
      if (member.id !== crew.id && member.assignmentKey === assignmentKey && member.busyUntil <= now) {
        member.assignmentKey = "idle";
      }
    });
  }
  crew.assignmentKey = assignmentKey;
  return true;
}

export function promoteCrew(state, crewId, now = Date.now()) {
  const crew = state.crew.find((member) => member.id === crewId);
  if (!crew || crew.rank >= 4) {
    return false;
  }
  const cost = getPromotionCost(crew);
  if (state.cleanCash < cost.clean || state.intel < cost.intel) {
    return false;
  }
  state.cleanCash -= cost.clean;
  state.intel -= cost.intel;
  crew.rank += 1;
  const effects = getTraitEffects(crew);
  const archetype = getArchetype(crew.archetypeId);
  const bump = 1 + effects.promotionBonus;
  crew.cunning += archetype.id === "hacker" || archetype.id === "grifter" || archetype.id === "fixer" ? bump : 1;
  crew.nerve += archetype.id === "wheelman" || archetype.id === "bruiser" ? bump : 1;
  crew.loyalty += archetype.id === "cleaner" || archetype.id === "fixer" ? 1 + Math.floor(effects.promotionBonus / 2) : 1;
  crew.stress = Math.max(0, crew.stress - 18);
  addNotoriety(state, 36 + crew.rank * 8);
  pushAlert(state, "crew", `${crew.name} promoted`, `${archetype.name} rank ${crew.rank}.`, now);
  return true;
}

export function refreshRecruitPool(state, now = Date.now(), free = false) {
  if (!free) {
    if (state.intel < 2) {
      return false;
    }
    state.intel -= 2;
  }
  state.recruitPool = createRecruitPool(state.nextRecruitId, 3);
  state.nextRecruitId += 3;
  state.nextRecruitRefreshAt = now + 210000;
  pushAlert(state, "crew", "Fresh faces", "The market turns. New specialists step into the glow.", now);
  return true;
}

export function hireCrew(state, candidateId, now = Date.now()) {
  const candidateIndex = state.recruitPool.findIndex((entry) => entry.id === candidateId);
  if (candidateIndex === -1) {
    return false;
  }
  const candidate = state.recruitPool[candidateIndex];
  const crewCap = state.crewCapBase + (getDistrictBonusAggregate(state).crewCap || 0);
  if (state.crew.length >= crewCap) {
    return false;
  }
  const cost = getRecruitCost(state, candidate);
  if (state.dirtyCash < cost.dirty || state.cleanCash < cost.clean || state.intel < cost.intel) {
    return false;
  }
  state.dirtyCash -= cost.dirty;
  state.cleanCash -= cost.clean;
  state.intel -= cost.intel;

  const crew = {
    ...candidate,
    id: `crew-${state.nextCrewId++}`,
    assignmentKey: "idle",
    busyUntil: 0,
    busyType: "",
    busyRef: "",
  };
  state.crew.push(crew);
  state.recruitPool.splice(candidateIndex, 1);
  if (state.recruitPool.length === 0) {
    state.recruitPool = createRecruitPool(state.nextRecruitId, 3);
    state.nextRecruitId += 3;
    state.nextRecruitRefreshAt = now + 210000;
  }
  addNotoriety(state, 55);
  pushAlert(state, "crew", `${crew.name} joins`, `${getArchetype(crew.archetypeId).name} on the payroll.`, now);
  return true;
}

export function startPrep(state, districtId, prepId, crewId, now = Date.now()) {
  const districtState = findDistrictState(state, districtId);
  const crew = state.crew.find((member) => member.id === crewId);
  const heistDef = getDistrictDef(districtId).heist;
  const prepDef = heistDef.preps.find((entry) => entry.id === prepId);
  if (!districtState || !prepDef || !crew || crew.busyUntil > now) {
    return false;
  }
  if (districtState.heist.prepDone[prepId]) {
    return false;
  }
  if (state.dirtyCash < prepDef.costDirty || state.intel < prepDef.costIntel) {
    return false;
  }
  state.dirtyCash -= prepDef.costDirty;
  state.intel -= prepDef.costIntel;

  const legacyBonuses = getLegacyBonuses(state);
  const beatMods = getCityBeatMods(state, now);
  const prefBonus = crew.archetypeId === prepDef.preferred ? 0.12 : 0;
  const durationScale = clamp(
    1 -
      (legacyBonuses.prepSpeed || 0) -
      (beatMods.prepSpeed || 0) -
      prefBonus -
      crew.cunning * 0.015 -
      crew.rank * 0.03,
    0.48,
    1,
  );
  const endsAt = now + Math.floor(prepDef.duration * durationScale);

  state.operations.push({
    id: `op-${state.nextOperationId++}`,
    type: "prep",
    districtId,
    prepId,
    heistId: heistDef.id,
    crewId,
    label: prepDef.name,
    startedAt: now,
    endsAt,
  });
  crew.busyUntil = endsAt;
  crew.busyType = "prep";
  crew.busyRef = prepId;
  pushAlert(state, "ops", `${prepDef.name} running`, `${crew.name} is moving on ${heistDef.name}.`, now);
  return true;
}

export function buildHeistRun(state, districtId, now = Date.now()) {
  const districtState = findDistrictState(state, districtId);
  const districtDef = getDistrictDef(districtId);
  const draft = state.heistDrafts[districtId];
  if (!districtState || !districtState.unlocked || !draft) {
    return null;
  }
  const approach = districtDef.heist.approaches.find((entry) => entry.id === draft.approachId) || districtDef.heist.approaches[0];
  const crewIds = draft.crewIds.filter((crewId) => {
    const member = state.crew.find((entry) => entry.id === crewId);
    return member && member.busyUntil <= now;
  });
  if (crewIds.length < approach.minCrew) {
    return null;
  }
  if (districtState.heist.cooldownUntil > now || state.intel < districtDef.heist.intelCost) {
    return null;
  }
  return {
    districtId,
    heistId: districtDef.heist.id,
    heistName: districtDef.heist.name,
    approachId: approach.id,
    approachName: approach.name,
    crewIds,
    minigame: approach.minigame,
    startedAt: now,
  };
}

export function resolveHeistRun(state, run, performanceScore, now = Date.now()) {
  const districtState = findDistrictState(state, run.districtId);
  const districtDef = getDistrictDef(run.districtId);
  const heistDef = districtDef.heist;
  const approach = heistDef.approaches.find((entry) => entry.id === run.approachId);
  if (!districtState || !heistDef || !approach) {
    return null;
  }
  if (state.intel < heistDef.intelCost) {
    return null;
  }

  state.intel -= heistDef.intelCost;
  const chanceValue = computeHeistChance(state, districtState, heistDef, approach, run.crewIds, performanceScore, now);
  const success = Math.random() < chanceValue;
  const prepDone = districtState.heist.prepDone || {};
  const prepEffects = heistDef.preps.reduce(
    (accumulator, prep) => {
      if (prepDone[prep.id]) {
        accumulator.reward += prep.effect.reward || 0;
        accumulator.clean += prep.effect.clean || 0;
        accumulator.heat += prep.effect.heat || 0;
      }
      return accumulator;
    },
    { reward: 0, clean: 0, heat: 0 },
  );

  const crew = run.crewIds
    .map((crewId) => state.crew.find((member) => member.id === crewId))
    .filter(Boolean);
  const averageStress = crew.reduce((total, member) => total + member.stress, 0) / crew.length;
  const baseDirty = randomBetween(heistDef.dirtyReward[0], heistDef.dirtyReward[1]);
  const baseClean = randomBetween(heistDef.cleanReward[0], heistDef.cleanReward[1]);
  const traitReward = crew.reduce((total, member) => total + getTraitEffects(member).assaultReward, 0);
  const rewardMult = 1 + prepEffects.reward + (success ? performanceScore * 0.24 : 0) + (approach.id === "hammer" ? traitReward : 0);
  const cleanMult = 1 + prepEffects.clean + performanceScore * 0.2;

  let dirtyGain = 0;
  let cleanGain = 0;
  if (success) {
    dirtyGain = Math.floor(baseDirty * approach.rewardMult * rewardMult);
    cleanGain = Math.floor(baseClean * cleanMult);
    addDirtyRevenue(state, dirtyGain);
    addCleanRevenue(state, cleanGain);
    addNotoriety(state, 220 + Math.floor(dirtyGain / 12000));
    state.stats.heistsWon += 1;
    districtState.control = clamp(districtState.control + heistDef.controlGain, 0, 100);
    districtState.heist.wins += 1;
  } else {
    dirtyGain = performanceScore > 0.7 ? Math.floor(baseDirty * 0.24) : 0;
    cleanGain = performanceScore > 0.82 ? Math.floor(baseClean * 0.14) : 0;
    if (dirtyGain > 0) {
      addDirtyRevenue(state, dirtyGain);
    }
    if (cleanGain > 0) {
      addCleanRevenue(state, cleanGain);
    }
    districtState.control = clamp(districtState.control + heistDef.controlGain * 0.28, 0, 100);
  }

  districtState.heat = clamp(
    districtState.heat + heistDef.heat * approach.heatMult * (1 + prepEffects.heat),
    0,
    100,
  );
  state.globalHeat = clamp(state.globalHeat + heistDef.heat * 0.72, 0, 100);
  state.heatPressure += heistDef.heat * 0.03;
  districtState.heist.cooldownUntil = now + heistDef.cooldown * 1000;
  districtState.heist.prepDone = {};
  districtState.heist.lastOutcome = success ? "success" : "fail";

  crew.forEach((member) => {
    const effects = getTraitEffects(member);
    member.stress = clamp(
      member.stress + (success ? 12 : 18) * (1 + effects.stressGain) + averageStress * 0.02,
      0,
      100,
    );
    member.xp += success ? 2 : 1;
    if (success && effects.intelHeist && state.stats.heistsWon % 2 === 0) {
      addIntel(state, effects.intelHeist);
    }
  });

  pushAlert(
    state,
    success ? "heist" : "heat",
    success ? `${heistDef.name} landed` : `${heistDef.name} burned`,
    success
      ? `+${Math.floor(dirtyGain).toLocaleString()} dirty / +${Math.floor(cleanGain).toLocaleString()} clean`
      : "The city held, but the crew got out alive.",
    now,
  );

  return {
    success,
    chanceValue,
    dirtyGain,
    cleanGain,
    performanceScore,
  };
}

export function claimContract(state, contractId, now = Date.now()) {
  const contract = state.contracts.find((entry) => entry.id === contractId);
  if (!contract || contract.claimed) {
    return false;
  }
  const progress = getContractProgress(state, contract);
  if (!progress.ready) {
    return false;
  }
  contract.claimed = true;
  addDirtyRevenue(state, contract.reward.dirty);
  addCleanRevenue(state, contract.reward.clean);
  addIntel(state, contract.reward.intel);
  const districtState = findDistrictState(state, contract.districtId);
  if (districtState) {
    districtState.control = clamp(districtState.control + contract.control, 0, 100);
  }
  addNotoriety(state, 90 + contract.control * 3);
  pushAlert(
    state,
    "contract",
    `${contract.name} complete`,
    `+${contract.reward.dirty.toLocaleString()} dirty / +${contract.reward.clean.toLocaleString()} clean / +${contract.reward.intel} intel`,
    now,
  );
  return true;
}

export function buyLegacyUpgrade(state, upgradeId, now = Date.now()) {
  const upgrade = LEGACY_UPGRADES.find((entry) => entry.id === upgradeId);
  const current = state.legacyUpgrades?.[upgradeId] || 0;
  if (!upgrade || current >= upgrade.max || state.legacyPoints < upgrade.cost) {
    return false;
  }
  state.legacyPoints -= upgrade.cost;
  state.legacyUpgrades[upgradeId] = current + 1;
  pushAlert(state, "legacy", `${upgrade.name} bought`, upgrade.desc, now);
  return true;
}

function rollCityBeat(state, now) {
  const beat = randomItem(CITY_BEATS);
  state.cityBeat = {
    id: beat.id,
    endsAt: now + beat.durationMs,
    mods: beat.mods,
  };
  pushAlert(state, "beat", beat.name, beat.desc, now);
}

function completeOperation(state, operation, now) {
  if (operation.type !== "prep") {
    return;
  }
  const districtState = findDistrictState(state, operation.districtId);
  const districtDef = getDistrictDef(operation.districtId);
  const prepDef = districtDef.heist.preps.find((entry) => entry.id === operation.prepId);
  const crew = state.crew.find((member) => member.id === operation.crewId);

  if (districtState && prepDef) {
    districtState.heist.prepDone[operation.prepId] = true;
    districtState.control = clamp(districtState.control + 4, 0, 100);
    state.stats.prepsDone += 1;
    addNotoriety(state, 24);
    pushAlert(state, "ops", `${prepDef.name} complete`, `${districtDef.shortName} is one step softer.`, now);
  }
  if (crew) {
    const effects = getTraitEffects(crew);
    crew.busyUntil = 0;
    crew.busyType = "";
    crew.busyRef = "";
    crew.stress = clamp(crew.stress + 10 * (1 + effects.stressGain), 0, 100);
    crew.xp += 1;
  }
}

export function tickState(state, now = Date.now()) {
  const deltaMs = Math.min(5000, Math.max(0, now - (state.lastTickAt || now)));
  const dtSeconds = deltaMs / 1000;
  if (dtSeconds <= 0) {
    return;
  }
  state.lastTickAt = now;

  const derived = calculateDerived(state, now);

  if (!derived.surgeActive && state.surge > 0) {
    state.surge = clamp(state.surge - 8 * dtSeconds, 0, 100);
  }

  let dirtyGain = 0;
  state.districts.forEach((districtState) => {
    if (!districtState.unlocked) {
      return;
    }
    const districtView = derived.districts.find((entry) => entry.def.id === districtState.id);
    if (!districtView) {
      return;
    }

    const districtDirty = districtView.dirtyPerSec * dtSeconds;
    dirtyGain += districtDirty;

    let remainingDirtyForDistrict = state.dirtyCash + dirtyGain;
    let cleanGain = 0;
    districtView.fronts.forEach((front) => {
      const launderDemand = front.launderPerSec * dtSeconds;
      const processed = Math.min(remainingDirtyForDistrict, launderDemand);
      remainingDirtyForDistrict -= processed;
      cleanGain += processed * (front.cleanPerSec / Math.max(0.0001, front.launderPerSec || 1));
    });

    const heatRise = districtView.rackets.reduce((total, racket) => total + racket.heatGain, 0) * dtSeconds;
    const heatDrop = (0.18 + districtView.coverPerSec * 0.6) * (1 + (derived.beatMods.heatDecayMult || 0)) * dtSeconds;
    districtState.heat = clamp(districtState.heat + heatRise - heatDrop, 0, 100);

    if (cleanGain > 0 && state.dirtyCash + dirtyGain > 0) {
      const actualProcess = Math.min(state.dirtyCash + dirtyGain, districtView.launderPerSec * dtSeconds);
      const dirtyTaken = Math.min(actualProcess, state.dirtyCash + dirtyGain);
      const cleanCreated = Math.min(cleanGain, dirtyTaken * 0.96);
      const dirtyFromState = Math.min(state.dirtyCash, dirtyTaken);
      state.dirtyCash -= dirtyFromState;
      if (dirtyTaken > dirtyFromState) {
        dirtyGain -= dirtyTaken - dirtyFromState;
      }
      addLaunderedRevenue(state, cleanCreated);
    }

    if (districtState.lockUntil > 0 && districtState.lockUntil <= now) {
      districtState.lockUntil = 0;
      pushAlert(state, "district", `${districtView.def.shortName} cools off`, "The lockdown breaks and the street opens again.", now);
    }

    if (districtState.heat > 84 && districtState.lockUntil <= now && chance(0.008, dtSeconds)) {
      districtState.lockUntil = now + 45000;
      districtState.control = clamp(districtState.control - 6, 0, 100);
      const fine = Math.floor((state.dirtyCash + dirtyGain) * 0.04);
      const paid = Math.min(fine, state.dirtyCash + dirtyGain);
      const dirtyFromState = Math.min(state.dirtyCash, paid);
      state.dirtyCash -= dirtyFromState;
      if (paid > dirtyFromState) {
        dirtyGain -= paid - dirtyFromState;
      }
      state.globalHeat = clamp(state.globalHeat + 4, 0, 100);
      pushAlert(state, "heat", `${districtView.def.shortName} lockdown`, `A sweep freezes the block and burns ${paid.toLocaleString()} dirty cash.`, now);
    }
  });

  if (dirtyGain > 0) {
    addDirtyRevenue(state, dirtyGain);
  }

  const averageHeat = derived.totals.averageHeat;
  state.heatPressure = Math.max(0, state.heatPressure - 0.18 * dtSeconds);
  state.globalHeat = clamp(
    state.globalHeat +
      (averageHeat / 250 + state.heatPressure) * dtSeconds -
      (0.22 + (derived.beatMods.heatDecayMult || 0) * 0.1 + (derived.legacyBonuses.heatMitigation || 0) * 0.5) * dtSeconds,
    0,
    100,
  );

  if (state.globalHeat > 75 && chance(0.006, dtSeconds)) {
    const bust = Math.floor(state.dirtyCash * 0.07);
    state.dirtyCash = Math.max(0, state.dirtyCash - bust);
    state.globalHeat = clamp(state.globalHeat - 6, 0, 100);
    pushAlert(state, "heat", "City raid", `${bust.toLocaleString()} dirty cash vanished into evidence lockers.`, now);
  }

  state.operations = state.operations.filter((operation) => {
    if (operation.endsAt <= now) {
      completeOperation(state, operation, now);
      return false;
    }
    return true;
  });

  state.crew.forEach((crew) => {
    if (crew.busyUntil > now) {
      return;
    }
    const effects = getTraitEffects(crew);
    if (crew.assignmentKey === "rest") {
      crew.stress = clamp(crew.stress - (0.55 + effects.stressRecovery) * dtSeconds, 0, 100);
    } else if (crew.assignmentKey === "idle") {
      crew.stress = clamp(crew.stress - 0.18 * dtSeconds, 0, 100);
    } else {
      crew.stress = clamp(crew.stress + (0.18 + effects.stressGain) * dtSeconds, 0, 100);
    }
  });

  if (state.cityBeat && state.cityBeat.endsAt <= now) {
    state.cityBeat = null;
    state.nextBeatAt = now + 90000;
  } else if (!state.cityBeat && state.nextBeatAt <= now) {
    rollCityBeat(state, now);
  }

  if (state.nextRecruitRefreshAt <= now) {
    refreshRecruitPool(state, now, true);
  }

  if (state.nextContractRefreshAt <= now) {
    rollContracts(state, now);
    pushAlert(state, "contract", "Contract board refreshed", "Fresh windows just hit the board.", now);
  }
}
