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

function compactList(list) {
  return list.length ? list.join(" · ") : "None";
}

function titleCase(input) {
  return input.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export class EmpireUI {
  constructor(documentRef, handlers) {
    this.document = documentRef;
    this.handlers = handlers;
    this.refs = {
      shell: documentRef.getElementById("appShell"),
      summary: documentRef.getElementById("summaryStrip"),
      hero: documentRef.getElementById("heroDeck"),
      status: documentRef.getElementById("statusDeck"),
      map: documentRef.getElementById("cityMap"),
      peek: documentRef.getElementById("districtPeek"),
      rail: documentRef.getElementById("liveRail"),
      dock: documentRef.getElementById("dockTabs"),
      panel: documentRef.getElementById("panelRoot"),
      overlay: documentRef.getElementById("overlayRoot"),
      toast: documentRef.getElementById("toastRoot"),
      soundToggle: documentRef.getElementById("soundToggle"),
      musicToggle: documentRef.getElementById("musicToggle"),
      saveButton: documentRef.getElementById("saveButton"),
    };
    this.lastToastId = null;
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
    });
  }

  render(state, derived) {
    const selected = derived.districts.find((district) => district.def.id === state.selectedDistrictId) || derived.districts[0];
    const hustlePreview = Math.floor((18 + derived.rankIndex * 4) * (1 + (derived.legacyBonuses.hustleMult || 0)) * (1 + (derived.beatMods.hustleMult || 0)) * (derived.surgeActive ? 1.4 : 1));

    this.refs.summary.innerHTML = `
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
    `;

    this.refs.hero.innerHTML = `
      <div class="deck-copy">
        <div class="deck-kicker">Milgie Crime Strategy</div>
        <h1>Criminal Empire II</h1>
        <p>Own the night. Wash the cash. Pressure every district until the city answers to your ledger.</p>
      </div>
      <div class="hero-metrics">
        <div class="hero-metric">
          <span>Dirty / sec</span>
          <strong>${fmtMoney(derived.totals.dirtyPerSec)}</strong>
        </div>
        <div class="hero-metric">
          <span>Clean / sec</span>
          <strong>${fmtMoney(derived.totals.cleanPerSec)}</strong>
        </div>
        <div class="hero-metric">
          <span>Active Ops</span>
          <strong>${fmtNumber(derived.operations.length)}</strong>
        </div>
      </div>
      <button class="hustle-button" type="button" data-action="hustle">
        <span>Run Hustle</span>
        <small>+${fmtMoney(hustlePreview)}</small>
      </button>
      <div class="surge-shell">
        <div class="surge-label">
          <span>Surge</span>
          <strong>${derived.surgeActive ? `LIVE · ${fmtTime(derived.surgeRemainingMs)}` : `${Math.round(state.surge)} / 100`}</strong>
        </div>
        <div class="progress"><span style="width:${derived.surgeActive ? 100 : state.surge}%"></span></div>
      </div>
    `;

    this.refs.status.innerHTML = `
      <div class="heat-ring-shell">
        <div class="heat-ring" style="--heat:${state.globalHeat}%">
          <div class="heat-ring-core">
            <span>Manhunt</span>
            <strong>${derived.manhunt.label}</strong>
          </div>
        </div>
      </div>
      <div class="status-grid">
        <div class="status-card">
          <span>Selected District</span>
          <strong>${selected.def.name}</strong>
          <small>${selected.faction.name}</small>
        </div>
        <div class="status-card">
          <span>Control</span>
          <strong>${Math.round(selected.state.control)}%</strong>
          <small>${selected.state.controlled ? "Secured" : "In play"}</small>
        </div>
        <div class="status-card">
          <span>City Beat</span>
          <strong>${derived.beat ? derived.beat.name : "Static"}</strong>
          <small>${derived.beat ? fmtTime(derived.beat.remainingMs) : "No modifier"}</small>
        </div>
      </div>
    `;

    const lines = derived.districts
      .slice(0, -1)
      .map((district, index) => {
        const next = derived.districts[index + 1];
        return `<line x1="${district.def.map.x}%" y1="${district.def.map.y}%" x2="${next.def.map.x}%" y2="${next.def.map.y}%"></line>`;
      })
      .join("");
    this.refs.map.innerHTML = `
      <div class="map-shell">
        <svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
        ${derived.districts.map((district) => `
          <button
            class="district-node ${district.state.controlled ? "controlled" : district.state.unlocked ? "unlocked" : "locked"} ${state.selectedDistrictId === district.def.id ? "selected" : ""}"
            style="left:${district.def.map.x}%;top:${district.def.map.y}%"
            data-action="select-district"
            data-district-id="${district.def.id}"
            ${district.state.unlocked ? "" : "disabled"}
          >
            <span>${district.def.shortName}</span>
            <small>${district.state.unlocked ? `${Math.round(district.state.control)}%` : "Locked"}</small>
          </button>
        `).join("")}
      </div>
    `;

    this.refs.peek.innerHTML = `
      <div class="district-peek-card">
        <div class="district-kicker">${selected.faction.name}</div>
        <h2>${selected.def.name}</h2>
        <p>${selected.def.flavor}</p>
        <div class="district-stats-row">
          <div><span>Dirty / sec</span><strong>${fmtMoney(selected.dirtyPerSec)}</strong></div>
          <div><span>Clean / sec</span><strong>${fmtMoney(selected.cleanPerSec)}</strong></div>
          <div><span>District Heat</span><strong>${Math.round(selected.state.heat)}%</strong></div>
        </div>
        <div class="progress"><span style="width:${selected.state.control}%"></span></div>
        <div class="district-actions">
          ${selected.canUnlock ? `<button class="neon-btn" type="button" data-action="unlock-district" data-district-id="${selected.def.id}">Unlock ${fmtMoney(selected.def.unlockCost.clean)} · ${selected.def.unlockCost.intel} intel</button>` : ""}
          ${selected.canSeize ? `<button class="neon-btn gold" type="button" data-action="seize-district" data-district-id="${selected.def.id}">Seize district</button>` : ""}
          <span class="bonus-pill">${selected.def.bonus.label}</span>
        </div>
      </div>
    `;

    this.refs.rail.innerHTML = `
      <div class="rail-card">
        <div class="section-label">Live Feed</div>
        <div class="alert-feed">
          ${state.alerts.slice(0, 5).map((alert) => `
            <div class="alert-item ${alert.tone}">
              <strong>${alert.title}</strong>
              <p>${alert.detail}</p>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="rail-card">
        <div class="section-label">Ops Queue</div>
        ${derived.operations.length ? derived.operations.slice(0, 4).map((operation) => `
          <div class="queue-item">
            <strong>${operation.label}</strong>
            <span>${fmtTime(operation.endsAt - derived.now)}</span>
          </div>
        `).join("") : `<div class="empty-copy">No prep ops running.</div>`}
      </div>
      <div class="rail-card">
        <div class="section-label">Empire Flow</div>
        <div class="micro-grid">
          <div><span>Launder rate</span><strong>${fmtMoney(derived.totals.launderPerSec)}</strong></div>
          <div><span>Avg heat</span><strong>${Math.round(derived.totals.averageHeat)}%</strong></div>
          <div><span>Crew</span><strong>${state.crew.length}/${derived.crewCap}</strong></div>
          <div><span>Legacy</span><strong>${derived.projectedLegacy} LP</strong></div>
        </div>
      </div>
    `;

    this.refs.dock.innerHTML = derived.panelTabs.map((tab) => `
      <button class="dock-tab ${state.currentPanel === tab.id ? "active" : ""}" type="button" data-action="panel" data-panel="${tab.id}">
        ${tab.label}
      </button>
    `).join("");

    this.refs.panel.innerHTML = this.renderPanel(state, derived, selected);
    this.refs.soundToggle.textContent = state.settings.sound ? "SFX On" : "SFX Off";
    this.refs.musicToggle.textContent = state.settings.music ? "Music On" : "Music Off";
    this.refs.saveButton.textContent = "Save";

    if (state.alerts[0] && state.alerts[0].id !== this.lastToastId) {
      this.lastToastId = state.alerts[0].id;
      this.toast(state.alerts[0]);
    }
  }

  renderPanel(state, derived, selected) {
    switch (state.currentPanel) {
      case "ops":
        return this.renderOpsPanel(state, derived, selected);
      case "crew":
        return this.renderCrewPanel(derived);
      case "ledger":
        return this.renderLedgerPanel(selected);
      case "legacy":
        return this.renderLegacyPanel(state, derived);
      default:
        return this.renderCityPanel(derived, selected);
    }
  }

  renderCityPanel(derived, selected) {
    return `
      <section class="section-block">
        <div class="section-head"><h2>District Control</h2><span>${derived.districts.filter((district) => district.state.controlled).length}/${derived.districts.length} secured</span></div>
        <div class="district-grid">
          ${derived.districts.map((district) => `
            <article class="district-card ${district.state.controlled ? "controlled" : ""} ${district.def.id === selected.def.id ? "focus" : ""}">
              <div class="district-card-head">
                <div>
                  <span class="eyebrow">${district.faction.name}</span>
                  <h3>${district.def.name}</h3>
                </div>
                <span class="district-tag">${district.state.unlocked ? `${Math.round(district.state.control)}%` : "Locked"}</span>
              </div>
              <p>${district.def.flavor}</p>
              <div class="progress"><span style="width:${district.state.control}%"></span></div>
              <div class="card-actions">
                <button class="ghost-btn" type="button" data-action="select-district" data-district-id="${district.def.id}" ${district.state.unlocked ? "" : "disabled"}>Focus</button>
                ${district.canUnlock ? `<button class="neon-btn" type="button" data-action="unlock-district" data-district-id="${district.def.id}">Unlock</button>` : ""}
                ${district.canSeize ? `<button class="neon-btn gold" type="button" data-action="seize-district" data-district-id="${district.def.id}">Seize</button>` : ""}
              </div>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2>${selected.def.name}</h2><span>${selected.def.bonus.label}</span></div>
        <div class="detail-panel">
          <p>${selected.def.flavor}</p>
          <div class="mini-columns">
            <div><span>Fronts</span><strong>${selected.fronts.filter((front) => front.state.level > 0).length}/${selected.fronts.length}</strong></div>
            <div><span>Rackets</span><strong>${selected.rackets.filter((racket) => racket.state.level > 0).length}/${selected.rackets.length}</strong></div>
            <div><span>Prep Done</span><strong>${selected.heist.prepDoneCount}/3</strong></div>
          </div>
        </div>
      </section>
    `;
  }

  renderOpsPanel(state, derived, selected) {
    const availableCrew = derived.crew.filter((entry) => !entry.isBusy);
    return `
      <section class="section-block">
        <div class="section-head"><h2>Street Contracts</h2><span>Refresh ${fmtTime(Math.max(0, state.nextContractRefreshAt - derived.now))}</span></div>
        <div class="contract-list">
          ${derived.contracts.map(({ contract, ratio, ready }) => `
            <article class="contract-card ${ready ? "ready" : ""}">
              <div class="contract-head">
                <div>
                  <span class="eyebrow">${titleCase(contract.type)}</span>
                  <h3>${contract.name}</h3>
                </div>
                <span class="contract-target">${fmtNumber(contract.target)}</span>
              </div>
              <p>${contract.desc}</p>
              <div class="progress"><span style="width:${ratio * 100}%"></span></div>
              <div class="contract-reward">Reward: ${fmtMoney(contract.reward.dirty)} · ${fmtMoney(contract.reward.clean)} · ${contract.reward.intel} intel</div>
              <button class="neon-btn" type="button" data-action="claim-contract" data-contract-id="${contract.id}" ${ready && !contract.claimed ? "" : "disabled"}>${contract.claimed ? "Claimed" : ready ? "Claim" : pct(ratio)}</button>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2>${selected.heist.def.name}</h2><span>${selected.heist.cooldownRemainingMs ? fmtTime(selected.heist.cooldownRemainingMs) : "Ready"}</span></div>
        <p class="section-copy">${selected.heist.def.desc}</p>
        <div class="approach-row">
          ${selected.heist.def.approaches.map((approach) => `
            <button class="approach-chip ${selected.heist.draft.approachId === approach.id ? "active" : ""}" type="button" data-action="set-approach" data-district-id="${selected.def.id}" data-approach-id="${approach.id}">
              <strong>${approach.name}</strong>
              <small>${approach.minCrew} crew</small>
            </button>
          `).join("")}
        </div>
        <div class="prep-grid">
          ${selected.heist.def.preps.map((prep) => `
            <article class="prep-card ${selected.state.heist.prepDone[prep.id] ? "done" : ""}">
              <div class="prep-head">
                <div>
                  <span class="eyebrow">${titleCase(prep.preferred)}</span>
                  <h3>${prep.name}</h3>
                </div>
                <span>${fmtTime(prep.duration)}</span>
              </div>
              <p>${prep.desc}</p>
              <select data-prep-select ${selected.state.heist.prepDone[prep.id] ? "disabled" : ""}>
                <option value="">Choose crew</option>
                ${availableCrew.map((entry) => `<option value="${entry.crew.id}">${entry.crew.name} · ${entry.archetype.name}</option>`).join("")}
              </select>
              <button class="ghost-btn" type="button" data-action="start-prep" data-district-id="${selected.def.id}" data-prep-id="${prep.id}" ${selected.state.heist.prepDone[prep.id] ? "disabled" : ""}>
                ${selected.state.heist.prepDone[prep.id] ? "Complete" : `${fmtMoney(prep.costDirty)} · ${prep.costIntel} intel`}
              </button>
            </article>
          `).join("")}
        </div>
        <div class="crew-pick-grid">
          ${derived.crew.map((entry) => `
            <label class="crew-pick ${selected.heist.draft.crewIds.includes(entry.crew.id) ? "selected" : ""} ${entry.isBusy ? "disabled" : ""}">
              <input type="checkbox" data-heist-crew data-district-id="${selected.def.id}" data-crew-id="${entry.crew.id}" ${selected.heist.draft.crewIds.includes(entry.crew.id) ? "checked" : ""} ${entry.isBusy ? "disabled" : ""}>
              <span>${entry.crew.name}</span>
              <small>${entry.archetype.name}</small>
            </label>
          `).join("")}
        </div>
        <div class="odds-card">
          <div><span>Intel cost</span><strong>${selected.heist.def.intelCost}</strong></div>
          <div><span>Prep done</span><strong>${selected.heist.prepDoneCount}/3</strong></div>
          <div><span>Estimated hit</span><strong>${pct(selected.heist.chance)}</strong></div>
        </div>
        <button class="neon-btn big" type="button" data-action="launch-heist" data-district-id="${selected.def.id}" ${selected.heist.ready ? "" : "disabled"}>Run the job</button>
      </section>
      <section class="section-block">
        <div class="section-head"><h2>Active Ops</h2><span>${derived.operations.length}</span></div>
        <div class="ops-list">
          ${derived.operations.length ? derived.operations.map((operation) => `
            <div class="ops-item">
              <strong>${operation.label}</strong>
              <span>${fmtTime(operation.endsAt - derived.now)}</span>
            </div>
          `).join("") : `<div class="empty-copy">No crews are running prep right now.</div>`}
        </div>
      </section>
    `;
  }

  renderCrewPanel(derived) {
    return `
      <section class="section-block">
        <div class="section-head"><h2>Crew Board</h2><span>${derived.crew.length}/${derived.crewCap} active</span></div>
        <div class="crew-grid">
          ${derived.crew.map((entry) => `
            <article class="crew-card">
              <div class="crew-head">
                <div class="crew-avatar" style="--avatar-hue:${entry.crew.hue}">
                  <span>${entry.crew.name.split(" ").map((part) => part[0]).join("")}</span>
                </div>
                <div class="crew-copy">
                  <h3>${entry.crew.name}</h3>
                  <p>${entry.archetype.name} · ${entry.positiveTrait.name} / ${entry.negativeTrait.name}</p>
                </div>
                <span class="rank-pill">R${entry.crew.rank}</span>
              </div>
              <div class="stat-row">
                <div><span>Cunning</span><strong>${entry.crew.cunning}</strong></div>
                <div><span>Nerve</span><strong>${entry.crew.nerve}</strong></div>
                <div><span>Loyalty</span><strong>${entry.effectiveLoyalty}</strong></div>
              </div>
              <div class="stress-shell">
                <div class="stress-label"><span>Stress</span><strong>${Math.round(entry.crew.stress)}%</strong></div>
                <div class="progress stress"><span style="width:${entry.crew.stress}%"></span></div>
              </div>
              <p class="section-copy">${entry.statusLabel}</p>
              <label class="select-wrap">
                <span>Assignment</span>
                <select data-assign-crew="${entry.crew.id}" ${entry.isBusy ? "disabled" : ""}>
                  ${entry.assignmentOptions.map((option) => `<option value="${option.value}" ${entry.crew.assignmentKey === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
                </select>
              </label>
              <button class="ghost-btn" type="button" data-action="promote-crew" data-crew-id="${entry.crew.id}" ${entry.crew.rank >= 4 ? "disabled" : ""}>Promote · ${fmtMoney(entry.promotionCost.clean)} + ${entry.promotionCost.intel} intel</button>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2>Recruit Market</h2><span>Refreshes automatically</span></div>
        <div class="crew-grid">
          ${derived.recruitPool.map((entry) => `
            <article class="crew-card recruit">
              <div class="crew-head">
                <div class="crew-avatar" style="--avatar-hue:${entry.candidate.hue}">
                  <span>${entry.candidate.name.split(" ").map((part) => part[0]).join("")}</span>
                </div>
                <div class="crew-copy">
                  <h3>${entry.candidate.name}</h3>
                  <p>${entry.archetype.name} · ${entry.positiveTrait.name} / ${entry.negativeTrait.name}</p>
                </div>
                <span class="rank-pill">R${entry.candidate.rank}</span>
              </div>
              <div class="stat-row">
                <div><span>Cunning</span><strong>${entry.candidate.cunning}</strong></div>
                <div><span>Nerve</span><strong>${entry.candidate.nerve}</strong></div>
                <div><span>Loyalty</span><strong>${entry.candidate.loyalty}</strong></div>
              </div>
              <button class="neon-btn" type="button" data-action="hire-crew" data-candidate-id="${entry.candidate.id}">Hire · ${fmtMoney(entry.cost.dirty)} · ${fmtMoney(entry.cost.clean)} · ${entry.cost.intel} intel</button>
            </article>
          `).join("")}
        </div>
        <button class="ghost-btn" type="button" data-action="reroll-crew">Spend 2 intel to reroll the market</button>
      </section>
    `;
  }

  renderLedgerPanel(selected) {
    const renderAsset = (asset, kind) => `
      <article class="asset-card ${kind}">
        <div class="asset-head">
          <div>
            <span class="eyebrow">${kind === "front" ? "Front" : "Racket"}</span>
            <h3>${asset.def.name}</h3>
          </div>
          <span class="rank-pill">Lv ${asset.state.level}/${asset.def.maxLevel}</span>
        </div>
        <p>${asset.def.desc}</p>
        <div class="asset-metrics">
          ${kind === "front"
            ? `<span>${fmtMoney(asset.cleanPerSec)}/s clean</span><span>${fmtMoney(asset.launderPerSec)}/s washed</span><span>${Math.round(asset.coverPerSec * 100)} cover</span>`
            : `<span>${fmtMoney(asset.dirtyPerSec)}/s dirty</span><span>${Math.round(asset.heatGain * 100)} heat</span><span>${asset.def.specialty}</span>`}
        </div>
        <div class="section-copy">${asset.assignedCrew ? `Assigned: ${asset.assignedCrew.name}` : "No crew assigned"}</div>
        <button class="neon-btn" type="button" data-action="buy-asset" data-district-id="${selected.def.id}" data-kind="${kind}" data-asset-id="${asset.def.id}" ${asset.state.level >= asset.def.maxLevel ? "disabled" : ""}>
          ${asset.state.level >= asset.def.maxLevel ? "Maxed" : `Upgrade · ${fmtMoney(asset.cost.dirty)} + ${fmtMoney(asset.cost.clean)}`}
        </button>
      </article>
    `;

    return `
      <section class="section-block">
        <div class="section-head"><h2>${selected.def.name} Ledger</h2><span>${fmtMoney(selected.dirtyPerSec)} dirty / s · ${fmtMoney(selected.cleanPerSec)} clean / s</span></div>
        <div class="asset-grid">${selected.rackets.map((asset) => renderAsset(asset, "racket")).join("")}</div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2>Front Businesses</h2><span>${selected.def.bonus.label}</span></div>
        <div class="asset-grid">${selected.fronts.map((asset) => renderAsset(asset, "front")).join("")}</div>
      </section>
    `;
  }

  renderLegacyPanel(state, derived) {
    return `
      <section class="section-block">
        <div class="section-head"><h2>Neon Legacy</h2><span>${state.legacyPoints} LP on hand</span></div>
        <div class="legacy-summary">
          <div><span>Projected retire gain</span><strong>${derived.projectedLegacy} LP</strong></div>
          <div><span>Lifetime clean</span><strong>${fmtMoney(state.stats.lifetimeClean)}</strong></div>
          <div><span>Runs completed</span><strong>${state.stats.legacyRuns}</strong></div>
          <button class="neon-btn gold" type="button" data-action="retire">Retire and rebuild</button>
        </div>
        <div class="legacy-grid">
          ${derived.legacyUpgrades.map((entry) => `
            <article class="legacy-card">
              <div class="asset-head">
                <div>
                  <span class="eyebrow">Legacy</span>
                  <h3>${entry.upgrade.name}</h3>
                </div>
                <span class="rank-pill">${entry.count}/${entry.upgrade.max}</span>
              </div>
              <p>${entry.upgrade.desc}</p>
              <button class="ghost-btn" type="button" data-action="buy-legacy" data-upgrade-id="${entry.upgrade.id}" ${entry.canBuy ? "" : "disabled"}>Buy · ${entry.upgrade.cost} LP</button>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="section-block">
        <div class="section-head"><h2>Empire Files</h2><span>${derived.dossiers.filter((entry) => entry.complete).length}/${derived.dossiers.length}</span></div>
        <div class="district-grid">
          ${derived.dossiers.map((entry) => `
            <article class="district-card ${entry.complete ? "controlled" : ""}">
              <div class="district-card-head">
                <div>
                  <span class="eyebrow">Dossier</span>
                  <h3>${entry.dossier.name}</h3>
                </div>
                <span class="district-tag">${entry.complete ? "Done" : `${Math.round(entry.ratio * 100)}%`}</span>
              </div>
              <p>${entry.dossier.desc}</p>
              <div class="progress"><span style="width:${entry.ratio * 100}%"></span></div>
            </article>
          `).join("")}
        </div>
      </section>
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
