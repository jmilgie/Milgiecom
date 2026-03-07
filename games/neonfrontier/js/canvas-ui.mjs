import {
  BUILDING_SKINS,
  CITY_PARCELS,
  FORMATION_DEFS,
  INCIDENT_TEMPLATES,
  RESOURCE_META,
  UNIT_DEFS,
  ZONE_META,
} from "./data.mjs";
import { fmtNumber, fmtTime } from "./systems.mjs";

const SCENE_SIZES = {
  world: { width: 1800, height: 1200 },
  city: { width: 1800, height: 1300 },
};

const WORLD_HUB = { x: 40, y: 78 };
const CITY_TILE = { width: 116, height: 58 };

const KIND_META = {
  relay: { label: "Relay", color: "#7febff" },
  salvage: { label: "Salvage", color: "#d9b4ff" },
  harvest: { label: "Harvest", color: "#ffd86f" },
  convoy: { label: "Convoy", color: "#84ffca" },
  threat: { label: "Threat", color: "#ff7ec7" },
  landmark: { label: "Landmark", color: "#ff9a68" },
};

const GROUP_META = {
  command: { label: "Command", color: "#ff9a68" },
  hero: { label: "Operatives", color: "#ff7ec7" },
  support: { label: "Support", color: "#ffd86f" },
  resource: { label: "Resource", color: "#7febff" },
  industry: { label: "Industry", color: "#caa3ff" },
  science: { label: "Research", color: "#84ffca" },
  military: { label: "Security", color: "#ff9f7c" },
  exploration: { label: "Exploration", color: "#92fff2" },
};

function titleCase(value) {
  return String(value || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function icon(name) {
  const icons = {
    save: '<path d="M5 5h12l2 2v12H5z"></path><path d="M8 5v5h8V5M9 19v-5h6v5"></path>',
    track: '<rect x="5" y="4" width="14" height="16" rx="2"></rect><path d="M9 2h6M8 9h8M8 13h6M8 17h4"></path>',
    build: '<path d="M4 19 19 4"></path><path d="m14 4 6 6"></path><path d="M6 13 3 16l5 5 3-3"></path>',
    zoomIn: '<circle cx="10" cy="10" r="5.5"></circle><path d="M10 7v6M7 10h6M15 15l5 5"></path>',
    zoomOut: '<circle cx="10" cy="10" r="5.5"></circle><path d="M7 10h6M15 15l5 5"></path>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>',
    world: '<circle cx="12" cy="12" r="7"></circle><path d="M5 12h14M12 5a13 13 0 0 1 0 14M12 5a13 13 0 0 0 0 14"></path>',
    city: '<path d="M4 20V10l8-6 8 6v10"></path><path d="M9 20v-5h6v5M8 11h.01M12 11h.01M16 11h.01"></path>',
    close: '<path d="M6 6 18 18M18 6 6 18"></path>',
    crew: '<path d="M8 12a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM16.5 11a2.5 2.5 0 1 1 0-5"></path><path d="M3.5 19a4.5 4.5 0 0 1 9 0M14 18a4 4 0 0 1 6 0"></path>',
    lab: '<path d="M10 3v5l-5 9a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 17l-5-9V3"></path><path d="M8 8h8M9 14h6"></path>',
  };
  return `<svg class="nf-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || icons.world}</svg>`;
}

function resourceChip(key, value, rate = "") {
  const meta = RESOURCE_META[key];
  return `
    <article class="nf-resource-chip" data-resource="${key}">
      <span class="nf-resource-mark" style="--accent:${meta?.accent || "#fff"}">${meta?.short || key.slice(0, 1).toUpperCase()}</span>
      <div class="nf-resource-copy">
        <span>${meta?.label || titleCase(key)}</span>
        <strong>${fmtNumber(value)}</strong>
      </div>
      ${rate ? `<small>${rate}</small>` : ""}
    </article>
  `;
}

function bundleMarkup(bundle = {}) {
  return Object.entries(bundle)
    .filter(([, value]) => value)
    .map(([key, value]) => `
      <span class="nf-chip" data-resource="${key}">
        <span class="nf-resource-mark tiny" style="--accent:${RESOURCE_META[key]?.accent || "#fff"}">${RESOURCE_META[key]?.short || key.slice(0, 1).toUpperCase()}</span>
        <span>${value > 0 ? "+" : "-"}${fmtNumber(Math.abs(value))} ${RESOURCE_META[key]?.label || titleCase(key)}</span>
      </span>
    `)
    .join("");
}

function rateMarkup(bundle = {}) {
  return Object.entries(bundle)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `
      <span class="nf-chip" data-resource="${key}">
        <span class="nf-resource-mark tiny" style="--accent:${RESOURCE_META[key]?.accent || "#fff"}">${RESOURCE_META[key]?.short || key.slice(0, 1).toUpperCase()}</span>
        <span>+${value.toFixed(2)}/s ${RESOURCE_META[key]?.label || titleCase(key)}</span>
      </span>
    `)
    .join("");
}

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function alphaColor(hex, alpha) {
  const normalized = String(hex || "#ffffff").replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized.padEnd(6, "f").slice(0, 6);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function percentPoint(scene, point) {
  return {
    x: (point.x / 100) * scene.width,
    y: (point.y / 100) * scene.height,
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function diamondPath(ctx, x, y, width, height) {
  ctx.beginPath();
  ctx.moveTo(x, y - height / 2);
  ctx.lineTo(x + width / 2, y);
  ctx.lineTo(x, y + height / 2);
  ctx.lineTo(x - width / 2, y);
  ctx.closePath();
}

export class NeonFrontierUI {
  constructor(documentRef, handlers) {
    this.document = documentRef;
    this.window = documentRef.defaultView || window;
    this.handlers = handlers;
    this.buildPaletteOpen = false;
    this.trackerOpen = this.window.matchMedia("(min-width: 1180px)").matches;
    this.lastState = null;
    this.lastDerived = null;
    this.lastMissionRun = null;
    this.refs = {
      hud: documentRef.getElementById("hudRoot"),
      tracker: documentRef.getElementById("objectiveRoot"),
      stage: documentRef.getElementById("stageRoot"),
      panel: documentRef.getElementById("panelRoot"),
      nav: documentRef.getElementById("navRoot"),
      overlay: documentRef.getElementById("overlayRoot"),
    };
    this.camera = {
      world: { x: 0, y: 0, scale: 1, initialized: false },
      city: { x: 0, y: 0, scale: 1, initialized: false },
    };
    this.viewport = { width: 1, height: 1, dpr: 1 };
    this.images = {
      world: loadImage(new URL("../assets/world/world-map.png", import.meta.url)),
      city: loadImage(new URL("../assets/world/city-plate.png", import.meta.url)),
    };
    this.canvas = null;
    this.ctx = null;
    this.pointer = null;
    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);
    this.boundPointerCancel = () => {
      this.pointer = null;
    };
    this.boundWheel = (event) => this.handleWheel(event);
    this.bind();
  }

  bind() {
    this.document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }
      if (this.handleLocalAction(button.dataset.action, button.dataset)) {
        return;
      }

      switch (button.dataset.action) {
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
          this.buildPaletteOpen = false;
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

    this.window.addEventListener("resize", () => {
      this.camera.world.initialized = false;
      this.camera.city.initialized = false;
      this.attachCanvas();
      this.draw();
    });

    this.window.addEventListener("keydown", (event) => {
      if (!this.lastState) {
        return;
      }
      if (event.key === "+" || event.key === "=") {
        this.bumpZoom(this.lastState.currentView, 0.12);
      }
      if (event.key === "-" || event.key === "_") {
        this.bumpZoom(this.lastState.currentView, -0.12);
      }
    });
  }

  isCompact() {
    return this.window.matchMedia("(max-width: 900px)").matches;
  }

  handleLocalAction(action, data = {}) {
    switch (action) {
      case "toggle-build-palette":
        this.buildPaletteOpen = !this.buildPaletteOpen;
        this.refresh();
        return true;
      case "toggle-tracker":
        this.trackerOpen = !this.trackerOpen;
        this.refresh();
        return true;
      case "zoom-in":
        this.bumpZoom(this.lastState?.currentView || "world", 0.12);
        return true;
      case "zoom-out":
        this.bumpZoom(this.lastState?.currentView || "world", -0.12);
        return true;
      case "fit-camera":
        this.resetCamera(this.lastState?.currentView || "world");
        this.draw();
        return true;
      case "focus-building-type":
        this.focusBuildingType(data.typeId);
        return true;
      default:
        return false;
    }
  }

  focusBuildingType(typeId) {
    if (!this.lastState) {
      return;
    }
    const existing = this.lastState.city.buildings.find((entry) => entry.typeId === typeId && entry.level > 0);
    if (this.lastState.currentView !== "city") {
      this.handlers.onSwitchView("city");
    }
    if (existing) {
      this.handlers.onSelectBuilding(existing.instanceId);
      return;
    }
    this.buildPaletteOpen = false;
    this.handlers.onStartPlacement(typeId);
  }

  render(state, derived, missionRun) {
    this.lastState = state;
    this.lastDerived = derived;
    this.lastMissionRun = missionRun;
    if (state.currentView !== "city") {
      this.buildPaletteOpen = false;
    }

    this.refs.hud.innerHTML = this.renderHud(state, derived);
    this.refs.stage.innerHTML = this.renderStage(state, derived);
    this.refs.tracker.innerHTML = this.renderTracker(state, derived);
    this.refs.panel.innerHTML = this.renderSheet(state, derived);
    this.refs.nav.innerHTML = this.renderBottomNav(state, derived);
    this.refs.overlay.innerHTML = this.renderOverlay(state, derived, missionRun);
    this.attachCanvas();
    this.window.requestAnimationFrame(() => this.draw());
  }

  refresh() {
    if (this.lastState && this.lastDerived) {
      this.render(this.lastState, this.lastDerived, this.lastMissionRun);
    }
  }

  renderHud(state, derived) {
    const compact = this.isCompact();
    const resourceKeys = compact
      ? ["food", "water", "energy", "alloy", "credits", "circuits"]
      : ["food", "water", "energy", "alloy", "circuits", "credits", "intel", "shards"];

    return `
      <header class="nf-topbar frame">
        <div class="nf-topbar-main">
          <div class="nf-brand">
            <span class="nf-brand-mark">NF</span>
            <div class="nf-brand-copy">
              <strong>Neon Frontier</strong>
              <small>Tier ${state.city.tier} | ${Math.round(state.city.morale)}% morale | ${Math.round(state.world.control)}% control</small>
            </div>
          </div>
          <div class="nf-topbar-status">
            <span>${state.currentView === "world" ? "Overland" : "My City"}</span>
            <span>${fmtNumber(derived.population)}/${fmtNumber(derived.housing)} pop</span>
            <span>${fmtNumber(derived.squadPower)} squad</span>
          </div>
          <div class="nf-topbar-actions">
            <button class="nf-round-btn" type="button" data-action="toggle-tracker" aria-label="Toggle tracker">${icon("track")}</button>
            <button class="nf-round-btn" type="button" data-action="save" aria-label="Save game">${icon("save")}</button>
          </div>
        </div>
        <div class="nf-resource-strip">
          ${resourceKeys
            .map((key) => resourceChip(key, state.resources[key], compact ? "" : derived.rates[key] > 0 ? `+${derived.rates[key].toFixed(2)}/s` : "stable"))
            .join("")}
        </div>
      </header>
    `;
  }

  renderStage(state, derived) {
    const placementActive = Boolean(state.ui.placementTypeId || state.ui.relocatingBuildingId);
    const showTrackerButton = this.isCompact() || !this.trackerOpen;
    const hint = placementActive
      ? state.ui.relocatingBuildingId
        ? "Tap an open tile to relocate the structure."
        : "Tap a bright tile to place your new building."
      : state.currentView === "world"
        ? "Drag to pan the frontier. Tap a route node or your city."
        : "Drag around the city. Tap a building or an open plot.";

    return `
      <section class="nf-stage frame">
        <canvas class="nf-canvas" id="nfSceneCanvas"></canvas>
        <div class="nf-stage-topline">
          ${showTrackerButton ? `
            <button class="nf-stage-chip is-button" type="button" data-action="toggle-tracker">
              ${icon("track")}
              <span>${this.isCompact() ? "Track" : "Objectives"}</span>
            </button>
          ` : `<span class="nf-stage-chip ghost">Objectives pinned</span>`}
          <div class="nf-stage-chip center">
            <strong>${state.currentView === "world" ? "Overland Map" : "My City"}</strong>
            <small>${placementActive ? hint : derived.activeObjective.title}</small>
          </div>
        </div>
        <div class="nf-stage-rail right">
          ${state.currentView === "city" ? `
            <button class="nf-stage-btn primary" type="button" data-action="toggle-build-palette">
              ${icon("build")}
              <span>Build</span>
            </button>
          ` : `
            <button class="nf-stage-btn primary" type="button" data-action="switch-view" data-view="city">
              ${icon("city")}
              <span>City</span>
            </button>
          `}
          <button class="nf-stage-btn" type="button" data-action="zoom-in" aria-label="Zoom in">${icon("zoomIn")}</button>
          <button class="nf-stage-btn" type="button" data-action="zoom-out" aria-label="Zoom out">${icon("zoomOut")}</button>
          <button class="nf-stage-btn" type="button" data-action="fit-camera" aria-label="Fit map">${icon("fit")}</button>
        </div>
        ${derived.topAlerts.length ? `
          <div class="nf-alert-stack">
            ${derived.topAlerts.slice(0, this.isCompact() ? 1 : 2).map((alert) => `
              <article class="nf-alert tone-${alert.tone}">
                <strong>${alert.title}</strong>
                <small>${alert.detail}</small>
              </article>
            `).join("")}
          </div>
        ` : ""}
        ${placementActive ? `
          <div class="nf-placement-banner">
            <strong>${state.ui.relocatingBuildingId ? "Relocate mode" : "Build mode"}</strong>
            <small>${hint}</small>
            <button class="nf-link-btn" type="button" data-action="cancel-placement">Cancel</button>
          </div>
        ` : ""}
      </section>
    `;
  }

  renderTracker(state, derived) {
    if (this.isCompact() || !this.trackerOpen) {
      return "";
    }

    return `
      <aside class="nf-tracker frame">
        ${this.renderTrackerBody(state, derived)}
      </aside>
    `;
  }

  renderTrackerBody(state, derived) {
    const timers = this.collectTimers(state, derived);
    return `
      <div class="nf-tracker-head">
        <span class="eyebrow">Objective</span>
        <h2>${derived.activeObjective.title}</h2>
        <p>${derived.activeObjective.detail}</p>
      </div>
      <div class="nf-tracker-grid">
        <article><span>Tier</span><strong>${state.city.tier}</strong></article>
        <article><span>Population</span><strong>${Math.round(derived.population)}/${Math.round(derived.housing)}</strong></article>
        <article><span>Control</span><strong>${Math.round(state.world.control)}%</strong></article>
        <article><span>Threat</span><strong>${Math.round(state.world.threat)}%</strong></article>
      </div>
      <div class="nf-tracker-timers">
        <span class="eyebrow">Timers</span>
        ${timers.length
          ? timers.map((item) => `<div class="nf-timer-row"><strong>${item.label}</strong><small>${item.detail}</small></div>`).join("")
          : `<div class="nf-timer-row"><strong>All clear</strong><small>No active timers</small></div>`}
      </div>
    `;
  }

  collectTimers(state, derived) {
    return [
      ...(state.research.activeId ? [{
        label: `Research ${derived.availableResearch.find((item) => item.active)?.definition.name || state.research.activeId}`,
        detail: fmtTime(Math.max(0, state.research.activeEndsAt - Date.now())),
      }] : []),
      ...(state.training.unitId ? [{
        label: `Training ${derived.trainingDef?.name || state.training.unitId}`,
        detail: fmtTime(derived.trainingRemainingMs),
      }] : []),
      ...derived.buildings.filter((entry) => entry.busyRemainingMs > 0).slice(0, 2).map((entry) => ({
        label: entry.definition.name,
        detail: fmtTime(entry.busyRemainingMs),
      })),
      ...derived.worldNodes.filter((entry) => entry.cooldownRemainingMs > 0).slice(0, 2).map((entry) => ({
        label: entry.definition.name,
        detail: fmtTime(entry.cooldownRemainingMs),
      })),
    ];
  }

  renderSheet(state, derived) {
    if (state.ui.placementTypeId || state.ui.relocatingBuildingId) {
      return "";
    }

    if (state.currentView === "world") {
      return this.renderWorldSheet(state, derived);
    }

    const selectedCell = derived.cells.find((cell) => cell.id === state.selectedCellId);
    if (selectedCell && !derived.selectedBuilding) {
      return this.renderCellSheet(derived, selectedCell);
    }

    return this.renderBuildingSheet(state, derived);
  }

  renderWorldSheet(state, derived) {
    const node = derived.selectedNode;
    if (!node) {
      return "";
    }

    const meta = KIND_META[node.definition.kind] || { label: titleCase(node.definition.kind), color: "#7febff" };
    return `
      <section class="nf-sheet frame" style="--sheet-accent:${meta.color}">
        <div class="nf-sheet-head">
          <div>
            <span class="eyebrow">${meta.label}</span>
            <h3>${node.definition.name}</h3>
            <p>${node.definition.detail}</p>
          </div>
          <button class="nf-icon-btn small" type="button" data-action="switch-view" data-view="city" aria-label="Enter city">${icon("city")}</button>
        </div>
        <div class="nf-sheet-chips">${bundleMarkup(node.definition.reward)}</div>
        <div class="nf-sheet-stats">
          <span>Enemy ${fmtNumber(node.definition.enemyPower)}</span>
          <span>Squad ${fmtNumber(derived.squadPower)}</span>
          <span>${node.definition.sector === 1 ? "Near city" : `Sector ${node.definition.sector}`}</span>
        </div>
        <div class="nf-sheet-actions">
          <button class="nf-action primary" type="button" data-action="open-mission" data-node-id="${node.state.id}" ${node.ready ? "" : "disabled"}>
            ${node.locked ? "Locked" : node.cooldownRemainingMs ? `Cooldown ${fmtTime(node.cooldownRemainingMs)}` : "Launch skirmish"}
          </button>
          <div class="nf-inline-actions">
            ${FORMATION_DEFS.map((formation) => `
              <button class="nf-inline-card ${state.ui.missionFormation === formation.id ? "active" : ""}" type="button" data-action="formation" data-formation-id="${formation.id}">
                <strong>${formation.name}</strong>
                <small>${formation.offense.toFixed(2)}x atk | ${formation.defense.toFixed(2)}x def</small>
              </button>
            `).join("")}
          </div>
        </div>
      </section>
    `;
  }

  renderCellSheet(derived, cell) {
    const recommendations = derived.buildChoices
      .filter((choice) => !choice.definition.allowedZones?.length || choice.definition.allowedZones.includes(cell.zone))
      .slice(0, this.isCompact() ? 2 : 3);
    const zone = ZONE_META[cell.zone];

    return `
      <section class="nf-sheet frame" style="--sheet-accent:${zone?.accent || "#84ffca"}">
        <div class="nf-sheet-head">
          <div>
            <span class="eyebrow">Open plot</span>
            <h3>${zone?.label || titleCase(cell.zone)}</h3>
            <p>Select a structure to start this block. Production and support buildings unlock new loops as your tier rises.</p>
          </div>
          <button class="nf-icon-btn small" type="button" data-action="toggle-build-palette" aria-label="Open build menu">${icon("build")}</button>
        </div>
        <div class="nf-inline-actions">
          ${recommendations.map((choice) => `
            <button class="nf-inline-card ${choice.buildable ? "" : "locked"}" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
              <strong>${choice.definition.name}</strong>
              <small>${GROUP_META[choice.definition.group]?.label || titleCase(choice.definition.group)}</small>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  renderBuildingSheet(state, derived) {
    const selected = derived.selectedBuilding;
    if (!selected) {
      return "";
    }

    const accent = selected.definition.accent || GROUP_META[selected.definition.group]?.color || "#84ffca";
    const status = selected.busyRemainingMs > 0
      ? fmtTime(selected.busyRemainingMs)
      : selected.cooldownRemainingMs > 0
        ? `Cooldown ${fmtTime(selected.cooldownRemainingMs)}`
        : "Ready";
    const extra = this.renderBuildingExtras(state, derived, selected);

    return `
      <section class="nf-sheet frame" style="--sheet-accent:${accent}">
        <div class="nf-sheet-head">
          <div>
            <span class="eyebrow">${GROUP_META[selected.definition.group]?.label || titleCase(selected.definition.group)}</span>
            <h3>${selected.definition.name}</h3>
            <p>${selected.definition.description}</p>
          </div>
          <div class="nf-sheet-head-actions">
            ${!selected.building.anchorId ? `<button class="nf-icon-btn small" type="button" data-action="relocate-building" data-instance-id="${selected.building.instanceId}" aria-label="Relocate building">${icon("build")}</button>` : ""}
            <button class="nf-icon-btn small" type="button" data-action="toggle-build-palette" aria-label="Open build menu">${icon("build")}</button>
          </div>
        </div>
        <div class="nf-sheet-chips">
          ${rateMarkup(selected.definition.outputPerSec)}
          <span class="nf-chip plain">Lv ${selected.building.level}</span>
          <span class="nf-chip plain">${selected.building.anchorId ? "Anchor" : ZONE_META[selected.position.zone]?.label || titleCase(selected.position.zone || "core")}</span>
          <span class="nf-chip plain">${status}</span>
        </div>
        <div class="nf-sheet-actions">
          ${selected.definition.action && !["research-lab", "vanguard-barracks", "operative-hub"].includes(selected.definition.id) ? `
            <button class="nf-action primary" type="button" data-action="building-action" data-instance-id="${selected.building.instanceId}" ${selected.cooldownRemainingMs > 0 || selected.busyRemainingMs > 0 ? "disabled" : ""}>
              ${selected.cooldownRemainingMs > 0 ? `Cooldown ${fmtTime(selected.cooldownRemainingMs)}` : selected.definition.action.label}
            </button>
          ` : ""}
          <button class="nf-action" type="button" data-action="upgrade-building" data-instance-id="${selected.building.instanceId}" ${selected.canUpgrade ? "" : "disabled"}>
            ${selected.canUpgrade ? "Upgrade" : selected.building.level >= selected.definition.maxLevel ? "Max level" : "Locked"}
          </button>
        </div>
        ${extra}
      </section>
    `;
  }

  renderBuildingExtras(state, derived, selected) {
    if (selected.definition.id === "research-lab") {
      return `
        <div class="nf-inline-actions">
          ${derived.availableResearch.filter((item) => !item.completed).slice(0, 3).map((item) => `
            <button class="nf-inline-card ${item.locked || item.active ? "locked" : ""}" type="button" data-action="start-research" data-research-id="${item.definition.id}" ${item.locked || item.active ? "disabled" : ""}>
              <strong>${item.definition.name}</strong>
              <small>${item.active ? fmtTime(Math.max(0, state.research.activeEndsAt - Date.now())) : item.locked ? "Locked" : "Start research"}</small>
            </button>
          `).join("")}
        </div>
      `;
    }

    if (selected.definition.id === "vanguard-barracks") {
      return `
        <div class="nf-inline-actions">
          ${UNIT_DEFS.map((unit) => `
            <button class="nf-inline-card ${state.training.unitId ? "locked" : ""}" type="button" data-action="queue-training" data-unit-id="${unit.id}" ${state.training.unitId ? "disabled" : ""}>
              <strong>${unit.name}</strong>
              <small>${unit.batch} units in ${fmtTime(unit.timeMs)}</small>
            </button>
          `).join("")}
        </div>
      `;
    }

    if (selected.definition.id === "operative-hub") {
      return `
        <div class="nf-inline-actions">
          ${derived.operatives.slice(0, 3).map((entry) => `
            <button class="nf-inline-card" type="button" data-action="${entry.state.recruited ? "promote-operative" : "recruit-operative"}" data-operative-id="${entry.state.id}">
              <strong>${entry.definition.name}</strong>
              <small>${entry.state.recruited ? `Rank ${entry.state.rank}` : "Recruit"}</small>
            </button>
          `).join("")}
        </div>
      `;
    }

    const incident = state.incidents[0];
    if ((selected.definition.id === "command-nexus" || selected.definition.id === "commons-hall") && incident) {
      const template = INCIDENT_TEMPLATES.find((entry) => entry.id === incident.templateId);
      return `
        <div class="nf-inline-actions">
          <button class="nf-inline-card" type="button" data-action="resolve-incident" data-incident-id="${incident.id}" data-choice="primary">
            <strong>${template?.primaryLabel || "Primary"}</strong>
            <small>${template?.title || "Incident"}</small>
          </button>
          <button class="nf-inline-card" type="button" data-action="resolve-incident" data-incident-id="${incident.id}" data-choice="secondary">
            <strong>${template?.secondaryLabel || "Secondary"}</strong>
            <small>${template?.title || "Incident"}</small>
          </button>
        </div>
      `;
    }

    return "";
  }

  renderBottomNav(state, derived) {
    const buildable = derived.buildChoices.filter((choice) => choice.buildable).length;
    const readyNodes = derived.worldNodes.filter((node) => node.ready).length;
    return `
      <nav class="nf-bottom-dock frame" aria-label="Game navigation">
        <button class="nf-dock-btn ${state.currentView === "world" ? "active" : ""}" type="button" data-action="switch-view" data-view="world">
          ${icon("world")}
          <strong>Map</strong>
          ${readyNodes ? `<span class="nf-badge">${readyNodes}</span>` : ""}
        </button>
        <button class="nf-dock-btn ${state.currentView === "city" ? "active" : ""}" type="button" data-action="switch-view" data-view="city">
          ${icon("city")}
          <strong>City</strong>
        </button>
        <button class="nf-dock-btn ${this.buildPaletteOpen ? "active" : ""}" type="button" data-action="toggle-build-palette">
          ${icon("build")}
          <strong>Build</strong>
          ${buildable ? `<span class="nf-badge">${buildable}</span>` : ""}
        </button>
        <button class="nf-dock-btn" type="button" data-action="focus-building-type" data-type-id="research-lab">
          ${icon("lab")}
          <strong>Lab</strong>
        </button>
        <button class="nf-dock-btn" type="button" data-action="focus-building-type" data-type-id="operative-hub">
          ${icon("crew")}
          <strong>Crew</strong>
        </button>
      </nav>
    `;
  }

  renderOverlay(state, derived, missionRun) {
    const parts = [];
    if (this.buildPaletteOpen && state.currentView === "city") {
      parts.push(this.renderBuildPalette(derived));
    }
    if (this.trackerOpen && this.isCompact()) {
      parts.push(`
        <div class="nf-overlay-backdrop">
          <section class="nf-overlay-panel frame nf-overlay-tracker">
            <div class="nf-overlay-head">
              <div>
                <span class="eyebrow">Progress</span>
                <h3>Tracker</h3>
              </div>
              <button class="nf-icon-btn small" type="button" data-action="toggle-tracker" aria-label="Close tracker">${icon("close")}</button>
            </div>
            ${this.renderTrackerBody(state, derived)}
          </section>
        </div>
      `);
    }
    if (missionRun) {
      parts.push(this.renderMissionOverlay(derived, missionRun));
    }
    return parts.join("");
  }

  renderBuildPalette(derived) {
    const choices = [...derived.buildChoices].sort((left, right) => Number(right.buildable) - Number(left.buildable) || left.definition.unlockTier - right.definition.unlockTier);
    return `
      <div class="nf-overlay-backdrop">
        <section class="nf-overlay-panel frame nf-build-panel">
          <div class="nf-overlay-head">
            <div>
              <span class="eyebrow">Construction</span>
              <h3>Build Menu</h3>
            </div>
            <button class="nf-icon-btn small" type="button" data-action="toggle-build-palette" aria-label="Close build menu">${icon("close")}</button>
          </div>
          <div class="nf-build-grid">
            ${choices.map((choice) => `
              <button class="nf-build-card ${choice.buildable ? "" : "locked"}" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
                <div class="nf-build-card-head">
                  <strong>${choice.definition.name}</strong>
                  <small>${GROUP_META[choice.definition.group]?.label || titleCase(choice.definition.group)} | ${choice.count}/${choice.definition.limit}</small>
                </div>
                <div class="nf-build-card-zones">
                  ${(choice.definition.allowedZones || Object.keys(ZONE_META)).map((zoneId) => `<span>${ZONE_META[zoneId]?.label || titleCase(zoneId)}</span>`).join("")}
                </div>
                <div class="nf-build-card-cost">${bundleMarkup(choice.definition.buildCost)}</div>
              </button>
            `).join("")}
          </div>
        </section>
      </div>
    `;
  }

  renderMissionOverlay(derived, missionRun) {
    const node = derived.worldNodes.find((entry) => entry.state.id === missionRun.nodeId) || derived.selectedNode;
    const playerPct = missionRun.playerMaxHp ? (missionRun.playerHp / missionRun.playerMaxHp) * 100 : 0;
    const enemyPct = missionRun.enemyMaxHp ? (missionRun.enemyHp / missionRun.enemyMaxHp) * 100 : 0;

    return `
      <div class="nf-overlay-backdrop">
        <section class="nf-overlay-panel frame nf-mission-panel">
          <div class="nf-overlay-head">
            <div>
              <span class="eyebrow">Skirmish</span>
              <h3>${node?.definition.name || "Mission"}</h3>
            </div>
            <button class="nf-icon-btn small" type="button" data-action="dismiss-mission" ${missionRun.running && !missionRun.resolved ? "disabled" : ""}>${icon("close")}</button>
          </div>
          <div class="nf-battle-bar">
            <span>Squad</span>
            <div><i style="width:${playerPct}%"></i></div>
            <strong>${fmtNumber(missionRun.playerHp)} / ${fmtNumber(missionRun.playerMaxHp)}</strong>
          </div>
          <div class="nf-battle-bar enemy">
            <span>Enemy</span>
            <div><i style="width:${enemyPct}%"></i></div>
            <strong>${fmtNumber(missionRun.enemyHp)} / ${fmtNumber(missionRun.enemyMaxHp)}</strong>
          </div>
          <div class="nf-inline-actions">
            ${missionRun.squadIds.map((operativeId) => {
              const operative = derived.operatives.find((entry) => entry.state.id === operativeId);
              return `
                <button class="nf-inline-card" type="button" data-action="mission-ability" data-operative-id="${operativeId}" ${(missionRun.running && !missionRun.abilityUses[operativeId] && !missionRun.resolved) ? "" : "disabled"}>
                  <strong>${operative?.definition.abilityLabel || "Ability"}</strong>
                  <small>${operative?.definition.name || operativeId}</small>
                </button>
              `;
            }).join("")}
          </div>
          <div class="nf-mission-log">
            ${missionRun.log.slice(0, 5).map((entry) => `<div class="nf-log-line ${entry.tone}">${entry.text}</div>`).join("")}
          </div>
          ${!missionRun.running && !missionRun.resolved ? `<button class="nf-action primary wide" type="button" data-action="start-mission">Start skirmish</button>` : ""}
        </section>
      </div>
    `;
  }

  attachCanvas() {
    const canvas = this.document.getElementById("nfSceneCanvas");
    if (!canvas) {
      return;
    }

    if (this.canvas !== canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      canvas.addEventListener("pointerdown", this.boundPointerDown);
      canvas.addEventListener("pointermove", this.boundPointerMove);
      canvas.addEventListener("pointerup", this.boundPointerUp);
      canvas.addEventListener("pointerleave", this.boundPointerUp);
      canvas.addEventListener("pointercancel", this.boundPointerCancel);
      canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = this.window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.viewport = {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      dpr,
    };
  }

  handlePointerDown(event) {
    if (!this.lastState || !this.canvas) {
      return;
    }
    this.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: this.camera[this.lastState.currentView].x,
      cameraY: this.camera[this.lastState.currentView].y,
      dragging: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  handlePointerMove(event) {
    if (!this.pointer || !this.lastState || event.pointerId !== this.pointer.id) {
      return;
    }
    const view = this.lastState.currentView;
    const camera = this.camera[view];
    const dx = event.clientX - this.pointer.startX;
    const dy = event.clientY - this.pointer.startY;
    if (!this.pointer.dragging && Math.hypot(dx, dy) > 8) {
      this.pointer.dragging = true;
    }
    if (!this.pointer.dragging) {
      return;
    }
    camera.x = this.pointer.cameraX - dx / camera.scale;
    camera.y = this.pointer.cameraY - dy / camera.scale;
    this.clampCamera(view);
    this.draw();
  }

  handlePointerUp(event) {
    if (!this.pointer || !this.lastState || event.pointerId !== this.pointer.id) {
      return;
    }
    const wasDragging = this.pointer.dragging;
    this.pointer = null;
    if (!wasDragging) {
      this.handleSceneTap(event.clientX, event.clientY);
    }
  }

  handleWheel(event) {
    if (!this.lastState || !this.canvas) {
      return;
    }
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.bumpZoom(this.lastState.currentView, event.deltaY < 0 ? 0.12 : -0.12, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  handleSceneTap(clientX, clientY) {
    const hit = this.getSceneHit(clientX, clientY);
    if (!hit) {
      this.handlers.onClearSelection?.();
      return;
    }

    if (this.lastState.currentView === "world") {
      if (hit.kind === "city") {
        this.handlers.onSwitchView("city");
        return;
      }
      if (hit.kind === "node") {
        this.handlers.onSelectNode(hit.nodeId);
      }
      return;
    }

    if (hit.kind === "building") {
      this.handlers.onSelectBuilding(hit.instanceId);
      return;
    }

    if (hit.kind === "cell") {
      this.handlers.onSelectCell(hit.cellId);
      return;
    }

    this.handlers.onClearSelection?.();
  }

  getSceneHit(clientX, clientY) {
    const point = this.scenePointFromClient(clientX, clientY);
    if (!point || !this.lastDerived) {
      return null;
    }

    if (this.lastState.currentView === "world") {
      const hub = percentPoint(SCENE_SIZES.world, WORLD_HUB);
      if (distance(point.sceneX, point.sceneY, hub.x, hub.y) <= 54) {
        return { kind: "city" };
      }
      for (const node of [...this.lastDerived.worldNodes].reverse()) {
        if (!node.state.discovered && node.definition.sector > this.lastState.world.sectorsUnlocked + 1) {
          continue;
        }
        const position = percentPoint(SCENE_SIZES.world, node.definition);
        const radius = node.definition.kind === "landmark" ? 38 : 28;
        if (distance(point.sceneX, point.sceneY, position.x, position.y) <= radius) {
          return { kind: "node", nodeId: node.state.id };
        }
      }
      return null;
    }

    const sortedBuildings = [...this.lastDerived.buildings].sort((left, right) => right.position.y - left.position.y);
    for (const entry of sortedBuildings) {
      const position = percentPoint(SCENE_SIZES.city, entry.position);
      const radius = entry.building.anchorId ? 78 : 64;
      if (distance(point.sceneX, point.sceneY, position.x, position.y - 24) <= radius) {
        return { kind: "building", instanceId: entry.building.instanceId };
      }
    }

    for (const cell of this.lastDerived.cells) {
      if (!cell.unlocked) {
        continue;
      }
      const position = percentPoint(SCENE_SIZES.city, cell);
      const dx = Math.abs(point.sceneX - position.x) / (CITY_TILE.width / 2);
      const dy = Math.abs(point.sceneY - position.y) / (CITY_TILE.height / 2);
      if (dx + dy <= 1) {
        return { kind: "cell", cellId: cell.id };
      }
    }

    return null;
  }

  scenePointFromClient(clientX, clientY) {
    if (!this.canvas || !this.lastState) {
      return null;
    }
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const camera = this.camera[this.lastState.currentView];
    return {
      localX,
      localY,
      sceneX: camera.x + localX / camera.scale,
      sceneY: camera.y + localY / camera.scale,
    };
  }

  getMinScale(view) {
    const scene = SCENE_SIZES[view];
    const fit = Math.min(this.viewport.width / scene.width, this.viewport.height / scene.height);
    return fit * 0.8;
  }

  getMaxScale(view) {
    return view === "city" ? 2.5 : 2.2;
  }

  getDefaultScale(view) {
    const scene = SCENE_SIZES[view];
    const cover = Math.max(this.viewport.width / scene.width, this.viewport.height / scene.height);
    const multiplier = view === "city"
      ? (this.isCompact() ? 1.08 : 1.02)
      : (this.isCompact() ? 1.02 : 1);
    return clamp(cover * multiplier, this.getMinScale(view), this.getMaxScale(view));
  }

  getDefaultFocus(view) {
    if (view === "city") {
      return { x: 50, y: 54 };
    }
    return { x: 48, y: 56 };
  }

  ensureCamera(view) {
    if (!this.camera[view].initialized) {
      this.resetCamera(view);
    }
    this.clampCamera(view);
  }

  resetCamera(view) {
    const camera = this.camera[view];
    camera.scale = this.getDefaultScale(view);
    camera.initialized = true;
    const focus = this.getDefaultFocus(view);
    this.centerOnPercent(view, focus.x, focus.y);
  }

  centerOnPercent(view, xPct, yPct) {
    const scene = SCENE_SIZES[view];
    const camera = this.camera[view];
    const sceneX = (xPct / 100) * scene.width;
    const sceneY = (yPct / 100) * scene.height;
    camera.x = sceneX - this.viewport.width / (2 * camera.scale);
    camera.y = sceneY - this.viewport.height / (2 * camera.scale);
    this.clampCamera(view);
  }

  clampCamera(view) {
    const scene = SCENE_SIZES[view];
    const camera = this.camera[view];
    const visibleWidth = this.viewport.width / camera.scale;
    const visibleHeight = this.viewport.height / camera.scale;
    const maxX = Math.max(0, scene.width - visibleWidth);
    const maxY = Math.max(0, scene.height - visibleHeight);
    camera.x = visibleWidth >= scene.width ? (scene.width - visibleWidth) / 2 : clamp(camera.x, 0, maxX);
    camera.y = visibleHeight >= scene.height ? (scene.height - visibleHeight) / 2 : clamp(camera.y, 0, maxY);
  }

  bumpZoom(view, delta, origin = { x: this.viewport.width / 2, y: this.viewport.height / 2 }) {
    const camera = this.camera[view];
    const nextScale = clamp(camera.scale + delta, this.getMinScale(view), this.getMaxScale(view));
    if (Math.abs(nextScale - camera.scale) < 0.001) {
      return;
    }
    const worldX = camera.x + origin.x / camera.scale;
    const worldY = camera.y + origin.y / camera.scale;
    camera.scale = nextScale;
    camera.x = worldX - origin.x / camera.scale;
    camera.y = worldY - origin.y / camera.scale;
    camera.initialized = true;
    this.clampCamera(view);
    this.draw();
  }

  draw() {
    if (!this.ctx || !this.lastState || !this.canvas) {
      return;
    }

    this.attachCanvas();
    const view = this.lastState.currentView;
    this.ensureCamera(view);
    const camera = this.camera[view];
    const scene = SCENE_SIZES[view];
    const ctx = this.ctx;

    ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    ctx.fillStyle = view === "world" ? "#07101d" : "#090713";
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    this.drawSceneBackdrop(ctx, view, scene);
    if (view === "world") {
      this.drawWorld(ctx);
    } else {
      this.drawCity(ctx);
    }
    ctx.restore();

    const vignette = ctx.createRadialGradient(
      this.viewport.width * 0.5,
      this.viewport.height * 0.45,
      this.viewport.width * 0.18,
      this.viewport.width * 0.5,
      this.viewport.height * 0.5,
      this.viewport.width * 0.68,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(4,4,10,0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
  }

  drawSceneBackdrop(ctx, view, scene) {
    const gradient = ctx.createLinearGradient(0, 0, scene.width, scene.height);
    if (view === "world") {
      gradient.addColorStop(0, "#102036");
      gradient.addColorStop(0.55, "#0b1630");
      gradient.addColorStop(1, "#070d1d");
    } else {
      gradient.addColorStop(0, "#221334");
      gradient.addColorStop(0.5, "#120d24");
      gradient.addColorStop(1, "#090711");
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, scene.width, scene.height);

    const image = this.images[view];
    if (image.complete && image.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.drawImage(image, 0, 0, scene.width, scene.height);
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = view === "world" ? "rgba(127, 235, 255, 0.06)" : "rgba(255, 154, 104, 0.06)";
    ctx.lineWidth = 1;
    const step = view === "world" ? 140 : 120;
    for (let x = 0; x <= scene.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scene.height);
      ctx.stroke();
    }
    for (let y = 0; y <= scene.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(scene.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWorld(ctx) {
    const scene = SCENE_SIZES.world;
    const hub = percentPoint(scene, WORLD_HUB);
    const time = Date.now() / 700;

    ctx.save();
    ctx.lineWidth = 3;
    this.lastDerived.worldNodes.forEach((node) => {
      if (!node.state.discovered) {
        return;
      }
      const point = percentPoint(scene, node.definition);
      const meta = KIND_META[node.definition.kind] || KIND_META.relay;
      ctx.strokeStyle = alphaColor(meta.color, node.ready ? 0.28 : 0.12);
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    });
    ctx.restore();

    ctx.save();
    ctx.translate(hub.x, hub.y);
    const pulse = 1 + Math.sin(time) * 0.04;
    ctx.fillStyle = "rgba(255, 154, 104, 0.16)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 112 * pulse, 66 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    diamondPath(ctx, 0, 0, 120, 62);
    ctx.fillStyle = "rgba(255, 154, 104, 0.22)";
    ctx.strokeStyle = "rgba(255, 210, 160, 0.8)";
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    roundedRect(ctx, -28, -62, 56, 84, 18);
    const towerGradient = ctx.createLinearGradient(0, -62, 0, 22);
    towerGradient.addColorStop(0, "#ffd9b2");
    towerGradient.addColorStop(1, "#ff8b5a");
    ctx.fillStyle = towerGradient;
    ctx.shadowColor = "rgba(255, 154, 104, 0.6)";
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    if (!this.lastDerived.selectedNode) {
      this.drawTag(ctx, hub.x, hub.y + 86, "Your City", "Return to build");
    }

    this.lastDerived.worldNodes.forEach((node) => {
      const meta = KIND_META[node.definition.kind] || KIND_META.relay;
      const point = percentPoint(scene, node.definition);
      const selected = this.lastState.selectedNodeId === node.state.id;
      const radius = node.definition.kind === "landmark" ? 32 : 24;
      const opacity = node.locked ? 0.28 : node.state.discovered ? 1 : 0.12;

      ctx.save();
      ctx.translate(point.x, point.y);

      if (node.ready) {
        const wave = 1 + Math.sin(time + point.x * 0.01) * 0.08;
        ctx.strokeStyle = alphaColor(meta.color, 0.36);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.6 * wave, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = alphaColor(meta.color, 0.16 * opacity);
      ctx.strokeStyle = alphaColor(meta.color, selected ? 0.95 : 0.72 * opacity);
      ctx.lineWidth = selected ? 4 : 2.5;
      roundedRect(ctx, -radius, -radius, radius * 2, radius * 2, 8);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-Math.PI / 4);

      ctx.fillStyle = alphaColor(meta.color, opacity);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.36, 0, Math.PI * 2);
      ctx.fill();

      if (selected) {
        ctx.strokeStyle = alphaColor("#ffffff", 0.48);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.28, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      if (selected) {
        this.drawTag(
          ctx,
          point.x,
          point.y - 64,
          node.definition.name,
          `${meta.label} | ${fmtNumber(node.definition.enemyPower)} enemy`,
          meta.color,
        );
      }
    });
  }

  drawCity(ctx) {
    const scene = SCENE_SIZES.city;
    const unlocked = new Set(this.lastState.city.unlockedZones);

    CITY_PARCELS.forEach((parcel) => {
      const parcelCells = this.lastDerived.cells.filter((cell) => cell.parcelId === parcel.id);
      const parcelUnlocked = unlocked.has(parcel.zone);
      const accent = ZONE_META[parcel.zone]?.accent || "#84ffca";
      ctx.save();
      ctx.globalAlpha = parcelUnlocked ? 1 : 0.5;
      parcelCells.forEach((cell) => {
        const point = percentPoint(scene, cell);
        ctx.fillStyle = alphaColor(accent, cell.canPlace ? 0.26 : cell.occupied ? 0.12 : parcelUnlocked ? 0.07 : 0.03);
        ctx.strokeStyle = alphaColor(accent, cell.canPlace ? 0.72 : parcelUnlocked ? 0.18 : 0.08);
        ctx.lineWidth = cell.canPlace ? 3 : 1.5;
        ctx.setLineDash(parcelUnlocked ? [] : [8, 10]);
        diamondPath(ctx, point.x, point.y, CITY_TILE.width, CITY_TILE.height);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      });
      ctx.restore();

      if (!this.isCompact() || !parcelUnlocked) {
        const labelPoint = percentPoint(scene, {
          x: parcel.startX + (parcel.cols * parcel.stepX) * 0.4,
          y: parcel.startY - 4,
        });
        this.drawTag(
          ctx,
          labelPoint.x,
          labelPoint.y,
          ZONE_META[parcel.zone]?.label || titleCase(parcel.zone),
          parcelUnlocked ? "Unlocked district" : `Unlocks at tier ${ZONE_META[parcel.zone]?.unlockTier || 1}`,
          accent,
        );
      }
    });

    const buildings = [...this.lastDerived.buildings].sort((left, right) => left.position.y - right.position.y);
    buildings.forEach((entry) => {
      this.drawBuilding(ctx, entry, this.lastState.selectedBuildingId === entry.building.instanceId);
    });

    const selectedCell = this.lastDerived.cells.find((cell) => cell.id === this.lastState.selectedCellId);
    if (selectedCell) {
      const point = percentPoint(scene, selectedCell);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 3;
      diamondPath(ctx, point.x, point.y, CITY_TILE.width + 10, CITY_TILE.height + 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBuilding(ctx, entry, selected) {
    const scene = SCENE_SIZES.city;
    const point = percentPoint(scene, entry.position);
    const skin = BUILDING_SKINS[entry.definition.id] || { silhouette: "hub", hue: 200 };
    const accent = entry.definition.accent || `hsl(${skin.hue} 92% 72%)`;
    const dark = `hsl(${skin.hue} 70% 32%)`;
    const light = `hsl(${skin.hue} 90% 84%)`;

    ctx.save();
    ctx.translate(point.x, point.y);

    ctx.fillStyle = alphaColor(accent, selected ? 0.28 : 0.16);
    ctx.beginPath();
    ctx.ellipse(0, 20, selected ? 82 : 70, selected ? 32 : 26, 0, 0, Math.PI * 2);
    ctx.fill();

    diamondPath(ctx, 0, 12, 114, 56);
    ctx.fillStyle = alphaColor(dark, 0.9);
    ctx.strokeStyle = alphaColor(light, 0.4);
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = alphaColor(accent, 0.5);
    ctx.shadowBlur = selected ? 28 : 18;
    this.drawBuildingSilhouette(ctx, skin.silhouette, accent, dark, light);
    ctx.shadowBlur = 0;

    if (entry.busyRemainingMs > 0) {
      this.drawTag(ctx, 0, -96, entry.definition.name, fmtTime(entry.busyRemainingMs), accent);
    } else if (selected) {
      this.drawTag(ctx, 0, -96, entry.definition.name, `Lv ${entry.building.level}`, accent);
    }

    ctx.fillStyle = alphaColor("#05030b", 0.88);
    ctx.strokeStyle = alphaColor(light, 0.44);
    ctx.lineWidth = 1.5;
    roundedRect(ctx, -44, -22, 34, 22, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 13px Sora, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Lv ${entry.building.level}`, -27, -11);

    if (selected) {
      ctx.strokeStyle = alphaColor("#ffffff", 0.55);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, 10, 84, 34, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawBuildingSilhouette(ctx, silhouette, accent, dark, light) {
    const vertical = ctx.createLinearGradient(0, -100, 0, 10);
    vertical.addColorStop(0, light);
    vertical.addColorStop(1, accent);
    ctx.fillStyle = vertical;
    ctx.strokeStyle = alphaColor("#ffffff", 0.3);
    ctx.lineWidth = 1.5;

    switch (silhouette) {
      case "spire":
        roundedRect(ctx, -20, -94, 40, 98, 16);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -126);
        ctx.lineTo(18, -94);
        ctx.lineTo(-18, -94);
        ctx.closePath();
        ctx.fill();
        break;
      case "relay":
        roundedRect(ctx, -32, -58, 64, 54, 16);
        ctx.fill();
        ctx.stroke();
        roundedRect(ctx, -8, -118, 16, 68, 8);
        ctx.fill();
        ctx.stroke();
        break;
      case "hub":
        roundedRect(ctx, -44, -52, 88, 48, 18);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -52, 24, Math.PI, Math.PI * 2);
        ctx.fill();
        break;
      case "hab":
        roundedRect(ctx, -42, -56, 84, 50, 22);
        ctx.fill();
        ctx.stroke();
        break;
      case "farm":
        [-48, -24, 0].forEach((offset, index) => {
          roundedRect(ctx, -42 + index * 6, offset - 36, 84 - index * 12, 18, 9);
          ctx.fill();
          ctx.stroke();
        });
        break;
      case "water":
        roundedRect(ctx, -28, -72, 56, 68, 20);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = alphaColor("#ffffff", 0.2);
        roundedRect(ctx, -18, -58, 36, 26, 10);
        ctx.fill();
        break;
      case "solar":
        roundedRect(ctx, -48, -40, 96, 20, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dark;
        roundedRect(ctx, -12, -20, 24, 16, 7);
        ctx.fill();
        break;
      case "forge":
        roundedRect(ctx, -26, -86, 52, 82, 14);
        ctx.fill();
        ctx.stroke();
        roundedRect(ctx, 12, -110, 16, 40, 8);
        ctx.fill();
        break;
      case "chip":
        roundedRect(ctx, -40, -52, 80, 48, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dark;
        for (let index = -3; index <= 3; index += 1) {
          ctx.fillRect(index * 10, -58, 4, 10);
          ctx.fillRect(index * 10, -4, 4, 10);
        }
        break;
      case "med":
        roundedRect(ctx, -30, -66, 60, 62, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = alphaColor("#ffffff", 0.82);
        ctx.fillRect(-6, -46, 12, 30);
        ctx.fillRect(-15, -37, 30, 12);
        break;
      case "hall":
        roundedRect(ctx, -48, -58, 96, 52, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dark;
        roundedRect(ctx, -16, -32, 32, 26, 10);
        ctx.fill();
        break;
      case "lab":
        roundedRect(ctx, -38, -76, 28, 72, 12);
        ctx.fill();
        ctx.stroke();
        roundedRect(ctx, 10, -64, 28, 60, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = alphaColor(light, 0.65);
        roundedRect(ctx, -8, -40, 16, 12, 6);
        ctx.fill();
        break;
      case "barracks":
        roundedRect(ctx, -48, -54, 96, 50, 14);
        ctx.fill();
        ctx.stroke();
        roundedRect(ctx, -12, -84, 24, 34, 10);
        ctx.fill();
        break;
      case "drone":
        roundedRect(ctx, -52, -34, 104, 18, 9);
        ctx.fill();
        ctx.stroke();
        roundedRect(ctx, -18, -54, 36, 20, 9);
        ctx.fill();
        break;
      default:
        roundedRect(ctx, -36, -64, 72, 60, 16);
        ctx.fill();
        ctx.stroke();
        break;
    }
  }

  drawTag(ctx, x, y, line1, line2, accent = "#7febff") {
    ctx.save();
    ctx.font = "700 15px Sora, sans-serif";
    const topWidth = ctx.measureText(line1).width;
    ctx.font = "500 12px Sora, sans-serif";
    const bottomWidth = line2 ? ctx.measureText(line2).width : 0;
    const width = Math.max(topWidth, bottomWidth) + 28;
    const height = line2 ? 42 : 28;

    roundedRect(ctx, x - width / 2, y - height / 2, width, height, 14);
    ctx.fillStyle = "rgba(8, 6, 18, 0.82)";
    ctx.strokeStyle = alphaColor(accent, 0.5);
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 15px Sora, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(line1, x, y - (line2 ? 7 : 0));
    if (line2) {
      ctx.fillStyle = "rgba(220, 215, 245, 0.86)";
      ctx.font = "500 12px Sora, sans-serif";
      ctx.fillText(line2, x, y + 11);
    }
    ctx.restore();
  }
}
