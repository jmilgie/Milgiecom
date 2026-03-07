const WORLD_LOTS = {
  hq: { x: 18, y: 77 },
  contract: { x: 15, y: 24 },
  district: { x: 84, y: 68 },
  heist: { x: 76, y: 20 },
  rackets: [
    { x: 30, y: 65 },
    { x: 49, y: 57 },
    { x: 62, y: 72 },
  ],
  fronts: [
    { x: 71, y: 49 },
    { x: 82, y: 38 },
  ],
};

const TRACK_POINTS = [12, 26, 40, 56, 72, 86];

const CREW_SPRITES = {
  fixer: "./assets/world/agent-fixer.png",
  hacker: "./assets/world/agent-hacker.png",
  wheelman: "./assets/world/agent-wheelman.png",
  bruiser: "./assets/world/agent-bruiser.png",
  grifter: "./assets/world/agent-grifter.png",
  cleaner: "./assets/world/agent-cleaner.png",
};

const PANEL_FOCUS = {
  city: new Set(["hq", "district", "asset"]),
  ops: new Set(["heist", "contracts", "contract"]),
  crew: new Set(["crew", "recruit"]),
  legacy: new Set(["legacy", "dossier"]),
};

function fmtMoney(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${Math.floor(value).toLocaleString()}`;
}

function fmtNumber(value) {
  return Math.floor(value).toLocaleString();
}

function fmtTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function titleCase(input) {
  return input.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function fmtMoneyRange(min, max) {
  return `${fmtMoney(min)} to ${fmtMoney(max)}`;
}

function describePrepEffects(effect) {
  const parts = [];
  if (effect.success) {
    parts.push(`+${Math.round(effect.success * 100)}% success`);
  }
  if (effect.reward) {
    parts.push(`+${Math.round(effect.reward * 100)}% dirty`);
  }
  if (effect.clean) {
    parts.push(`+${Math.round(effect.clean * 100)}% clean`);
  }
  if (effect.heat) {
    parts.push(`${Math.round(effect.heat * 100)}% heat shift`);
  }
  return parts.join(" / ") || "Makes the window cleaner.";
}

function heistButtonLabel(selected, availableIntel) {
  const approach = selected.heist.def.approaches.find((entry) => entry.id === selected.heist.draft.approachId) || selected.heist.def.approaches[0];
  if (selected.heist.cooldownRemainingMs > 0) {
    return `Cooldown ${fmtTime(selected.heist.cooldownRemainingMs)}`;
  }
  if (availableIntel < selected.heist.def.intelCost) {
    return `Need ${selected.heist.def.intelCost - availableIntel} intel`;
  }
  if (selected.heist.draft.crewIds.length < approach.minCrew) {
    return `Need ${approach.minCrew - selected.heist.draft.crewIds.length} crew`;
  }
  return "Run the job";
}

function first(list) {
  return list?.length ? list[0] : null;
}

function crewSpritePath(archetypeId) {
  return CREW_SPRITES[archetypeId] || CREW_SPRITES.fixer;
}

function panelAllowsFocus(panelId, focus) {
  return PANEL_FOCUS[panelId]?.has(focus?.type);
}

function focusMatches(focus, candidate) {
  return Boolean(
    focus &&
      focus.type === candidate.type &&
      (candidate.kind ? focus.kind === candidate.kind : true) &&
      (candidate.id ? focus.id === candidate.id : true) &&
      (candidate.districtId ? focus.districtId === candidate.districtId : true),
  );
}

function assetAffordable(state, asset) {
  return state.dirtyCash >= asset.cost.dirty && state.cleanCash >= asset.cost.clean;
}

function assetActionLabel(asset, kind) {
  if (asset.state.level >= asset.def.maxLevel) {
    return "Maxed";
  }
  const verb = asset.state.level === 0 ? "Build" : "Upgrade";
  return `${verb} / ${fmtMoney(asset.cost.dirty)} / ${fmtMoney(asset.cost.clean)}`;
}

function assetOutputLabel(asset, kind) {
  if (asset.state.level <= 0) {
    return `Build for ${kind === "front" ? "clean cash" : "dirty cash"}`;
  }
  if (kind === "front") {
    return `${fmtMoney(asset.cleanPerSec)}/s clean / ${fmtMoney(asset.launderPerSec)}/s washed`;
  }
  return `${fmtMoney(asset.dirtyPerSec)}/s dirty / ${Math.round(asset.heatGain * 100)} heat`;
}

function buildFrontierStep(frontier) {
  const openRacket = frontier.rackets.find((asset) => asset.state.level === 0) || frontier.rackets[0];
  const openFront = frontier.fronts.find((asset) => asset.state.level === 0) || frontier.fronts[0];
  const pendingPrep = frontier.heist.def.preps.find((prep) => !frontier.state.heist.prepDone[prep.id]);

  if (!frontier.state.unlocked) {
    return {
      id: "unlock_frontier",
      label: `Unlock ${frontier.def.name}`,
      detail: `Spend ${fmtMoney(frontier.def.unlockCost.clean)} clean and ${frontier.def.unlockCost.intel} intel to open the next district.`,
      complete: false,
      focus: { panel: "city", type: "district", districtId: frontier.def.id },
      loopStage: 3,
    };
  }

  if (!frontier.state.controlled && frontier.canSeize) {
    return {
      id: "seize_frontier",
      label: `Seize ${frontier.def.name}`,
      detail: `Cash in the control lead and claim ${frontier.def.bonus.label}.`,
      complete: false,
      focus: { panel: "city", type: "district", districtId: frontier.def.id },
      loopStage: 3,
    };
  }

  if (!frontier.state.controlled && frontier.heist.ready) {
    return {
      id: "run_frontier_heist",
      label: `Run ${frontier.heist.def.name}`,
      detail: "The district score is the fastest way to jump control and bankroll.",
      complete: false,
      focus: { panel: "ops", type: "heist", districtId: frontier.def.id },
      loopStage: 2,
    };
  }

  if (!frontier.state.controlled && pendingPrep) {
    return {
      id: "prep_frontier",
      label: `Prep ${frontier.heist.def.name}`,
      detail: `${pendingPrep.name} improves the next score and makes the hit cleaner.`,
      complete: false,
      focus: { panel: "ops", type: "heist", districtId: frontier.def.id },
      loopStage: 2,
    };
  }

  if (!frontier.state.controlled && openRacket?.state.level === 0) {
    return {
      id: "build_frontier_racket",
      label: `Build ${openRacket.def.name}`,
      detail: "Every new district still needs a dirty-cash engine before it snowballs.",
      complete: false,
      focus: { panel: "city", type: "asset", districtId: frontier.def.id, kind: "racket", id: openRacket.def.id },
      loopStage: 0,
    };
  }

  if (!frontier.state.controlled && openFront?.state.level === 0) {
    return {
      id: "build_frontier_front",
      label: `Open ${openFront.def.name}`,
      detail: "A clean front turns dirty money into permanent empire growth.",
      complete: false,
      focus: { panel: "city", type: "asset", districtId: frontier.def.id, kind: "front", id: openFront.def.id },
      loopStage: 1,
    };
  }

  return {
    id: "push_frontier",
    label: `Push ${frontier.def.name} control`,
    detail: "Upgrade lots, wash cash, and keep heat survivable until the district breaks.",
    complete: frontier.state.controlled,
    focus: { panel: "city", type: "district", districtId: frontier.def.id },
    loopStage: 3,
  };
}

function buildGuidance(state, derived, selected) {
  const controlledCount = derived.districts.filter((district) => district.state.controlled).length;
  const dossiersComplete = derived.dossiers.filter((entry) => entry.complete).length;
  const totalRacketsBuilt = derived.districts.reduce((total, district) => total + district.rackets.filter((asset) => asset.state.level > 0).length, 0);
  const totalFrontsBuilt = derived.districts.reduce((total, district) => total + district.fronts.filter((asset) => asset.state.level > 0).length, 0);
  const recruitGoal = Math.min(derived.crewCap, controlledCount >= 2 ? 4 : controlledCount >= 1 ? 3 : 2);
  const frontier = derived.districts.find((district) => !district.state.controlled && (district.state.unlocked || district.canUnlock)) || derived.districts[derived.districts.length - 1];
  const starterRacket = frontier.rackets.find((asset) => asset.state.level === 0) || frontier.rackets[0];
  const starterFront = frontier.fronts.find((asset) => asset.state.level === 0) || frontier.fronts[0];
  const readyContracts = derived.contracts.filter((entry) => entry.ready && !entry.contract.claimed);
  const baseSteps = [
    {
      id: "racket",
      label: "Build a racket",
      detail: "Dirty cash is your first engine. Tap a hot lot on the city board to start passive income.",
      complete: totalRacketsBuilt > 0,
      focus: { panel: "city", type: "asset", districtId: frontier.def.id, kind: "racket", id: starterRacket.def.id },
      loopStage: 0,
    },
    {
      id: "front",
      label: "Open a front",
      detail: "Fronts launder dirty cash into clean cash for upgrades, unlocks, and district claims.",
      complete: totalFrontsBuilt > 0,
      focus: { panel: "city", type: "asset", districtId: frontier.def.id, kind: "front", id: starterFront.def.id },
      loopStage: 1,
    },
    {
      id: "crew",
      label: `Grow to ${recruitGoal} crew`,
      detail: "More specialists let you staff lots, prep scores, and hit safer heists.",
      complete: state.crew.length >= recruitGoal,
      focus: { panel: "crew", type: derived.crew.length ? "crew" : "recruit", id: first(derived.crew)?.crew.id || first(derived.recruitPool)?.candidate.id || "" },
      loopStage: 1,
    },
    {
      id: "heist_machine",
      label: "Run a district score",
      detail: "Prep jobs and heists are how districts break open. They drive the campaign forward.",
      complete: state.stats.heistsWon > 0,
      focus: { panel: "ops", type: "heist", districtId: frontier.def.id },
      loopStage: 2,
    },
  ];
  const frontierStep = buildFrontierStep(frontier);
  const campaignStep = {
    id: "black_vault",
    label: "Take the Black Vault",
    detail: "Own the final district to finish the skyline campaign and maximize retirement value.",
    complete: Boolean(derived.districts[derived.districts.length - 1]?.state.controlled),
    focus: { panel: "city", type: "district", districtId: derived.districts[derived.districts.length - 1]?.def.id },
    loopStage: 3,
  };
  const steps = [...baseSteps, frontierStep, campaignStep];
  const activeStep = steps.find((step) => !step.complete) || campaignStep;
  const frontierDetail = !frontier.state.unlocked
    ? `${fmtMoney(state.cleanCash)} / ${fmtMoney(frontier.def.unlockCost.clean)} clean • ${state.intel} / ${frontier.def.unlockCost.intel} intel`
    : `${Math.round(frontier.state.control)}% control • ${Math.round(frontier.state.heat)}% heat`;
  const empireProgress = Math.round((((controlledCount / derived.districts.length) * 0.74) + ((dossiersComplete / derived.dossiers.length) * 0.26)) * 100);

  return {
    activeStep,
    steps,
    recommendedFocus: activeStep.focus,
    readyContracts,
    controlledCount,
    dossiersComplete,
    empireProgress,
    frontier,
    frontierDetail,
    loopCards: [
      {
        id: "dirty",
        label: "Dirty Cash",
        detail: `${totalRacketsBuilt || 0} rackets online`,
        focus: { panel: "city", type: "asset", districtId: frontier.def.id, kind: "racket", id: starterRacket.def.id },
        active: activeStep.loopStage === 0,
        complete: totalRacketsBuilt > 0,
      },
      {
        id: "clean",
        label: "Wash Clean",
        detail: `${totalFrontsBuilt || 0} fronts online`,
        focus: { panel: "city", type: "asset", districtId: frontier.def.id, kind: "front", id: starterFront.def.id },
        active: activeStep.loopStage === 1,
        complete: totalFrontsBuilt > 0,
      },
      {
        id: "score",
        label: "Run Scores",
        detail: `${state.stats.heistsWon} heists won`,
        focus: { panel: "ops", type: "heist", districtId: frontier.def.id },
        active: activeStep.loopStage === 2,
        complete: state.stats.heistsWon > 0,
      },
      {
        id: "district",
        label: "Own Districts",
        detail: `${controlledCount}/${derived.districts.length} secured`,
        focus: { panel: "city", type: "district", districtId: frontier.def.id },
        active: activeStep.loopStage === 3,
        complete: controlledCount > 0,
      },
    ],
  };
}

function buildAgentMarker(entry, selected, derived, index) {
  let start = { x: WORLD_LOTS.hq.x + (index % 2) * 4, y: WORLD_LOTS.hq.y + Math.floor(index / 2) * 3 };
  let end = { ...start };
  let mode = entry.isBusy ? "route" : "idle";
  const assignment = entry.crew.assignmentKey || "idle";

  if (entry.isBusy) {
    end = WORLD_LOTS.heist;
  } else if (assignment.includes(":")) {
    const [kind, districtId, assetId] = assignment.split(":");
    if (districtId === selected.def.id) {
      const positions = kind === "front" ? WORLD_LOTS.fronts : WORLD_LOTS.rackets;
      const collection = kind === "front" ? selected.fronts : selected.rackets;
      const positionIndex = collection.findIndex((asset) => asset.def.id === assetId);
      if (positionIndex >= 0) {
        end = positions[positionIndex];
        mode = "route";
      }
    } else {
      const districtIndex = derived.districts.findIndex((district) => district.def.id === districtId);
      start = { x: TRACK_POINTS[Math.max(0, districtIndex)], y: 15 };
      end = { ...start };
      mode = "distant";
    }
  }

  return {
    mode,
    style: `--start-x:${start.x}%;--start-y:${start.y}%;--end-x:${end.x}%;--end-y:${end.y}%;--delay:${index * 0.35}s`,
    sprite: crewSpritePath(entry.archetype.id),
    label: entry.crew.name.split(" ")[0],
  };
}

function buildWorldLots(state, selected, guidance, focus, hustlePreview) {
  const contractReady = guidance.readyContracts.length;
  const lots = [
    {
      type: "hq",
      label: "HQ",
      kicker: "Hustle",
      detail: `Tap for +${fmtMoney(hustlePreview)} and a shot at intel.`,
      tag: state.surgeUntil > Date.now() ? "Surge live" : "Run hustle",
      tone: state.surgeUntil > Date.now() ? "online" : "warn",
      position: WORLD_LOTS.hq,
      focus: { type: "hq", districtId: selected.def.id },
      panel: "city",
      disabled: false,
    },
    {
      type: "contract",
      label: "Contract Board",
      kicker: "Rotating Jobs",
      detail: contractReady ? `${contractReady} contracts are ready to claim.` : "Street contracts set the short-term grind.",
      tag: contractReady ? `${contractReady} ready` : `${state.contracts.length} live`,
      tone: contractReady ? "online" : "warn",
      position: WORLD_LOTS.contract,
      focus: { type: contractReady ? "contract" : "contracts", id: guidance.readyContracts[0]?.contract.id || "", districtId: selected.def.id },
      panel: "ops",
      disabled: false,
    },
    {
      type: "heist",
      label: selected.heist.def.name,
      kicker: "District Score",
      detail: selected.state.unlocked ? `Odds ${pct(selected.heist.chance)} • ${fmtMoneyRange(selected.heist.preview.dirtyMin, selected.heist.preview.dirtyMax)}` : "Unlock the district before you can hit the score.",
      tag: selected.heist.ready ? "Window open" : selected.state.unlocked ? `Prep ${selected.heist.prepDoneCount}/3` : "Locked",
      tone: selected.heist.ready ? "online" : selected.state.unlocked ? "warn" : "bad",
      position: WORLD_LOTS.heist,
      focus: { type: "heist", districtId: selected.def.id },
      panel: "ops",
      disabled: !selected.state.unlocked,
    },
    {
      type: "district",
      label: selected.def.name,
      kicker: "District Crown",
      detail: selected.state.controlled ? selected.def.bonus.label : selected.canUnlock ? `Unlock for ${fmtMoney(selected.def.unlockCost.clean)} and ${selected.def.unlockCost.intel} intel.` : selected.canSeize ? `Seize for ${fmtMoney(selected.def.seizeCost.clean)} and ${selected.def.seizeCost.intel} intel.` : `${Math.round(selected.state.control)}% control • ${Math.round(selected.state.heat)}% heat`,
      tag: selected.state.controlled ? "Secured" : selected.canSeize ? "Seize" : selected.canUnlock ? "Unlock" : `${Math.round(selected.state.control)}%`,
      tone: selected.state.controlled ? "online" : selected.canSeize || selected.canUnlock ? "warn" : "bad",
      position: WORLD_LOTS.district,
      focus: { type: "district", districtId: selected.def.id },
      panel: "city",
      disabled: false,
    },
  ];

  selected.rackets.forEach((asset, index) => {
    lots.push({
      type: "racket",
      label: asset.def.name,
      kicker: "Dirty Cash",
      detail: selected.state.unlocked ? assetOutputLabel(asset, "racket") : "Unlock the district before building here.",
      tag: asset.state.level > 0 ? `Lv ${asset.state.level}` : assetAffordable(state, asset) && selected.state.unlocked ? "Build" : "Offline",
      tone: asset.state.level > 0 ? "online" : assetAffordable(state, asset) && selected.state.unlocked ? "warn" : "bad",
      position: WORLD_LOTS.rackets[index],
      focus: { type: "asset", districtId: selected.def.id, kind: "racket", id: asset.def.id },
      panel: "city",
      disabled: !selected.state.unlocked,
    });
  });

  selected.fronts.forEach((asset, index) => {
    lots.push({
      type: "front",
      label: asset.def.name,
      kicker: "Clean Cash",
      detail: selected.state.unlocked ? assetOutputLabel(asset, "front") : "Unlock the district before laundering here.",
      tag: asset.state.level > 0 ? `Lv ${asset.state.level}` : assetAffordable(state, asset) && selected.state.unlocked ? "Build" : "Offline",
      tone: asset.state.level > 0 ? "online" : assetAffordable(state, asset) && selected.state.unlocked ? "warn" : "bad",
      position: WORLD_LOTS.fronts[index],
      focus: { type: "asset", districtId: selected.def.id, kind: "front", id: asset.def.id },
      panel: "city",
      disabled: !selected.state.unlocked,
    });
  });

  return lots.map((lot) => ({
    ...lot,
    focused: focusMatches(focus, lot.focus),
    recommended: focusMatches(guidance.recommendedFocus, lot.focus),
  }));
}
export class EmpireUI {
  constructor(documentRef, handlers) {
    this.document = documentRef;
    this.handlers = handlers;
    this.focus = { type: "hq" };
    this.lastToastId = null;
    this.lastState = null;
    this.lastDerived = null;
    this.refs = {
      shell: documentRef.getElementById("appShell"),
      goal: documentRef.getElementById("goalStrip"),
      summary: documentRef.getElementById("summaryStrip"),
      mission: documentRef.getElementById("missionRail"),
      map: documentRef.getElementById("cityMap"),
      dock: documentRef.getElementById("dockTabs"),
      panel: documentRef.getElementById("panelRoot"),
      overlay: documentRef.getElementById("overlayRoot"),
      toast: documentRef.getElementById("toastRoot"),
      soundToggle: documentRef.getElementById("soundToggle"),
      musicToggle: documentRef.getElementById("musicToggle"),
      saveButton: documentRef.getElementById("saveButton"),
    };
    this.bind();
  }

  bind() {
    this.document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }
      const { action } = button.dataset;
      switch (action) {
        case "panel":
          this.handlers.onPanel(button.dataset.panel);
          break;
        case "focus":
          this.applyFocus(button.dataset);
          break;
        case "select-district":
          this.handlers.onSelectDistrict(button.dataset.districtId);
          break;
        case "hustle":
          this.handlers.onHustle();
          break;
        case "buy-asset":
          this.handlers.onBuyAsset(button.dataset.districtId, button.dataset.kind, button.dataset.assetId);
          break;
        case "unlock-district":
          this.handlers.onUnlockDistrict(button.dataset.districtId);
          break;
        case "seize-district":
          this.handlers.onSeizeDistrict(button.dataset.districtId);
          break;
        case "hire-crew":
          this.handlers.onHireCrew(button.dataset.candidateId);
          break;
        case "reroll-crew":
          this.handlers.onRerollCrew();
          break;
        case "promote-crew":
          this.handlers.onPromoteCrew(button.dataset.crewId);
          break;
        case "claim-contract":
          this.handlers.onClaimContract(button.dataset.contractId);
          break;
        case "start-prep": {
          const card = button.closest(".prep-card");
          const select = card?.querySelector("[data-prep-select]");
          if (select?.value) {
            this.handlers.onStartPrep(button.dataset.districtId, button.dataset.prepId, select.value);
          }
          break;
        }
        case "set-approach":
          this.handlers.onSetHeistApproach(button.dataset.districtId, button.dataset.approachId);
          break;
        case "launch-heist":
          this.handlers.onLaunchHeist(button.dataset.districtId);
          break;
        case "buy-legacy":
          this.handlers.onBuyLegacy(button.dataset.upgradeId);
          break;
        case "retire":
          this.handlers.onRetire();
          break;
        case "toggle-sound":
          this.handlers.onToggleSound();
          break;
        case "toggle-music":
          this.handlers.onToggleMusic();
          break;
        case "save":
          this.handlers.onSave();
          break;
        default:
          break;
      }
    });

    this.document.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches("[data-assign-crew]")) {
        this.handlers.onAssignCrew(target.dataset.assignCrew, target.value);
      }
      if (target.matches("[data-heist-crew]")) {
        this.handlers.onToggleHeistCrew(target.dataset.districtId, target.dataset.crewId);
      }
      if (target.matches("[data-prep-select]")) {
        const card = target.closest(".prep-card");
        const button = card?.querySelector("[data-start-prep]");
        if (button) {
          button.disabled = !target.value;
        }
      }
    });
  }

  applyFocus(dataset) {
    this.focus = {
      type: dataset.focusType || "hq",
      id: dataset.id || dataset.focusId || "",
      kind: dataset.kind || "",
      districtId: dataset.districtId || this.lastState?.selectedDistrictId || "",
    };

    let rerendered = false;
    if (dataset.districtId && dataset.districtId !== this.lastState?.selectedDistrictId) {
      this.handlers.onSelectDistrict(dataset.districtId);
      rerendered = true;
    }
    if (dataset.panel && dataset.panel !== this.lastState?.currentPanel) {
      this.handlers.onPanel(dataset.panel);
      rerendered = true;
    }
    if (!rerendered) {
      this.rerender();
    }
  }

  rerender() {
    if (this.lastState && this.lastDerived) {
      this.render(this.lastState, this.lastDerived);
    }
  }

  defaultFocusForPanel(state, derived, selected, guidance) {
    const panel = state.currentPanel;
    if (panel === "crew") {
      if (derived.crew.length) {
        return { type: "crew", id: derived.crew[0].crew.id, districtId: selected.def.id };
      }
      return { type: "recruit", id: derived.recruitPool[0]?.candidate.id || "", districtId: selected.def.id };
    }
    if (panel === "ops") {
      return {
        type: guidance.readyContracts.length ? "contract" : "heist",
        id: guidance.readyContracts[0]?.contract.id || "",
        districtId: selected.def.id,
      };
    }
    if (panel === "legacy") {
      return { type: "legacy", districtId: selected.def.id };
    }
    return guidance.recommendedFocus?.districtId === selected.def.id
      ? { ...guidance.recommendedFocus }
      : { type: "hq", districtId: selected.def.id };
  }

  isFocusValid(state, derived, selected) {
    const focus = this.focus;
    if (!focus || !panelAllowsFocus(state.currentPanel, focus)) {
      return false;
    }
    switch (state.currentPanel) {
      case "city":
        if (focus.type === "hq" || focus.type === "district") {
          return true;
        }
        if (focus.type === "asset" && focus.districtId === selected.def.id) {
          const collection = focus.kind === "front" ? selected.fronts : selected.rackets;
          return collection.some((asset) => asset.def.id === focus.id);
        }
        return false;
      case "ops":
        if (focus.type === "heist" || focus.type === "contracts") {
          return true;
        }
        return focus.type === "contract" ? derived.contracts.some((entry) => entry.contract.id === focus.id) : false;
      case "crew":
        if (focus.type === "crew") {
          return derived.crew.some((entry) => entry.crew.id === focus.id);
        }
        return focus.type === "recruit" ? derived.recruitPool.some((entry) => entry.candidate.id === focus.id) : false;
      case "legacy":
        return focus.type === "legacy" || focus.type === "dossier";
      default:
        return false;
    }
  }

  render(state, derived) {
    this.lastState = state;
    this.lastDerived = derived;
    const selected = derived.districts.find((district) => district.def.id === state.selectedDistrictId) || derived.districts[0];
    const guidance = buildGuidance(state, derived, selected);
    if (!this.isFocusValid(state, derived, selected)) {
      this.focus = this.defaultFocusForPanel(state, derived, selected, guidance);
    }

    const hustlePreview = Math.floor((18 + derived.rankIndex * 4) * (1 + (derived.legacyBonuses.hustleMult || 0)) * (1 + (derived.beatMods.hustleMult || 0)) * (derived.surgeActive ? 1.4 : 1));

    this.refs.goal.innerHTML = this.renderGoalStrip(state, derived, guidance);
    this.refs.summary.innerHTML = this.renderSummaryStrip(state, derived);
    this.refs.mission.innerHTML = this.renderMissionRail(state, derived, selected, guidance);
    this.refs.map.innerHTML = this.renderWorldStage(state, derived, selected, guidance, hustlePreview);
    this.refs.dock.innerHTML = this.renderDock(state, derived, guidance);
    this.refs.panel.innerHTML = this.renderPanel(state, derived, selected, guidance);
    this.refs.soundToggle.textContent = state.settings.sound ? "SFX On" : "SFX Off";
    this.refs.musicToggle.textContent = state.settings.music ? "Music On" : "Music Off";
    this.refs.saveButton.textContent = "Save";

    if (this.lastToastId === null && state.alerts[0]) {
      this.lastToastId = state.alerts[0].id;
    } else if (state.alerts[0] && state.alerts[0].id !== this.lastToastId) {
      this.lastToastId = state.alerts[0].id;
      this.toast(state.alerts[0]);
    }
  }

  renderGoalStrip(state, derived, guidance) {
    return `
      <div class="goal-card">
        <div class="goal-copy">
          <div class="section-label">Campaign Goal</div>
          <h2>Own The Black Vault</h2>
          <p>Take every district, keep the heat survivable, and retire with enough clean money to lock in your Neon Legacy.</p>
          <div class="progress"><span style="width:${guidance.empireProgress}%"></span></div>
          <div class="goal-meta">
            <strong>${guidance.controlledCount}/${derived.districts.length} districts seized</strong>
            <span>${guidance.dossiersComplete}/${derived.dossiers.length} dossiers complete</span>
          </div>
        </div>
        <div class="goal-side">
          <div class="goal-progress-head">
            <span class="section-label">Frontier</span>
            <strong>${guidance.frontier.def.name}</strong>
          </div>
          <div class="goal-footnote">${guidance.frontierDetail}</div>
          <div class="territory-lane">
            ${derived.districts.map((district) => `
              <button
                class="district-track-button ${district.state.controlled ? "controlled" : ""} ${district.def.id === state.selectedDistrictId ? "selected" : ""} ${guidance.frontier.def.id === district.def.id ? "frontier" : ""} ${district.state.unlocked ? "" : "locked"}"
                type="button"
                data-action="select-district"
                data-district-id="${district.def.id}"
              >
                <strong>${district.def.shortName}</strong>
                <small>${district.state.controlled ? "Secured" : district.state.unlocked ? `${Math.round(district.state.control)}% control` : "Locked"}</small>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  renderSummaryStrip(state, derived) {
    return `
      <div class="summary-chip">
        <span class="summary-label">Rank</span>
        <strong>${derived.rank.name}</strong>
      </div>
      <div class="summary-chip">
        <span class="summary-label">Dirty</span>
        <strong>${fmtMoney(state.dirtyCash)}</strong>
      </div>
      <div class="summary-chip">
        <span class="summary-label">Clean</span>
        <strong>${fmtMoney(state.cleanCash)}</strong>
      </div>
      <div class="summary-chip">
        <span class="summary-label">Intel</span>
        <strong>${fmtNumber(state.intel)}</strong>
      </div>
      <div class="summary-chip heat">
        <span class="summary-label">Heat</span>
        <strong>${Math.round(state.globalHeat)}%</strong>
      </div>
      <div class="summary-chip">
        <span class="summary-label">Ready Crew</span>
        <strong>${derived.crew.filter((entry) => !entry.isBusy).length}/${derived.crewCap}</strong>
      </div>
    `;
  }

  renderMissionRail(state, derived, selected, guidance) {
    return `
      <section class="rail-card objective-card">
        <div class="section-label">Next Move</div>
        <div class="objective-copy"><strong>${guidance.activeStep.label}</strong></div>
        <p class="rail-copy">${guidance.activeStep.detail}</p>
        <div class="objective-actions">
          <button
            class="neon-btn"
            type="button"
            data-action="focus"
            data-panel="${guidance.activeStep.focus.panel}"
            data-focus-type="${guidance.activeStep.focus.type}"
            data-district-id="${guidance.activeStep.focus.districtId || selected.def.id}"
            data-kind="${guidance.activeStep.focus.kind || ""}"
            data-id="${guidance.activeStep.focus.id || ""}"
          >Show Me</button>
          <button class="ghost-btn" type="button" data-action="panel" data-panel="ops">Open Ops</button>
        </div>
        <div class="goal-footnote">Why this matters: every action should move you toward a district seizure or the next unlock.</div>
      </section>

      <section class="rail-card">
        <div class="section-head">
          <h3>Empire Loop</h3>
          <span class="section-label">How to play</span>
        </div>
        <div class="checklist">
          ${guidance.steps.map((step) => `
            <div class="checklist-item ${step.complete ? "complete" : guidance.activeStep.id === step.id ? "active" : ""}">
              <div>
                <strong>${step.label}</strong>
                <div class="goal-footnote">${step.detail}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="rail-card">
        <div class="section-head">
          <h3>Frontier Readout</h3>
          <span class="section-label">${guidance.frontier.def.shortName}</span>
        </div>
        <div class="metric-grid three">
          <div><span>Control</span><strong>${Math.round(guidance.frontier.state.control)}%</strong></div>
          <div><span>District Heat</span><strong>${Math.round(guidance.frontier.state.heat)}%</strong></div>
          <div><span>Heist Odds</span><strong>${pct(guidance.frontier.heist.chance)}</strong></div>
        </div>
        <div class="progress ${guidance.frontier.state.heat > 65 ? "heat" : ""}"><span style="width:${guidance.frontier.state.control}%"></span></div>
        <div class="goal-footnote">${guidance.frontierDetail}</div>
      </section>

      <section class="rail-card">
        <div class="section-head">
          <h3>Live Feed</h3>
          <span class="section-label">${derived.operations.length} active ops</span>
        </div>
        <div class="feed-list">
          ${state.alerts.slice(0, 4).map((alert) => `
            <div class="feed-item ${alert.tone}">
              <strong>${alert.title}</strong>
              <p>${alert.detail}</p>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  renderWorldStage(state, derived, selected, guidance, hustlePreview) {
    const lots = buildWorldLots(state, selected, guidance, this.focus, hustlePreview);
    return `
      <div class="world-stage-shell ${state.settings.reducedMotion ? "still-motion" : ""}">
        <div class="world-topline">
          <div class="world-callout">
            <div class="section-label">Selected District</div>
            <h2>${selected.def.name}</h2>
            <p>${selected.def.flavor}</p>
          </div>
          <div class="world-chip-row">
            <div class="world-chip"><span>Dirty / sec</span><strong>${fmtMoney(derived.totals.dirtyPerSec)}</strong></div>
            <div class="world-chip"><span>Clean / sec</span><strong>${fmtMoney(derived.totals.cleanPerSec)}</strong></div>
            <div class="world-chip"><span>Washed Total</span><strong>${fmtMoney(state.stats.cleanLaundered)}</strong></div>
            <div class="world-chip"><span>Projected Legacy</span><strong>${derived.projectedLegacy} LP</strong></div>
          </div>
        </div>
        <div class="world-board">
          <div class="territory-track">
            ${derived.districts.map((district) => `
              <button
                class="district-track-button ${district.state.controlled ? "controlled" : ""} ${district.def.id === state.selectedDistrictId ? "selected" : ""} ${guidance.frontier.def.id === district.def.id ? "frontier" : ""} ${district.state.unlocked ? "" : "locked"}"
                type="button"
                data-action="select-district"
                data-district-id="${district.def.id}"
              >
                <strong>${district.def.shortName}</strong>
                <small>${district.state.controlled ? "Secured" : district.state.unlocked ? `${Math.round(district.state.control)}%` : "Locked"}</small>
              </button>
            `).join("")}
          </div>
          <div class="agent-layer">
            ${derived.crew.map((entry, index) => {
              const marker = buildAgentMarker(entry, selected, derived, index);
              return `
                <div class="map-agent ${marker.mode} ${entry.isBusy ? "busy" : ""}" style="${marker.style}">
                  <img src="${marker.sprite}" alt="" />
                  <span>${marker.label}</span>
                </div>
              `;
            }).join("")}
          </div>
          <div class="lot-layer">
            ${lots.map((lot) => `
              <button
                class="lot-shell type-${lot.type} ${lot.focused ? "focused" : ""} ${lot.recommended ? "recommended" : ""} ${lot.disabled ? "disabled" : ""}"
                type="button"
                style="--x:${lot.position.x}%;--y:${lot.position.y}%"
                data-action="focus"
                data-panel="${lot.panel}"
                data-focus-type="${lot.focus.type}"
                data-district-id="${lot.focus.districtId}"
                data-kind="${lot.focus.kind || ""}"
                data-id="${lot.focus.id || ""}"
              >
                <div class="lot-head">
                  <div>
                    <div class="lot-kicker">${lot.kicker}</div>
                    <strong>${lot.label}</strong>
                  </div>
                  <span class="lot-tag ${lot.tone}">${lot.tag}</span>
                </div>
                <small>${lot.detail}</small>
              </button>
            `).join("")}
          </div>
          <div class="board-hint">${guidance.activeStep.label}: ${guidance.activeStep.detail}</div>
        </div>
        <div class="world-footer">
          ${guidance.loopCards.map((card) => `
            <button
              class="quick-lot loop-card ${card.active ? "active" : ""} ${card.complete ? "complete" : ""}"
              type="button"
              data-action="focus"
              data-panel="${card.focus.panel}"
              data-focus-type="${card.focus.type}"
              data-district-id="${card.focus.districtId}"
              data-kind="${card.focus.kind || ""}"
              data-id="${card.focus.id || ""}"
            >
              <strong>${card.label}</strong>
              <small>${card.detail}</small>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  renderDock(state, derived, guidance) {
    const meta = {
      city: `${guidance.controlledCount}/${derived.districts.length}`,
      crew: `${derived.crew.length}/${derived.crewCap}`,
      ops: guidance.readyContracts.length ? `${guidance.readyContracts.length} ready` : `${derived.operations.length} live`,
      legacy: `${derived.projectedLegacy} LP`,
    };
    return derived.panelTabs.map((tab) => `
      <button class="dock-tab ${state.currentPanel === tab.id ? "active" : ""}" type="button" data-action="panel" data-panel="${tab.id}">
        ${tab.label}
        <small>${meta[tab.id] || ""}</small>
      </button>
    `).join("");
  }
  renderPanel(state, derived, selected, guidance) {
    switch (state.currentPanel) {
      case "crew":
        return this.renderCrewPanel(state, derived, selected);
      case "ops":
        return this.renderOpsPanel(state, derived, selected);
      case "legacy":
        return this.renderLegacyPanel(state, derived, selected);
      default:
        return this.renderCityPanel(state, derived, selected, guidance);
    }
  }

  renderCityPanel(state, derived, selected, guidance) {
    if (this.focus.type === "asset") {
      const collection = this.focus.kind === "front" ? selected.fronts : selected.rackets;
      const asset = collection.find((entry) => entry.def.id === this.focus.id) || collection[0];
      const affordable = assetAffordable(state, asset);
      return `
        <div class="panel-stack">
          <section class="panel-hero">
            <div class="section-label">${this.focus.kind === "front" ? "Clean Front" : "Dirty Racket"}</div>
            <div class="panel-copy">
              <h2>${asset.def.name}</h2>
              <p>${asset.def.desc}</p>
            </div>
            <div class="metric-grid three">
              <div><span>Level</span><strong>${asset.state.level}/${asset.def.maxLevel}</strong></div>
              <div><span>Output</span><strong>${this.focus.kind === "front" ? fmtMoney(asset.cleanPerSec) : fmtMoney(asset.dirtyPerSec)}</strong></div>
              <div><span>${this.focus.kind === "front" ? "Cover" : "Heat"}</span><strong>${this.focus.kind === "front" ? Math.round(asset.coverPerSec * 100) : Math.round(asset.heatGain * 100)}</strong></div>
            </div>
            <div class="goal-footnote">${assetOutputLabel(asset, this.focus.kind)}</div>
            <div class="panel-actions">
              <button
                class="neon-btn ${affordable ? "" : "gold"}"
                type="button"
                data-action="buy-asset"
                data-district-id="${selected.def.id}"
                data-kind="${this.focus.kind}"
                data-asset-id="${asset.def.id}"
                ${selected.state.unlocked && asset.state.level < asset.def.maxLevel ? "" : "disabled"}
              >${assetActionLabel(asset, this.focus.kind)}</button>
              <button class="ghost-btn" type="button" data-action="panel" data-panel="crew">Open Crew Dock</button>
            </div>
          </section>

          <section class="panel-card">
            <div class="section-head"><h3>District Lots</h3><span class="section-label">Tap to switch focus</span></div>
            <div class="card-strip quick-strip">
              ${selected.rackets.map((assetItem) => `
                <button
                  class="quick-lot ${focusMatches(this.focus, { type: "asset", kind: "racket", id: assetItem.def.id, districtId: selected.def.id }) ? "focused" : ""} ${focusMatches(guidance.recommendedFocus, { type: "asset", kind: "racket", id: assetItem.def.id, districtId: selected.def.id }) ? "recommended" : ""}"
                  type="button"
                  data-action="focus"
                  data-panel="city"
                  data-focus-type="asset"
                  data-district-id="${selected.def.id}"
                  data-kind="racket"
                  data-id="${assetItem.def.id}"
                >
                  <strong>${assetItem.def.name}</strong>
                  <small>${assetOutputLabel(assetItem, "racket")}</small>
                </button>
              `).join("")}
              ${selected.fronts.map((assetItem) => `
                <button
                  class="quick-lot ${focusMatches(this.focus, { type: "asset", kind: "front", id: assetItem.def.id, districtId: selected.def.id }) ? "focused" : ""} ${focusMatches(guidance.recommendedFocus, { type: "asset", kind: "front", id: assetItem.def.id, districtId: selected.def.id }) ? "recommended" : ""}"
                  type="button"
                  data-action="focus"
                  data-panel="city"
                  data-focus-type="asset"
                  data-district-id="${selected.def.id}"
                  data-kind="front"
                  data-id="${assetItem.def.id}"
                >
                  <strong>${assetItem.def.name}</strong>
                  <small>${assetOutputLabel(assetItem, "front")}</small>
                </button>
              `).join("")}
            </div>
          </section>
        </div>
      `;
    }

    if (this.focus.type === "district") {
      return `
        <div class="panel-stack">
          <section class="panel-hero">
            <div class="section-label">District Control</div>
            <div class="panel-copy">
              <h2>${selected.def.name}</h2>
              <p>${selected.def.flavor}</p>
            </div>
            <div class="metric-grid three">
              <div><span>Control</span><strong>${Math.round(selected.state.control)}%</strong></div>
              <div><span>District Heat</span><strong>${Math.round(selected.state.heat)}%</strong></div>
              <div><span>Bonus</span><strong>${selected.def.bonus.label}</strong></div>
            </div>
            <div class="progress ${selected.state.heat > 65 ? "heat" : ""}"><span style="width:${selected.state.control}%"></span></div>
            <div class="panel-actions">
              ${selected.canUnlock ? `<button class="neon-btn" type="button" data-action="unlock-district" data-district-id="${selected.def.id}">Unlock / ${fmtMoney(selected.def.unlockCost.clean)} / ${selected.def.unlockCost.intel} intel</button>` : ""}
              ${selected.canSeize ? `<button class="neon-btn gold" type="button" data-action="seize-district" data-district-id="${selected.def.id}">Seize / ${fmtMoney(selected.def.seizeCost.clean)} / ${selected.def.seizeCost.intel} intel</button>` : ""}
              ${!selected.canUnlock && !selected.canSeize ? `<button class="ghost-btn" type="button" data-action="focus" data-panel="ops" data-focus-type="heist" data-district-id="${selected.def.id}">Open District Score</button>` : ""}
            </div>
          </section>
          <section class="panel-card">
            <div class="section-head"><h3>District Snapshot</h3><span class="section-label">${selected.faction.name}</span></div>
            <div class="metric-grid three">
              <div><span>Dirty / sec</span><strong>${fmtMoney(selected.dirtyPerSec)}</strong></div>
              <div><span>Clean / sec</span><strong>${fmtMoney(selected.cleanPerSec)}</strong></div>
              <div><span>Prep Done</span><strong>${selected.heist.prepDoneCount}/${selected.heist.def.preps.length}</strong></div>
            </div>
          </section>
        </div>
      `;
    }

    return `
      <div class="panel-stack">
        <section class="panel-hero">
          <div class="section-label">HQ Command</div>
          <div class="panel-copy">
            <h2>Run the city from one screen</h2>
            <p>Tap map lots to build the economy. Dirty rackets fund clean fronts, clean money opens districts, and heists push the campaign forward.</p>
          </div>
          <div class="metric-grid three">
            <div><span>Dirty / sec</span><strong>${fmtMoney(derived.totals.dirtyPerSec)}</strong></div>
            <div><span>Clean / sec</span><strong>${fmtMoney(derived.totals.cleanPerSec)}</strong></div>
            <div><span>Surge</span><strong>${derived.surgeActive ? fmtTime(derived.surgeRemainingMs) : `${Math.round(state.surge)} / 100`}</strong></div>
          </div>
          <button class="neon-btn big" type="button" data-action="hustle">Run Hustle / +${fmtMoney(Math.floor((18 + derived.rankIndex * 4) * (1 + (derived.legacyBonuses.hustleMult || 0)) * (1 + (derived.beatMods.hustleMult || 0)) * (derived.surgeActive ? 1.4 : 1)))}</button>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Start Here</h3><span class="section-label">Current plan</span></div>
          <div class="goal-footnote">${guidance.activeStep.label}</div>
          <button
            class="ghost-btn"
            type="button"
            data-action="focus"
            data-panel="${guidance.activeStep.focus.panel}"
            data-focus-type="${guidance.activeStep.focus.type}"
            data-district-id="${guidance.activeStep.focus.districtId || selected.def.id}"
            data-kind="${guidance.activeStep.focus.kind || ""}"
            data-id="${guidance.activeStep.focus.id || ""}"
          >Focus Recommended Target</button>
        </section>
      </div>
    `;
  }

  renderOpsPanel(state, derived, selected) {
    const selectedApproach = selected.heist.def.approaches.find((entry) => entry.id === selected.heist.draft.approachId) || selected.heist.def.approaches[0];
    return `
      <div class="panel-stack">
        <section class="panel-hero">
          <div class="section-label">District Score</div>
          <div class="panel-copy">
            <h2>${selected.heist.def.name}</h2>
            <p>${selected.heist.def.desc}</p>
          </div>
          <div class="heist-checklist">
            <span class="heist-chip ${state.intel >= selected.heist.def.intelCost ? "good" : "warn"}">Intel ${state.intel}/${selected.heist.def.intelCost}</span>
            <span class="heist-chip ${selected.heist.draft.crewIds.length >= selectedApproach.minCrew ? "good" : "warn"}">Crew ${selected.heist.draft.crewIds.length}/${selectedApproach.minCrew}</span>
            <span class="heist-chip ${selected.heist.prepDoneCount > 0 ? "good" : "warn"}">Prep ${selected.heist.prepDoneCount}/${selected.heist.def.preps.length}</span>
            <span class="heist-chip ${selected.heist.cooldownRemainingMs > 0 ? "warn" : "good"}">${selected.heist.cooldownRemainingMs > 0 ? fmtTime(selected.heist.cooldownRemainingMs) : "Window open"}</span>
          </div>
          <div class="metric-grid three">
            <div><span>Chance</span><strong>${pct(selected.heist.chance)}</strong></div>
            <div><span>Dirty Payout</span><strong>${fmtMoneyRange(selected.heist.preview.dirtyMin, selected.heist.preview.dirtyMax)}</strong></div>
            <div><span>Heat Spike</span><strong>${Math.round(selected.heist.preview.heat)}%</strong></div>
          </div>
          <div class="approach-row">
            ${selected.heist.def.approaches.map((approach) => `
              <button class="approach-chip ${selected.heist.draft.approachId === approach.id ? "active" : ""}" type="button" data-action="set-approach" data-district-id="${selected.def.id}" data-approach-id="${approach.id}">
                <strong>${approach.name}</strong>
                <small>${approach.minCrew} crew</small>
              </button>
            `).join("")}
          </div>
          <button class="neon-btn big" type="button" data-action="launch-heist" data-district-id="${selected.def.id}" ${selected.heist.ready ? "" : "disabled"}>${heistButtonLabel(selected, state.intel)}</button>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Prep Slots</h3><span class="section-label">Raise odds and payout</span></div>
          <div class="card-strip">
            ${selected.heist.def.preps.map((prep) => {
              const done = Boolean(selected.state.heist.prepDone[prep.id]);
              const availableCrew = derived.crew.filter((entry) => !entry.isBusy);
              const defaultCrew = availableCrew[0]?.crew.id || "";
              return `
                <article class="prep-card ${done ? "done" : ""}">
                  <strong>${prep.name}</strong>
                  <p>${prep.desc}</p>
                  <small>${describePrepEffects(prep.effect)}</small>
                  <small>${fmtMoney(prep.costDirty)} / ${prep.costIntel} intel / ${fmtTime(prep.duration)}</small>
                  <select data-prep-select ${done || !availableCrew.length ? "disabled" : ""}>
                    ${availableCrew.length ? availableCrew.map((entry) => `<option value="${entry.crew.id}" ${entry.crew.id === defaultCrew ? "selected" : ""}>${entry.crew.name} / ${entry.archetype.name}</option>`).join("") : `<option value="">No crew free</option>`}
                  </select>
                  <button class="ghost-btn" type="button" data-action="start-prep" data-start-prep data-district-id="${selected.def.id}" data-prep-id="${prep.id}" ${done || !availableCrew.length ? "disabled" : ""}>${done ? "Done" : "Start Prep"}</button>
                </article>
              `;
            }).join("")}
          </div>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Crew Draft</h3><span class="section-label">Pick the heist team</span></div>
          <div class="crew-draft-grid">
            ${derived.crew.map((entry) => `
              <label class="crew-draft-chip ${selected.heist.draft.crewIds.includes(entry.crew.id) ? "selected" : ""} ${entry.isBusy ? "disabled" : ""}">
                <input type="checkbox" data-heist-crew data-district-id="${selected.def.id}" data-crew-id="${entry.crew.id}" ${selected.heist.draft.crewIds.includes(entry.crew.id) ? "checked" : ""} ${entry.isBusy ? "disabled" : ""}>
                <strong>${entry.crew.name}</strong>
                <small>${entry.archetype.name}</small>
                <small>${entry.isBusy ? "Busy" : `Stress ${Math.round(entry.crew.stress)}%`}</small>
              </label>
            `).join("")}
          </div>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Contracts</h3><span class="section-label">Short-term goals</span></div>
          <div class="card-strip">
            ${derived.contracts.map((entry) => `
              <article class="contract-card ${entry.ready ? "ready" : ""} ${this.focus.type === "contract" && this.focus.id === entry.contract.id ? "selected" : ""}">
                <strong>${entry.contract.name}</strong>
                <p>${entry.contract.desc}</p>
                <div class="progress"><span style="width:${entry.ratio * 100}%"></span></div>
                <div class="contract-footer">${pct(entry.ratio)} / Reward ${fmtMoney(entry.contract.reward.dirty)} + ${fmtMoney(entry.contract.reward.clean)} + ${entry.contract.reward.intel} intel</div>
                <button class="ghost-btn" type="button" data-action="claim-contract" data-contract-id="${entry.contract.id}" ${entry.ready && !entry.contract.claimed ? "" : "disabled"}>${entry.contract.claimed ? "Claimed" : entry.ready ? "Claim" : "In Progress"}</button>
              </article>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  }

  renderCrewPanel(state, derived, selected) {
    const focusCrew = derived.crew.find((entry) => entry.crew.id === this.focus.id) || derived.crew[0];
    return `
      <div class="panel-stack">
        ${focusCrew ? `
          <section class="panel-hero">
            <div class="section-label">Crew Lead</div>
            <div class="hero-art">
              <img src="${crewSpritePath(focusCrew.archetype.id)}" alt="" />
              <div class="panel-copy">
                <h2>${focusCrew.crew.name}</h2>
                <p>${focusCrew.archetype.name} / ${focusCrew.positiveTrait.name} / ${focusCrew.negativeTrait.name}</p>
              </div>
            </div>
            <div class="metric-grid three">
              <div><span>Cunning</span><strong>${focusCrew.crew.cunning}</strong></div>
              <div><span>Nerve</span><strong>${focusCrew.crew.nerve}</strong></div>
              <div><span>Loyalty</span><strong>${focusCrew.effectiveLoyalty}</strong></div>
            </div>
            <div class="goal-footnote">${focusCrew.statusLabel}. ${focusCrew.archetype.passive}</div>
            <label class="select-wrap">
              <span>Assignment</span>
              <select data-assign-crew="${focusCrew.crew.id}" ${focusCrew.isBusy ? "disabled" : ""}>
                ${focusCrew.assignmentOptions.map((option) => `<option value="${option.value}" ${focusCrew.crew.assignmentKey === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
              </select>
            </label>
            <button class="ghost-btn" type="button" data-action="promote-crew" data-crew-id="${focusCrew.crew.id}" ${focusCrew.crew.rank >= 4 ? "disabled" : ""}>Promote / ${fmtMoney(focusCrew.promotionCost.clean)} / ${focusCrew.promotionCost.intel} intel</button>
          </section>
        ` : ""}

        <section class="panel-card">
          <div class="section-head"><h3>Roster</h3><span class="section-label">${derived.crew.length}/${derived.crewCap} active</span></div>
          <div class="card-strip crew-strip">
            ${derived.crew.map((entry) => `
              <button class="crew-roster-card ${focusCrew?.crew.id === entry.crew.id ? "selected" : ""}" type="button" data-action="focus" data-panel="crew" data-focus-type="crew" data-id="${entry.crew.id}" data-district-id="${selected.def.id}">
                <div class="crew-mini-head">
                  <img class="crew-thumb" src="${crewSpritePath(entry.archetype.id)}" alt="" />
                  <div>
                    <strong>${entry.crew.name}</strong>
                    <small>${entry.archetype.name}</small>
                  </div>
                </div>
                <small>${entry.statusLabel}</small>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Recruit Market</h3><button class="ghost-btn" type="button" data-action="reroll-crew">Reroll / 2 intel</button></div>
          <div class="card-strip crew-strip">
            ${derived.recruitPool.map((entry) => `
              <article class="recruit-card">
                <div class="crew-mini-head">
                  <img class="crew-thumb" src="${crewSpritePath(entry.archetype.id)}" alt="" />
                  <div>
                    <strong>${entry.candidate.name}</strong>
                    <small>${entry.archetype.name}</small>
                  </div>
                </div>
                <small>${entry.positiveTrait.name} / ${entry.negativeTrait.name}</small>
                <button class="neon-btn" type="button" data-action="hire-crew" data-candidate-id="${entry.candidate.id}">Hire / ${fmtMoney(entry.cost.dirty)} / ${fmtMoney(entry.cost.clean)} / ${entry.cost.intel} intel</button>
              </article>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  }

  renderLegacyPanel(state, derived, selected) {
    return `
      <div class="panel-stack">
        <section class="panel-hero">
          <div class="section-label">Neon Legacy</div>
          <div class="panel-copy">
            <h2>Bank the run or push deeper</h2>
            <p>Retiring converts this empire into permanent momentum. Hold longer for more LP, or cash out when the city gets too hot.</p>
          </div>
          <div class="metric-grid three">
            <div><span>Legacy on hand</span><strong>${state.legacyPoints} LP</strong></div>
            <div><span>Projected gain</span><strong>${derived.projectedLegacy} LP</strong></div>
            <div><span>Runs</span><strong>${state.stats.legacyRuns}</strong></div>
          </div>
          <div class="legacy-summary-actions">
            <button class="neon-btn gold" type="button" data-action="retire">Retire and rebuild</button>
            <button class="ghost-btn" type="button" data-action="focus" data-panel="city" data-focus-type="district" data-district-id="${derived.districts[derived.districts.length - 1].def.id}">Focus Black Vault</button>
          </div>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Permanent Upgrades</h3><span class="section-label">Spend LP</span></div>
          <div class="card-strip upgrade-strip">
            ${derived.legacyUpgrades.map((entry) => `
              <article class="upgrade-card">
                <strong>${entry.upgrade.name}</strong>
                <p>${entry.upgrade.desc}</p>
                <small>${entry.count}/${entry.upgrade.max}</small>
                <button class="ghost-btn" type="button" data-action="buy-legacy" data-upgrade-id="${entry.upgrade.id}" ${entry.canBuy ? "" : "disabled"}>Buy / ${entry.upgrade.cost} LP</button>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="panel-card">
          <div class="section-head"><h3>Empire Files</h3><span class="section-label">Why the run matters</span></div>
          <div class="card-strip upgrade-strip">
            ${derived.dossiers.map((entry) => `
              <article class="dossier-card ${entry.complete ? "selected" : ""}">
                <strong>${entry.dossier.name}</strong>
                <p>${entry.dossier.desc}</p>
                <div class="progress"><span style="width:${entry.ratio * 100}%"></span></div>
                <small>${entry.complete ? "Complete" : pct(entry.ratio)}</small>
              </article>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  }

  toast(alert) {
    const item = this.document.createElement("div");
    item.className = `toast ${alert.tone}`;
    item.innerHTML = `<strong>${alert.title}</strong><p>${alert.detail}</p>`;
    this.refs.toast.appendChild(item);
    window.setTimeout(() => item.classList.add("show"), 10);
    window.setTimeout(() => {
      item.classList.remove("show");
      window.setTimeout(() => item.remove(), 250);
    }, 3200);
  }
}
