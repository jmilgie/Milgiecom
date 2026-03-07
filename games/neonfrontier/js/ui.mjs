import {
  BUILDING_SKINS,
  FORMATION_DEFS,
  INCIDENT_TEMPLATES,
  RESOURCE_META,
  UNIT_DEFS,
} from "./data.mjs";
import { fmtNumber, fmtTime } from "./systems.mjs";

const SCENE_SIZES = {
  world: { width: 1800, height: 1200 },
  city: { width: 1800, height: 1300 },
};

const WORLD_KIND_META = {
  relay: { label: "Relay", accent: "#7febff", icon: "signal" },
  salvage: { label: "Salvage", accent: "#caa3ff", icon: "salvage" },
  harvest: { label: "Harvest", accent: "#ffd86f", icon: "harvest" },
  convoy: { label: "Convoy", accent: "#84ffca", icon: "convoy" },
  threat: { label: "Threat", accent: "#ff7ec7", icon: "threat" },
  landmark: { label: "Landmark", accent: "#ff9a68", icon: "landmark" },
};

const BUILD_GROUP_META = {
  command: { label: "Command", icon: "city" },
  hero: { label: "Operatives", icon: "crew" },
  support: { label: "Support", icon: "support" },
  resource: { label: "Resources", icon: "resource" },
  industry: { label: "Industry", icon: "industry" },
  science: { label: "Research", icon: "lab" },
  military: { label: "Security", icon: "guard" },
};

const ICON_PATHS = {
  world: `
    <circle cx="12" cy="12" r="7"></circle>
    <path d="M5 12h14M12 5a13 13 0 0 1 0 14M12 5a13 13 0 0 0 0 14"></path>
  `,
  city: `
    <path d="M4 20V10l8-6 8 6v10"></path>
    <path d="M9 20v-5h6v5M8 11h.01M12 11h.01M16 11h.01"></path>
  `,
  build: `
    <path d="M4 19 19 4"></path>
    <path d="m14 4 6 6"></path>
    <path d="M6 13 3 16l5 5 3-3"></path>
  `,
  lab: `
    <path d="M10 3v5l-5 9a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 17l-5-9V3"></path>
    <path d="M8 8h8M9 14h6"></path>
  `,
  crew: `
    <path d="M8 12a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM16.5 11a2.5 2.5 0 1 1 0-5"></path>
    <path d="M3.5 19a4.5 4.5 0 0 1 9 0M14 18a4 4 0 0 1 6 0"></path>
  `,
  track: `
    <rect x="5" y="4" width="14" height="16" rx="2"></rect>
    <path d="M9 2h6M8 9h8M8 13h6M8 17h4"></path>
  `,
  save: `
    <path d="M5 5h12l2 2v12H5z"></path>
    <path d="M8 5v5h8V5M9 19v-5h6v5"></path>
  `,
  focus: `
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M17 7l2-2M5 19l2-2"></path>
  `,
  zoomIn: `
    <circle cx="10" cy="10" r="5.5"></circle>
    <path d="M10 7v6M7 10h6M15 15l5 5"></path>
  `,
  zoomOut: `
    <circle cx="10" cy="10" r="5.5"></circle>
    <path d="M7 10h6M15 15l5 5"></path>
  `,
  fit: `
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
  `,
  signal: `
    <path d="M12 19V9"></path>
    <path d="M7 19a5 5 0 0 1 10 0"></path>
    <path d="M8.5 9.5a5 5 0 0 1 7 0"></path>
    <path d="M10.2 12a2.5 2.5 0 0 1 3.6 0"></path>
  `,
  salvage: `
    <path d="M4 18h16"></path>
    <path d="m7 18 2-9h6l2 9"></path>
    <path d="M9 9 8 6h8l-1 3"></path>
  `,
  harvest: `
    <path d="M12 20V9"></path>
    <path d="M8 11c0-3 2-5 4-6 2 1 4 3 4 6"></path>
    <path d="M7 15c1.5-2 3-3 5-3"></path>
    <path d="M17 15c-1.5-2-3-3-5-3"></path>
  `,
  convoy: `
    <rect x="4" y="8" width="12" height="7" rx="1.5"></rect>
    <path d="M16 10h2.5l1.5 2v3H16"></path>
    <circle cx="8" cy="17" r="2"></circle>
    <circle cx="17" cy="17" r="2"></circle>
  `,
  threat: `
    <path d="M12 3 21 19H3L12 3Z"></path>
    <path d="M12 9v4M12 17h.01"></path>
  `,
  landmark: `
    <path d="M12 3 5 7v5c0 5 3 8 7 9 4-1 7-4 7-9V7l-7-4Z"></path>
    <path d="M9 12h6M12 9v6"></path>
  `,
  support: `
    <path d="M12 4v16M4 12h16"></path>
    <circle cx="12" cy="12" r="7"></circle>
  `,
  resource: `
    <path d="M12 4c4 2.5 6 5.2 6 8a6 6 0 1 1-12 0c0-2.8 2-5.5 6-8Z"></path>
  `,
  industry: `
    <path d="M4 20V9l5 3V9l5 3V6l6 4v10"></path>
    <path d="M8 20v-4M13 20v-3M17 20v-5"></path>
  `,
  guard: `
    <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"></path>
    <path d="M10 12 11.5 13.5 14.5 10.5"></path>
  `,
  timer: `
    <circle cx="12" cy="13" r="7"></circle>
    <path d="M12 13V9M9 2h6M12 20v2"></path>
  `,
  upgrade: `
    <path d="M12 20V4"></path>
    <path d="m6 10 6-6 6 6"></path>
  `,
  launch: `
    <path d="M5 19 19 5"></path>
    <path d="M9 5h10v10"></path>
  `,
};

function iconSvg(name) {
  return `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.signal}</svg>`;
}

function titleCase(value) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function groupMeta(group) {
  return BUILD_GROUP_META[group] || { label: titleCase(group || "system"), icon: "resource" };
}

function kindMeta(kind) {
  return WORLD_KIND_META[kind] || { label: titleCase(kind || "node"), accent: "#7febff", icon: "signal" };
}

function resourceIconMarkup(key) {
  const meta = RESOURCE_META[key];
  return `<span class="resource-mark" style="--accent:${meta?.accent || "#fff"}">${meta?.short || key.slice(0, 1).toUpperCase()}</span>`;
}

function bundleMarkup(bundle = {}) {
  return Object.entries(bundle)
    .filter(([, value]) => value)
    .map(([key, value]) => `<span class="stat-chip" data-resource="${key}">${resourceIconMarkup(key)}<span>${fmtNumber(Math.abs(value))} ${RESOURCE_META[key]?.label || titleCase(key)}</span></span>`)
    .join("");
}

function rateMarkup(bundle = {}) {
  return Object.entries(bundle)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `<span class="stat-chip" data-resource="${key}">${resourceIconMarkup(key)}<span>+${value.toFixed(2)}/s ${RESOURCE_META[key].label}</span></span>`)
    .join("");
}

function statBlock(label, value, detail = "") {
  return `
    <article class="mini-stat">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </article>
  `;
}

function operativeBadge(entry) {
  return `
    <button class="squad-pill ${entry.selected ? "selected" : ""} ${entry.injuryRemainingMs > 0 ? "injured" : ""}" type="button" data-action="toggle-squad" data-operative-id="${entry.state.id}">
      <span class="orb" style="--accent:${entry.definition.accent}">${entry.definition.name.slice(0, 1)}</span>
      <span class="squad-pill-copy">
        <strong>${entry.definition.name}</strong>
        <small>${entry.definition.role} | ${Math.round(entry.power)} power${entry.injuryRemainingMs > 0 ? ` | ${fmtTime(entry.injuryRemainingMs)}` : ""}</small>
      </span>
    </button>
  `;
}

function silhouetteClass(typeId) {
  return `shape-${BUILDING_SKINS[typeId]?.silhouette || "hub"}`;
}

export class NeonFrontierUI {
  constructor(documentRef, handlers) {
    this.document = documentRef;
    this.handlers = handlers;
    this.trackerCollapsed = window.matchMedia("(max-width: 720px)").matches;
    this.buildPaletteOpen = false;
    this.lastState = null;
    this.lastDerived = null;
    this.lastMissionRun = null;
    this.camera = {
      world: { x: 0, y: 0, scale: 0.9, initialized: false },
      city: { x: 0, y: 0, scale: 1, initialized: false },
    };
    this.dragState = null;
    this.refs = {
      hud: documentRef.getElementById("hudRoot"),
      tracker: documentRef.getElementById("objectiveRoot"),
      stage: documentRef.getElementById("stageRoot"),
      panel: documentRef.getElementById("panelRoot"),
      nav: documentRef.getElementById("navRoot"),
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
      const handledLocal = this.handleLocalAction(button.dataset.action, button.dataset);
      if (handledLocal) {
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

    this.document.addEventListener("pointerdown", (event) => {
      const viewport = event.target.closest(".map-viewport");
      if (!viewport || event.target.closest("[data-action]")) {
        return;
      }
      const view = viewport.dataset.view;
      this.dragState = {
        view,
        startX: event.clientX,
        startY: event.clientY,
        baseX: this.camera[view].x,
        baseY: this.camera[view].y,
      };
      viewport.setPointerCapture?.(event.pointerId);
      viewport.classList.add("dragging");
    });

    this.document.addEventListener("pointermove", (event) => {
      if (!this.dragState) {
        return;
      }
      const view = this.dragState.view;
      this.camera[view].x = this.dragState.baseX + (event.clientX - this.dragState.startX);
      this.camera[view].y = this.dragState.baseY + (event.clientY - this.dragState.startY);
      this.syncCamera(view);
    });

    this.document.addEventListener("pointerup", () => {
      const viewport = this.document.querySelector(".map-viewport.dragging");
      viewport?.classList.remove("dragging");
      this.dragState = null;
    });

    this.document.addEventListener("pointercancel", () => {
      const viewport = this.document.querySelector(".map-viewport.dragging");
      viewport?.classList.remove("dragging");
      this.dragState = null;
    });

    this.document.addEventListener("wheel", (event) => {
      const viewport = event.target.closest(".map-viewport");
      if (!viewport) {
        return;
      }
      event.preventDefault();
      const view = viewport.dataset.view;
      this.bumpZoom(view, event.deltaY < 0 ? 0.1 : -0.1);
    }, { passive: false });

    this.document.addEventListener("keydown", (event) => {
      if (!this.lastState || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const { key } = event;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "+", "=", "-", "_", "0", "1", "2"].includes(key)) {
        return;
      }
      event.preventDefault();
      const view = this.lastState.currentView;
      switch (key) {
        case "ArrowUp":
        case "w":
          this.nudgeCamera(view, 0, 48);
          break;
        case "ArrowDown":
        case "s":
          this.nudgeCamera(view, 0, -48);
          break;
        case "ArrowLeft":
        case "a":
          this.nudgeCamera(view, 48, 0);
          break;
        case "ArrowRight":
        case "d":
          this.nudgeCamera(view, -48, 0);
          break;
        case "+":
        case "=":
          this.bumpZoom(view, 0.1);
          break;
        case "-":
        case "_":
          this.bumpZoom(view, -0.1);
          break;
        case "0":
          this.resetCamera(view);
          break;
        case "1":
          this.handlers.onSwitchView("world");
          break;
        case "2":
          this.handlers.onSwitchView("city");
          break;
        default:
          break;
      }
    });

    window.addEventListener("resize", () => {
      if (!this.lastState) {
        return;
      }
      this.syncCamera(this.lastState.currentView);
    });
  }

  handleLocalAction(action, dataset) {
    switch (action) {
      case "toggle-tracker":
        this.trackerCollapsed = !this.trackerCollapsed;
        this.refresh();
        return true;
      case "toggle-build-palette":
        this.buildPaletteOpen = !this.buildPaletteOpen;
        this.refresh();
        return true;
      case "zoom-in":
        this.bumpZoom(this.lastState?.currentView || "world", 0.1);
        return true;
      case "zoom-out":
        this.bumpZoom(this.lastState?.currentView || "world", -0.1);
        return true;
      case "reset-camera":
        this.resetCamera(this.lastState?.currentView || "world");
        return true;
      case "focus-building-type":
        this.focusBuildingType(dataset.typeId);
        return true;
      case "focus-home":
        this.focusHome();
        return true;
      case "focus-selected":
        this.focusSelected();
        return true;
      default:
        return false;
    }
  }

  isCompactViewport() {
    return window.matchMedia("(max-width: 720px)").matches;
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
    this.refs.panel.innerHTML = this.renderFloating(state, derived);
    this.refs.nav.innerHTML = this.renderBottomNav(state, derived);
    this.refs.overlay.innerHTML = this.renderOverlay(derived, missionRun);
    requestAnimationFrame(() => this.syncCamera(state.currentView));
  }

  refresh() {
    if (this.lastState && this.lastDerived) {
      this.render(this.lastState, this.lastDerived, this.lastMissionRun);
    }
  }

  renderHud(state, derived) {
    const buildableCount = derived.buildChoices.filter((choice) => choice.buildable).length;
    const compact = this.isCompactViewport();
    const resourceEntries = compact
      ? ["food", "water", "energy", "alloy", "credits", "circuits"].map((key) => [key, state.resources[key]])
      : Object.entries(state.resources);

    if (compact) {
      return `
        <header class="top-bar frame compact-hud">
          <div class="compact-topline">
            <div class="player-lockup compact">
              <div class="avatar-core">NF</div>
              <div>
                <strong>Neon Frontier</strong>
                <small>Tier ${state.city.tier} | ${fmtNumber(derived.squadPower)} power</small>
              </div>
            </div>
            <div class="top-actions compact">
              <button class="hud-icon round compact-icon ${this.trackerCollapsed ? "" : "active"}" type="button" data-action="toggle-tracker" aria-label="Toggle tracker">
                ${iconSvg("track")}
              </button>
              <button class="hud-icon round compact-icon" type="button" data-action="save" aria-label="Save game">
                ${iconSvg("save")}
              </button>
            </div>
          </div>
          <div class="compact-status-strip">
            <span class="compact-view">${state.currentView === "world" ? "Map" : "City"}</span>
            <span>${Math.round(state.city.morale)}% morale</span>
            <span>${Math.round(state.world.control)}% control</span>
            <span>${buildableCount} ready</span>
          </div>
          <div class="resource-rack compact-resource-rack">
            ${resourceEntries.map(([key, value]) => `
              <article class="resource-pill compact" data-resource="${key}">
                ${resourceIconMarkup(key)}
                <div class="resource-copy">
                  <span>${RESOURCE_META[key].label}</span>
                  <strong>${fmtNumber(value)}</strong>
                </div>
              </article>
            `).join("")}
          </div>
        </header>
      `;
    }

    return `
      <header class="top-bar frame">
        <div class="top-main">
          <div class="player-lockup">
            <div class="avatar-core">NF</div>
            <div>
              <span class="eyebrow">Milgie City Strategy</span>
              <strong>Neon Frontier</strong>
              <small>Tier ${state.city.tier} command | ${fmtNumber(derived.squadPower)} squad power</small>
            </div>
          </div>
          <div class="status-pill">
            <span>Pulse 03-02</span>
            <strong>${state.currentView === "world" ? "Frontier Map" : "City Grid"}</strong>
            <small>${Math.round(state.city.morale)}% morale | ${Math.round(state.world.control)}% control | ${buildableCount} builds ready</small>
          </div>
          <div class="top-actions">
            <button class="hud-icon utility-inline ${this.trackerCollapsed ? "" : "active"}" type="button" data-action="toggle-tracker">
              ${iconSvg("track")}
              <span class="button-label">Track</span>
            </button>
            <button class="hud-icon utility-inline" type="button" data-action="save">
              ${iconSvg("save")}
              <span class="button-label">Save</span>
            </button>
          </div>
        </div>
        <div class="resource-rack">
          ${resourceEntries.map(([key, value]) => `
            <article class="resource-pill" data-resource="${key}">
              ${resourceIconMarkup(key)}
              <div class="resource-copy">
                <span>${RESOURCE_META[key].label}</span>
                <strong>${fmtNumber(value)}</strong>
                <small>${derived.rates[key] > 0 ? `+${derived.rates[key].toFixed(2)}/s` : "stable"}</small>
              </div>
            </article>
          `).join("")}
        </div>
      </header>
    `;
  }

  renderStage(state, derived) {
    const placementActive = Boolean(state.ui.placementTypeId || state.ui.relocatingBuildingId);
    return `
      <section class="map-chassis frame">
        <div class="map-viewport" data-view="${state.currentView}">
          <div class="map-scene ${state.currentView}" data-map-scene="${state.currentView}">
            ${state.currentView === "world" ? this.renderWorldScene(derived) : this.renderCityScene(state, derived)}
          </div>
        </div>
        <div class="view-chip">${state.currentView === "world" ? "Overland" : "My City"}</div>
        ${this.renderStageControls(state)}
        ${this.renderAlertStack(derived)}
        ${this.renderMapIntel(state, derived)}
        ${placementActive ? `
          <div class="placement-chip">
            <strong>${state.ui.relocatingBuildingId ? "Tap an empty plot to relocate" : "Tap an empty plot to build"}</strong>
            <button class="hud-icon utility-inline" type="button" data-action="cancel-placement">
              ${iconSvg("threat")}
              <span class="button-label">Cancel</span>
            </button>
          </div>
        ` : ""}
      </section>
    `;
  }

  renderStageControls(state) {
    if (this.isCompactViewport()) {
      return `
        <aside class="stage-rail mobile-right">
          <div class="zoom-rail mobile">
            <button class="utility-btn compact" type="button" data-action="zoom-in" aria-label="Zoom in">
              <span class="utility-icon">${iconSvg("zoomIn")}</span>
            </button>
            <button class="utility-btn compact" type="button" data-action="zoom-out" aria-label="Zoom out">
              <span class="utility-icon">${iconSvg("zoomOut")}</span>
            </button>
            <button class="utility-btn compact" type="button" data-action="reset-camera" aria-label="Reset camera">
              <span class="utility-icon">${iconSvg("fit")}</span>
            </button>
          </div>
        </aside>
      `;
    }

    const cityShortcut = state.currentView === "city"
      ? `
        <button class="utility-btn ${this.buildPaletteOpen ? "active" : ""}" type="button" data-action="toggle-build-palette">
          <span class="utility-icon">${iconSvg("build")}</span>
          <span class="utility-copy"><strong>Build</strong><small>Palette</small></span>
        </button>
      `
      : `
        <button class="utility-btn" type="button" data-action="switch-view" data-view="city">
          <span class="utility-icon">${iconSvg("city")}</span>
          <span class="utility-copy"><strong>City</strong><small>Enter</small></span>
        </button>
      `;

    return `
      <aside class="stage-rail left">
        <button class="utility-btn ${this.trackerCollapsed ? "" : "active"}" type="button" data-action="toggle-tracker">
          <span class="utility-icon">${iconSvg("track")}</span>
          <span class="utility-copy"><strong>Tracker</strong><small>${this.trackerCollapsed ? "Open" : "Hide"}</small></span>
        </button>
        <button class="utility-btn" type="button" data-action="focus-selected">
          <span class="utility-icon">${iconSvg("focus")}</span>
          <span class="utility-copy"><strong>Focus</strong><small>Selection</small></span>
        </button>
        <button class="utility-btn" type="button" data-action="focus-home">
          <span class="utility-icon">${iconSvg("city")}</span>
          <span class="utility-copy"><strong>Home</strong><small>Center</small></span>
        </button>
        ${cityShortcut}
      </aside>
      <aside class="stage-rail right">
        <button class="utility-btn" type="button" data-action="focus-building-type" data-type-id="research-lab">
          <span class="utility-icon">${iconSvg("lab")}</span>
          <span class="utility-copy"><strong>Lab</strong><small>Research</small></span>
        </button>
        <button class="utility-btn" type="button" data-action="focus-building-type" data-type-id="operative-hub">
          <span class="utility-icon">${iconSvg("crew")}</span>
          <span class="utility-copy"><strong>Crew</strong><small>Operatives</small></span>
        </button>
        <div class="zoom-rail">
          <button class="utility-btn compact" type="button" data-action="zoom-in">
            <span class="utility-icon">${iconSvg("zoomIn")}</span>
          </button>
          <button class="utility-btn compact" type="button" data-action="zoom-out">
            <span class="utility-icon">${iconSvg("zoomOut")}</span>
          </button>
          <button class="utility-btn compact" type="button" data-action="reset-camera">
            <span class="utility-icon">${iconSvg("fit")}</span>
          </button>
        </div>
      </aside>
    `;
  }

  renderAlertStack(derived) {
    if (this.isCompactViewport()) {
      return "";
    }
    const alerts = derived.topAlerts.slice(0, 2);
    if (!alerts.length) {
      return "";
    }
    return `
      <div class="alert-stack">
        ${alerts.map((alert) => this.renderAlertCard(alert, false)).join("")}
      </div>
    `;
  }

  renderAlertCard(alert, compact) {
    const icon = (() => {
      switch (alert.tone) {
        case "science":
          return "lab";
        case "build":
          return "build";
        case "military":
          return "guard";
        case "event":
          return "landmark";
        case "save":
          return "save";
        case "offline":
          return "timer";
        default:
          return "signal";
      }
    })();
    return `
      <article class="alert-card tone-${alert.tone} ${compact ? "compact" : ""}">
        <span class="alert-icon">${iconSvg(icon)}</span>
        <div class="alert-copy">
          <strong>${alert.title}</strong>
          <small>${alert.detail}</small>
        </div>
      </article>
    `;
  }

  renderMapIntel(state, derived) {
    const view = state.currentView;
    const camera = this.camera[view];
    const selection = view === "world"
      ? derived.selectedNode
      : derived.selectedBuilding || derived.cells.find((cell) => cell.id === state.selectedCellId) || null;
    const position = view === "world"
      ? { x: selection?.definition.x || 40, y: selection?.definition.y || 78 }
      : { x: selection?.position?.x || selection?.x || 52, y: selection?.position?.y || selection?.y || 43 };
    const label = view === "world"
      ? selection?.definition?.name || "Helio City"
      : selection?.definition?.name || "Helio Core";
    const detail = view === "world"
      ? `Sector ${selection?.definition?.sector || 1}`
      : selection?.position?.zone ? titleCase(selection.position.zone) : "Anchor district";
    const zoom = Math.round((camera.scale || 1) * 100);
    return `
      <section class="map-intel frame">
        <div class="map-intel-head">
          <span class="utility-icon">${iconSvg(view === "world" ? "world" : "city")}</span>
          <div>
            <span class="eyebrow">Map Intel</span>
            <strong>${label}</strong>
          </div>
        </div>
        <div class="map-intel-grid">
          <div>
            <span>${detail}</span>
            <strong>X${Math.round(position.x * 10)} Y${Math.round(position.y * 10)}</strong>
          </div>
          <div>
            <span>Camera</span>
            <strong>${zoom}%</strong>
          </div>
        </div>
        <small>Drag to pan. Use the side controls to zoom and refocus.</small>
      </section>
    `;
  }

  renderWorldScene(derived) {
    return `
      <button class="city-hub" type="button" data-action="switch-view" data-view="city" style="left:40%;top:78%">
        <span class="city-hub-core"></span>
        <span class="marker-copy">
          <strong>Helio City</strong>
          <small>Enter city</small>
        </span>
      </button>
      ${derived.worldNodes.map((node) => `
        <button
          class="map-marker world kind-${node.definition.kind} ${derived.selectedNode?.state.id === node.state.id ? "selected" : ""} ${node.ready ? "ready" : ""} ${node.locked ? "locked" : ""}"
          type="button"
          data-action="select-node"
          data-node-id="${node.state.id}"
          data-kind="${node.definition.kind}"
          style="left:${node.definition.x}%;top:${node.definition.y}%"
        >
          <span class="marker-core"></span>
          <span class="marker-copy">
            <strong>${node.definition.name}</strong>
            <small>${node.locked ? "Locked" : node.cooldownRemainingMs ? fmtTime(node.cooldownRemainingMs) : node.state.cleared && !node.definition.repeatable ? "Secured" : "Ready"}</small>
          </span>
        </button>
      `).join("")}
    `;
  }

  renderCityScene(state, derived) {
    return `
      <div class="zone-label zone-waterfront">Waterfront</div>
      <div class="zone-label zone-core">Core Mesh</div>
      <div class="zone-label zone-spireline">Spireline</div>
      <div class="zone-label zone-market">Sky Market</div>
      ${derived.cells.filter((cell) => !cell.occupied).map((cell) => `
        <button
          class="plot-marker ${cell.unlocked ? "" : "locked"} ${cell.canPlace ? "open" : ""}"
          type="button"
          data-action="select-cell"
          data-cell-id="${cell.id}"
          style="left:${cell.x}%;top:${cell.y}%"
        >
          <span>${cell.canPlace ? "Place" : ""}</span>
        </button>
      `).join("")}
      ${derived.buildings.map((entry) => `
        <button
          class="map-marker city ${silhouetteClass(entry.definition.id)} ${derived.selectedBuilding?.building.instanceId === entry.building.instanceId ? "selected" : ""} ${entry.busyRemainingMs > 0 ? "busy" : ""}"
          type="button"
          data-action="select-building"
          data-instance-id="${entry.building.instanceId}"
          style="left:${entry.position.x}%;top:${entry.position.y}%;--hue:${BUILDING_SKINS[entry.definition.id]?.hue || 200}"
        >
          <span class="marker-tower"></span>
          <span class="marker-copy">
            <strong>${entry.definition.name}</strong>
            <small>${entry.busyRemainingMs > 0 ? fmtTime(entry.busyRemainingMs) : `Lv ${entry.building.level}`}</small>
          </span>
        </button>
      `).join("")}
    `;
  }

  renderTracker(state, derived) {
    if (this.isCompactViewport() && this.trackerCollapsed) {
      return "";
    }

    const timers = [
      ...(state.research.activeId ? [{
        label: `Research: ${derived.availableResearch.find((item) => item.active)?.definition.name || state.research.activeId}`,
        detail: fmtTime(Math.max(0, state.research.activeEndsAt - Date.now())),
      }] : []),
      ...(state.training.unitId ? [{
        label: `Training: ${derived.trainingDef?.name || state.training.unitId}`,
        detail: fmtTime(derived.trainingRemainingMs),
      }] : []),
      ...derived.buildings
        .filter((entry) => entry.busyRemainingMs > 0)
        .sort((left, right) => left.busyRemainingMs - right.busyRemainingMs)
        .slice(0, 3)
        .map((entry) => ({
          label: entry.definition.name,
          detail: fmtTime(entry.busyRemainingMs),
        })),
      ...derived.worldNodes
        .filter((entry) => entry.cooldownRemainingMs > 0)
        .sort((left, right) => left.cooldownRemainingMs - right.cooldownRemainingMs)
        .slice(0, 2)
        .map((entry) => ({
          label: entry.definition.name,
          detail: fmtTime(entry.cooldownRemainingMs),
        })),
    ];

    return `
      <aside class="tracker-shell frame ${this.trackerCollapsed ? "collapsed" : ""}">
        <button class="tracker-toggle" type="button" data-action="toggle-tracker">
          ${iconSvg("track")}
          <span>${this.trackerCollapsed ? "Open Tracker" : "Hide Tracker"}</span>
        </button>
        <div class="tracker-body">
          <section class="tracker-section">
            <span class="eyebrow">Objective</span>
            <h2>${derived.activeObjective.title}</h2>
            <p>${derived.activeObjective.detail}</p>
          </section>
          <section class="tracker-section">
            <span class="eyebrow">Progress</span>
            <div class="tracker-stats">
              ${statBlock("Tier", state.city.tier, "Helio Core")}
              ${statBlock("Population", `${Math.round(derived.population)}/${Math.round(derived.housing)}`, "Residents")}
              ${statBlock("Control", `${Math.round(state.world.control)}%`, "Frontier")}
              ${statBlock("Threat", `${Math.round(state.world.threat)}%`, "Pressure")}
            </div>
          </section>
          <section class="tracker-section">
            <span class="eyebrow">Timers</span>
            <div class="timer-list">
              ${timers.length ? timers.map((item) => `
                <article class="timer-row">
                  <span class="timer-icon">${iconSvg("timer")}</span>
                  <strong>${item.label}</strong>
                  <small>${item.detail}</small>
                </article>
              `).join("") : `<article class="timer-row quiet"><strong>All clear</strong><small>No active timers.</small></article>`}
            </div>
          </section>
          <section class="tracker-section">
            <span class="eyebrow">Signal Feed</span>
            <div class="tracker-alerts">
              ${derived.topAlerts.length ? derived.topAlerts.slice(0, 3).map((alert) => this.renderAlertCard(alert, true)).join("") : `<article class="alert-card compact"><span class="alert-icon">${iconSvg("signal")}</span><div class="alert-copy"><strong>Stable signal</strong><small>No fresh alerts.</small></div></article>`}
            </div>
          </section>
        </div>
      </aside>
    `;
  }

  renderFloating(state, derived) {
    const selectedCell = derived.cells.find((cell) => cell.id === state.selectedCellId);
    return `
      <div class="floating-stack">
        ${state.currentView === "city" && this.buildPaletteOpen ? this.renderBuildPalette(derived) : ""}
        ${state.currentView === "world"
          ? this.renderWorldCard(state, derived)
          : this.renderCityCard(state, derived, selectedCell)}
      </div>
    `;
  }

  renderBuildPalette(derived) {
    const compact = this.isCompactViewport();
    return `
      <section class="detail-card build-palette frame themed-card ${compact ? "compact-detail" : ""}" style="--card-accent:#ff9a68">
        <div class="card-head">
          <div>
            <span class="eyebrow">Build menu</span>
            <h3>City Construction</h3>
          </div>
          <button class="hud-icon utility-inline" type="button" data-action="toggle-build-palette">
            ${iconSvg("build")}
            <span class="button-label">Close</span>
          </button>
        </div>
        <div class="build-grid">
          ${derived.buildChoices.map((choice) => `
            <button class="build-choice ${choice.buildable ? "" : "disabled"}" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
              <span class="build-choice-top">
                <span class="build-choice-icon">${iconSvg(groupMeta(choice.definition.group).icon)}</span>
                <span class="build-choice-copy">
                  <strong>${choice.definition.name}</strong>
                  <small>${groupMeta(choice.definition.group).label} | ${choice.count}/${choice.definition.limit}${choice.definition.unlockTier > this.lastState.city.tier ? ` | tier ${choice.definition.unlockTier}` : ""}</small>
                </span>
              </span>
              <div class="card-chips compact">${bundleMarkup(choice.definition.buildCost)}</div>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }

  renderWorldCard(state, derived) {
    const node = derived.selectedNode;
    if (!node) {
      return "";
    }
    const meta = kindMeta(node.definition.kind);
    const powerGap = derived.squadPower - node.definition.enemyPower;
    const matchupWidth = Math.max(14, Math.min(100, (derived.squadPower / Math.max(node.definition.enemyPower, 1)) * 54));
    if (this.isCompactViewport()) {
      return `
        <section class="detail-card frame themed-card compact-detail compact-world-card" style="--card-accent:${meta.accent}">
          <div class="card-head">
            <div>
              <h3>${node.definition.name}</h3>
            </div>
            <button class="hud-icon round compact-icon" type="button" data-action="switch-view" data-view="city" aria-label="Enter city">
              ${iconSvg("city")}
            </button>
          </div>
          <div class="card-chips">${bundleMarkup(node.definition.reward)}</div>
          <div class="card-actions compact-actions">
            <button class="action-btn primary" type="button" data-action="open-mission" data-node-id="${node.state.id}" ${node.ready ? "" : "disabled"}>
              ${node.locked ? "Locked" : node.cooldownRemainingMs ? `Cooldown ${fmtTime(node.cooldownRemainingMs)}` : "Launch skirmish"}
            </button>
          </div>
          <div class="compact-stat-row">
            <span class="compact-stat-pill">${meta.label}</span>
            <span class="compact-stat-pill">Enemy ${fmtNumber(node.definition.enemyPower)}</span>
            <span class="compact-stat-pill">Squad ${fmtNumber(derived.squadPower)}</span>
            <span class="compact-stat-pill ${powerGap >= 0 ? "good" : "bad"}">${powerGap >= 0 ? "+" : ""}${fmtNumber(powerGap)}</span>
          </div>
        </section>
      `;
    }
    return `
      <section class="detail-card frame themed-card" style="--card-accent:${meta.accent}">
        <div class="card-head">
          <div>
            <span class="eyebrow">Overland node</span>
            <h3>${node.definition.name}</h3>
          </div>
          <button class="hud-icon utility-inline" type="button" data-action="switch-view" data-view="city">
            ${iconSvg("city")}
            <span class="button-label">City</span>
          </button>
        </div>
        <div class="detail-hero">
          <div class="detail-hero-copy">
            <span class="eyebrow">${meta.label} operation</span>
            <p>${node.definition.detail}</p>
          </div>
          <div class="detail-emblem">${iconSvg(meta.icon)}</div>
        </div>
        <div class="card-chips">${bundleMarkup(node.definition.reward)}</div>
        <section class="power-card ${powerGap >= 0 ? "positive" : "negative"}">
          <div>
            <span class="eyebrow">Matchup</span>
            <strong>${powerGap >= 0 ? "+" : ""}${fmtNumber(powerGap)}</strong>
            <small>${powerGap >= 0 ? "Squad advantage" : "Enemy advantage"}</small>
          </div>
          <div class="power-meter"><div style="width:${matchupWidth}%"></div></div>
        </section>
        <div class="detail-stats">
          ${statBlock("Type", titleCase(node.definition.kind), node.definition.missionType)}
          ${statBlock("Enemy", fmtNumber(node.definition.enemyPower), node.locked ? "Locked" : node.ready ? "Ready" : node.cooldownRemainingMs ? fmtTime(node.cooldownRemainingMs) : "Secured")}
          ${statBlock("Squad", fmtNumber(derived.squadPower), state.ui.missionFormation)}
        </div>
        <div class="card-actions">
          <button class="action-btn primary" type="button" data-action="open-mission" data-node-id="${node.state.id}" ${node.ready ? "" : "disabled"}>
            ${node.locked ? "Locked" : node.cooldownRemainingMs ? `Cooldown ${fmtTime(node.cooldownRemainingMs)}` : "Launch skirmish"}
          </button>
        </div>
        <div class="formation-row compact">
          ${FORMATION_DEFS.map((formation) => `
            <button class="formation-chip ${state.ui.missionFormation === formation.id ? "active" : ""}" type="button" data-action="formation" data-formation-id="${formation.id}">
              <strong>${formation.name}</strong>
            </button>
          `).join("")}
        </div>
        <div class="squad-list">
          ${derived.operatives.filter((entry) => entry.state.recruited).slice(0, 6).map((entry) => operativeBadge(entry)).join("")}
        </div>
      </section>
    `;
  }

  renderCityCard(state, derived, selectedCell) {
    const selected = derived.selectedBuilding;
    if (!selected && !selectedCell) {
      return "";
    }

    if (!selected && selectedCell) {
      const quickChoices = this.recommendBuildChoices(selectedCell, derived);
      if (this.isCompactViewport()) {
        return `
          <section class="detail-card frame themed-card compact-detail" style="--card-accent:#84ffca">
            <div class="card-head">
              <div>
                <span class="eyebrow">Open plot</span>
                <h3>${titleCase(selectedCell.zone)}</h3>
              </div>
              <button class="hud-icon round compact-icon" type="button" data-action="toggle-build-palette" aria-label="Open build palette">
                ${iconSvg("build")}
              </button>
            </div>
            <p>Place a new structure on this plot.</p>
            <div class="quick-grid compact-quick-grid">
              ${quickChoices.map((choice) => `
                <button class="quick-card" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
                  <strong>${choice.definition.name}</strong>
                  <small>${groupMeta(choice.definition.group).label}</small>
                </button>
              `).join("")}
            </div>
          </section>
        `;
      }
      return `
        <section class="detail-card frame themed-card" style="--card-accent:#84ffca">
          <div class="card-head">
            <div>
              <span class="eyebrow">Open plot</span>
              <h3>${titleCase(selectedCell.zone)}</h3>
            </div>
            <button class="hud-icon utility-inline" type="button" data-action="toggle-build-palette">
              ${iconSvg("build")}
              <span class="button-label">Build</span>
            </button>
          </div>
          <div class="detail-hero">
            <div class="detail-hero-copy">
              <span class="eyebrow">Placement zone</span>
              <p>This plot is free. Drop a new structure here to extend your city loop.</p>
            </div>
            <div class="detail-emblem">${iconSvg("build")}</div>
          </div>
          <div class="quick-grid">
            ${quickChoices.map((choice) => `
              <button class="quick-card" type="button" data-action="start-placement" data-type-id="${choice.definition.id}" ${choice.buildable ? "" : "disabled"}>
                <strong>${choice.definition.name}</strong>
                <small>${groupMeta(choice.definition.group).label}</small>
              </button>
            `).join("")}
          </div>
        </section>
      `;
    }

    const special = this.renderBuildingExtras(state, derived, selected);
    const meta = groupMeta(selected.definition.group);
    if (this.isCompactViewport()) {
      return `
        <section class="detail-card frame themed-card compact-detail compact-city-card" style="--card-accent:${selected.definition.accent}">
          <div class="card-head">
            <div>
              <h3>${selected.definition.name}</h3>
            </div>
            <div class="card-head-actions compact">
              ${!selected.building.anchorId ? `<button class="hud-icon round compact-icon" type="button" data-action="relocate-building" data-instance-id="${selected.building.instanceId}" aria-label="Move building">${iconSvg("focus")}</button>` : ""}
              <button class="hud-icon round compact-icon" type="button" data-action="toggle-build-palette" aria-label="Open build palette">${iconSvg("build")}</button>
            </div>
          </div>
          <div class="card-chips">${rateMarkup(selected.definition.outputPerSec)}</div>
          <div class="card-actions compact-actions">
            ${selected.definition.action && !["research-lab", "vanguard-barracks", "operative-hub"].includes(selected.definition.id) ? `
              <button class="action-btn primary" type="button" data-action="building-action" data-instance-id="${selected.building.instanceId}" ${selected.cooldownRemainingMs > 0 || selected.busyRemainingMs > 0 ? "disabled" : ""}>
                ${selected.cooldownRemainingMs > 0 ? `Cooldown ${fmtTime(selected.cooldownRemainingMs)}` : selected.definition.action.label}
              </button>
            ` : ""}
            <button class="action-btn" type="button" data-action="upgrade-building" data-instance-id="${selected.building.instanceId}" ${selected.canUpgrade ? "" : "disabled"}>
              ${selected.canUpgrade ? "Upgrade" : selected.building.level >= selected.definition.maxLevel ? "Max level" : "Locked"}
            </button>
          </div>
          <div class="compact-stat-row">
            <span class="compact-stat-pill">${meta.label}</span>
            <span class="compact-stat-pill">Lv ${selected.building.level}</span>
            <span class="compact-stat-pill">${selected.building.anchorId ? "Anchor" : titleCase(selected.position.zone || "anchor")}</span>
          </div>
          ${special}
        </section>
      `;
    }
    return `
      <section class="detail-card frame themed-card" style="--card-accent:${selected.definition.accent}">
        <div class="card-head">
          <div>
            <span class="eyebrow">City building</span>
            <h3>${selected.definition.name}</h3>
          </div>
          <div class="card-head-actions">
            ${!selected.building.anchorId ? `<button class="hud-icon utility-inline" type="button" data-action="relocate-building" data-instance-id="${selected.building.instanceId}">${iconSvg("focus")}<span class="button-label">Move</span></button>` : ""}
            <button class="hud-icon utility-inline" type="button" data-action="toggle-build-palette">${iconSvg("build")}<span class="button-label">Build</span></button>
          </div>
        </div>
        <div class="detail-hero">
          <div class="detail-hero-copy">
            <span class="eyebrow">${meta.label}</span>
            <p>${selected.definition.description}</p>
          </div>
          <div class="detail-emblem">${iconSvg(meta.icon)}</div>
        </div>
        <div class="card-chips">${rateMarkup(selected.definition.outputPerSec)}</div>
        <div class="detail-stats">
          ${statBlock("Level", selected.building.level, selected.busyRemainingMs > 0 ? fmtTime(selected.busyRemainingMs) : "Operational")}
          ${statBlock("Action", selected.definition.action?.label || "Passive", selected.cooldownRemainingMs > 0 ? fmtTime(selected.cooldownRemainingMs) : "Ready")}
          ${statBlock("Zone", titleCase(selected.position.zone || "anchor"), selected.building.anchorId ? "Fixed" : "Player placed")}
        </div>
        <section class="upgrade-preview">
          <span class="eyebrow">Upgrade Cost</span>
          <div class="card-chips">${bundleMarkup(selected.upgradeCost)}</div>
        </section>
        <div class="card-actions">
          ${selected.definition.action && !["research-lab", "vanguard-barracks", "operative-hub"].includes(selected.definition.id) ? `
            <button class="action-btn primary" type="button" data-action="building-action" data-instance-id="${selected.building.instanceId}" ${selected.cooldownRemainingMs > 0 || selected.busyRemainingMs > 0 ? "disabled" : ""}>
              ${selected.cooldownRemainingMs > 0 ? `Cooldown ${fmtTime(selected.cooldownRemainingMs)}` : selected.definition.action.label}
            </button>
          ` : ""}
          <button class="action-btn" type="button" data-action="upgrade-building" data-instance-id="${selected.building.instanceId}" ${selected.canUpgrade ? "" : "disabled"}>
            ${selected.canUpgrade ? "Upgrade" : selected.building.level >= selected.definition.maxLevel ? "Max level" : selected.busyRemainingMs > 0 ? `Busy ${fmtTime(selected.busyRemainingMs)}` : "Need resources"}
          </button>
        </div>
        ${special}
      </section>
    `;
  }

  renderBuildingExtras(state, derived, selected) {
    const compact = this.isCompactViewport();
    if (selected.definition.id === "research-lab") {
      return `
        <div class="quick-grid ${compact ? "compact-quick-grid" : ""}">
          ${derived.availableResearch.filter((item) => !item.completed).slice(0, compact ? 2 : 3).map((item) => `
            <button class="quick-card" type="button" data-action="start-research" data-research-id="${item.definition.id}" ${item.locked || item.active ? "disabled" : ""}>
              <strong>${item.definition.name}</strong>
              <small>${item.active ? `Active | ${fmtTime(Math.max(0, this.lastState.research.activeEndsAt - Date.now()))}` : item.locked ? "Locked" : "Start research"}</small>
            </button>
          `).join("")}
        </div>
      `;
    }

    if (selected.definition.id === "vanguard-barracks") {
      return `
        <div class="quick-grid ${compact ? "compact-quick-grid" : ""}">
          ${UNIT_DEFS.slice(0, compact ? 2 : UNIT_DEFS.length).map((unit) => `
            <button class="quick-card" type="button" data-action="queue-training" data-unit-id="${unit.id}" ${state.training.unitId ? "disabled" : ""}>
              <strong>${unit.name}</strong>
              <small>${unit.batch} units | ${fmtTime(unit.timeMs)}</small>
            </button>
          `).join("")}
        </div>
      `;
    }

    if (selected.definition.id === "operative-hub") {
      return `
        <div class="quick-grid ${compact ? "compact-quick-grid" : ""}">
          ${derived.operatives.slice(0, compact ? 2 : 4).map((entry) => `
            <button class="quick-card" type="button" data-action="${entry.state.recruited ? "promote-operative" : "recruit-operative"}" data-operative-id="${entry.state.id}">
              <strong>${entry.definition.name}</strong>
              <small>${entry.state.recruited ? `Promote | rank ${entry.state.rank}` : "Recruit"}</small>
            </button>
          `).join("")}
        </div>
      `;
    }

    const incident = this.lastState.incidents[0];
    if ((selected.definition.id === "command-nexus" || selected.definition.id === "commons-hall") && incident) {
      const template = INCIDENT_TEMPLATES.find((entry) => entry.id === incident.templateId);
      return `
        <div class="incident-card">
          <strong>${template?.title || "Incident"}</strong>
          <p>${template?.detail || "A city event needs a decision."}</p>
          <div class="card-actions">
            <button class="action-btn primary" type="button" data-action="resolve-incident" data-incident-id="${incident.id}" data-choice="primary">${template?.primaryLabel || "Primary"}</button>
            <button class="action-btn" type="button" data-action="resolve-incident" data-incident-id="${incident.id}" data-choice="secondary">${template?.secondaryLabel || "Secondary"}</button>
          </div>
        </div>
      `;
    }

    return "";
  }

  recommendBuildChoices(cell, derived) {
    return derived.buildChoices
      .filter((choice) => !choice.definition.allowedZones?.length || choice.definition.allowedZones.includes(cell.zone))
      .sort((left, right) => Number(right.buildable) - Number(left.buildable))
      .slice(0, 3);
  }

  renderBottomNav(state, derived) {
    const readyNodes = derived.worldNodes.filter((node) => node.ready).length;
    const buildableCount = derived.buildChoices.filter((choice) => choice.buildable).length;
    const activeResearch = derived.availableResearch.find((item) => item.active);
    const openResearch = derived.availableResearch.filter((item) => !item.completed && !item.locked).length;
    const recruitedCount = derived.operatives.filter((entry) => entry.state.recruited).length;
    const injuryCount = derived.operatives.filter((entry) => entry.injuryRemainingMs > 0).length;
    return `
      <nav class="bottom-nav frame" aria-label="Game navigation">
        <button class="nav-btn ${state.currentView === "world" ? "active" : ""}" type="button" data-action="switch-view" data-view="world">
          <span class="nav-icon">${iconSvg("world")}</span>
          <span class="nav-copy">
            <strong>Overland</strong>
            <small>${readyNodes} ready</small>
          </span>
          ${readyNodes ? `<span class="nav-badge">${readyNodes}</span>` : ""}
        </button>
        <button class="nav-btn ${state.currentView === "city" ? "active" : ""}" type="button" data-action="switch-view" data-view="city">
          <span class="nav-icon">${iconSvg("city")}</span>
          <span class="nav-copy">
            <strong>My City</strong>
            <small>${Math.round(derived.population)}/${Math.round(derived.housing)}</small>
          </span>
        </button>
        <button class="nav-btn ${this.buildPaletteOpen ? "active" : ""}" type="button" data-action="toggle-build-palette">
          <span class="nav-icon">${iconSvg("build")}</span>
          <span class="nav-copy">
            <strong>Build</strong>
            <small>Palette</small>
          </span>
          ${buildableCount ? `<span class="nav-badge">${buildableCount}</span>` : ""}
        </button>
        <button class="nav-btn" type="button" data-action="focus-building-type" data-type-id="research-lab">
          <span class="nav-icon">${iconSvg("lab")}</span>
          <span class="nav-copy">
            <strong>Lab</strong>
            <small>${activeResearch ? fmtTime(Math.max(0, this.lastState.research.activeEndsAt - Date.now())) : `${openResearch} ready`}</small>
          </span>
          ${activeResearch ? `<span class="nav-badge live"></span>` : openResearch ? `<span class="nav-badge">${openResearch}</span>` : ""}
        </button>
        <button class="nav-btn" type="button" data-action="focus-building-type" data-type-id="operative-hub">
          <span class="nav-icon">${iconSvg("crew")}</span>
          <span class="nav-copy">
            <strong>Crew</strong>
            <small>${recruitedCount} online</small>
          </span>
          ${injuryCount ? `<span class="nav-badge warn">${injuryCount}</span>` : ""}
        </button>
      </nav>
    `;
  }

  renderOverlay(derived, missionRun) {
    if (!missionRun) {
      return "";
    }
    const node = derived.worldNodes.find((entry) => entry.state.id === missionRun.nodeId) || derived.selectedNode;
    const playerPct = missionRun.playerMaxHp ? (missionRun.playerHp / missionRun.playerMaxHp) * 100 : 0;
    const enemyPct = missionRun.enemyMaxHp ? (missionRun.enemyHp / missionRun.enemyMaxHp) * 100 : 0;
    return `
      <div class="overlay-backdrop">
        <section class="mission-modal frame">
          <div class="card-head">
            <div>
              <span class="eyebrow">Skirmish</span>
              <h3>${node?.definition.name || "Mission"}</h3>
            </div>
            <button class="hud-icon" type="button" data-action="dismiss-mission" ${missionRun.running && !missionRun.resolved ? "disabled" : ""}>Close</button>
          </div>
          <div class="battle-bars">
            <article>
              <span>Squad integrity</span>
              <div class="meter"><div style="width:${playerPct}%"></div></div>
              <strong>${fmtNumber(missionRun.playerHp)} / ${fmtNumber(missionRun.playerMaxHp)}</strong>
            </article>
            <article>
              <span>Enemy pressure</span>
              <div class="meter enemy"><div style="width:${enemyPct}%"></div></div>
              <strong>${fmtNumber(missionRun.enemyHp)} / ${fmtNumber(missionRun.enemyMaxHp)}</strong>
            </article>
          </div>
          <div class="ability-strip">
            ${missionRun.squadIds.map((operativeId) => {
              const operative = derived.operatives.find((entry) => entry.state.id === operativeId);
              return `
                <button class="ability-card ${missionRun.abilityUses[operativeId] ? "used" : ""}" type="button" data-action="mission-ability" data-operative-id="${operativeId}" ${(missionRun.running && !missionRun.abilityUses[operativeId] && !missionRun.resolved) ? "" : "disabled"}>
                  <strong>${operative?.definition.abilityLabel || "Ability"}</strong>
                  <small>${operative?.definition.name || operativeId}</small>
                </button>
              `;
            }).join("")}
          </div>
          <div class="mission-log">
            ${missionRun.log.map((entry) => `<div class="log-line ${entry.tone}">${entry.text}</div>`).join("")}
          </div>
          ${!missionRun.running && !missionRun.resolved ? `
            <div class="card-actions">
              <button class="action-btn primary" type="button" data-action="start-mission">Start skirmish</button>
            </div>
          ` : ""}
        </section>
      </div>
    `;
  }

  focusBuildingType(typeId) {
    if (!this.lastState) {
      return;
    }
    const building = this.lastState.city.buildings.find((entry) => entry.typeId === typeId);
    this.handlers.onSwitchView("city");
    if (building) {
      this.handlers.onSelectBuilding(building.instanceId);
    } else {
      this.buildPaletteOpen = true;
      this.refresh();
    }
  }

  focusHome() {
    if (!this.lastState) {
      return;
    }
    if (this.lastState.currentView === "world") {
      this.centerCameraOn("world", 40, 78);
      return;
    }
    this.centerCameraOn("city", 52, 43);
  }

  focusSelected() {
    if (!this.lastState || !this.lastDerived) {
      return;
    }
    if (this.lastState.currentView === "world") {
      const node = this.lastDerived.selectedNode;
      if (node) {
        this.centerCameraOn("world", node.definition.x, node.definition.y);
      }
      return;
    }
    const selectedCell = this.lastDerived.cells.find((cell) => cell.id === this.lastState.selectedCellId);
    const target = this.lastDerived.selectedBuilding?.position || selectedCell;
    if (target) {
      this.centerCameraOn("city", target.x, target.y);
    }
  }

  bumpZoom(view, delta) {
    const camera = this.camera[view];
    camera.scale = Math.max(0.65, Math.min(1.6, camera.scale + delta));
    this.syncCamera(view);
  }

  nudgeCamera(view, deltaX, deltaY) {
    this.camera[view].x += deltaX;
    this.camera[view].y += deltaY;
    this.syncCamera(view);
  }

  resetCamera(view) {
    this.camera[view].initialized = false;
    this.syncCamera(view);
  }

  centerCameraOn(view, xPercent, yPercent) {
    const viewport = this.document.querySelector(`.map-viewport[data-view="${view}"]`);
    if (!viewport) {
      return;
    }
    const metrics = SCENE_SIZES[view];
    const viewportRect = viewport.getBoundingClientRect();
    const camera = this.camera[view];
    if (!camera.initialized) {
      this.syncCamera(view);
    }
    camera.x = viewportRect.width / 2 - (metrics.width * camera.scale * xPercent) / 100;
    camera.y = viewportRect.height / 2 - (metrics.height * camera.scale * yPercent) / 100;
    this.syncCamera(view);
  }

  syncCamera(view) {
    const viewport = this.document.querySelector(`.map-viewport[data-view="${view}"]`);
    const scene = this.document.querySelector(`.map-scene[data-map-scene="${view}"]`);
    if (!viewport || !scene) {
      return;
    }
    const metrics = SCENE_SIZES[view];
    const viewportRect = viewport.getBoundingClientRect();
    const coverScale = Math.max(viewportRect.width / metrics.width, viewportRect.height / metrics.height);
    const camera = this.camera[view];
    if (!camera.initialized) {
      camera.scale = Math.max(coverScale * (view === "world" ? 1.12 : 1.22), view === "world" ? 0.72 : 0.82);
      camera.scale = Math.min(camera.scale, 1.35);
      camera.x = (viewportRect.width - metrics.width * camera.scale) / 2;
      camera.y = (viewportRect.height - metrics.height * camera.scale) / 2;
      camera.initialized = true;
    }

    const scaledWidth = metrics.width * camera.scale;
    const scaledHeight = metrics.height * camera.scale;
    const minX = scaledWidth <= viewportRect.width ? (viewportRect.width - scaledWidth) / 2 : viewportRect.width - scaledWidth;
    const maxX = scaledWidth <= viewportRect.width ? minX : 0;
    const minY = scaledHeight <= viewportRect.height ? (viewportRect.height - scaledHeight) / 2 : viewportRect.height - scaledHeight;
    const maxY = scaledHeight <= viewportRect.height ? minY : 0;

    camera.x = Math.max(minX, Math.min(maxX, camera.x));
    camera.y = Math.max(minY, Math.min(maxY, camera.y));
    scene.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`;
  }
}
