function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildShell(root, title, subtitle) {
  root.innerHTML = `
    <div class="mini-overlay">
      <div class="mini-card">
        <button class="mini-close" type="button" data-mini-close>Close</button>
        <div class="mini-kicker">Heist Sequence</div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
        <div class="mini-stage" id="miniStage"></div>
      </div>
    </div>
  `;
  return root.querySelector("#miniStage");
}

export function launchMiniGame(root, config) {
  if (config.type === "safe") {
    return launchSafeGame(root, config);
  }
  if (config.type === "signal") {
    return launchSignalGame(root, config);
  }
  return launchChaseGame(root, config);
}

function launchSafeGame(root, config) {
  const stage = buildShell(root, "Ghost Cut", "Stop the dial inside the neon window three times.");
  stage.innerHTML = `
    <div class="mini-metric">Round <span id="safeRound">1</span>/3</div>
    <div class="safe-shell">
      <div class="safe-track">
        <div class="safe-target" id="safeTarget"></div>
        <div class="safe-needle" id="safeNeedle"></div>
      </div>
    </div>
    <div class="mini-result" id="safeResult">Tap or press space when the needle crosses the lit band.</div>
    <button class="mini-action" id="safeStop">Stop the dial</button>
  `;

  const target = stage.querySelector("#safeTarget");
  const needle = stage.querySelector("#safeNeedle");
  const roundLabel = stage.querySelector("#safeRound");
  const resultLabel = stage.querySelector("#safeResult");
  const stopButton = stage.querySelector("#safeStop");
  const closeButton = root.querySelector("[data-mini-close]");

  let resolvePromise;
  let frameId = 0;
  let current = 0;
  let direction = 1;
  let round = 0;
  let totalScore = 0;
  let targetStart = 20;
  let targetSize = 28;
  let finished = false;
  let roundLocked = false;

  const finish = (score) => {
    if (finished) {
      return;
    }
    finished = true;
    cancelAnimationFrame(frameId);
    window.removeEventListener("keydown", onKeyDown);
    resolvePromise(clamp(score, 0, 1));
  };

  const rollRound = () => {
    round += 1;
    if (round > 3) {
      resultLabel.textContent = "Dial cracked.";
      window.setTimeout(() => finish(totalScore / 3), 450);
      return;
    }
    roundLabel.textContent = String(round);
    targetSize = 28 - (round - 1) * 6;
    targetStart = 15 + Math.random() * (85 - targetSize);
    target.style.left = `${targetStart}%`;
    target.style.width = `${targetSize}%`;
    resultLabel.textContent = round === 1 ? "Keep it steady." : "Tighter window. Stay cool.";
    current = 0;
    direction = 1;
    roundLocked = false;
    stopButton.disabled = false;
  };

  const animate = () => {
    current += direction * (0.55 + round * 0.06);
    if (current >= 100) {
      current = 100;
      direction = -1;
    } else if (current <= 0) {
      current = 0;
      direction = 1;
    }
    needle.style.left = `${current}%`;
    frameId = requestAnimationFrame(animate);
  };

  const stopNeedle = () => {
    if (finished || roundLocked) {
      return;
    }
    roundLocked = true;
    stopButton.disabled = true;

    const targetCenter = targetStart + targetSize / 2;
    const distance = Math.abs(current - targetCenter);
    const success = distance <= targetSize / 2;
    const roundScore = success ? 1 - distance / (targetSize / 2) : 0;
    totalScore += roundScore;
    resultLabel.textContent = success ? "Window clean. Move." : "Too wide. Recover.";
    window.setTimeout(rollRound, 450);
  };

  const onKeyDown = (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      stopNeedle();
    }
  };

  closeButton.addEventListener("click", () => finish(0));
  stopButton.addEventListener("click", stopNeedle);
  window.addEventListener("keydown", onKeyDown);
  rollRound();
  animate();

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}

function launchSignalGame(root, config) {
  const stage = buildShell(root, "Glitch Veil", "Repeat the node sequence before the trace closes.");
  const tiles = Array.from({ length: 9 }, (_, index) => `<button class="signal-tile" type="button" data-signal-index="${index}">${index + 1}</button>`).join("");
  stage.innerHTML = `
    <div class="mini-metric">Repeat 4 steps</div>
    <div class="signal-grid">${tiles}</div>
    <div class="mini-result" id="signalResult">Watch the circuit, then echo it.</div>
  `;

  const closeButton = root.querySelector("[data-mini-close]");
  const buttons = [...stage.querySelectorAll("[data-signal-index]")];
  const resultLabel = stage.querySelector("#signalResult");
  const sequence = [];
  let resolvePromise;
  let accepting = false;
  let pointer = 0;
  let finished = false;

  while (sequence.length < 4) {
    const next = Math.floor(Math.random() * 9);
    if (!sequence.includes(next) || Math.random() < 0.3) {
      sequence.push(next);
    }
  }

  const finish = (score) => {
    if (finished) {
      return;
    }
    finished = true;
    buttons.forEach((button) => {
      button.disabled = true;
    });
    resolvePromise(clamp(score, 0, 1));
  };

  const flashTile = (index, delay) => {
    window.setTimeout(() => {
      buttons[index].classList.add("lit");
      window.setTimeout(() => buttons[index].classList.remove("lit"), 280);
    }, delay);
  };

  const reveal = () => {
    accepting = false;
    resultLabel.textContent = "Reading sequence...";
    sequence.forEach((index, seqIndex) => flashTile(index, seqIndex * 500));
    window.setTimeout(() => {
      accepting = true;
      resultLabel.textContent = "Your turn.";
    }, sequence.length * 500 + 120);
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!accepting || finished) {
        return;
      }

      const index = Number(button.dataset.signalIndex);
      button.classList.add("lit");
      window.setTimeout(() => button.classList.remove("lit"), 180);

      if (index === sequence[pointer]) {
        pointer += 1;
        if (pointer >= sequence.length) {
          resultLabel.textContent = "Trace spoofed.";
          window.setTimeout(() => finish(1), 250);
        } else {
          resultLabel.textContent = `${pointer}/${sequence.length} clean`;
        }
      } else {
        resultLabel.textContent = "Trace snapped.";
        window.setTimeout(() => finish(pointer / sequence.length), 250);
      }
    });
  });

  closeButton.addEventListener("click", () => finish(0));
  reveal();

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}

function launchChaseGame(root, config) {
  const stage = buildShell(root, "Hammer Exit", "Stay off the barricades until the tunnel opens.");
  stage.innerHTML = `
    <div class="mini-metric">Survive 10 seconds / 3 integrity</div>
    <div class="chase-shell">
      <div class="chase-road" id="chaseRoad"></div>
      <div class="chase-car lane-1" id="chaseCar"></div>
    </div>
    <div class="chase-controls">
      <button class="mini-action" type="button" id="chaseLeft">Left</button>
      <button class="mini-action" type="button" id="chaseRight">Right</button>
    </div>
    <div class="mini-result" id="chaseResult">Slide lanes with buttons or arrow keys.</div>
  `;

  const closeButton = root.querySelector("[data-mini-close]");
  const road = stage.querySelector("#chaseRoad");
  const car = stage.querySelector("#chaseCar");
  const resultLabel = stage.querySelector("#chaseResult");
  const leftButton = stage.querySelector("#chaseLeft");
  const rightButton = stage.querySelector("#chaseRight");
  let resolvePromise;
  let frameId = 0;
  let lane = 1;
  let lastSpawn = performance.now();
  let start = performance.now();
  let health = 3;
  let finished = false;
  const obstacles = [];

  const finish = (score) => {
    if (finished) {
      return;
    }
    finished = true;
    cancelAnimationFrame(frameId);
    window.removeEventListener("keydown", onKeyDown);
    resolvePromise(clamp(score, 0, 1));
  };

  const setLane = (nextLane) => {
    lane = clamp(nextLane, 0, 2);
    car.className = `chase-car lane-${lane}`;
  };

  const spawnObstacle = () => {
    const element = document.createElement("div");
    const obstacle = {
      lane: Math.floor(Math.random() * 3),
      y: -16,
      hit: false,
      element,
    };
    element.className = `chase-obstacle lane-${obstacle.lane}`;
    road.appendChild(element);
    obstacles.push(obstacle);
  };

  const onKeyDown = (event) => {
    if (event.code === "ArrowLeft") {
      event.preventDefault();
      setLane(lane - 1);
    }
    if (event.code === "ArrowRight") {
      event.preventDefault();
      setLane(lane + 1);
    }
  };

  const loop = (time) => {
    const elapsed = (time - start) / 1000;
    if (time - lastSpawn > 700) {
      spawnObstacle();
      lastSpawn = time;
    }

    obstacles.forEach((obstacle) => {
      obstacle.y += 1.35;
      obstacle.element.style.transform = `translateY(${obstacle.y}%)`;
      if (!obstacle.hit && obstacle.lane === lane && obstacle.y > 72 && obstacle.y < 90) {
        obstacle.hit = true;
        health -= 1;
        resultLabel.textContent = `Integrity hit. ${health} left.`;
        obstacle.element.classList.add("hit");
        if (health <= 0) {
          finish(elapsed / 10 * 0.45);
        }
      }
    });

    while (obstacles.length && obstacles[0].y > 110) {
      obstacles.shift().element.remove();
    }

    if (elapsed >= 10) {
      resultLabel.textContent = "Tunnel clear.";
      finish(elapsed / 10 * 0.65 + health / 3 * 0.35);
      return;
    }

    if (!finished) {
      frameId = requestAnimationFrame(loop);
    }
  };

  closeButton.addEventListener("click", () => finish(0));
  leftButton.addEventListener("click", () => setLane(lane - 1));
  rightButton.addEventListener("click", () => setLane(lane + 1));
  window.addEventListener("keydown", onKeyDown);
  frameId = requestAnimationFrame(loop);

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}
