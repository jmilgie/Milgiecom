import {
  CREW_ARCHETYPES,
  CREW_FIRST_NAMES,
  CREW_LAST_NAMES,
  DISTRICTS,
  LEGACY_UPGRADES,
  NEGATIVE_TRAITS,
  PANEL_TABS,
  POSITIVE_TRAITS,
  SAVE_KEY,
  SAVE_VERSION,
} from "./data.mjs";

function buildSettingsDefaults() {
  return {
    sound: true,
    music: true,
    vibration: true,
    reducedMotion: false,
  };
}

function buildStatsDefaults() {
  return {
    dirtyEarned: 0,
    cleanEarned: 0,
    cleanLaundered: 0,
    intelEarned: 0,
    prepsDone: 0,
    upgradesBought: 0,
    heistsWon: 0,
    hustleClicks: 0,
    districtsSeized: 0,
    lifetimeDirty: 0,
    lifetimeClean: 0,
    legacyRuns: 0,
  };
}

function buildLegacyUpgradeDefaults() {
  return Object.fromEntries(LEGACY_UPGRADES.map((upgrade) => [upgrade.id, 0]));
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function buildName() {
  return `${randomItem(CREW_FIRST_NAMES)} ${randomItem(CREW_LAST_NAMES)}`;
}

function traitPair() {
  return {
    positiveTraitId: randomItem(POSITIVE_TRAITS).id,
    negativeTraitId: randomItem(NEGATIVE_TRAITS).id,
  };
}

function statFromBias(base) {
  return Math.max(2, Math.min(8, base + randomInt(-1, 1)));
}

export function createCrewEntity({
  id,
  name = buildName(),
  archetypeId = randomItem(CREW_ARCHETYPES).id,
  rank = 1,
  positiveTraitId,
  negativeTraitId,
  starting = false,
} = {}) {
  const archetype = CREW_ARCHETYPES.find((entry) => entry.id === archetypeId) || CREW_ARCHETYPES[0];
  const rolledTraits = traitPair();
  const traits = {
    positiveTraitId: positiveTraitId || rolledTraits.positiveTraitId,
    negativeTraitId: negativeTraitId || rolledTraits.negativeTraitId,
  };

  return {
    id,
    name,
    archetypeId: archetype.id,
    rank,
    cunning: statFromBias(archetype.bias.cunning) + (starting ? 1 : 0),
    nerve: statFromBias(archetype.bias.nerve),
    loyalty: statFromBias(archetype.bias.loyalty) + (starting ? 1 : 0),
    stress: starting ? 8 : randomInt(4, 18),
    xp: 0,
    hue: randomInt(0, 360),
    positiveTraitId: traits.positiveTraitId,
    negativeTraitId: traits.negativeTraitId,
    assignmentKey: starting ? "rest" : "idle",
    busyUntil: 0,
    busyType: "",
    busyRef: "",
    lastHeistBonusClaim: 0,
  };
}

export function createRecruitPool(startingId = 1, count = 3) {
  return Array.from({ length: count }, (_, index) => {
    const archetype = randomItem(CREW_ARCHETYPES);
    return createCrewEntity({
      id: `candidate-${startingId + index}`,
      archetypeId: archetype.id,
      rank: Math.random() < 0.2 ? 2 : 1,
    });
  });
}

function buildDistrictState(district, unlocked) {
  return {
    id: district.id,
    unlocked,
    controlled: false,
    control: unlocked ? 24 : 0,
    heat: unlocked ? 8 : 0,
    lockUntil: 0,
    rackets: district.rackets.map((asset) => ({ id: asset.id, level: 0 })),
    fronts: district.fronts.map((asset) => ({ id: asset.id, level: 0 })),
    heist: {
      cooldownUntil: 0,
      prepDone: {},
      wins: 0,
      lastOutcome: "",
    },
  };
}

function buildHeistDrafts() {
  return Object.fromEntries(
    DISTRICTS.map((district) => [
      district.id,
      {
        approachId: district.heist.approaches[0].id,
        crewIds: [],
      },
    ]),
  );
}

function normalizeCrewEntry(entry, fallbackId) {
  return {
    ...entry,
    id: entry.id || fallbackId,
    name: entry.name || buildName(),
    rank: entry.rank || 1,
    cunning: entry.cunning ?? 4,
    nerve: entry.nerve ?? 4,
    loyalty: entry.loyalty ?? 4,
    stress: entry.stress ?? 0,
    xp: entry.xp ?? 0,
    hue: entry.hue ?? randomInt(0, 360),
    positiveTraitId: entry.positiveTraitId || POSITIVE_TRAITS[0].id,
    negativeTraitId: entry.negativeTraitId || NEGATIVE_TRAITS[0].id,
    assignmentKey: entry.assignmentKey || "idle",
    busyUntil: entry.busyUntil || 0,
    busyType: entry.busyType || "",
    busyRef: entry.busyRef || "",
    lastHeistBonusClaim: entry.lastHeistBonusClaim || 0,
  };
}

function normalizeDistricts(parsedDistricts = []) {
  return DISTRICTS.map((district, index) => {
    const existing = parsedDistricts.find((entry) => entry.id === district.id) || {};
    const base = buildDistrictState(district, index === 0);

    return {
      ...base,
      ...existing,
      rackets: district.rackets.map((asset) => ({
        ...(base.rackets.find((entry) => entry.id === asset.id) || { id: asset.id, level: 0 }),
        ...(existing.rackets?.find((entry) => entry.id === asset.id) || {}),
      })),
      fronts: district.fronts.map((asset) => ({
        ...(base.fronts.find((entry) => entry.id === asset.id) || { id: asset.id, level: 0 }),
        ...(existing.fronts?.find((entry) => entry.id === asset.id) || {}),
      })),
      heist: {
        ...base.heist,
        ...(existing.heist || {}),
        prepDone: { ...(existing.heist?.prepDone || {}) },
      },
    };
  });
}

function normalizeStats(stats = {}) {
  const defaults = buildStatsDefaults();
  const cleanEarned = stats.cleanEarned ?? stats.lifetimeClean ?? stats.cleanLaundered ?? 0;
  const cleanLaundered = stats.cleanLaundered ?? 0;

  return {
    ...defaults,
    ...stats,
    cleanEarned,
    cleanLaundered,
    lifetimeClean: stats.lifetimeClean ?? cleanEarned,
  };
}

function normalizeState(parsed) {
  const now = Date.now();
  const validPanels = new Set(PANEL_TABS.map((tab) => tab.id));
  const legacyUpgrades = {
    ...buildLegacyUpgradeDefaults(),
    ...(parsed.legacyUpgrades || {}),
  };
  const crew = (parsed.crew || []).map((entry, index) => normalizeCrewEntry(entry, `crew-${index + 1}`));
  const recruitPool = (parsed.recruitPool || []).map((entry, index) => normalizeCrewEntry(entry, `candidate-${index + 1}`));
  const alerts = Array.isArray(parsed.alerts) && parsed.alerts.length
    ? parsed.alerts.slice(0, 18)
    : [{
      id: 1,
      tone: "info",
      title: "HQ online",
      detail: "Own the strip, then build toward the vault.",
      at: now,
    }];
  const districts = normalizeDistricts(parsed.districts);
  const heistDrafts = { ...buildHeistDrafts(), ...(parsed.heistDrafts || {}) };

  return {
    ...parsed,
    version: SAVE_VERSION,
    savedAt: parsed.savedAt || now,
    lastTickAt: parsed.lastTickAt || parsed.savedAt || now,
    dirtyCash: parsed.dirtyCash ?? 520,
    cleanCash: parsed.cleanCash ?? 220,
    intel: parsed.intel ?? 3,
    notoriety: parsed.notoriety ?? 0,
    surge: parsed.surge ?? 18,
    surgeUntil: parsed.surgeUntil || 0,
    globalHeat: parsed.globalHeat ?? 10,
    heatPressure: parsed.heatPressure ?? 0,
    currentPanel: validPanels.has(parsed.currentPanel) ? parsed.currentPanel : "city",
    selectedDistrictId: parsed.selectedDistrictId || DISTRICTS[0].id,
    heistDrafts,
    nextContractRefreshAt: parsed.nextContractRefreshAt || now + 240000,
    nextRecruitRefreshAt: parsed.nextRecruitRefreshAt || now + 210000,
    nextBeatAt: parsed.nextBeatAt || now + 90000,
    cityBeat: parsed.cityBeat || null,
    districts,
    crewCapBase: parsed.crewCapBase ?? 4,
    crew,
    recruitPool,
    nextRecruitId: parsed.nextRecruitId ?? (recruitPool.length + 1),
    nextCrewId: parsed.nextCrewId ?? (crew.length + 1),
    nextAlertId: parsed.nextAlertId ?? (alerts.reduce((max, alert) => Math.max(max, alert.id || 0), 0) + 1),
    nextOperationId: parsed.nextOperationId ?? 1,
    contracts: Array.isArray(parsed.contracts) ? parsed.contracts : [],
    operations: Array.isArray(parsed.operations) ? parsed.operations : [],
    legacyPoints: parsed.legacyPoints ?? 0,
    legacyUpgrades,
    settings: {
      ...buildSettingsDefaults(),
      ...(parsed.settings || {}),
    },
    stats: normalizeStats(parsed.stats),
    alerts,
  };
}

export function createInitialState(now = Date.now()) {
  const recruitPool = createRecruitPool(1, 3);
  const starterCrew = createCrewEntity({
    id: "crew-1",
    name: "Nova Vale",
    archetypeId: "fixer",
    rank: 1,
    positiveTraitId: "connected",
    negativeTraitId: "flashy",
    starting: true,
  });

  return {
    version: SAVE_VERSION,
    savedAt: now,
    lastTickAt: now,
    dirtyCash: 520,
    cleanCash: 220,
    intel: 3,
    notoriety: 0,
    surge: 18,
    surgeUntil: 0,
    globalHeat: 10,
    heatPressure: 0,
    currentPanel: "city",
    selectedDistrictId: DISTRICTS[0].id,
    heistDrafts: buildHeistDrafts(),
    nextContractRefreshAt: now + 240000,
    nextRecruitRefreshAt: now + 210000,
    nextBeatAt: now + 90000,
    cityBeat: null,
    districts: DISTRICTS.map((district, index) => buildDistrictState(district, index === 0)),
    crewCapBase: 4,
    crew: [starterCrew],
    recruitPool,
    nextRecruitId: recruitPool.length + 1,
    nextCrewId: 2,
    nextAlertId: 2,
    nextOperationId: 1,
    contracts: [],
    operations: [],
    legacyPoints: 0,
    legacyUpgrades: buildLegacyUpgradeDefaults(),
    settings: buildSettingsDefaults(),
    stats: buildStatsDefaults(),
    alerts: [
      {
        id: 1,
        tone: "info",
        title: "HQ online",
        detail: "Own the strip, then build toward the vault.",
        at: now,
      },
    ],
  };
}

export function buildFreshEmpireFromLegacy(previousState, now = Date.now()) {
  const fresh = createInitialState(now);
  fresh.legacyPoints = previousState.legacyPoints || 0;
  fresh.legacyUpgrades = { ...fresh.legacyUpgrades, ...(previousState.legacyUpgrades || {}) };
  fresh.stats.legacyRuns = (previousState.stats?.legacyRuns || 0) + 1;
  const startingDirty = LEGACY_UPGRADES.reduce((total, upgrade) => {
    const count = previousState.legacyUpgrades?.[upgrade.id] || 0;
    return total + (upgrade.bonus.startDirty || 0) * count;
  }, 0);
  fresh.dirtyCash += startingDirty;
  return fresh;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.version && parsed.version > SAVE_VERSION)) {
      return null;
    }
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

export function saveState(state) {
  const snapshot = {
    ...state,
    savedAt: Date.now(),
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
}
