import {
  BUILDING_DEFS,
  CITY_CELLS,
  CITY_ANCHORS,
  FORMATION_DEFS,
  INCIDENT_TEMPLATES,
  OPERATIVE_DEFS,
  RESEARCH_NODES,
  RESOURCE_META,
  UNIT_DEFS,
  WORLD_NODES,
  ZONE_META,
} from "./data.mjs";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

export function getBuildingDef(id) {
  return BUILDING_DEFS.find((entry) => entry.id === id) || BUILDING_DEFS[0];
}

export function getNodeDef(id) {
  return WORLD_NODES.find((entry) => entry.id === id) || WORLD_NODES[0];
}

export function getOperativeDef(id) {
  return OPERATIVE_DEFS.find((entry) => entry.id === id) || OPERATIVE_DEFS[0];
}

export function getResearchDef(id) {
  return RESEARCH_NODES.find((entry) => entry.id === id) || null;
}

export function getUnitDef(id) {
  return UNIT_DEFS.find((entry) => entry.id === id) || UNIT_DEFS[0];
}

export function getFormationDef(id) {
  return FORMATION_DEFS.find((entry) => entry.id === id) || FORMATION_DEFS[0];
}

function getCell(id) {
  return CITY_CELLS.find((entry) => entry.id === id) || null;
}

function getAnchor(id) {
  return CITY_ANCHORS.find((entry) => entry.id === id) || null;
}

export function fmtNumber(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return Math.floor(value).toLocaleString();
}

export function fmtTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function hasResourceKey(key) {
  return Object.prototype.hasOwnProperty.call(RESOURCE_META, key);
}

export function canAfford(state, bundle = {}) {
  return Object.entries(bundle).every(([key, value]) => !hasResourceKey(key) || (state.resources[key] || 0) >= value);
}

function applyBundle(state, bundle = {}, scale = 1) {
  Object.entries(bundle).forEach(([key, value]) => {
    if (!hasResourceKey(key)) {
      return;
    }
    state.resources[key] = Math.max(0, (state.resources[key] || 0) + value * scale);
  });
}

function spendBundle(state, bundle = {}) {
  if (!canAfford(state, bundle)) {
    return false;
  }
  Object.entries(bundle).forEach(([key, value]) => {
    if (!hasResourceKey(key)) {
      return;
    }
    state.resources[key] = Math.max(0, (state.resources[key] || 0) - value);
  });
  return true;
}

export function pushAlert(state, tone, title, detail, now = Date.now()) {
  state.alerts.unshift({
    id: state.nextAlertId++,
    tone,
    title,
    detail,
    at: now,
  });
  state.alerts = state.alerts.slice(0, 12);
}

function getBuildingState(state, instanceId) {
  return state.city.buildings.find((entry) => entry.instanceId === instanceId) || null;
}

function getNodeState(state, nodeId) {
  return state.world.nodes.find((entry) => entry.id === nodeId) || null;
}

function getOperativeState(state, operativeId) {
  return state.operatives.find((entry) => entry.id === operativeId) || null;
}

function buildingCount(state, typeId) {
  return state.city.buildings.filter((entry) => entry.typeId === typeId).length;
}

function isBuildingReady(building, now) {
  return building.busyUntil <= now;
}

function getResearchBonuses(state) {
  return state.research.completedIds.reduce((accumulator, id) => {
    const definition = getResearchDef(id);
    if (!definition) {
      return accumulator;
    }
    Object.entries(definition.effect).forEach(([key, value]) => {
      accumulator[key] = (accumulator[key] || 0) + value;
    });
    return accumulator;
  }, {});
}

function getCityBonuses(state) {
  const bonuses = getResearchBonuses(state);
  bonuses.moraleMult = 1 + Math.max(-0.12, (state.city.morale - 70) / 220);
  bonuses.missionPower = (bonuses.missionSuccess || 0) + (state.world.control / 500);
  return bonuses;
}

function getPassiveRates(state, now) {
  const bonuses = getCityBonuses(state);
  const rates = Object.keys(RESOURCE_META).reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});

  state.city.buildings.forEach((building) => {
    if (!isBuildingReady(building, now) || building.level <= 0) {
      return;
    }
    const definition = getBuildingDef(building.typeId);
    const levelMult = 1 + (building.level - 1) * 0.28;
    Object.entries(definition.outputPerSec || {}).forEach(([key, value]) => {
      let bonus = 1;
      if (key === "food") {
        bonus += bonuses.foodRate || 0;
      }
      if (key === "water") {
        bonus += bonuses.waterRate || 0;
      }
      if (key === "alloy") {
        bonus += bonuses.alloyRate || 0;
      }
      if (key === "credits") {
        bonus += bonuses.creditsRate || 0;
      }
      if (key === "intel") {
        bonus += bonuses.intelRate || 0;
      }
      rates[key] += value * levelMult * bonus * bonuses.moraleMult;
    });
  });

  return rates;
}

function updatePopulation(state, dtSeconds) {
  const habitatLevels = state.city.buildings
    .filter((entry) => entry.typeId === "habitat-pod" && entry.level > 0)
    .reduce((total, entry) => total + entry.level, 0);
  const bonuses = getCityBonuses(state);
  const housingBonus = bonuses.housingBonus || 0;
  state.city.housing = 56 + habitatLevels * 16 + housingBonus + state.city.tier * 8;
  const targetPopulation = Math.min(state.city.housing, 58 + state.city.tier * 10 + habitatLevels * 8);
  const delta = clamp((targetPopulation - state.city.population) * dtSeconds * 0.01, -0.6, 0.7);
  state.city.population = clamp(state.city.population + delta, 40, state.city.housing);
}

function unlockZonesForTier(tier) {
  return Object.entries(ZONE_META)
    .filter(([, meta]) => meta.unlockTier <= tier)
    .map(([id]) => id);
}

function revealNodesForProgress(state) {
  state.city.unlockedZones = unlockZonesForTier(state.city.tier);
  state.world.nodes.forEach((nodeState) => {
    const definition = getNodeDef(nodeState.id);
    if (definition.sector <= state.world.sectorsUnlocked) {
      nodeState.discovered = true;
    }
  });
}

function completeResearch(state, now) {
  if (!state.research.activeId || state.research.activeEndsAt > now) {
    return;
  }
  if (!state.research.completedIds.includes(state.research.activeId)) {
    state.research.completedIds.push(state.research.activeId);
    state.stats.researchesCompleted += 1;
    pushAlert(state, "science", "Research completed", `${getResearchDef(state.research.activeId)?.name || "Research"} is now online.`, now);
  }
  state.research.activeId = "";
  state.research.activeEndsAt = 0;
}

function completeTraining(state, now) {
  if (!state.training.unitId || state.training.endsAt > now) {
    return;
  }
  state.units = state.units || {};
  state.units[state.training.unitId] = (state.units[state.training.unitId] || 0) + state.training.amount;
  pushAlert(
    state,
    "military",
    "Training complete",
    `${getUnitDef(state.training.unitId).name} +${state.training.amount} are ready.`,
    now,
  );
  state.training.unitId = "";
  state.training.amount = 0;
  state.training.endsAt = 0;
}

function finishBuildingActivity(state, building, now) {
  if (!building.activityId || building.busyUntil > now) {
    return;
  }
  if (building.activityId === "construction") {
    building.level = 1;
    state.stats.buildingsPlaced += 1;
    pushAlert(state, "build", "Construction complete", `${getBuildingDef(building.typeId).name} is online.`, now);
  }
  if (building.activityId === "upgrade") {
    building.level = building.queuedPayload?.targetLevel || building.level;
    state.stats.buildingUpgrades += 1;
    if (building.typeId === "helio-core") {
      state.city.tier = building.level;
      tierUpUnlocks(state, now);
    }
    pushAlert(state, "build", "Upgrade complete", `${getBuildingDef(building.typeId).name} reached level ${building.level}.`, now);
  }
  building.busyUntil = 0;
  building.activityId = "";
  building.queuedPayload = null;
}

function resolvePendingActivities(state, now) {
  state.city.buildings.forEach((building) => finishBuildingActivity(state, building, now));
}

function maybeSpawnIncident(state, now) {
  if (state.incidents.length || now < state.nextIncidentAt) {
    return;
  }
  const template = randomItem(INCIDENT_TEMPLATES);
  if (!template) {
    return;
  }
  state.incidents.push({
    id: state.nextIncidentId++,
    templateId: template.id,
    spawnedAt: now,
  });
  state.nextIncidentAt = now + 140000 + Math.floor(Math.random() * 90000);
  pushAlert(state, "event", template.title, template.detail, now);
}

export function tickState(state, now = Date.now()) {
  const lastTick = state.lastTickAt || now;
  const elapsed = Math.max(0, now - lastTick);
  const dtSeconds = elapsed / 1000;
  if (dtSeconds <= 0) {
    return;
  }

  const rates = getPassiveRates(state, now);
  Object.entries(rates).forEach(([key, value]) => {
    state.resources[key] = Math.max(0, (state.resources[key] || 0) + value * dtSeconds);
  });

  updatePopulation(state, dtSeconds);
  completeResearch(state, now);
  completeTraining(state, now);
  resolvePendingActivities(state, now);
  revealNodesForProgress(state);
  maybeSpawnIncident(state, now);
  state.lastTickAt = now;
}

function getZoneUnlocked(state, zoneId) {
  return state.city.unlockedZones.includes(zoneId);
}

function getOccupiedCellIds(state, excludeInstanceId = "") {
  return new Set(
    state.city.buildings
      .filter((entry) => entry.instanceId !== excludeInstanceId && entry.cellId)
      .map((entry) => entry.cellId),
  );
}

function cellCanHostType(state, cellId, typeId, excludeInstanceId = "") {
  const cell = getCell(cellId);
  const definition = getBuildingDef(typeId);
  if (!cell || !definition || definition.fixed) {
    return false;
  }
  if (!getZoneUnlocked(state, cell.zone)) {
    return false;
  }
  if (definition.allowedZones?.length && !definition.allowedZones.includes(cell.zone)) {
    return false;
  }
  return !getOccupiedCellIds(state, excludeInstanceId).has(cellId);
}

function getBuildCost(definition) {
  return definition.buildCost || {};
}

export function getUpgradeCost(building) {
  const definition = getBuildingDef(building.typeId);
  const nextLevel = building.level + 1;
  return Object.entries(definition.upgradeBase || {}).reduce((accumulator, [key, value]) => {
    accumulator[key] = Math.floor(value * Math.pow(definition.upgradeScale || 1.7, nextLevel - 2));
    return accumulator;
  }, {});
}

function getBuildDuration(definition) {
  return 18000 + definition.unlockTier * 4000;
}

function getUpgradeDuration(building) {
  return 24000 + building.level * 9000;
}

function nextBuildingInstanceId(state) {
  const id = `build-${state.city.nextBuildingId}`;
  state.city.nextBuildingId += 1;
  return id;
}

function tierUpUnlocks(state, now) {
  revealNodesForProgress(state);
  pushAlert(state, "core", "Tier elevated", `Helio Core tier ${state.city.tier} unlocks more city zones and frontier sectors.`, now);
}

export function selectView(state, viewId) {
  state.currentView = viewId === "city" ? "city" : "world";
}

export function selectBuilding(state, instanceId) {
  if (getBuildingState(state, instanceId)) {
    state.selectedBuildingId = instanceId;
    state.selectedCellId = "";
    state.currentView = "city";
  }
}

export function selectCell(state, cellId) {
  if (getCell(cellId)) {
    state.selectedCellId = cellId;
    state.selectedBuildingId = "";
    state.currentView = "city";
  }
}

export function selectNode(state, nodeId) {
  if (getNodeState(state, nodeId)) {
    state.selectedNodeId = nodeId;
    state.currentView = "world";
  }
}

export function selectOperative(state, operativeId) {
  if (getOperativeState(state, operativeId)) {
    state.selectedOperativeId = operativeId;
  }
}

export function startPlacement(state, typeId) {
  const definition = getBuildingDef(typeId);
  if (!definition || definition.fixed) {
    return false;
  }
  if (state.city.tier < definition.unlockTier) {
    return false;
  }
  if (buildingCount(state, typeId) >= definition.limit) {
    return false;
  }
  state.ui.placementTypeId = typeId;
  state.ui.relocatingBuildingId = "";
  state.currentView = "city";
  return true;
}

export function startRelocate(state, instanceId) {
  const building = getBuildingState(state, instanceId);
  if (!building || building.anchorId) {
    return false;
  }
  state.ui.relocatingBuildingId = instanceId;
  state.ui.placementTypeId = "";
  state.currentView = "city";
  return true;
}

export function cancelPlacement(state) {
  state.ui.placementTypeId = "";
  state.ui.relocatingBuildingId = "";
}

export function confirmPlacement(state, cellId, now = Date.now()) {
  if (state.ui.relocatingBuildingId) {
    const building = getBuildingState(state, state.ui.relocatingBuildingId);
    if (!building || !cellCanHostType(state, cellId, building.typeId, building.instanceId)) {
      return false;
    }
    building.cellId = cellId;
    state.selectedBuildingId = building.instanceId;
    cancelPlacement(state);
    pushAlert(state, "build", "Building relocated", `${getBuildingDef(building.typeId).name} has a new footprint.`, now);
    return true;
  }

  const typeId = state.ui.placementTypeId;
  const definition = getBuildingDef(typeId);
  if (!definition || !cellCanHostType(state, cellId, typeId)) {
    return false;
  }
  if (buildingCount(state, typeId) >= definition.limit || !spendBundle(state, getBuildCost(definition))) {
    return false;
  }

  const building = {
    instanceId: nextBuildingInstanceId(state),
    typeId,
    anchorId: null,
    cellId,
    level: 0,
    busyUntil: now + getBuildDuration(definition),
    cooldownUntil: 0,
    activityId: "construction",
    queuedPayload: { targetLevel: 1 },
  };
  state.city.buildings.push(building);
  state.selectedBuildingId = building.instanceId;
  state.selectedCellId = "";
  state.stats.actionsTaken += 1;
  cancelPlacement(state);
  pushAlert(state, "build", "Construction started", `${definition.name} is going up in ${fmtTime(building.busyUntil - now)}.`, now);
  return true;
}

export function upgradeBuilding(state, instanceId, now = Date.now()) {
  const building = getBuildingState(state, instanceId);
  if (!building || building.busyUntil > now) {
    return false;
  }
  const definition = getBuildingDef(building.typeId);
  if (building.level >= definition.maxLevel) {
    return false;
  }
  const cost = getUpgradeCost(building);
  if (!spendBundle(state, cost)) {
    return false;
  }
  building.busyUntil = now + getUpgradeDuration(building);
  building.activityId = "upgrade";
  building.queuedPayload = { targetLevel: building.level + 1 };
  pushAlert(state, "build", "Upgrade queued", `${definition.name} will reach level ${building.level + 1} in ${fmtTime(building.busyUntil - now)}.`, now);
  return true;
}

function reduceLongestInjury(state, amountMs) {
  const injured = state.operatives
    .filter((entry) => entry.injuryUntil > Date.now())
    .sort((left, right) => right.injuryUntil - left.injuryUntil);
  if (!injured.length) {
    return false;
  }
  injured[0].injuryUntil = Math.max(Date.now(), injured[0].injuryUntil - amountMs);
  return true;
}

function refreshFastestNode(state, amountMs) {
  const candidates = state.world.nodes
    .filter((entry) => entry.cooldownUntil > Date.now())
    .sort((left, right) => left.cooldownUntil - right.cooldownUntil);
  if (!candidates.length) {
    return false;
  }
  candidates[0].cooldownUntil = Math.max(Date.now(), candidates[0].cooldownUntil - amountMs);
  return true;
}

function revealNextHiddenNode(state) {
  const hidden = state.world.nodes.find((entry) => {
    const definition = getNodeDef(entry.id);
    return !entry.discovered && definition.sector <= Math.max(1, state.world.sectorsUnlocked + 1);
  });
  if (!hidden) {
    return false;
  }
  hidden.discovered = true;
  return true;
}

export function triggerBuildingAction(state, instanceId, now = Date.now()) {
  const building = getBuildingState(state, instanceId);
  if (!building || building.busyUntil > now || building.cooldownUntil > now || building.level <= 0) {
    return false;
  }
  const definition = getBuildingDef(building.typeId);
  let succeeded = false;

  switch (definition.id) {
    case "helio-core":
      applyBundle(state, { energy: 42, credits: 20 });
      state.city.morale = clamp(state.city.morale + 4, 30, 100);
      succeeded = true;
      break;
    case "command-nexus":
      applyBundle(state, { intel: 3, credits: 25 });
      refreshFastestNode(state, 30000);
      succeeded = true;
      break;
    case "habitat-pod":
      if (spendBundle(state, { food: 12, water: 8 })) {
        applyBundle(state, { credits: 70 });
        state.city.morale = clamp(state.city.morale + 6, 30, 100);
        succeeded = true;
      }
      break;
    case "hydroponic-farm":
      if (spendBundle(state, { energy: 12 })) {
        applyBundle(state, { food: 52 });
        succeeded = true;
      }
      break;
    case "water-loop":
      if (spendBundle(state, { energy: 8 })) {
        applyBundle(state, { water: 48 });
        state.city.morale = clamp(state.city.morale + 2, 30, 100);
        succeeded = true;
      }
      break;
    case "solar-spine":
      applyBundle(state, { energy: 72 });
      state.city.morale = clamp(state.city.morale - 2, 30, 100);
      succeeded = true;
      break;
    case "alloy-works":
      if (spendBundle(state, { energy: 18 })) {
        applyBundle(state, { alloy: 44 });
        succeeded = true;
      }
      break;
    case "circuit-foundry":
      if (spendBundle(state, { credits: 60, alloy: 16 })) {
        applyBundle(state, { circuits: 8 });
        succeeded = true;
      }
      break;
    case "med-bay":
      state.city.morale = clamp(state.city.morale + 5, 30, 100);
      reduceLongestInjury(state, 120000);
      succeeded = true;
      break;
    case "commons-hall":
      if (spendBundle(state, { food: 28, water: 28, credits: 40 })) {
        applyBundle(state, { credits: 95 });
        state.city.morale = clamp(state.city.morale + 10, 30, 100);
        state.world.threat = clamp(state.world.threat - 4, 0, 100);
        succeeded = true;
      }
      break;
    case "drone-port":
      applyBundle(state, { intel: 4 });
      revealNextHiddenNode(state);
      refreshFastestNode(state, 45000);
      succeeded = true;
      break;
    default:
      break;
  }

  if (!succeeded) {
    return false;
  }

  building.cooldownUntil = now + (definition.action?.cooldownMs || 0);
  state.stats.actionsTaken += 1;
  pushAlert(state, "action", definition.action.label, definition.action.detail, now);
  return true;
}

export function startResearch(state, researchId, now = Date.now()) {
  const research = getResearchDef(researchId);
  if (!research || state.research.completedIds.includes(researchId) || state.research.activeId) {
    return false;
  }
  const requirementsMet = (research.requires || []).every((id) => state.research.completedIds.includes(id));
  if (!requirementsMet || !spendBundle(state, research.cost)) {
    return false;
  }
  state.research.activeId = researchId;
  state.research.activeEndsAt = now + research.durationMs;
  pushAlert(state, "science", "Research started", `${research.name} will complete in ${fmtTime(research.durationMs)}.`, now);
  return true;
}

export function queueTraining(state, unitId, now = Date.now()) {
  if (state.training.unitId) {
    return false;
  }
  const unit = getUnitDef(unitId);
  if (!spendBundle(state, unit.cost)) {
    return false;
  }
  state.training.unitId = unit.id;
  state.training.amount = unit.batch;
  state.training.endsAt = now + unit.timeMs;
  pushAlert(state, "military", "Training queued", `${unit.name} x${unit.batch} ready in ${fmtTime(unit.timeMs)}.`, now);
  return true;
}

export function recruitOperative(state, operativeId, now = Date.now()) {
  const operative = getOperativeState(state, operativeId);
  if (!operative || operative.recruited) {
    return false;
  }
  if (!spendBundle(state, { credits: 180, shards: 2, intel: 2 })) {
    return false;
  }
  operative.recruited = true;
  operative.level = 1;
  operative.rank = 1;
  state.selectedOperativeId = operativeId;
  pushAlert(state, "hero", "Operative recruited", `${getOperativeDef(operativeId).name} joined the city.`, now);
  return true;
}

export function promoteOperative(state, operativeId, now = Date.now()) {
  const operative = getOperativeState(state, operativeId);
  if (!operative || !operative.recruited) {
    return false;
  }
  const cost = {
    credits: 120 + operative.rank * 90,
    shards: operative.rank >= 3 ? 2 : 1,
  };
  if (!spendBundle(state, cost)) {
    return false;
  }
  operative.rank += 1;
  operative.level += 1;
  pushAlert(state, "hero", "Operative promoted", `${getOperativeDef(operativeId).name} reached rank ${operative.rank}.`, now);
  return true;
}

export function resolveIncidentChoice(state, incidentId, choice, now = Date.now()) {
  const incidentIndex = state.incidents.findIndex((entry) => entry.id === incidentId);
  if (incidentIndex < 0) {
    return false;
  }
  const incident = state.incidents[incidentIndex];
  const template = INCIDENT_TEMPLATES.find((entry) => entry.id === incident.templateId);
  if (!template) {
    return false;
  }
  const effect = choice === "primary" ? template.primaryEffect : template.secondaryEffect;
  Object.entries(effect || {}).forEach(([key, value]) => {
    if (hasResourceKey(key)) {
      state.resources[key] = Math.max(0, (state.resources[key] || 0) + value);
      return;
    }
    if (key === "morale") {
      state.city.morale = clamp(state.city.morale + value, 30, 100);
    }
  });
  state.incidents.splice(incidentIndex, 1);
  pushAlert(state, "event", template.title, `Resolved with "${choice === "primary" ? template.primaryLabel : template.secondaryLabel}".`, now);
  return true;
}

function getOperativePower(state, operativeId) {
  const operative = getOperativeState(state, operativeId);
  const definition = getOperativeDef(operativeId);
  if (!operative?.recruited) {
    return 0;
  }
  const injuryPenalty = operative.injuryUntil > Date.now() ? 0.72 : 1;
  return (definition.power + operative.rank * 6 + operative.level * 2.5) * injuryPenalty;
}

function getUnitPower(state) {
  const units = state.units || {};
  const bonuses = getCityBonuses(state);
  return UNIT_DEFS.reduce((total, definition) => {
    const count = units[definition.id] || 0;
    return total + count * definition.power * (1 + (bonuses.unitAttack || 0));
  }, 0);
}

export function estimateMissionPower(state, squadIds = state.ui.missionSquad) {
  return squadIds.reduce((total, id) => total + getOperativePower(state, id), 0) + getUnitPower(state) * 0.25;
}

function getMissionCooldown(nodeDef, bonuses) {
  const base = nodeDef.kind === "landmark" ? 0 : nodeDef.kind === "threat" ? 180000 : 150000;
  return Math.floor(base * (1 - (bonuses.missionCooldown || 0)));
}

export function createMissionRun(state, nodeId, now = Date.now()) {
  const nodeDef = getNodeDef(nodeId);
  const nodeState = getNodeState(state, nodeId);
  if (!nodeDef || !nodeState || !nodeState.discovered || nodeState.cooldownUntil > now) {
    return null;
  }

  const squadIds = state.ui.missionSquad.filter((id) => getOperativeState(state, id)?.recruited).slice(0, 3);
  if (squadIds.length === 0) {
    return null;
  }

  const bonuses = getCityBonuses(state);
  const formation = getFormationDef(state.ui.missionFormation);
  const squadPower = squadIds.reduce((total, id) => total + getOperativePower(state, id), 0);
  const unitPower = getUnitPower(state);
  const playerMaxHp = Math.round(140 + squadPower * 1.5 + unitPower * 0.3);
  const enemyMaxHp = Math.round(nodeDef.enemyPower * 2.8);

  return {
    id: `${nodeId}-${now}`,
    nodeId,
    startedAt: now,
    squadIds,
    formationId: formation.id,
    round: 0,
    playerHp: playerMaxHp,
    playerMaxHp,
    enemyHp: enemyMaxHp,
    enemyMaxHp,
    attackBuff: 0,
    defenseBuff: 0,
    enemyDefenseDebuff: 0,
    roundBuffs: [],
    abilityUses: Object.fromEntries(squadIds.map((id) => [id, false])),
    log: [
      {
        id: `${now}-0`,
        tone: "info",
        text: `${nodeDef.name}: ${nodeDef.detail}`,
      },
    ],
    resolved: false,
    winner: "",
    missionPower: squadPower + unitPower * 0.35,
    offenseMod: formation.offense,
    defenseMod: formation.defense,
    missionSuccessBonus: bonuses.missionSuccess || 0,
    unitDefenseBonus: bonuses.unitDefense || 0,
    missionCritBonus: bonuses.missionCrit || 0,
  };
}

function addRunLog(run, tone, text) {
  run.log.unshift({
    id: `${run.id}-${run.round}-${run.log.length}`,
    tone,
    text,
  });
  run.log = run.log.slice(0, 8);
}

export function activateMissionAbility(run, operativeId) {
  if (!run || run.resolved || run.abilityUses?.[operativeId]) {
    return false;
  }
  const definition = getOperativeDef(operativeId);
  run.abilityUses[operativeId] = true;

  switch (definition.role) {
    case "Assault":
      run.enemyHp = Math.max(0, run.enemyHp - Math.round(24 + definition.power * 0.8));
      run.attackBuff += 0.15;
      run.roundBuffs.push({ kind: "attack", value: 0.15, rounds: 2 });
      addRunLog(run, "hero", `${definition.name} fires ${definition.abilityLabel} for a heavy burst.`);
      break;
    case "Support":
      run.playerHp = Math.min(run.playerMaxHp, run.playerHp + Math.round(18 + definition.power * 0.55));
      run.defenseBuff += 0.18;
      run.roundBuffs.push({ kind: "defense", value: 0.18, rounds: 2 });
      addRunLog(run, "hero", `${definition.name} activates ${definition.abilityLabel} to reinforce the squad.`);
      break;
    case "Signal":
      run.enemyDefenseDebuff += 0.2;
      run.roundBuffs.push({ kind: "enemyDefense", value: 0.2, rounds: 3 });
      addRunLog(run, "hero", `${definition.name} executes ${definition.abilityLabel} and opens the target up.`);
      break;
    default:
      break;
  }

  if (run.enemyHp <= 0) {
    run.resolved = true;
    run.winner = "player";
  }
  return true;
}

function decayRoundBuffs(run) {
  run.roundBuffs = run.roundBuffs
    .map((buff) => ({ ...buff, rounds: buff.rounds - 1 }))
    .filter((buff) => buff.rounds > 0);
  run.attackBuff = run.roundBuffs.filter((buff) => buff.kind === "attack").reduce((total, buff) => total + buff.value, 0);
  run.defenseBuff = run.roundBuffs.filter((buff) => buff.kind === "defense").reduce((total, buff) => total + buff.value, 0);
  run.enemyDefenseDebuff = run.roundBuffs.filter((buff) => buff.kind === "enemyDefense").reduce((total, buff) => total + buff.value, 0);
}

export function advanceMissionRun(run) {
  if (!run || run.resolved) {
    return run;
  }

  run.round += 1;
  const critRoll = Math.random() < 0.18 + run.missionCritBonus;
  const playerHit = Math.round((run.missionPower * 0.2 * run.offenseMod) * (1 + run.attackBuff) * (1 + run.enemyDefenseDebuff) * randomBetween(0.9, 1.12));
  const enemyHit = Math.round((run.enemyMaxHp * 0.055) * (1 - (run.defenseMod - 1)) * (1 - run.unitDefenseBonus - run.defenseBuff) * randomBetween(0.92, 1.1));
  const finalPlayerHit = Math.max(8, critRoll ? Math.round(playerHit * 1.35) : playerHit);
  const finalEnemyHit = Math.max(5, enemyHit);

  run.enemyHp = Math.max(0, run.enemyHp - finalPlayerHit);
  addRunLog(run, critRoll ? "crit" : "hit", `Your squad lands ${finalPlayerHit} damage.`);

  if (run.enemyHp <= 0) {
    run.resolved = true;
    run.winner = "player";
    addRunLog(run, "win", "Target broken. The route is yours.");
    return run;
  }

  run.playerHp = Math.max(0, run.playerHp - finalEnemyHit);
  addRunLog(run, "warn", `Enemy pressure deals ${finalEnemyHit} damage back.`);

  if (run.playerHp <= 0 || run.round >= 6) {
    run.resolved = true;
    run.winner = run.playerHp > run.enemyHp ? "player" : "enemy";
    addRunLog(run, run.winner === "player" ? "win" : "loss", run.winner === "player" ? "You edge out the last exchange." : "The squad breaks off and retreats.");
  }

  decayRoundBuffs(run);
  return run;
}

function applyMissionOutcome(state, run, now) {
  const nodeDef = getNodeDef(run.nodeId);
  const nodeState = getNodeState(state, run.nodeId);
  const bonuses = getCityBonuses(state);
  if (!nodeState) {
    return;
  }

  const success = run.winner === "player";
  const rewardScale = nodeDef.missionType === "escort"
    ? 1 + (bonuses.escortReward || 0)
    : nodeDef.missionType === "signal"
      ? 1 + (bonuses.signalReward || 0)
      : 1;

  if (success) {
    applyBundle(state, nodeDef.reward, rewardScale);
    nodeState.completions += 1;
    if (!nodeDef.repeatable) {
      nodeState.cleared = true;
    }
    if (nodeDef.unlocksSector) {
      state.world.sectorsUnlocked = Math.max(state.world.sectorsUnlocked, nodeDef.unlocksSector);
      revealNodesForProgress(state);
    }
    state.world.control = clamp(state.world.control + (nodeDef.kind === "landmark" ? 18 : 8), 0, 100);
    state.world.threat = clamp(state.world.threat - (nodeDef.kind === "threat" ? 6 : 2), 0, 100);
    nodeState.cooldownUntil = success && nodeDef.repeatable ? now + getMissionCooldown(nodeDef, bonuses) : 0;
    state.stats.missionsWon += 1;
    state.stats.nodesCleared += 1;
    pushAlert(state, "mission", "Mission secured", `${nodeDef.name} yielded ${Object.entries(nodeDef.reward).map(([key, value]) => `${fmtNumber(Math.floor(value * rewardScale))} ${RESOURCE_META[key].label}`).join(", ")}.`, now);
  } else {
    state.world.threat = clamp(state.world.threat + 5, 0, 100);
    nodeState.cooldownUntil = now + 70000;
    state.stats.missionsLost += 1;
    pushAlert(state, "mission", "Mission failed", `${nodeDef.name} pushed your squad back.`, now);
  }

  run.squadIds.forEach((operativeId) => {
    const operative = getOperativeState(state, operativeId);
    if (!operative) {
      return;
    }
    if (success) {
      operative.xp += nodeDef.enemyPower;
      if (nodeDef.kind === "landmark") {
        operative.level += 1;
      }
    } else {
      const reduction = getCityBonuses(state).injuryReduction || 0;
      operative.injuryUntil = Math.max(operative.injuryUntil, now + Math.floor(160000 * (1 - reduction)));
    }
  });
}

export function resolveMissionRun(state, run, now = Date.now()) {
  if (!run || !run.resolved) {
    return null;
  }
  applyMissionOutcome(state, run, now);
  return {
    success: run.winner === "player",
    nodeId: run.nodeId,
  };
}

function getAvailableResearch(state) {
  return RESEARCH_NODES.map((definition) => {
    const completed = state.research.completedIds.includes(definition.id);
    const active = state.research.activeId === definition.id;
    const locked = (definition.requires || []).some((id) => !state.research.completedIds.includes(id));
    return {
      definition,
      completed,
      active,
      locked,
      affordable: canAfford(state, definition.cost),
    };
  });
}

function getMissionReady(state, nodeState, now) {
  const definition = getNodeDef(nodeState.id);
  return nodeState.discovered && definition.sector <= state.world.sectorsUnlocked && nodeState.cooldownUntil <= now && state.city.tier >= definition.tierReq && (!nodeState.cleared || definition.repeatable);
}

function buildObjectives(state, derived) {
  const missingSolar = !state.city.buildings.some((entry) => entry.typeId === "solar-spine" && entry.level > 0);
  const missingCommons = !state.city.buildings.some((entry) => entry.typeId === "commons-hall");
  const firstLandmark = state.world.nodes.find((entry) => getNodeDef(entry.id).kind === "landmark");
  const activeResearch = state.research.activeId;

  const objectives = [
    {
      id: "power",
      title: "Grow your grid",
      detail: missingSolar ? "Place or upgrade a Solar Spine to stabilize the city." : "Use the Helio Core and Solar Spine to keep energy positive.",
      done: !missingSolar,
      focusView: "city",
    },
    {
      id: "research",
      title: "Push research",
      detail: activeResearch ? `Research running: ${getResearchDef(activeResearch)?.name || "Unknown"}.` : "Use the Research Lab to unlock your first permanent bonus.",
      done: state.research.completedIds.length > 0,
      focusView: "city",
    },
    {
      id: "civic",
      title: "Hold morale",
      detail: missingCommons ? "Build Commons Hall for city events and morale control." : `City morale is ${Math.round(state.city.morale)}%.`,
      done: !missingCommons,
      focusView: "city",
    },
    {
      id: "frontier",
      title: "Break the first gate",
      detail: firstLandmark?.cleared ? "The first district gate is down." : `Win at ${getNodeDef(firstLandmark?.id || "").name || "the first landmark"} to open sector two.`,
      done: Boolean(firstLandmark?.cleared),
      focusView: "world",
    },
  ];

  derived.activeObjective = objectives.find((entry) => !entry.done) || objectives[objectives.length - 1];
  return objectives;
}

export function calculateDerived(state, now = Date.now()) {
  const bonuses = getCityBonuses(state);
  const rates = getPassiveRates(state, now);
  const occupied = getOccupiedCellIds(state);
  const buildings = state.city.buildings.map((entry) => {
    const definition = getBuildingDef(entry.typeId);
    const cell = entry.cellId ? getCell(entry.cellId) : null;
    const anchor = entry.anchorId ? getAnchor(entry.anchorId) : null;
    return {
      building: entry,
      definition,
      position: cell || anchor,
      ready: entry.busyUntil <= now,
      busyRemainingMs: Math.max(0, entry.busyUntil - now),
      cooldownRemainingMs: Math.max(0, entry.cooldownUntil - now),
      upgradeCost: getUpgradeCost(entry),
      canUpgrade:
        entry.busyUntil <= now &&
        entry.level >= 1 &&
        entry.level < definition.maxLevel &&
        canAfford(state, getUpgradeCost(entry)),
    };
  });

  const cells = CITY_CELLS.map((cell) => ({
    ...cell,
    occupied: occupied.has(cell.id),
    unlocked: getZoneUnlocked(state, cell.zone),
    canPlace:
      (state.ui.placementTypeId && cellCanHostType(state, cell.id, state.ui.placementTypeId)) ||
      (state.ui.relocatingBuildingId &&
        cellCanHostType(state, cell.id, getBuildingState(state, state.ui.relocatingBuildingId)?.typeId || "", state.ui.relocatingBuildingId)),
  }));

  const buildChoices = BUILDING_DEFS.filter((definition) => !definition.fixed).map((definition) => ({
    definition,
    count: buildingCount(state, definition.id),
    buildable:
      state.city.tier >= definition.unlockTier &&
      buildingCount(state, definition.id) < definition.limit &&
      canAfford(state, getBuildCost(definition)),
  }));

  const worldNodes = state.world.nodes.map((entry) => {
    const definition = getNodeDef(entry.id);
    const cooldownRemainingMs = Math.max(0, entry.cooldownUntil - now);
    const ready = getMissionReady(state, entry, now);
    return {
      state: entry,
      definition,
      cooldownRemainingMs,
      ready,
      locked:
        !entry.discovered ||
        definition.sector > state.world.sectorsUnlocked ||
        state.city.tier < definition.tierReq ||
        (entry.cleared && !definition.repeatable),
    };
  });

  const operatives = state.operatives.map((entry) => {
    const definition = getOperativeDef(entry.id);
    return {
      state: entry,
      definition,
      power: getOperativePower(state, entry.id),
      injuryRemainingMs: Math.max(0, entry.injuryUntil - now),
      selected: state.ui.missionSquad.includes(entry.id),
    };
  });

  const availableResearch = getAvailableResearch(state);
  const selectedBuilding =
    buildings.find((entry) => entry.building.instanceId === state.selectedBuildingId) ||
    buildings[0] ||
    null;
  const selectedNode =
    worldNodes.find((entry) => entry.state.id === state.selectedNodeId) ||
    worldNodes[0] ||
    null;
  const selectedOperative =
    operatives.find((entry) => entry.state.id === state.selectedOperativeId) ||
    operatives[0] ||
    null;

  const derived = {
    bonuses,
    rates,
    housing: state.city.housing,
    population: state.city.population,
    buildings,
    cells,
    buildChoices,
    worldNodes,
    operatives,
    selectedBuilding,
    selectedNode,
    selectedOperative,
    availableResearch,
    squadPower: estimateMissionPower(state),
    missionFormation: getFormationDef(state.ui.missionFormation),
    trainingDef: state.training.unitId ? getUnitDef(state.training.unitId) : null,
    trainingRemainingMs: Math.max(0, state.training.endsAt - now),
    topAlerts: state.alerts.slice(0, 4),
  };

  derived.objectives = buildObjectives(state, derived);
  return derived;
}

export function toggleMissionSquad(state, operativeId) {
  const operative = getOperativeState(state, operativeId);
  if (!operative?.recruited) {
    return false;
  }
  if (state.ui.missionSquad.includes(operativeId)) {
    if (state.ui.missionSquad.length === 1) {
      return false;
    }
    state.ui.missionSquad = state.ui.missionSquad.filter((id) => id !== operativeId);
    return true;
  }
  if (state.ui.missionSquad.length >= 3) {
    return false;
  }
  state.ui.missionSquad = [...state.ui.missionSquad, operativeId];
  return true;
}

export function setMissionFormation(state, formationId) {
  if (FORMATION_DEFS.some((entry) => entry.id === formationId)) {
    state.ui.missionFormation = formationId;
    return true;
  }
  return false;
}

export function applyOfflineProgress(state, now = Date.now()) {
  const savedAt = state.savedAt || now;
  const elapsed = Math.min(now - savedAt, 30 * 60 * 1000);
  if (elapsed < 15000) {
    return;
  }
  const step = 5000;
  let cursor = savedAt;
  while (cursor < savedAt + elapsed) {
    cursor += step;
    tickState(state, cursor);
  }
  pushAlert(state, "offline", "City catch-up", `Processed ${Math.round(elapsed / 60000)} minutes of offline progress.`, now);
}

if (typeof window !== "undefined") {
  window.neonFrontierDebug = {
    fmtNumber,
    fmtTime,
  };
}
