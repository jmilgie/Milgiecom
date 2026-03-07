import {
  BUILDING_DEFS,
  CITY_ANCHORS,
  INCIDENT_TEMPLATES,
  OPERATIVE_DEFS,
  RESEARCH_NODES,
  RESOURCE_META,
  SAVE_KEY,
  SAVE_VERSION,
  STARTING_BUILDINGS,
  STARTING_OPERATIVE_IDS,
  WORLD_NODES,
} from "./data.mjs";

function buildResourceDefaults() {
  return Object.keys(RESOURCE_META).reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});
}

function buildResources(input = {}) {
  return {
    ...buildResourceDefaults(),
    food: 210,
    water: 210,
    energy: 180,
    alloy: 95,
    circuits: 36,
    credits: 520,
    intel: 12,
    shards: 2,
    ...input,
  };
}

function buildBuildingEntry(entry) {
  return {
    instanceId: entry.instanceId,
    typeId: entry.typeId,
    anchorId: entry.anchorId || null,
    cellId: entry.cellId || null,
    level: entry.level || 1,
    busyUntil: entry.busyUntil || 0,
    cooldownUntil: entry.cooldownUntil || 0,
    activityId: entry.activityId || "",
    queuedPayload: entry.queuedPayload || null,
  };
}

function buildNodeState(definition) {
  return {
    id: definition.id,
    completions: 0,
    cleared: false,
    cooldownUntil: 0,
    lastRunAt: 0,
    discovered: definition.sector === 1,
  };
}

function buildOperativeState(definition, recruited = false) {
  return {
    id: definition.id,
    recruited,
    level: recruited ? 1 : 0,
    xp: 0,
    rank: recruited ? 1 : 0,
    injuryUntil: 0,
  };
}

function buildAlerts(now) {
  return [
    {
      id: 1,
      tone: "info",
      title: "City online",
      detail: "Anchor the Helio Core, claim the nearby routes, and grow into the ridge.",
      at: now,
    },
  ];
}

function buildStats() {
  return {
    buildingsPlaced: 0,
    buildingUpgrades: 0,
    missionsWon: 0,
    missionsLost: 0,
    nodesCleared: 0,
    researchesCompleted: 0,
    actionsTaken: 0,
  };
}

function buildResearchState() {
  return {
    activeId: "",
    activeEndsAt: 0,
    completedIds: [],
  };
}

function buildTrainingState() {
  return {
    unitId: "",
    amount: 0,
    endsAt: 0,
  };
}

function buildUiState() {
  return {
    placementTypeId: "",
    relocatingBuildingId: "",
    missionNodeId: "",
    missionSquad: [...STARTING_OPERATIVE_IDS],
    missionFormation: "balanced",
  };
}

function normalizeBuildings(input = []) {
  const known = new Set();
  const buildings = [];

  input.forEach((entry) => {
    const definition = BUILDING_DEFS.find((item) => item.id === entry.typeId);
    if (!definition) {
      return;
    }
    known.add(entry.instanceId);
    buildings.push(buildBuildingEntry(entry));
  });

  STARTING_BUILDINGS.forEach((entry) => {
    if (!known.has(entry.instanceId)) {
      buildings.push(buildBuildingEntry(entry));
    }
  });

  return buildings;
}

function normalizeNodes(input = []) {
  return WORLD_NODES.map((definition) => {
    const existing = input.find((entry) => entry.id === definition.id) || {};
    return {
      ...buildNodeState(definition),
      ...existing,
      id: definition.id,
      discovered: existing.discovered ?? definition.sector === 1,
    };
  });
}

function normalizeOperatives(input = []) {
  return OPERATIVE_DEFS.map((definition) => {
    const existing = input.find((entry) => entry.id === definition.id);
    if (existing) {
      return {
        ...buildOperativeState(definition, STARTING_OPERATIVE_IDS.includes(definition.id)),
        ...existing,
        id: definition.id,
      };
    }
    return buildOperativeState(definition, STARTING_OPERATIVE_IDS.includes(definition.id));
  });
}

function normalizeResearch(input = {}) {
  const completed = Array.isArray(input.completedIds)
    ? input.completedIds.filter((id) => RESEARCH_NODES.some((node) => node.id === id))
    : [];
  return {
    activeId: input.activeId || "",
    activeEndsAt: input.activeEndsAt || 0,
    completedIds: completed,
  };
}

function normalizeIncidents(input = []) {
  return (Array.isArray(input) ? input : []).filter((entry) =>
    INCIDENT_TEMPLATES.some((template) => template.id === entry.templateId),
  );
}

function normalizeUi(input = {}) {
  const squad = Array.isArray(input.missionSquad)
    ? input.missionSquad.filter((id) => OPERATIVE_DEFS.some((definition) => definition.id === id)).slice(0, 3)
    : [];
  return {
    ...buildUiState(),
    ...input,
    missionSquad: squad.length ? squad : [...STARTING_OPERATIVE_IDS],
  };
}

function normalizeState(input = {}) {
  const now = Date.now();
  const reducedMotion = (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) || false;
  const buildings = normalizeBuildings(input.city?.buildings || input.buildings || []);

  return {
    version: SAVE_VERSION,
    savedAt: input.savedAt || now,
    lastTickAt: input.lastTickAt || input.savedAt || now,
    currentView: input.currentView === "city" ? "city" : "world",
    selectedNodeId: input.selectedNodeId || WORLD_NODES[0].id,
    selectedBuildingId: input.selectedBuildingId || "anchor-helio",
    selectedCellId: input.selectedCellId || "",
    selectedOperativeId: input.selectedOperativeId || STARTING_OPERATIVE_IDS[0],
    resources: buildResources(input.resources),
    city: {
      tier: input.city?.tier || 1,
      morale: input.city?.morale ?? 72,
      population: input.city?.population ?? 68,
      housing: input.city?.housing ?? 88,
      unlockedZones: input.city?.unlockedZones?.length ? input.city.unlockedZones : ["waterfront", "core"],
      buildings,
      nextBuildingId: input.city?.nextBuildingId ?? 7,
    },
    world: {
      sectorsUnlocked: input.world?.sectorsUnlocked || 1,
      control: input.world?.control ?? 8,
      threat: input.world?.threat ?? 18,
      nodes: normalizeNodes(input.world?.nodes || []),
    },
    units: {
      vanguard: input.units?.vanguard ?? 18,
      skimmer: input.units?.skimmer ?? 12,
      arclight: input.units?.arclight ?? 6,
    },
    operatives: normalizeOperatives(input.operatives || []),
    research: normalizeResearch(input.research),
    training: {
      ...buildTrainingState(),
      ...(input.training || {}),
    },
    incidents: normalizeIncidents(input.incidents),
    alerts: input.alerts?.length ? input.alerts.slice(0, 12) : buildAlerts(now),
    ui: normalizeUi(input.ui),
    stats: {
      ...buildStats(),
      ...(input.stats || {}),
    },
    settings: {
      sound: input.settings?.sound ?? true,
      music: input.settings?.music ?? true,
      reducedMotion,
    },
    nextAlertId: input.nextAlertId || 2,
    nextIncidentId: input.nextIncidentId || 1,
    nextIncidentAt: input.nextIncidentAt || now + 150000,
  };
}

export function createInitialState() {
  return normalizeState({});
}

export function loadState() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to load Neon Frontier save.", error);
    return null;
  }
}

export function saveState(state) {
  const snapshot = {
    ...state,
    savedAt: Date.now(),
  };
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
}

export function buildAnchorMap() {
  return CITY_ANCHORS.reduce((accumulator, anchor) => {
    accumulator[anchor.id] = anchor;
    return accumulator;
  }, {});
}
