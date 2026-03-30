(function () {
  const STORAGE_KEY = "milgie-cooking-state-v1";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { recipes: {} };
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { recipes: {} };
      }

      return {
        recipes: parsed.recipes && typeof parsed.recipes === "object" ? parsed.recipes : {}
      };
    } catch (error) {
      return { recipes: {} };
    }
  }

  const appState = loadState();

  function saveState() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }

  function ensureRecipeState(recipe) {
    const existing = appState.recipes[recipe.id] || {};
    const counts = recipe.normalizeCounts(existing.counts || {});
    const phases = recipe.getPhases();
    const activePhase = phases.some(function (phase) { return phase.id === existing.activePhase; })
      ? existing.activePhase
      : phases[0].id;
    const checked = existing.checked && typeof existing.checked === "object" ? existing.checked : {};

    appState.recipes[recipe.id] = {
      counts: counts,
      activePhase: activePhase,
      checked: checked
    };

    return appState.recipes[recipe.id];
  }

  function renderLanding() {
    const container = document.getElementById("recipeLibrary");
    const recipes = Object.values(window.COOKBOOK_RECIPES || {});

    if (!container || !recipes.length) {
      return;
    }

    container.innerHTML = recipes.map(function (recipe) {
      const card = recipe.getLandingCard();
      const tags = card.tags.map(function (tag) {
        return '<span class="tag-pill">' + escapeHtml(tag) + "</span>";
      }).join("");

      return (
        '<article class="recipe-card">' +
          '<div class="recipe-card-top">' +
            '<span class="recipe-status">' + escapeHtml(card.status) + "</span>" +
            '<p class="recipe-card-kicker">' + escapeHtml(card.kicker) + "</p>" +
            "<h2>" + escapeHtml(card.title) + "</h2>" +
            "<p>" + escapeHtml(card.summary) + "</p>" +
            '<div class="recipe-card-tags">' + tags + "</div>" +
          "</div>" +
          '<div class="recipe-card-bottom">' +
            '<span class="mini-label">Template-ready recipe page</span>' +
            '<a class="recipe-link" href="' + escapeHtml(card.href) + '">Open guide</a>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function initRecipePage() {
    const recipeId = document.body.getAttribute("data-recipe-id");
    const recipe = window.COOKBOOK_RECIPES && window.COOKBOOK_RECIPES[recipeId];

    if (!recipe) {
      return;
    }

    const recipeState = ensureRecipeState(recipe);
    const els = {
      eyebrow: document.getElementById("recipeEyebrow"),
      title: document.getElementById("recipeTitle"),
      summary: document.getElementById("recipeSummary"),
      stats: document.getElementById("recipeStats"),
      presets: document.getElementById("plannerPresets"),
      controls: document.getElementById("plannerControls"),
      summaryStrip: document.getElementById("plannerSummary"),
      phaseNav: document.getElementById("phaseNav"),
      phaseKicker: document.getElementById("phaseKicker"),
      phaseTitle: document.getElementById("phaseTitle"),
      phaseDescription: document.getElementById("phaseDescription"),
      phaseProgress: document.getElementById("phaseProgressCard"),
      highlights: document.getElementById("phaseHighlights"),
      content: document.getElementById("phaseContent"),
      aside: document.getElementById("phaseAside"),
      app: document.getElementById("recipeApp")
    };

    function getCheckedMap(phaseId) {
      const checked = recipeState.checked[phaseId];
      if (checked && typeof checked === "object") {
        return checked;
      }

      recipeState.checked[phaseId] = {};
      return recipeState.checked[phaseId];
    }

    function getTrackableItems(phaseData) {
      const trackable = [];

      (phaseData.sections || []).forEach(function (section) {
        (section.groups || []).forEach(function (group) {
          (group.items || []).forEach(function (item) {
            if (item.checkable === false || item.optional) {
              return;
            }
            trackable.push(item.id);
          });
        });
      });

      return trackable;
    }

    function getPhaseProgress(phaseId, phaseData) {
      const trackable = getTrackableItems(phaseData);
      const checkedMap = getCheckedMap(phaseId);
      const completed = trackable.filter(function (id) {
        return Boolean(checkedMap[id]);
      }).length;
      const total = trackable.length;
      const percent = total ? Math.round((completed / total) * 100) : 0;

      return {
        completed: completed,
        total: total,
        percent: percent
      };
    }

    function renderHero() {
      const hero = recipe.getHero(recipeState.counts);
      els.eyebrow.textContent = hero.eyebrow;
      els.title.textContent = hero.title;
      els.summary.textContent = hero.summary;
      els.stats.innerHTML = (hero.stats || []).map(function (stat) {
        return (
          '<article class="stat-card">' +
            '<span class="stat-value">' + escapeHtml(stat.value) + "</span>" +
            '<span class="stat-label">' + escapeHtml(stat.label) + "</span>" +
          "</article>"
        );
      }).join("");
    }

    function renderPlanner() {
      const controls = recipe.getControls();
      const presets = recipe.getPresets ? recipe.getPresets() : [];
      const overview = recipe.getOverview(recipeState.counts);

      els.presets.innerHTML = presets.map(function (preset, index) {
        return (
          '<button class="preset-button" type="button" data-preset-index="' + index + '">' +
            escapeHtml(preset.label) +
          "</button>"
        );
      }).join("");

      els.controls.innerHTML = controls.map(function (control) {
        const value = recipeState.counts[control.id];

        return (
          '<div class="planner-control">' +
            '<div class="planner-label">' +
              "<strong>" + escapeHtml(control.label) + "</strong>" +
              "<span>" + escapeHtml(control.description) + "</span>" +
            "</div>" +
            '<div class="stepper">' +
              '<button type="button" aria-label="Decrease ' + escapeHtml(control.label) + '" data-adjust="' + escapeHtml(control.id) + '" data-step="-1">-</button>' +
              '<label class="visually-hidden" for="count-' + escapeHtml(control.id) + '">' + escapeHtml(control.label) + "</label>" +
              '<input id="count-' + escapeHtml(control.id) + '" type="number" min="' + control.min + '" max="' + control.max + '" value="' + value + '" data-count-id="' + escapeHtml(control.id) + '" />' +
              '<button type="button" aria-label="Increase ' + escapeHtml(control.label) + '" data-adjust="' + escapeHtml(control.id) + '" data-step="1">+</button>' +
            "</div>" +
          "</div>"
        );
      }).join("");

      const summaryItems = [
        {
          label: "Fillings",
          value: overview.fillCount ? overview.fillCount + " batches" : "0 batches",
          tone: ""
        },
        {
          label: "Estimated yield",
          value: overview.fillCount ? overview.pierogi.min + "-" + overview.pierogi.max + " pierogi" : "Set fillings",
          tone: ""
        },
        {
          label: "Dough plan",
          value: overview.recommendedDough ? ("Suggested: " + overview.recommendedDough + " batches") : "Waiting on fillings",
          tone: overview.doughTone === "good" ? "is-good" : "is-warning"
        }
      ];

      els.summaryStrip.innerHTML = summaryItems.map(function (item) {
        return (
          '<div class="summary-pill">' +
            '<span class="pill-label">' + escapeHtml(item.label) + "</span>" +
            '<span class="pill-value ' + escapeHtml(item.tone) + '">' + escapeHtml(item.value) + "</span>" +
          "</div>"
        );
      }).join("");
    }

    function renderSections(sections, phaseId) {
      if (!sections.length) {
        return '<div class="empty-state">No content is available for this phase yet.</div>';
      }

      return sections.map(function (section) {
        const groups = (section.groups || []).length
          ? '<div class="group-grid">' + section.groups.map(function (group) {
              return renderGroup(group, phaseId);
            }).join("") + "</div>"
          : '<div class="empty-state">No active items in this section for the current batch plan.</div>';

        return (
          '<section class="content-section">' +
            '<div class="content-section-header">' +
              "<h3>" + escapeHtml(section.title) + "</h3>" +
              (section.body ? "<p>" + escapeHtml(section.body) + "</p>" : "") +
            "</div>" +
            groups +
          "</section>"
        );
      }).join("");
    }

    function renderGroup(group, phaseId) {
      const checkedMap = getCheckedMap(phaseId);
      let checklistMarkup = "";

      if (group.items && group.items.length) {
        checklistMarkup = '<div class="checklist">' + group.items.map(function (item) {
          const checked = Boolean(checkedMap[item.id]);
          const optionalTag = item.optional ? '<span class="optional-tag">Optional</span>' : "";

          return (
            '<label class="check-item' + (checked ? " is-complete" : "") + '">' +
              '<input type="checkbox" data-phase-item="' + escapeHtml(item.id) + '"' + (checked ? " checked" : "") + " />" +
              '<span class="check-ui" aria-hidden="true"></span>' +
              '<span class="check-copy">' +
                '<span class="check-text">' + escapeHtml(item.text) + "</span>" +
                (item.meta ? '<span class="check-meta">' + escapeHtml(item.meta) + "</span>" : "") +
              "</span>" +
              optionalTag +
            "</label>"
          );
        }).join("") + "</div>";
      } else if (group.staticItems && group.staticItems.length) {
        checklistMarkup = '<div class="checklist">' + group.staticItems.map(function (item) {
          return (
            '<div class="static-item">' +
              '<span class="static-text">' + escapeHtml(item) + "</span>" +
            "</div>"
          );
        }).join("") + "</div>";
      } else {
        checklistMarkup = '<div class="empty-state">Nothing is active here for the current plan.</div>';
      }

      return (
        '<article class="group-card">' +
          "<h4>" + escapeHtml(group.title) + "</h4>" +
          (group.subtitle ? '<p class="group-subtitle">' + escapeHtml(group.subtitle) + "</p>" : "") +
          (group.note ? '<p class="group-note">' + escapeHtml(group.note) + "</p>" : "") +
          checklistMarkup +
        "</article>"
      );
    }

    function renderAside(cards) {
      if (!cards.length) {
        return '<div class="empty-state">No side notes for this phase.</div>';
      }

      return cards.map(function (card) {
        const items = (card.items || []).length
          ? "<ul>" + card.items.map(function (item) {
              return "<li>" + escapeHtml(item) + "</li>";
            }).join("") + "</ul>"
          : "";

        return (
          '<article class="aside-card is-' + escapeHtml(card.tone || "warm") + '">' +
            "<h3>" + escapeHtml(card.title) + "</h3>" +
            (card.body ? "<p>" + escapeHtml(card.body) + "</p>" : "") +
            items +
          "</article>"
        );
      }).join("");
    }

    function renderPhases() {
      const phases = recipe.getPhases();
      const phaseDataById = {};

      phases.forEach(function (phase) {
        phaseDataById[phase.id] = recipe.buildPhase(phase.id, recipeState.counts);
      });

      els.phaseNav.innerHTML = phases.map(function (phase) {
        const phaseData = phaseDataById[phase.id];
        const progress = getPhaseProgress(phase.id, phaseData);

        return (
          '<button class="phase-tab' + (phase.id === recipeState.activePhase ? " is-active" : "") + '" type="button" data-phase="' + escapeHtml(phase.id) + '">' +
            '<span class="phase-tab-title">' + escapeHtml(phase.label) + "</span>" +
            '<span class="phase-tab-meta">' +
              "<span>" + progress.percent + "% complete</span>" +
              '<span class="tab-count">' + progress.completed + "/" + progress.total + "</span>" +
            "</span>" +
          "</button>"
        );
      }).join("");

      const active = phaseDataById[recipeState.activePhase];
      const activeProgress = getPhaseProgress(recipeState.activePhase, active);

      els.phaseKicker.textContent = active.header.kicker;
      els.phaseTitle.textContent = active.header.title;
      els.phaseDescription.textContent = active.header.description;

      els.phaseProgress.innerHTML = (
        '<span class="progress-number">' + activeProgress.percent + "%</span>" +
        '<p class="progress-copy">' +
          (activeProgress.total
            ? (activeProgress.completed + " of " + activeProgress.total + " checklist items complete")
            : "Reference notes only in this phase") +
        "</p>"
      );

      els.highlights.innerHTML = (active.highlights || []).map(function (highlight) {
        return (
          '<article class="callout-card">' +
            "<strong>" + escapeHtml(highlight.label) + "</strong>" +
            "<span>" + escapeHtml(highlight.value) + "</span>" +
          "</article>"
        );
      }).join("");

      els.content.innerHTML = renderSections(active.sections || [], recipeState.activePhase);
      els.aside.innerHTML = renderAside(active.aside || []);
    }

    function renderAll() {
      renderHero();
      renderPlanner();
      renderPhases();
      saveState();
    }

    function setCount(controlId, nextValue) {
      const controls = recipe.getControls();
      const control = controls.find(function (item) {
        return item.id === controlId;
      });

      if (!control) {
        return;
      }

      const safeValue = Number.isFinite(nextValue) ? Math.round(nextValue) : control.defaultValue;
      recipeState.counts[controlId] = Math.max(control.min, Math.min(control.max, safeValue));
      renderAll();
    }

    els.app.addEventListener("click", function (event) {
      const adjustButton = event.target.closest("[data-adjust]");
      if (adjustButton) {
        const id = adjustButton.getAttribute("data-adjust");
        const step = Number(adjustButton.getAttribute("data-step") || 0);
        setCount(id, recipeState.counts[id] + step);
        return;
      }

      const presetButton = event.target.closest("[data-preset-index]");
      if (presetButton && recipe.getPresets) {
        const presetIndex = Number(presetButton.getAttribute("data-preset-index"));
        const preset = recipe.getPresets()[presetIndex];

        if (preset) {
          recipeState.counts = recipe.normalizeCounts(preset.values);
          renderAll();
        }
        return;
      }

      const phaseButton = event.target.closest("[data-phase]");
      if (phaseButton) {
        recipeState.activePhase = phaseButton.getAttribute("data-phase");
        renderAll();
        return;
      }

      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        const action = actionButton.getAttribute("data-action");

        if (action === "sync-dough") {
          recipeState.counts.dough = recipe.getOverview(recipeState.counts).recommendedDough;
          renderAll();
        }

        if (action === "reset-progress") {
          const confirmed = window.confirm("Clear every shopping, prep, and cook checkbox for this recipe?");
          if (confirmed) {
            recipeState.checked = {};
            renderAll();
          }
        }
      }
    });

    els.app.addEventListener("change", function (event) {
      const countInput = event.target.closest("[data-count-id]");
      if (countInput) {
        const id = countInput.getAttribute("data-count-id");
        setCount(id, Number(countInput.value));
        return;
      }

      const checkbox = event.target.closest("[data-phase-item]");
      if (checkbox) {
        const activePhase = recipeState.activePhase;
        const checkedMap = getCheckedMap(activePhase);
        checkedMap[checkbox.getAttribute("data-phase-item")] = checkbox.checked;
        renderAll();
      }
    });

    renderAll();
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (document.body.getAttribute("data-page") === "landing") {
      renderLanding();
    }

    if (document.body.getAttribute("data-page") === "recipe") {
      initRecipePage();
    }
  });
})();
