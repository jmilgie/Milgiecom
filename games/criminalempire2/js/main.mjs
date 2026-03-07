import { AudioDirector } from "./audio.mjs";
import { launchMiniGame } from "./minigames.mjs";
import {
  buildFreshEmpireFromLegacy,
  createInitialState,
  loadState,
  saveState,
} from "./state.mjs";
import {
  buildHeistRun,
  buyAsset,
  buyLegacyUpgrade,
  calculateDerived,
  claimContract,
  estimateLegacyGain,
  hireCrew,
  hustle,
  pushAlert,
  refreshRecruitPool,
  resolveHeistRun,
  rollContracts,
  assignCrew,
  promoteCrew,
  selectDistrict,
  seizeDistrict,
  setHeistApproach,
  setPanel,
  startPrep,
  tickState,
  toggleHeistCrew,
  unlockDistrict,
} from "./systems.mjs";
import { EmpireUI } from "./ui.mjs";

const audio = new AudioDirector();

let state = loadState() || createInitialState();
let simulationStarted = false;
const now = Date.now();
state.settings.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
if (!state.contracts?.length) {
  rollContracts(state, now);
}
if (!state.recruitPool?.length) {
  refreshRecruitPool(state, now, true);
}

function vibrate(pattern) {
  if (state.settings.vibration && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function applyOfflineProgress() {
  const savedAt = state.savedAt || now;
  const elapsed = Math.min(now - savedAt, 2 * 60 * 60 * 1000);
  if (elapsed < 15000) {
    return;
  }
  const step = 5000;
  let cursor = savedAt;
  while (cursor < savedAt + elapsed) {
    cursor += step;
    state.lastTickAt = cursor - step;
    tickState(state, cursor);
  }
  pushAlert(state, "offline", "The city kept moving", `Offline catch-up processed for ${Math.round(elapsed / 60000)} minutes.`, now);
}

applyOfflineProgress();

const ui = new EmpireUI(document, {
  onPanel: (panelId) => {
    setPanel(state, panelId);
    audio.playFx("toggle");
    render();
  },
  onSelectDistrict: (districtId) => {
    selectDistrict(state, districtId);
    audio.playFx("toggle");
    render();
  },
  onHustle: () => {
    hustle(state);
    audio.playFx("hustle");
    vibrate(8);
    render();
  },
  onBuyAsset: (districtId, kind, assetId) => {
    if (buyAsset(state, districtId, kind, assetId)) {
      audio.playFx("buy");
      vibrate([12, 16, 22]);
      render();
    }
  },
  onUnlockDistrict: (districtId) => {
    if (unlockDistrict(state, districtId)) {
      audio.playFx("claim");
      render();
    }
  },
  onSeizeDistrict: (districtId) => {
    if (seizeDistrict(state, districtId)) {
      audio.playFx("claim");
      vibrate([18, 40, 26]);
      render();
    }
  },
  onHireCrew: (candidateId) => {
    if (hireCrew(state, candidateId)) {
      audio.playFx("buy");
      render();
    }
  },
  onRerollCrew: () => {
    if (refreshRecruitPool(state)) {
      audio.playFx("toggle");
      render();
    }
  },
  onAssignCrew: (crewId, assignmentKey) => {
    if (assignCrew(state, crewId, assignmentKey)) {
      render();
    }
  },
  onPromoteCrew: (crewId) => {
    if (promoteCrew(state, crewId)) {
      audio.playFx("claim");
      render();
    }
  },
  onClaimContract: (contractId) => {
    if (claimContract(state, contractId)) {
      audio.playFx("claim");
      vibrate([10, 24, 10]);
      render();
    }
  },
  onStartPrep: (districtId, prepId, crewId) => {
    if (startPrep(state, districtId, prepId, crewId)) {
      audio.playFx("buy");
      render();
    }
  },
  onSetHeistApproach: (districtId, approachId) => {
    if (setHeistApproach(state, districtId, approachId)) {
      render();
    }
  },
  onToggleHeistCrew: (districtId, crewId) => {
    toggleHeistCrew(state, districtId, crewId);
    render();
  },
  onLaunchHeist: async (districtId) => {
    const run = buildHeistRun(state, districtId);
    if (!run) {
      pushAlert(state, "heat", "Job not ready", "You need enough intel, crew, and a clean window.", Date.now());
      render();
      return;
    }
    const score = await launchMiniGame(document.getElementById("overlayRoot"), {
      type: run.minigame,
    });
    document.getElementById("overlayRoot").innerHTML = "";
    const result = resolveHeistRun(state, run, score ?? 0);
    if (result?.success) {
      audio.playFx("heistSuccess");
      vibrate([40, 20, 60]);
    } else {
      audio.playFx("heistFail");
      vibrate([60, 40, 60]);
    }
    render();
  },
  onBuyLegacy: (upgradeId) => {
    if (buyLegacyUpgrade(state, upgradeId)) {
      audio.playFx("claim");
      render();
    }
  },
  onRetire: () => {
    const gain = estimateLegacyGain(state);
    if (!gain) {
      pushAlert(state, "legacy", "Not enough voltage", "Control more districts and wash more money before retiring.", Date.now());
      render();
      return;
    }
    if (!window.confirm(`Retire this empire for ${gain} legacy points?`)) {
      return;
    }
    const next = buildFreshEmpireFromLegacy(state, Date.now());
    next.legacyPoints = (state.legacyPoints || 0) + gain;
    next.legacyUpgrades = { ...state.legacyUpgrades };
    state = next;
    rollContracts(state, Date.now());
    pushAlert(state, "legacy", "A new skyline", `${gain} legacy points carried into the next empire.`, Date.now());
    audio.playFx("claim");
    render();
  },
  onToggleSound: () => {
    state.settings.sound = !state.settings.sound;
    audio.setToggles({ sound: state.settings.sound, music: state.settings.music });
    render();
  },
  onToggleMusic: () => {
    state.settings.music = !state.settings.music;
    audio.setToggles({ sound: state.settings.sound, music: state.settings.music });
    render();
  },
  onSave: () => {
    saveState(state);
    pushAlert(state, "info", "Empire saved", "The ledger is locked into local storage.", Date.now());
    audio.playFx("toggle");
    render();
  },
});

function render() {
  const derived = calculateDerived(state, Date.now());
  audio.setToggles({ sound: state.settings.sound, music: state.settings.music });
  audio.setScene({ intensity: derived.manhunt.id, beatId: derived.beat?.id || "" });
  ui.render(state, derived);
}

document.getElementById("introStart").addEventListener("click", async () => {
  document.getElementById("introScreen").classList.add("hidden");
  simulationStarted = true;
  state.lastTickAt = Date.now();
  await audio.boot();
  render();
});

window.setInterval(() => {
  if (!simulationStarted) {
    return;
  }
  tickState(state, Date.now());
  render();
}, 400);

window.setInterval(() => {
  saveState(state);
}, 5000);

document.addEventListener("visibilitychange", () => {
  if (!simulationStarted) {
    return;
  }
  if (document.hidden) {
    saveState(state);
  } else {
    state.lastTickAt = Date.now();
  }
});

render();
