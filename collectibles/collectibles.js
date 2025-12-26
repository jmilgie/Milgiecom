// Scroll-driven chapter + background + reveal effects

const chapterEl = document.getElementById("railChapter");
const progressBarEl = document.getElementById("railProgressBar");
const railLinks = Array.from(document.querySelectorAll(".rail-link"));

const observed = Array.from(document.querySelectorAll(".observe"));
const revealTargets = Array.from(document.querySelectorAll(".reveal"));

function setActiveRailLink(chapter) {
  railLinks.forEach(a => {
    a.classList.toggle("active", a.dataset.chapter === chapter);
  });
}

function setBg(bgIndex) {
  const body = document.body;
  body.classList.remove("bg-0", "bg-1", "bg-2", "bg-3");
  body.classList.add(`bg-${bgIndex}`);
}

function updateProgress() {
  // Page scroll percent
  const doc = document.documentElement;
  const scrollTop = doc.scrollTop || document.body.scrollTop;
  const scrollHeight = doc.scrollHeight - doc.clientHeight;
  const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  progressBarEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

window.addEventListener("scroll", updateProgress, { passive: true });
updateProgress();

// Observe sections to update chapter and bg
const sectionObserver = new IntersectionObserver((entries) => {
  // Choose the entry most visible (intersectionRatio highest)
  const visible = entries
    .filter(e => e.isIntersecting)
    .sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];

  if (!visible) return;

  const chapter = visible.target.getAttribute("data-chapter") || "";
  const bg = visible.target.getAttribute("data-bg");

  if (chapterEl && chapter) chapterEl.textContent = chapter;
  if (bg !== null && bg !== undefined) setBg(bg);

  setActiveRailLink(chapter);
}, {
  root: null,
  threshold: [0.22, 0.35, 0.50, 0.65]
});

observed.forEach(el => sectionObserver.observe(el));

// Reveal cards
const revealObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add("in");
      revealObserver.unobserve(e.target);
    }
  }
}, { threshold: 0.15 });

revealTargets.forEach(el => revealObserver.observe(el));
