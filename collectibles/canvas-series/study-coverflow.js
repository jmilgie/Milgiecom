/* study-coverflow.js
   REBUILT: line-efficient, non-duplicative, same behavior
   - Coverflow (click-to-focus, prev/next buttons, dots, keyboard, swipe)
   - Selected study copy (under carousel)
   - About viewer (thumbs update big viewer, active thumb state, certificate link passthrough)
*/
(() => {
  "use strict";

  // ---------------------------
  // Helpers
  // ---------------------------
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const mod = (n, m) => ((n % m) + m) % m;

  // =====================================================================
  // COVERFLOW
  // =====================================================================
  const root = $("#studyCoverflow");
  if (root) {
    const track = $("#coverflowTrack");
    const viewport = $("#coverflowViewport");
    const now = $("#coverflowNow");
    const dotsHost = $("#coverflowDots");

    const studyWrap = $("#coverflowStudy");
    const studyTitle = $("#coverflowStudyTitle");
    const studyBody = $("#coverflowStudyBody");

    const cards = track ? $$(".cf-card", track) : [];

    // Hard guard: if any required piece is missing, bail without side effects.
    const ok =
      track &&
      viewport &&
      now &&
      dotsHost &&
      studyWrap &&
      studyTitle &&
      studyBody &&
      cards.length > 0;

    if (ok) {
      // Stable card indices for delegated click -> setIndex()
      cards.forEach((c, i) => (c.dataset.idx = String(i)));

      // Study copy (from your removed "Included Studies" section)
      const STUDY_COPY = {
        "#study-spongebob": [
          "This canvas presents SpongeBob SquarePants as an exercise in sustained optimism and professional devotion. The figure is rendered with open posture and forward orientation, suggesting availability, readiness, and emotional transparency.",
          "Despite a simplified form, the subject conveys remarkable narrative density. Enthusiasm is not depicted as chaos, but as structure — a consistent state maintained through repetition and effort.",
          "This piece functions as an anchor for the edition."
        ],
        "#study-patrick": [
          "Patrick Star is represented as a study in stillness, negative space, and unburdened presence. The composition emphasizes simplicity, allowing form and expression to remain largely uninterrupted by context.",
          "Within the collection, this work provides contrast and relief — reinforcing the value of absence as a compositional tool."
        ],
        "#study-squidward": [
          "This canvas examines restraint, detachment, and internalized judgment. The posture conveys distance maintained as a discipline.",
          "As part of the collection, this piece introduces tension and balance — grounding the ensemble through controlled opposition."
        ],
        "#study-krabs": [
          "Mr. Krabs is rendered as a study in accumulation, vigilance, and transactional awareness. The stance suggests control exercised through continual evaluation.",
          "Within the collection, this work functions as a commentary on systems of value and the behaviors they reinforce."
        ],
        "#study-gary": [
          "This canvas presents Gary with minimal intervention, allowing form and placement to define the work. Motion is implied rather than depicted, emphasizing patience and continuity.",
          "As part of the collection, this piece reinforces pacing and visual rest."
        ],
        "#study-sandy": [
          "Sandy Cheeks is represented as a study in adaptability, preparedness, and applied intellect. The posture suggests capability without performance.",
          "Within the collection, this canvas introduces dimensionality through contrast — land and sea, structure and exploration."
        ]
      };

      // State
      let index = 0;

      // Optional: auto-rotate like a museum display
      const AUTO_ROTATE = false;
      const AUTO_MS = 4500;
      let autoTimer = null;

      // Swipe state
      let startX = null;
      let startY = null;
      let moved = false;

      const SWIPE_THRESHOLD = 40;
      const MOVE_TOLERANCE = 8; // below this is considered a "tap/click"

      // ---------------------------
      // Rendering
      // ---------------------------
      const renderStudyForCard = (card) => {
        const title = card?.dataset?.title || "";
        const key = card?.dataset?.anchor || "";
        const paras = STUDY_COPY[key] || ["No study text is available for this entry yet."];

        studyTitle.textContent = title;
        // Static copy you control; keeping innerHTML for <p> blocks (same as original behavior)
        studyBody.innerHTML = paras.map((p) => `<p>${p}</p>`).join("");
      };

      const updateDots = () => {
        const dots = $$(".cf-dot", dotsHost);
        dots.forEach((d, i) => d.classList.toggle("active", i === index));
      };

      const buildDots = () => {
        dotsHost.innerHTML = "";
        cards.forEach((_, i) => {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "cf-dot";
          dot.setAttribute("aria-label", `Go to item ${i + 1}`);
          dot.addEventListener("click", () => setIndex(i));
          dotsHost.appendChild(dot);
        });
      };

      const layout = () => {
        const N = cards.length;

        // These must match your CSS reserves
        const vpH = viewport.clientHeight || 760;
        const controlsReserve = 78; // CSS padding-bottom
        const topReserve = 14; // CSS padding-top
        const usableH = Math.max(0, vpH - controlsReserve - topReserve);
        const usableCenter = topReserve + usableH / 2;
        const y = usableCenter - vpH / 2;

        cards.forEach((card, i) => {
          let o = i - index;

          // circular wrap so near items remain near
          if (o > N / 2) o -= N;
          if (o < -N / 2) o += N;

          const visibleRange = 2; // center + 2 each side
          const isVisible = Math.abs(o) <= visibleRange;
          const isCenter = o === 0;

          // Your tuned transforms
          const x = o * 280;
          const z = isCenter ? 220 : 0 - Math.abs(o) * 70;
          const rotY = o * -22;
          const scale = isCenter ? 1.0 : 0.9 - Math.abs(o) * 0.04;

          card.classList.toggle("is-center", isCenter);
          card.style.opacity = isVisible ? "1" : "0";
          card.style.pointerEvents = isVisible ? "auto" : "none";
          card.style.zIndex = String(200 - Math.abs(o));

          card.style.transform =
            `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), ${z}px)` +
            ` rotateY(${rotY}deg) scale(${scale})`;
        });

        now.textContent = cards[index]?.dataset?.title || "";
        renderStudyForCard(cards[index]);
        updateDots();
      };

      // ---------------------------
      // Navigation + Auto rotate
      // ---------------------------
      const restartAuto = () => {
        if (!AUTO_ROTATE) return;
        if (autoTimer) window.clearInterval(autoTimer);
        autoTimer = window.setInterval(next, AUTO_MS);
      };

      const pauseAuto = () => {
        if (autoTimer) window.clearInterval(autoTimer);
        autoTimer = null;
      };

      const setIndex = (i) => {
        index = mod(i, cards.length);
        layout();
        restartAuto();
      };

      const next = () => setIndex(index + 1);
      const prev = () => setIndex(index - 1);

      // ---------------------------
      // Click handlers
      // ---------------------------

      // Prev/Next buttons (delegated at root)
      root.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-cf]");
        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const dir = btn.getAttribute("data-cf");
        if (dir === "next") next();
        else if (dir === "prev") prev();
      });

      // Track delegated click:
      // - Click action button on CENTER card -> jump/scroll
      // - Click non-center visible card -> focus (bring to center)
      track.addEventListener("click", (e) => {
        const card = e.target.closest(".cf-card");
        if (!card) return;

        const btn = e.target.closest("[data-jump]");
        const isCenter = card.classList.contains("is-center");
        const i = Number(card.dataset.idx);

        // Action button behavior (center-only)
        if (btn) {
          if (!isCenter) return;

          const anchor = btn.getAttribute("data-jump");
          if (!anchor) return;

          const target = document.querySelector(anchor);
          (target || studyWrap).scrollIntoView({ behavior: "smooth", block: target ? "start" : "nearest" });
          return;
        }

        // Click-to-focus on any visible non-center card
        if (!isCenter) {
          e.preventDefault();
          e.stopPropagation();
          setIndex(i);
        }
      });

      // ---------------------------
      // Keyboard
      // ---------------------------
      viewport.addEventListener("keydown", (e) => {
        const k = e.key;
        if (k === "ArrowRight") { e.preventDefault(); next(); }
        else if (k === "ArrowLeft") { e.preventDefault(); prev(); }
        else if (k === "Home") { e.preventDefault(); setIndex(0); }
        else if (k === "End") { e.preventDefault(); setIndex(cards.length - 1); }
      });

      // ---------------------------
      // Touch / pointer swipe
      // ---------------------------
      viewport.addEventListener("pointerdown", (e) => {
        if (!e.isPrimary) return;

        startX = e.clientX;
        startY = e.clientY;
        moved = false;

        // Capture for touch/pen to keep gesture stable; skip for mouse for click feel.
        if (e.pointerType !== "mouse") {
          try { viewport.setPointerCapture(e.pointerId); } catch {}
        }
      });

      viewport.addEventListener("pointermove", (e) => {
        if (startX == null || !e.isPrimary) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) moved = true;
      });

      viewport.addEventListener("pointerup", (e) => {
        if (startX == null || !e.isPrimary) return;

        const dx = e.clientX - startX;

        // reset first
        startX = null;
        startY = null;

        // If they swiped horizontally, rotate
        if (moved && Math.abs(dx) > SWIPE_THRESHOLD) dx < 0 ? next() : prev();
      });

      viewport.addEventListener("pointercancel", () => {
        startX = null;
        startY = null;
        moved = false;
      });

      // Pause on hover/focus (museum etiquette)
      root.addEventListener("mouseenter", pauseAuto);
      root.addEventListener("mouseleave", restartAuto);
      root.addEventListener("focusin", pauseAuto);
      root.addEventListener("focusout", restartAuto);

      // Keep responsive
      window.addEventListener("resize", layout, { passive: true });

      // Init
      buildDots();
      layout();
      restartAuto();
    }
  }

  // =====================================================================
  // ABOUT VIEWER (thumbs -> big viewer)
  // =====================================================================
  const viewer = $("#aboutViewer");
  const viewerImg = $("#aboutViewerImg");
  const viewerLabel = $("#aboutViewerLabel");

  if (viewer && viewerImg && viewerLabel) {
    const thumbs = $$(".asset-row .asset-slot.asset-small.is-clickable");
    if (thumbs.length) {
      const setActiveThumb = (el) => thumbs.forEach((t) => t.classList.toggle("is-active", t === el));

      const setViewer = (src, title) => {
        if (!src) return;

        viewerImg.src = src;
        viewerLabel.textContent = title || "VIEWER";
        viewerImg.alt = title ? `${title} (expanded view)` : "Expanded view";

        viewer.dataset.viewSrc = src;
        viewer.dataset.viewTitle = title || "";
      };

      // Initialize to whatever the viewer already says (HTML defaults to montage)
      setViewer(viewer.dataset.viewSrc || viewerImg.src, viewer.dataset.viewTitle || viewerLabel.textContent);

      // Thumb clicks
      thumbs.forEach((thumb) => {
        thumb.addEventListener("click", (e) => {
          // If they clicked the CERTIFICATE label link, let it jump to #certificate
          if (e.target.closest("a[href^='#']")) return;

          const src = thumb.getAttribute("data-view-src");
          const title = thumb.getAttribute("data-view-title");
          if (!src) return;

          setViewer(src, title);
          setActiveThumb(thumb);

          // Smoothly scroll viewer into view if user is lower
          viewer.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });

      // Click big viewer to cycle back to montage
      viewer.addEventListener("click", () => {
        const src = viewer.getAttribute("data-view-src") || "./assets/montage-boxback.png";
        const title = viewer.getAttribute("data-view-title") || "MONTAGE / BOX BACK";
        setViewer(src, title);

        const montageThumb = thumbs.find((t) =>
          (t.getAttribute("data-view-title") || "").toUpperCase().includes("MONTAGE")
        );
        if (montageThumb) setActiveThumb(montageThumb);
      });
    }
  }
})();
