import { createInitialState, loadState, saveState } from "./state.mjs";
import {
  activateMissionAbility,
  advanceMissionRun,
  applyOfflineProgress,
  calculateDerived,
  cancelPlacement,
  confirmPlacement,
  clearSelection,
  createMissionRun,
  promoteOperative,
  queueTraining,
  recruitOperative,
  resolveIncidentChoice,
  resolveMissionRun,
  selectBuilding,
  selectCell,
  selectNode,
  selectOperative,
  selectView,
  setMissionFormation,
  startPlacement,
  startRelocate,
  startResearch,
  tickState,
  toggleMissionSquad,
  triggerBuildingAction,
  upgradeBuilding,
  pushAlert,
} from "./systems.mjs";
import { NeonFrontierUI } from "./canvas-ui.mjs";

let state = loadState() || createInitialState();
applyOfflineProgress(state, Date.now());

let missionRun = null;
let simulationStarted = false;

const introScreen = document.getElementById("introScreen");
const startButton = document.getElementById("introStart");
const params = new URLSearchParams(window.location.search);
const autoStart = params.get("autostart") === "1";
const initialView = params.get("view");

function render() {
  const derived = calculateDerived(state, Date.now());
  ui.render(state, derived, missionRun);
}

const ui = new NeonFrontierUI(document, {
  onSwitchView: (viewId) => {
    selectView(state, viewId);
    render();
  },
  onSelectNode: (nodeId) => {
    selectNode(state, nodeId);
    render();
  },
  onSelectBuilding: (instanceId) => {
    selectBuilding(state, instanceId);
    render();
  },
  onSelectCell: (cellId) => {
    if (state.ui.placementTypeId || state.ui.relocatingBuildingId) {
      if (confirmPlacement(state, cellId)) {
        render();
      }
      return;
    }
    selectCell(state, cellId);
    render();
  },
  onStartPlacement: (typeId) => {
    if (startPlacement(state, typeId)) {
      render();
    }
  },
  onCancelPlacement: () => {
    cancelPlacement(state);
    render();
  },
  onUpgradeBuilding: (instanceId) => {
    if (upgradeBuilding(state, instanceId)) {
      render();
    }
  },
  onBuildingAction: (instanceId) => {
    if (triggerBuildingAction(state, instanceId)) {
      render();
    }
  },
  onStartResearch: (researchId) => {
    if (startResearch(state, researchId)) {
      render();
    }
  },
  onQueueTraining: (unitId) => {
    if (queueTraining(state, unitId)) {
      render();
    }
  },
  onRecruitOperative: (operativeId) => {
    if (recruitOperative(state, operativeId)) {
      render();
    }
  },
  onPromoteOperative: (operativeId) => {
    if (promoteOperative(state, operativeId)) {
      render();
    }
  },
  onSelectOperative: (operativeId) => {
    selectOperative(state, operativeId);
    render();
  },
  onToggleSquad: (operativeId) => {
    if (toggleMissionSquad(state, operativeId)) {
      render();
    }
  },
  onSetFormation: (formationId) => {
    if (setMissionFormation(state, formationId)) {
      render();
    }
  },
  onOpenMission: (nodeId) => {
    missionRun = createMissionRun(state, nodeId);
    if (!missionRun) {
      pushAlert(state, "warn", "Mission unavailable", "This node is locked, cooling down, or missing a ready squad.", Date.now());
    }
    render();
  },
  onStartMission: () => {
    if (!missionRun || missionRun.running || missionRun.resolved) {
      return;
    }
    missionRun.running = true;
    missionRun.nextRoundAt = Date.now() + 800;
    render();
  },
  onMissionAbility: (operativeId) => {
    if (missionRun && activateMissionAbility(missionRun, operativeId)) {
      render();
    }
  },
  onDismissMission: () => {
    missionRun = null;
    render();
  },
  onResolveIncident: (incidentId, choice) => {
    if (resolveIncidentChoice(state, Number(incidentId), choice)) {
      render();
    }
  },
  onRelocateBuilding: (instanceId) => {
    if (startRelocate(state, instanceId)) {
      render();
    }
  },
  onSave: () => {
    saveState(state);
    pushAlert(state, "save", "Save complete", "Your city has been written to local storage.", Date.now());
    render();
  },
  onClearSelection: () => {
    clearSelection(state);
    render();
  },
});

startButton?.addEventListener("click", () => {
  introScreen?.classList.add("hidden");
  simulationStarted = true;
  state.lastTickAt = Date.now();
  render();
});

if (autoStart) {
  introScreen?.classList.add("hidden");
  simulationStarted = true;
  state.lastTickAt = Date.now();
}

if (initialView === "city" || initialView === "world") {
  selectView(state, initialView);
}

window.setInterval(() => {
  if (!simulationStarted) {
    return;
  }
  const now = Date.now();
  tickState(state, now);
  if (missionRun?.running && !missionRun.resolved && now >= (missionRun.nextRoundAt || 0)) {
    advanceMissionRun(missionRun);
    missionRun.nextRoundAt = now + 850;
    if (missionRun.resolved && !missionRun.applied) {
      resolveMissionRun(state, missionRun, now);
      missionRun.applied = true;
      missionRun.running = false;
    }
  }
  render();
}, 400);

window.setInterval(() => {
  if (simulationStarted) {
    saveState(state);
  }
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
