import {
  BUILDING_SKINS,
  FORMATION_DEFS,
  INCIDENT_TEMPLATES,
  RESOURCE_META,
  UNIT_DEFS,
  VIEW_TABS,
} from "./data.mjs";
import { fmtNumber, fmtTime } from "./systems.mjs";

function pct(value, total) {
  if (!total) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function titleCase(value) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function bundleMarkup(bundle = {}) {
  const parts = Object.entries(bundle)
    .filter(([, value]) => value)
    .map(([key, value]) => `<span class="bundle-chip" data-resource="${key}">${fmtNumber(Math.abs(value))} ${RESOURCE_META[key]?.label || titleCase(key)}</span>`);
  return parts.length ? parts.join("") : `<span class="bundle-chip mute">No direct cost</span>`;
}

function rateMarkup(rates = {}) {
  const parts = Object.entries(rates)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `<span class="bundle-chip" data-resource="${key}">+${value.toFixed(2)}/s ${RESOURCE_META[key].label}</span>`);
  return parts.length ? parts.join("") : `<span class="bundle-chip mute">No passive output</span>`;
}

function silhouetteClass(typeId) {
  return `silhouette-${BUILDING_SKINS[typeId]?.silhouette || "hub"}`;
}

function metricCard(label, value, detail) {
  return `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </article>
  `;
}

function operativeBadge(entry) {
  const roleClass = entry.definition.role.toLowerCase();
  const injured = entry.injuryRemainingMs > 0;
  return `
    <button class="operative-pill ${entry.selected ? "selected" : ""} ${injured ? "injured" : ""}" type="button" data-action="toggle-squad" data-operative-id="${entry.state.id}">
      <span class="portrait-orb ${roleClass}" style="--accent:${entry.definition.accent}">${entry.definition.name.slice(0, 1)}</span>
      <span class="operative-pill-copy">
        <strong>${entry.definition.name}</strong>
        <small>${entry.definition.role} • ${Math.round(entry.power)} power${injured ? ` • injured ${fmtTime(entry.injuryRemainingMs)}` : ""}</small>
      </span>
    </button>
  `;
}

function alertMarkup(alert) {
  return `
    <article class="alert-card ${alert.tone}">
      <strong>${alert.title}</strong>
      <p>${alert.detail}</p>
    </article>
  `;
}

function worldNodeMarkup(node, selected) {
  return `
    <button
      class="world-node kind-${node.definition.kind} ${selected ? "selected" : ""} ${node.ready ? "ready" : ""} ${node.locked ? "locked" : ""}"
      type="button"
      data-action="select-node"
      data-node-id="${node.state.id}"
      style="left:${node.definition.x}%;top:${node.definition.y}%"
    >
      <span class="world-node-core"></span>
      <span class="world-node-copy">
        <strong>${node.definition.name}</strong>
        <small>${node.locked ? "Locked" : node.ready ? "Ready" : node.cooldownRemainingMs ? fmtTime(node.cooldownRemainingMs) : node.state.cleared ? "Secured" : "Online"}</small>
      </span>
    </button>
  `;
}

function cityBuildingMarkup(entry, selected, placementActive) {
  const hue = BUILDING_SKINS[entry.definition.id]?.hue || 180;
  const busy = entry.busyRemainingMs > 0;
  return `
    <button
      class="city-building ${selected ? "selected" : ""} ${busy ? "busy" : ""} ${silhouetteClass(entry.definition.id)}"
      type="button"
      data-action="select-building"
      data-instance-id="${entry.building.instanceId}"
      style="left:${entry.position.x}%;top:${entry.position.y}%;--hue:${hue}"
    >
      <span class="city-building-glow"></span>
      <span class="city-building-copy">
        <strong>${entry.definition.name}</strong>
        <small>${busy ? fmtTime(entry.busyRemainingMs) : `Lv ${entry.building.level}`}</small>
      </span>
      ${placementActive && !entry.building.anchorId ? `<span class="move-cue">Move</span>` : ""}
    </button>
  `;
}

function cityCellMarkup(cell, selected) {
  return `
    <button
      class="city-cell ${cell.unlocked ? "" : "locked"} ${cell.canPlace ? "can-place" : ""} ${selected ? "selected" : ""}"
      type="button"
      data-action="select-cell"
      data-cell-id="${cell.id}"
      style="left:${cell.x}%;top:${cell.y}%"
    >
      <span>${cell.canPlace ? "Place" : cell.unlocked ? "" : "Tier"}</span>
    </button>
  `;
}

export class NeonFrontierUI {
  constructor(documentRef, handlers) {
    this.document = documentRef;
    this.handlers = handlers;
    this.refs = {
      shell: documentRef.getElementById("appShell"),
      hud: documentRef.getElementById("hudRoot"),
      objective: documentRef.getElementById("objectiveRoot"),
      stage: documentRef.getElementById("stageRoot"),
      panel: documentRef.getElementById("panelRoot"),
      overlay: documentRef.getElementById("overlayRoot"),
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
        case "switch-view":
          this.handlers.onSwitchView(button.dataset.view);
          break;
        case "select-node":
          this.handlers.onSelectNode(button.dataset.nodeId);
          break;
        case "select-building":
          this.handlers.onSelectBuilding(button.dataset.instanceId);
          break;
        case "select-cell":
          this.handlers.onSelectCell(button.dataset.cellId);
          break;
        case "start-placement":
          this.handlers.onStartPlacement(button.dataset.typeId);
          break;
        case "cancel-placement":
          this.handlers.onCancelPlacement();
          break;
        case "upgrade-building":
          this.handlers.onUpgradeBuilding(button.dataset.instanceId);
          break;
        case "building-action":
          this.handlers.onBuildingAction(button.dataset.instanceId);
          break;
        case "start-research":
          this.handlers.onStartResearch(button.dataset.researchId);
          break;
        case "queue-training":
          this.handlers.onQueueTraining(button.dataset.unitId);
          break;
        case "recruit-operative":
          this.handlers.onRecruitOperative(button.dataset.operativeId);
          break;
        case "promote-operative":
          this.handlers.onPromoteOperative(button.dataset.operativeId);
          break;
        case "select-operative":
          this.handlers.onSelectOperative(button.dataset.operativeId);
          break;
        case "toggle-squad":
          this.handlers.onToggleSquad(button.dataset.operativeId);
          break;
        case "formation":
          this.handlers.onSetFormation(button.dataset.formationId);
          break;
        case "open-mission":
          this.handlers.onOpenMission(button.dataset.nodeId);
          break;
        case "start-mission":
          this.handlers.onStartMission();
          break;
        case "mission-ability":
          this.handlers.onMissionAbility(button.dataset.operativeId);
          break;
        case "dismiss-mission":
          this.handlers.onDismissMission();
          break;
        case "resolve-incident":
          this.handlers.onResolveIncident(button.dataset.incidentId, button.dataset.choice);
          break;
        case "relocate-building":
          this.handlers.onRelocateBuilding(button.dataset.instanceId);
          break;
        case "save":
          this.handlers.onSave();
          break;
        default:
          break;
      }
    });
  }

  render(state, derived, missionRun) {
    this.refs.hud.innerHTML = this.renderHud(state, derived);
    this.refs.objective.innerHTML = this.renderObjectives(state, derived);
    this.refs.stage.innerHTML = state.currentView === "world"
      ? this.renderWorldStage(state, derived)
      : this.renderCityStage(state, derived);
    this.refs.panel.innerHTML = state.currentView === "world"
      ? this.renderWorldPanel(state, derived)
      : this.renderCityPanel(state, derived);
    this.refs.overlay.innerHTML = this.renderOverlay(state, derived, missionRun);
  }

  renderHud(state, derived) {
    return `
      <header class="top-hud frame">
        <div class="brand-lockup">
          <span class="brand-kicker">Milgie City Strategy</span>
          <h1>Neon Frontier</h1>
          <p>Warm megacity expansion across a luminous frontier.</p>
        </div>
        <nav class="view-tabs">
          ${VIEW_TABS.map((tab) => `
            <button class="view-tab ${state.currentView === tab.id ? "active" : ""}" type="button" data-action="switch-view" data-view="${tab.id}">
              ${tab.label}
            </button>
          `).join("")}
        </nav>
        <div class="macro-grid">
          ${metricCard("Tier", state.city.tier, "Helio Core")}
          ${metricCard("Morale", `${Math.round(state.city.morale)}%`, "City stability")}
          ${metricCard("Population", `${Math.round(derived.population)}/${Math.round(derived.housing)}`, "Residents housed")}
          ${metricCard("Frontier Control", `${Math.round(state.world.control)}%`, "Regional reach")}
        </div>
        <div class="resource-strip">
          ${Object.entries(state.resources).map(([key, value]) => `
            <article class="resource-chip" data-resource="${key}">
              <span>${RESOURCE_META[key].label}</span>
              <strong>${fmtNumber(value)}</strong>
              <small>${derived.rates[key] > 0 ? `+${derived.rates[key].toFixed(2)}/s` : "static"}</small>
            </article>
          `).join("")}
        </div>
        <div class="hud-actions">
          <button class="glass-btn" type="button" data-action="save">Save</button>
        </div>
      </header>
    `;
  }

  renderObjectives(state, derived) {
    return `
      <section class="objective-strip frame">
        <article class="objective-card">
          <div>
            <span class="eyebrow">Current objective</span>
            <h2>${derived.activeObjective.title}</h2>
            <p>${derived.activeObjective.detail}</p>
          </div>
          <button class="glass-btn accent" type="button" data-action="switch-view" data-view="${derived.activeObjective.focusView}">
            Focus ${derived.activeObjective.focusView === "city" ? "City" : "Overland"}
          </button>
        </article>
        <div class="alert-stack">
          ${state.incidents.length ? `
            <article class="alert-card event">
              <strong>${state.incidents.length} incident${state.incidents.length > 1 ? "s" : ""} pending</strong>
              <p>Open the city panel to resolve the latest civic event.</p>
            </article>
          ` : ""}
          ${derived.topAlerts.map((alert) => alertMarkup(alert)).join("")}
        </div>
      </section>
    `;
  }

  renderWorldStage(state, derived) {
    return `
      <section class="stage-shell world-shell frame">
        <div class="world-surface">
          <div class="world-lights"></div>
          <div class="world-grid"></div>
          <button class="city-beacon" type="button" data-action="switch-view" data-view="city">
            <span class="city-beacon-core"></span>
            <span class="city-beacon-copy">
              <strong>Helio City</strong>
              <small>Tap to enter</small>
            </span>
          </button>
          ${derived.worldNodes.map((node) => worldNodeMarkup(node, derived.selectedNode?.state.id === node.state.id)).join("")}
        </div>
      </section>
    `;
  }

  renderWorldPanel(state, derived) {
    const node = derived.selectedNode;
    if (!node) {
      return `<section class="panel-shell frame"><p>No node selected.</p></section>`;
    }
    return `
      <section class="panel-shell frame">
        <div class="panel-head">
          <span class="eyebrow">Overland node</span>
          <h2>${node.definition.name}</h2>
          <p>${node.definition.detail}</p>
        </div>
        <div class="bundle-row">
          ${bundleMarkup(node.definition.reward)}
        </div>
        <div class="panel-metrics">
          ${metricCard("Type", titleCase(node.definition.kind), node.definition.missionType)}
          ${metricCard("Enemy Power", fmtNumber(node.definition.enemyPower), node.locked ? "Locked" : node.ready ? "Ready" : node.cooldownRemainingMs ? fmtTime(node.cooldownRemainingMs) : "Secured")}
          ${metricCard("Squad Power", fmtNumber(derived.squadPower), state.ui.missionFormation)}
        </div>
        <div class="panel-actions">
          <button class="glass-btn accent" type="button" data-action="open-mission" data-node-id="${node.state.id}" ${node.ready ? "" : "disabled"}>
            ${node.locked ? "Locked" : node.cooldownRemainingMs ? `Cooldown ${fmtTime(node.cooldownRemainingMs)}` : "Open Skirmish"}
          </button>
          <button class="glass-btn" type="button" data-action="switch-view" data-view="city">Enter City</button>
        </div>
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Formation</strong>
            <small>Pick the balance before launching.</small>
          </div>
          <div class="formation-row">
            ${FORMATION_DEFS.map((formation) => `
              <button class="formation-pill ${state.ui.missionFormation === formation.id ? "active" : ""}" type="button" data-action="formation" data-formation-id="${formation.id}">
                <strong>${formation.name}</strong>
                <small>${formation.detail}</small>
              </button>
            `).join("")}
          </div>
        </section>
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Mission Squad</strong>
            <small>Choose up to three recruited operatives.</small>
          </div>
          <div class="operative-list">
            ${derived.operatives.filter((entry) => entry.state.recruited).map((entry) => operativeBadge(entry)).join("")}
          </div>
        </section>
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Field Alerts</strong>
            <small>Latest city and frontier activity.</small>
          </div>
          <div class="alert-list">
            ${derived.topAlerts.map((alert) => alertMarkup(alert)).join("")}
          </div>
        </section>
      </section>
    `;
  }

  renderCityStage(state, derived) {
    const placementActive = Boolean(state.ui.placementTypeId || state.ui.relocatingBuildingId);
    return `
      <section class="stage-shell city-shell frame">
        <div class="city-surface">
          <div class="city-aurora"></div>
          <div class="city-gridline city-gridline-a"></div>
          <div class="city-gridline city-gridline-b"></div>
          <div class="city-zone zone-waterfront">Waterfront</div>
          <div class="city-zone zone-core">Core Mesh</div>
          <div class="city-zone zone-spireline">Spireline</div>
          <div class="city-zone zone-market">Sky Market</div>
          ${derived.cells.filter((cell) => !cell.occupied).map((cell) => cityCellMarkup(cell, state.selectedCellId === cell.id)).join("")}
          ${derived.buildings.map((entry) => cityBuildingMarkup(entry, state.selectedBuildingId === entry.building.instanceId, placementActive)).join("")}
          <div class="build-dock">
            ${derived.buildChoices.map((choice) => `
              <button class="build-card ${state.ui.placementTypeId === choice.definition.id ? "active" : ""}" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
                <span class="build-card-kicker">${choice.count}/${choice.definition.limit}</span>
                <strong>${choice.definition.name}</strong>
                <small>${choice.definition.unlockTier > state.city.tier ? `Tier ${choice.definition.unlockTier}` : choice.buildable ? "Ready" : "Need resources"}</small>
              </button>
            `).join("")}
          </div>
          ${placementActive ? `
            <div class="placement-banner">
              <strong>${state.ui.relocatingBuildingId ? "Select a new city lot" : "Select a city lot to build"}</strong>
              <button class="glass-btn small" type="button" data-action="cancel-placement">Cancel</button>
            </div>
          ` : ""}
        </div>
      </section>
    `;
  }

  renderGenericBuildingPanel(entry) {
    return `
      <div class="panel-actions">
        <button class="glass-btn accent" type="button" data-action="building-action" data-instance-id="${entry.building.instanceId}" ${entry.definition.action ? "" : "disabled"}>
          ${entry.definition.action?.label || "No action"}
        </button>
        <button class="glass-btn" type="button" data-action="upgrade-building" data-instance-id="${entry.building.instanceId}" ${entry.canUpgrade ? "" : "disabled"}>
          ${entry.canUpgrade ? `Upgrade • ${bundleMarkup(entry.upgradeCost)}` : entry.building.level >= entry.definition.maxLevel ? "Max level" : entry.ready ? "Need more resources" : `Busy ${fmtTime(entry.busyRemainingMs)}`}
        </button>
      </div>
      ${!entry.building.anchorId ? `
        <div class="panel-actions secondary">
          <button class="glass-btn small" type="button" data-action="relocate-building" data-instance-id="${entry.building.instanceId}">Relocate</button>
        </div>
      ` : ""}
    `;
  }

  renderResearchPanel(entry, derived) {
    return `
      <section class="subpanel">
        <div class="subpanel-head">
          <strong>Research Queue</strong>
          <small>${derived.availableResearch.filter((item) => item.completed).length} completed</small>
        </div>
        <div class="research-list">
          ${derived.availableResearch.map((item) => `
            <article class="research-card ${item.completed ? "complete" : item.active ? "active" : ""}">
              <strong>${item.definition.name}</strong>
              <p>${item.definition.detail}</p>
              <div class="bundle-row">${bundleMarkup(item.definition.cost)}</div>
              <button class="glass-btn small" type="button" data-action="start-research" data-research-id="${item.definition.id}" ${(item.locked || item.completed || item.active || derived.selectedBuilding.busyRemainingMs > 0 || derived.selectedBuilding.building.level <= 0) ? "disabled" : ""}>
                ${item.completed ? "Complete" : item.active ? `Active • ${fmtTime(item.definition.durationMs)}` : item.locked ? "Locked" : "Start"}
              </button>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  renderTrainingPanel(state) {
    return `
      <section class="subpanel">
        <div class="subpanel-head">
          <strong>Training Queue</strong>
          <small>${state.training.unitId ? `Busy • ${fmtTime(Math.max(0, state.training.endsAt - Date.now()))}` : "Idle"}</small>
        </div>
        <div class="training-list">
          ${UNIT_DEFS.map((unit) => `
            <article class="train-card">
              <strong>${unit.name}</strong>
              <p>${unit.batch} units • ${unit.power} power each</p>
              <div class="bundle-row">${bundleMarkup(unit.cost)}</div>
              <button class="glass-btn small" type="button" data-action="queue-training" data-unit-id="${unit.id}" ${state.training.unitId ? "disabled" : ""}>
                Train • ${fmtTime(unit.timeMs)}
              </button>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  renderOperativePanel(state, derived) {
    return `
      <section class="subpanel">
        <div class="subpanel-head">
          <strong>Operative Roster</strong>
          <small>Promote or recruit specialists.</small>
        </div>
        <div class="operative-list">
          ${derived.operatives.map((entry) => `
            <article class="operative-card ${entry.state.recruited ? "" : "locked"}">
              <div class="operative-topline">
                <span class="portrait-orb ${entry.definition.role.toLowerCase()}" style="--accent:${entry.definition.accent}">${entry.definition.name.slice(0, 1)}</span>
                <div>
                  <strong>${entry.definition.name}</strong>
                  <small>${entry.definition.role} • ${entry.definition.abilityLabel}</small>
                </div>
              </div>
              <p>${entry.definition.abilityDetail}</p>
              <div class="panel-actions secondary">
                ${entry.state.recruited ? `
                  <button class="glass-btn small" type="button" data-action="promote-operative" data-operative-id="${entry.state.id}">Promote</button>
                ` : `
                  <button class="glass-btn small accent" type="button" data-action="recruit-operative" data-operative-id="${entry.state.id}">Recruit</button>
                `}
                <button class="glass-btn small" type="button" data-action="select-operative" data-operative-id="${entry.state.id}">Focus</button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  renderIncidentPanel(state) {
    if (!state.incidents.length) {
      return `
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>City incidents</strong>
            <small>No unresolved issues.</small>
          </div>
        </section>
      `;
    }

    const incident = state.incidents[0];
    const template = INCIDENT_TEMPLATES.find((entry) => entry.id === incident.templateId);
    return `
      <section class="subpanel incident-panel">
        <div class="subpanel-head">
          <strong>${template?.title || titleCase(incident.templateId)}</strong>
          <small>Resolve the latest civic pressure.</small>
        </div>
        <p>${template?.detail || "A city event needs a decision."}</p>
        <div class="panel-actions">
          <button class="glass-btn accent" type="button" data-action="resolve-incident" data-incident-id="${incident.id}" data-choice="primary">${template?.primaryLabel || "Primary response"}</button>
          <button class="glass-btn" type="button" data-action="resolve-incident" data-incident-id="${incident.id}" data-choice="secondary">${template?.secondaryLabel || "Secondary response"}</button>
        </div>
      </section>
    `;
  }

  renderCityPanel(state, derived) {
    const selected = derived.selectedBuilding;
    if (!selected) {
      return `<section class="panel-shell frame"><p>No building selected.</p></section>`;
    }

    let specialMarkup = "";
    if (selected.definition.id === "research-lab") {
      specialMarkup = this.renderResearchPanel(selected, derived);
    } else if (selected.definition.id === "vanguard-barracks") {
      specialMarkup = this.renderTrainingPanel(state);
    } else if (selected.definition.id === "operative-hub") {
      specialMarkup = this.renderOperativePanel(state, derived);
    } else if (selected.definition.id === "command-nexus" || selected.definition.id === "commons-hall") {
      specialMarkup = this.renderIncidentPanel(state);
    }

    return `
      <section class="panel-shell frame">
        <div class="panel-head">
          <span class="eyebrow">City building</span>
          <h2>${selected.definition.name}</h2>
          <p>${selected.definition.description}</p>
        </div>
        <div class="bundle-row">${rateMarkup(selected.definition.outputPerSec)}</div>
        <div class="panel-metrics">
          ${metricCard("Level", selected.building.level, selected.ready ? "Operational" : `Busy ${fmtTime(selected.busyRemainingMs)}`)}
          ${metricCard("Action", selected.definition.action?.label || "Passive", selected.cooldownRemainingMs ? `Cooldown ${fmtTime(selected.cooldownRemainingMs)}` : "Ready")}
          ${metricCard("Zone", titleCase(selected.position.zone || "anchor"), selected.building.anchorId ? "Fixed anchor" : "Player placed")}
        </div>
        ${selected.definition.id === "research-lab" || selected.definition.id === "vanguard-barracks" || selected.definition.id === "operative-hub"
          ? `
            <div class="panel-actions">
              <button class="glass-btn" type="button" data-action="upgrade-building" data-instance-id="${selected.building.instanceId}" ${selected.canUpgrade ? "" : "disabled"}>
                ${selected.canUpgrade ? "Upgrade building" : selected.building.level >= selected.definition.maxLevel ? "Max level" : selected.ready ? "Need more resources" : `Busy ${fmtTime(selected.busyRemainingMs)}`}
              </button>
              ${!selected.building.anchorId ? `<button class="glass-btn small" type="button" data-action="relocate-building" data-instance-id="${selected.building.instanceId}">Relocate</button>` : ""}
            </div>
          `
          : this.renderGenericBuildingPanel(selected)}
        ${specialMarkup}
        <section class="subpanel">
          <div class="subpanel-head">
            <strong>Build queue</strong>
            <small>${state.ui.placementTypeId ? "Placement mode active" : "Tap any building lot to focus it."}</small>
          </div>
          <div class="build-queue-list">
            ${derived.buildChoices.map((choice) => `
              <button class="mini-build ${choice.buildable ? "" : "disabled"}" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
                <strong>${choice.definition.name}</strong>
                <small>${choice.count}/${choice.definition.limit}</small>
              </button>
            `).join("")}
          </div>
        </section>
      </section>
    `;
  }

  renderOverlay(state, derived, missionRun) {
    if (!missionRun) {
      return "";
    }
    const node = derived.worldNodes.find((entry) => entry.state.id === missionRun.nodeId) || derived.selectedNode;
    return `
      <div class="overlay-backdrop">
        <section class="mission-modal frame">
          <div class="panel-head">
            <span class="eyebrow">Skirmish</span>
            <h2>${node?.definition.name || "Mission"}</h2>
            <p>${missionRun.running ? "Abilities can each be used once during the clash." : "Confirm your squad and start the engagement."}</p>
          </div>
          <div class="mission-bars">
            <article>
              <span>Squad Integrity</span>
              <div class="bar"><div style="width:${pct(missionRun.playerHp, missionRun.playerMaxHp)}%"></div></div>
              <strong>${fmtNumber(missionRun.playerHp)} / ${fmtNumber(missionRun.playerMaxHp)}</strong>
            </article>
            <article>
              <span>Enemy Pressure</span>
              <div class="bar enemy"><div style="width:${pct(missionRun.enemyHp, missionRun.enemyMaxHp)}%"></div></div>
              <strong>${fmtNumber(missionRun.enemyHp)} / ${fmtNumber(missionRun.enemyMaxHp)}</strong>
            </article>
          </div>
          <div class="ability-row">
            ${missionRun.squadIds.map((operativeId) => {
              const operative = derived.operatives.find((entry) => entry.state.id === operativeId);
              return `
                <button class="ability-btn ${missionRun.abilityUses[operativeId] ? "used" : ""}" type="button" data-action="mission-ability" data-operative-id="${operativeId}" ${(missionRun.running && !missionRun.abilityUses[operativeId] && !missionRun.resolved) ? "" : "disabled"}>
                  <strong>${operative?.definition.abilityLabel || "Ability"}</strong>
                  <small>${operative?.definition.name || operativeId}</small>
                </button>
              `;
            }).join("")}
          </div>
          <div class="mission-log">
            ${missionRun.log.map((entry) => `<div class="log-line ${entry.tone}">${entry.text}</div>`).join("")}
          </div>
          <div class="panel-actions">
            ${!missionRun.running && !missionRun.resolved
              ? `<button class="glass-btn accent" type="button" data-action="start-mission">Start skirmish</button>`
              : ""}
            <button class="glass-btn" type="button" data-action="dismiss-mission" ${missionRun.running && !missionRun.resolved ? "disabled" : ""}>
              ${missionRun.resolved ? "Close" : "Retreat"}
            </button>
          </div>
        </section>
      </div>
    `;
  }
}
