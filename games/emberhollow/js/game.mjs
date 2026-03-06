import * as THREE from '../vendor/three.module.js';
import { AudioController } from './audio.mjs';
import { ABILITY_META, LEVELS, SAVE_KEY } from './levels.mjs';
import {
  THEMES,
  buildLevelGeometry,
  createObjectVisual,
  makeImpactBurst,
  tileToWorld,
  worldToTile,
  isBaseSolid,
  isHazard,
} from './world.mjs';

const ENEMY_STATS = {
  crawler: { maxHp: 3, speed: 4.2, range: 1.5, damage: 1, cooldown: 1.1, shards: 3 },
  wisp: { maxHp: 2, speed: 2.9, range: 8.5, damage: 1, cooldown: 1.8, shards: 4 },
  warden: { maxHp: 6, speed: 2.6, range: 7.5, damage: 1, cooldown: 1.6, shards: 6 },
  vaultKing: { maxHp: 24, speed: 1.6, shards: 0 },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function setEntityTag(root, entityId) {
  root.traverse((child) => {
    child.userData.entityId = entityId;
  });
}

function defaultState() {
  return {
    levelId: 'town',
    spawnTag: 'default',
    health: 5,
    maxHealth: 5,
    shards: 0,
    shotLevel: 1,
    abilities: {
      lantern: false,
      dash: false,
      magnet: false,
      forgeHeart: false,
      starfall: false,
      wayfinder: false,
    },
    flags: {
      elderIntro: false,
      bossCleared: false,
      skyVaultOpened: false,
      marketUnlocked: false,
    },
    openedChests: [],
    brokenPots: [],
    claimedPedestals: [],
    destroyedTiles: [],
    clearedGroups: [],
    defeatedEnemies: [],
    notes: [],
  };
}

export class EmberhollowGame {
  constructor(dom) {
    this.dom = dom;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.state = this.loadState();
    this.audio = new AudioController();
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 240);
    this.camera.rotation.order = 'YXZ';

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.dom.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.player = {
      position: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      radius: 0.54,
      moveSpeed: 8.6,
      sprint: 1.25,
      dashTimer: 0,
      dashCooldown: 0,
      invuln: 0,
      hurtCooldown: 0,
      bob: 0,
      shotCooldown: 0,
      magnetCooldown: 0,
      novaCooldown: 0,
      knockback: new THREE.Vector3(),
    };

    this.level = null;
    this.levelRoot = null;
    this.themeLights = [];
    this.levelAnimators = [];
    this.entities = new Map();
    this.groupStates = new Map();
    this.enemyEntities = [];
    this.interactables = [];
    this.gates = new Map();
    this.staticCrackedTiles = new Map();
    this.raycastRoots = [];
    this.particles = [];
    this.projectiles = [];
    this.pickups = [];
    this.promptEntity = null;
    this.pointerLocked = false;
    this.overlayVisible = true;
    this.flashAmount = 0;
    this.shakeAmount = 0;

    this.input = {
      keys: new Set(),
      movePad: new THREE.Vector2(),
      lookPad: new THREE.Vector2(),
      movePointer: null,
      lookPointer: null,
    };

    this.raycaster = new THREE.Raycaster();

    this.buildBaseScene();
    this.bindEvents();
    this.setupTouchControls();
    this.showStartScreen();
    this.renderHud();
    this.loop();
  }

  buildBaseScene() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  }

  loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        abilities: { ...base.abilities, ...(parsed.abilities || {}) },
        flags: { ...base.flags, ...(parsed.flags || {}) },
        openedChests: parsed.openedChests || base.openedChests,
        brokenPots: parsed.brokenPots || base.brokenPots,
        claimedPedestals: parsed.claimedPedestals || base.claimedPedestals,
        destroyedTiles: parsed.destroyedTiles || base.destroyedTiles,
        clearedGroups: parsed.clearedGroups || base.clearedGroups,
        defeatedEnemies: parsed.defeatedEnemies || base.defeatedEnemies,
        notes: parsed.notes || base.notes,
      };
    } catch {
      return defaultState();
    }
  }

  saveState() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Tab') {
        event.preventDefault();
        if (!this.overlayVisible) this.openJournal();
        return;
      }

      if (event.code === 'Escape') {
        if (!this.overlayVisible) this.openPauseMenu();
        return;
      }

      this.input.keys.add(event.code);
      if (this.overlayVisible) return;

      if (event.code === 'KeyE') this.tryInteract();
      if (event.code === 'KeyQ') this.useMagnet();
      if (event.code === 'KeyF') this.useStarfall();
      if (event.code === 'Space') this.tryDash();
    });

    window.addEventListener('keyup', (event) => {
      this.input.keys.delete(event.code);
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked || this.overlayVisible || this.isTouch) return;
      this.player.yaw -= event.movementX * 0.0024;
      this.player.pitch -= event.movementY * 0.0022;
      this.player.pitch = clamp(this.player.pitch, -1.32, 1.32);
    });

    this.dom.canvas.addEventListener('mousedown', async (event) => {
      if (this.overlayVisible) return;
      await this.audio.resume();
      if (!this.isTouch && !this.pointerLocked) {
        this.requestPointerLock();
        return;
      }
      if (event.button === 0) this.shoot();
      if (event.button === 2) this.tryDash();
    });

    this.dom.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom.canvas;
      if (!this.pointerLocked && !this.overlayVisible && !this.isTouch) {
        this.openPauseMenu();
      }
    });
  }

  setupTouchControls() {
    if (!this.isTouch) return;
    this.dom.touchControls.classList.remove('hidden');

    const attachPad = (pad, thumb, key) => {
      const pointerKey = key === 'movePad' ? 'movePointer' : 'lookPointer';
      const setVector = (event) => {
        const rect = pad.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const radius = rect.width * 0.34;
        const vec = new THREE.Vector2(event.clientX - cx, event.clientY - cy);
        if (vec.length() > radius) vec.setLength(radius);
        thumb.style.transform = `translate(${vec.x}px, ${vec.y}px)`;
        this.input[key].set(vec.x / radius, vec.y / radius);
      };

      const clear = (event) => {
        if (this.input[pointerKey] !== event.pointerId) return;
        this.input[pointerKey] = null;
        this.input[key].set(0, 0);
        thumb.style.transform = 'translate(0px, 0px)';
      };

      pad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        pad.setPointerCapture(event.pointerId);
        this.input[pointerKey] = event.pointerId;
        setVector(event);
      });
      pad.addEventListener('pointermove', (event) => {
        if (this.input[pointerKey] !== event.pointerId) return;
        setVector(event);
      });
      pad.addEventListener('pointerup', clear);
      pad.addEventListener('pointercancel', clear);
    };

    attachPad(this.dom.movePad, this.dom.moveThumb, 'movePad');
    attachPad(this.dom.lookPad, this.dom.lookThumb, 'lookPad');

    this.dom.touchShoot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.overlayVisible) this.shoot();
    });
    this.dom.touchInteract.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.overlayVisible) this.tryInteract();
    });
    this.dom.touchDash.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.overlayVisible) this.tryDash();
    });
    this.dom.touchHook.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.overlayVisible) this.useMagnet();
    });
    this.dom.touchNova.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.overlayVisible) this.useStarfall();
    });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  requestPointerLock() {
    if (this.isTouch) return;
    this.dom.canvas.requestPointerLock?.();
  }

  async startAdventure({ fresh = false } = {}) {
    if (fresh) {
      this.state = defaultState();
      this.saveState();
    }
    await this.audio.resume();
    this.hideModal(true);
    this.loadLevel(this.state.levelId || 'town', this.state.spawnTag || 'default');
  }

  showStartScreen() {
    const hasSave = !!localStorage.getItem(SAVE_KEY);
    const controls = this.isTouch
      ? 'Move with the left pad, look with the right pad, and use the buttons for shoot, interact, dash, hook, and nova.'
      : 'WASD move, mouse look, left click shoot, E interact, Q hook, Space or right click dash, F nova, Tab journal.';
    const featurePills = [
      'Bellroot and Starlight Row',
      'Archive side path',
      'Relics and shrine upgrades',
      'Boss nova reward',
      'Local soundtrack',
      'Modular level data',
    ].map((label) => `<span class="feature-pill">${label}</span>`).join('');

    this.showModal({
      panelClass: 'start-panel',
      html: `
        <section class="start-hero">
          <img class="start-art" src="./assets/ui/title-card.svg" alt="Emberhollow title art" />
          <div class="start-copy">
            <div class="modal-eyebrow">Three.js Adventure</div>
            <h2 class="modal-title">Bellroot is open. Echo Cave is waiting.</h2>
            <p class="modal-body">A modular first-person action-puzzle RPG with a town hub, layered cave floors, optional archive route, modular upgrades, and a boss strong enough to justify its own legend.</p>
            <div class="feature-pills">${featurePills}</div>
            <section class="start-card">
              <h3>Controls</h3>
              <p>${controls}</p>
            </section>
            <section class="start-card">
              <h3>Run Notes</h3>
              <p>Autosaves on transitions, relic claims, important pickups, and boss milestones. The score and UI sigils load locally with the game.</p>
            </section>
          </div>
        </section>
      `,
      buttons: [
        ...(hasSave ? [{ label: 'Continue', action: () => this.startAdventure() }] : []),
        { label: hasSave ? 'New Quest' : 'Begin', accent: 'primary', action: () => this.startAdventure({ fresh: true }) },
      ],
    });
  }

  openPauseMenu() {
    this.showModal({
      eyebrow: 'Paused',
      title: this.level ? this.level.name : 'Emberhollow',
      body: 'The cave can wait.',
      buttons: [
        { label: 'Resume', accent: 'primary', action: () => this.hideModal(true) },
        { label: 'Journal', action: () => this.openJournal() },
        { label: 'Restart Quest', action: () => this.startAdventure({ fresh: true }) },
      ],
    });
  }

  openJournal() {
    const notes = this.state.notes.length
      ? `<ul class="modal-list">${this.state.notes.map((note) => `<li><strong>${note.title}</strong><span>${note.body}</span></li>`).join('')}</ul>`
      : '<p class="modal-empty">No song fragments collected yet.</p>';

    const abilities = Object.entries(this.state.abilities)
      .filter(([, unlocked]) => unlocked)
      .map(([key]) => ABILITY_META[key])
      .map((item) => `<li><strong>${item.name}</strong><span>${item.key} &middot; ${item.description}</span></li>`)
      .join('');

    this.showModal({
      eyebrow: 'Journal',
      title: 'Quest Log',
      html: `
        <section class="journal-block">
          <h3>Current Objective</h3>
          <p>${this.currentObjective()}</p>
        </section>
        <section class="journal-block">
          <h3>Unlocked Abilities</h3>
          ${abilities ? `<ul class="modal-list">${abilities}</ul>` : '<p class="modal-empty">You only have your spark bolt so far.</p>'}
        </section>
        <section class="journal-block">
          <h3>Song Fragments</h3>
          ${notes}
        </section>
      `,
      buttons: [{ label: 'Resume', accent: 'primary', action: () => this.hideModal(true) }],
    });
  }

  showModal({ eyebrow = '', title = '', body = '', html = '', buttons = [], footer = '', panelClass = '' }) {
    this.overlayVisible = true;
    this.dom.overlay.classList.remove('hidden');
    this.dom.overlay.dataset.mode = panelClass || 'default';
    this.dom.panel.className = ['overlay-panel', 'glass', panelClass].filter(Boolean).join(' ');

    const parts = [];
    if (eyebrow) parts.push(`<div class="modal-eyebrow">${eyebrow}</div>`);
    if (title) parts.push(`<h2 class="modal-title">${title}</h2>`);
    if (body) parts.push(`<p class="modal-body">${body}</p>`);
    if (html) parts.push(html);
    if (footer) parts.push(`<p class="modal-footer">${footer}</p>`);
    parts.push('<div class="modal-actions"></div>');
    this.dom.panel.innerHTML = parts.join('');

    const actions = this.dom.panel.querySelector('.modal-actions');
    buttons.forEach((button) => {
      const el = document.createElement('button');
      el.className = `modal-btn ${button.accent === 'primary' ? 'primary' : ''}`;
      el.textContent = button.label;
      el.addEventListener('click', button.action, { once: true });
      actions.appendChild(el);
    });
    this.dom.panel.scrollTop = 0;
  }

  hideModal(requestLock = false) {
    this.overlayVisible = false;
    this.dom.overlay.classList.add('hidden');
    this.dom.overlay.dataset.mode = 'default';
    this.dom.panel.className = 'overlay-panel glass';
    if (requestLock && !this.isTouch) this.requestPointerLock();
  }

  clearLevel() {
    if (this.levelRoot) {
      this.scene.remove(this.levelRoot);
      this.levelRoot = null;
    }
    this.themeLights.forEach((light) => this.scene.remove(light));
    this.themeLights = [];
    this.entities.forEach((entity) => {
      if (entity.mesh) this.scene.remove(entity.mesh);
    });
    this.particles.forEach((particle) => this.scene.remove(particle.mesh));
    this.projectiles.forEach((projectile) => this.scene.remove(projectile.mesh));
    this.pickups.forEach((pickup) => this.scene.remove(pickup.mesh));
    this.levelAnimators = [];
    this.entities.clear();
    this.groupStates.clear();
    this.enemyEntities = [];
    this.interactables = [];
    this.gates.clear();
    this.staticCrackedTiles.clear();
    this.raycastRoots = [];
    this.particles = [];
    this.projectiles = [];
    this.pickups = [];
    this.promptEntity = null;
  }

  loadLevel(levelId, spawnTag = 'default') {
    this.clearLevel();
    this.level = LEVELS[levelId];
    this.state.levelId = levelId;
    this.state.spawnTag = spawnTag;
    if (levelId === 'starlight-row') this.state.flags.marketUnlocked = true;
    this.saveState();

    const built = buildLevelGeometry(this.level);
    this.levelRoot = built.group;
    this.levelAnimators = [...built.animators];
    this.staticCrackedTiles = built.staticMeshes;
    this.levelRoot.traverse((child) => {
      child.userData.world = true;
    });
    this.scene.add(this.levelRoot);
    this.raycastRoots = [this.levelRoot];

    this.rebuildLighting(built.theme);
    this.audio.setTheme(this.level.theme);

    (this.level.puzzleGroups || []).forEach((group) => {
      this.groupStates.set(group.id, {
        ...group,
        progress: 0,
        completed: this.state.clearedGroups.includes(group.id),
        timer: 0,
        membersActive: new Set(),
      });
    });

    const spawn = this.level.spawnPoints[spawnTag] || this.level.spawnPoints.default;
    const worldSpawn = tileToWorld(this.level, spawn.x, spawn.z);
    this.player.position.copy(worldSpawn);
    this.player.yaw = spawn.facing || 0;
    this.player.pitch = 0;
    this.player.knockback.set(0, 0, 0);

    this.spawnObjects();
    this.applyDestroyedTiles();
    this.refreshConditionalEntities();
    this.renderHud();
    this.notify(this.level.subtitle, 2.5);
  }

  rebuildLighting(theme) {
    const hemi = new THREE.HemisphereLight(theme.ambient, theme.sky, this.level.theme === 'town' ? 1.15 : 0.82);
    hemi.position.set(0, 30, 0);
    const sun = new THREE.DirectionalLight(theme.accentSoft, this.level.theme === 'town' ? 1.2 : 0.55);
    sun.position.set(12, 18, 6);
    const rim = new THREE.PointLight(theme.accent, 0.7, 60, 2.2);
    rim.position.set(0, 8, 0);
    this.themeLights = [hemi, sun, rim];
    this.themeLights.forEach((light) => this.scene.add(light));
    this.scene.fog = new THREE.Fog(theme.fog, 16, 92);
    this.scene.background = new THREE.Color(theme.clear);
  }

  applyDestroyedTiles() {
    const ids = new Set(this.state.destroyedTiles.filter((id) => id.startsWith(`${this.level.id}:`)));
    ids.forEach((entry) => {
      const [, tileKey] = entry.split(':');
      const mesh = this.staticCrackedTiles.get(`cracked:${tileKey}`);
      if (mesh) mesh.visible = false;
    });
  }

  spawnObjects() {
    this.level.objects.forEach((object) => {
      if (object.kind === 'enemy' && this.state.defeatedEnemies.includes(object.id)) return;
      if (object.kind === 'pot' && this.state.brokenPots.includes(object.id)) return;

      const { mesh, animators } = createObjectVisual(object, this.level.theme);
      const pos = tileToWorld(this.level, object.x, object.z);
      mesh.position.set(pos.x, 0, pos.z);
      setEntityTag(mesh, object.id);
      this.scene.add(mesh);
      this.raycastRoots.push(mesh);

      const entity = {
        id: object.id,
        def: object,
        kind: object.kind,
        mesh,
        animators,
        state: {
          active: false,
          open: false,
          opened: this.state.openedChests.includes(object.id),
          claimed: this.state.claimedPedestals.includes(object.id),
          alive: true,
        },
      };

      if (object.group) {
        const group = this.groupStates.get(object.group);
        if (group?.completed) entity.state.active = true;
      }

      if (object.kind === 'gate') {
        entity.state.open = this.requirementsMet(entity.def.requiresGroups || []);
        this.gates.set(`${object.x},${object.z}`, entity);
        if (entity.state.open) entity.mesh.position.y = -3.2;
      }

      if (object.kind === 'chest' && entity.state.opened) {
        entity.mesh.rotation.x = -0.18;
      }

      if (object.kind === 'pedestal' && entity.state.claimed) {
        entity.mesh.traverse((child) => {
          if (child.material?.emissiveIntensity !== undefined) child.material.emissiveIntensity *= 0.25;
        });
      }

      if (object.kind === 'enemy') {
        const stats = ENEMY_STATS[object.enemyType];
        entity.state.hp = stats.maxHp;
        entity.state.maxHp = stats.maxHp;
        entity.state.cooldown = 0.3 + Math.random();
        this.enemyEntities.push(entity);
      }

      if (object.kind === 'boss') {
        entity.state.hp = ENEMY_STATS.vaultKing.maxHp;
        entity.state.maxHp = ENEMY_STATS.vaultKing.maxHp;
        entity.state.attackTimer = 1.2;
        entity.state.waveTimer = 5.6;
        entity.state.summoned = false;
        entity.state.shieldCount = 4;
        this.enemyEntities.push(entity);
      }

      if (this.isInteractable(entity.kind)) this.interactables.push(entity);
      this.entities.set(entity.id, entity);
    });
  }

  refreshConditionalEntities() {
    this.entities.forEach((entity) => {
      entity.mesh.visible = this.shouldEntityBeVisible(entity);
      if (!entity.mesh.visible) return;
      if (entity.kind === 'gate') {
        this.setGateOpen(entity, this.requirementsMet(entity.def.requiresGroups || []), false);
      }
    });
  }

  shouldEntityBeVisible(entity) {
    const { def } = entity;
    if (def.hiddenUntil && !this.state.abilities[def.hiddenUntil]) return false;
    if (def.kind === 'pedestal' && def.requiresFlag && !this.state.flags[def.requiresFlag]) return false;
    if (def.kind === 'lore' && def.requiresFlag && !this.state.flags[def.requiresFlag]) return false;
    if (def.kind === 'boss' && this.state.flags.bossCleared) return false;
    if (def.kind === 'crackedWall' && this.state.destroyedTiles.includes(`${this.level.id}:${def.x},${def.z}`)) return false;
    return true;
  }

  requirementsMet(groups) {
    return groups.every((groupId) => this.groupStates.get(groupId)?.completed);
  }

  isInteractable(kind) {
    return ['npc', 'portal', 'shrine', 'fountain', 'lore', 'chest', 'pedestal', 'brazier', 'resonator', 'crackedWall'].includes(kind);
  }

  tryInteract() {
    if (!this.promptEntity) return;
    this.handleInteraction(this.promptEntity);
  }

  handleInteraction(entity) {
    const { def } = entity;

    switch (entity.kind) {
      case 'portal':
        if (def.requiresFlag && !this.state.flags[def.requiresFlag]) {
          this.notify('Elder Suri wanted a word before you vanish underground.');
          return;
        }
        if (def.requiresGate) {
          const gate = this.entities.get(def.requiresGate);
          if (gate && !gate.state.open) {
            this.notify('Something in this chamber still wants solving.');
            return;
          }
        }
        this.loadLevel(def.target, def.targetSpawn || 'default');
        break;
      case 'npc':
        this.openNpc(def.id);
        break;
      case 'shrine':
        this.openShrine();
        break;
      case 'fountain':
        this.state.health = this.state.maxHealth;
        this.audio.play('heal');
        this.saveState();
        this.notify('The moonwell tops off your hearts.');
        this.renderHud();
        break;
      case 'lore':
        this.showModal({
          eyebrow: 'Lore',
          title: def.title,
          body: def.body,
          buttons: [{ label: 'Back', accent: 'primary', action: () => this.hideModal(true) }],
        });
        break;
      case 'chest':
        this.openChest(entity);
        break;
      case 'pedestal':
        this.claimPedestal(entity);
        break;
      case 'brazier':
        this.activateBrazier(entity);
        break;
      case 'resonator':
        this.activateResonator(entity);
        break;
      case 'crackedWall':
        this.notify(this.state.abilities.starfall ? 'Use Starfall with F.' : 'That star mark needs far more power.');
        break;
      default:
        break;
    }
  }

  openNpc(id) {
    if (id === 'elder') {
      const body = !this.state.flags.elderIntro
        ? 'Echo Cave is awake again. Bring back the cave song, not just the treasure. Bellroot needs both.'
        : this.state.flags.bossCleared
          ? 'You did it. The valley sounds lighter already.'
          : 'The deeper you go, the less this place behaves like stone. Trust the puzzles.';

      this.showModal({
        eyebrow: 'Bellroot',
        title: 'Elder Suri',
        body,
        buttons: [{
          label: !this.state.flags.elderIntro ? 'Open the Road' : 'Back',
          accent: 'primary',
          action: () => {
            this.state.flags.elderIntro = true;
            this.saveState();
            this.refreshConditionalEntities();
            this.hideModal(true);
            this.notify('The elder points you toward the cave mouth.');
          },
        }],
      });
      return;
    }

    if (id === 'smith') {
      this.openShrine('Brakka tunes your launcher while the forge cools.');
      return;
    }

    if (id === 'bard') {
      const body = this.state.notes.length
        ? `You have ${this.state.notes.length} song fragment${this.state.notes.length === 1 ? '' : 's'}. Bellroot is going to make a ridiculous ballad out of this.`
        : 'Try shooting anything that looks ceremonial. This cave was built for listeners, not looters.';
      this.showModal({
        eyebrow: 'Bellroot',
        title: 'Pippin the Bard',
        body,
        buttons: [{ label: 'Back', accent: 'primary', action: () => this.hideModal(true) }],
      });
      return;
    }

    if (id === 'cartographer') {
      const body = this.state.abilities.wayfinder
        ? 'The Wayfinder Lens is syncing beautifully. You should notice caches and secret walls reading much louder on your field map now.'
        : this.state.abilities.magnet
          ? 'The old maps mention an archive tucked off the Echo Gallery. If you see lens locks and song seals, that is the place. Bring back anything that helps you read the cave.'
          : 'Most people come to Starlight Row for lantern soup, not cave maps. Come back once you can pull those old bridge pins around in Echo Cave.';
      this.showModal({
        eyebrow: 'Starlight Row',
        title: 'Mara the Cartographer',
        body,
        buttons: [{ label: 'Back', accent: 'primary', action: () => this.hideModal(true) }],
      });
      return;
    }

    if (id === 'glassweaver') {
      const body = this.state.flags.bossCleared
        ? 'Bellroot already feels different. The glass is catching more dawn than it used to.'
        : 'I make lantern glass thin enough to sing in the wind. The archive under the cave used to make lenses that sang back.';
      this.showModal({
        eyebrow: 'Starlight Row',
        title: 'Ilya Glassweaver',
        body,
        buttons: [{ label: 'Back', accent: 'primary', action: () => this.hideModal(true) }],
      });
    }
  }

  openShrine(intro = 'Spend shards on permanent upgrades. Bellroot keeps whatever you forge here.') {
    const heartCost = 18 + Math.max(0, this.state.maxHealth - 5) * 10;
    const shotCost = 16 + Math.max(0, this.state.shotLevel - 1) * 12;
    this.showModal({
      eyebrow: 'Sunforge Shrine',
      title: `Shards: ${this.state.shards}`,
      html: `
        <section class="journal-block">
          <h3>Heart Tempering</h3>
          <p>Increase max hearts by one. Cost: ${heartCost} shards.</p>
        </section>
        <section class="journal-block">
          <h3>Bolt Tempering</h3>
          <p>Raise bolt damage and impact. Cost: ${shotCost} shards.</p>
        </section>
        <section class="journal-block">
          <p>${intro}</p>
        </section>
      `,
      buttons: [
        {
          label: `Forge Heart (${heartCost})`,
          action: () => {
            if (this.state.shards < heartCost) {
              this.notify('Not enough shards for that forging.');
              this.openShrine();
              return;
            }
            this.state.shards -= heartCost;
            this.state.maxHealth += 1;
            this.state.health = this.state.maxHealth;
            this.audio.play('heal');
            this.saveState();
            this.renderHud();
            this.notify('Your hearts burn a little hotter.');
            this.openShrine();
          },
        },
        {
          label: `Tune Bolts (${shotCost})`,
          action: () => {
            if (this.state.shards < shotCost) {
              this.notify('Not enough shards for that tuning.');
              this.openShrine();
              return;
            }
            this.state.shards -= shotCost;
            this.state.shotLevel += 1;
            this.audio.play('unlock');
            this.saveState();
            this.renderHud();
            this.notify('Your spark bolts bite harder now.');
            this.openShrine();
          },
        },
        { label: 'Leave', accent: 'primary', action: () => this.hideModal(true) },
      ],
    });
  }

  claimPedestal(entity) {
    if (entity.state.claimed) {
      this.notify('Only a faint afterglow remains.');
      return;
    }
    if (entity.def.requiresGroups && !this.requirementsMet(entity.def.requiresGroups)) {
      this.notify('The dais is waiting for the chamber to settle.');
      return;
    }

    const meta = ABILITY_META[entity.def.grants];
    this.showModal({
      eyebrow: 'Relic Claimed',
      title: meta.name,
      body: meta.description,
      buttons: [{
        label: 'Take It',
        accent: 'primary',
        action: () => {
          entity.state.claimed = true;
          this.state.claimedPedestals.push(entity.id);
          if (entity.def.grants === 'forgeHeart') {
            this.state.abilities.forgeHeart = true;
            this.state.maxHealth += 1;
            this.state.health = Math.min(this.state.maxHealth, this.state.health + 1);
            this.state.shotLevel += 1;
          } else {
            this.state.abilities[entity.def.grants] = true;
          }
          this.audio.play('unlock');
          this.saveState();
          entity.mesh.traverse((child) => {
            if (child.material?.emissiveIntensity !== undefined) child.material.emissiveIntensity *= 0.24;
          });
          this.refreshConditionalEntities();
          this.renderHud();
          this.hideModal(true);
          this.notify(`${meta.name} unlocked.`);
        },
      }],
    });
  }

  openChest(entity) {
    if (entity.state.opened) {
      this.notify('The chest is already empty.');
      return;
    }
    entity.state.opened = true;
    entity.mesh.rotation.x = -0.18;
    this.state.openedChests.push(entity.id);
    const reward = entity.def.reward || {};
    this.state.shards += reward.shards || 0;
    if (reward.heal) this.state.health = Math.min(this.state.maxHealth, this.state.health + reward.heal);
    if (reward.note && !this.state.notes.some((note) => note.title === reward.note.title)) {
      this.state.notes.push(reward.note);
    }
    this.audio.play('pickup');
    this.saveState();
    this.renderHud();
    this.notify(reward.note ? `${reward.note.title} found.` : `Chest opened. +${reward.shards || 0} shards.`);
  }

  activateBrazier(entity) {
    if (entity.state.active) {
      this.notify('That brazier is already singing.');
      return;
    }
    entity.state.active = true;
    this.audio.play('unlock');
    this.markGroupMember(entity.def.group, entity.id);
  }

  activateResonator(entity) {
    if (entity.state.active && this.groupStates.get(entity.def.group)?.completed) return;
    this.audio.play('shoot');
    this.markGroupMember(entity.def.group, entity.id);
  }

  markGroupMember(groupId, entityId) {
    const group = this.groupStates.get(groupId);
    if (!group || group.completed) return;

    if (group.type === 'sequence') {
      const expected = group.sequence[group.progress];
      if (entityId !== expected) {
        group.progress = 0;
        group.membersActive.clear();
        this.entities.forEach((candidate) => {
          if (candidate.def.group === groupId) candidate.state.active = false;
        });
        this.notify('The choir resets. Try the order again.');
        return;
      }
      group.progress += 1;
      group.membersActive.add(entityId);
    } else {
      group.membersActive.add(entityId);
      if (group.type === 'timedPlates' && group.timer <= 0) {
        group.timer = group.timeLimit;
        if (group.onStartToast) this.notify(group.onStartToast);
      }
    }

    const entity = this.entities.get(entityId);
    if (entity) entity.state.active = true;

    if (group.members.every((memberId) => group.membersActive.has(memberId))) {
      this.completeGroup(groupId);
    }
  }

  completeGroup(groupId) {
    const group = this.groupStates.get(groupId);
    if (!group || group.completed) return;
    group.completed = true;
    group.timer = 0;
    group.members.forEach((memberId) => {
      const entity = this.entities.get(memberId);
      if (entity) entity.state.active = true;
    });
    if (!this.state.clearedGroups.includes(groupId)) this.state.clearedGroups.push(groupId);
    this.audio.play('unlock');
    this.saveState();
    if (group.onCompleteToast) this.notify(group.onCompleteToast);
    this.entities.forEach((entity) => {
      if (entity.kind === 'gate' && entity.def.requiresGroups?.includes(groupId)) {
        this.setGateOpen(entity, this.requirementsMet(entity.def.requiresGroups), true);
      }
    });
    this.renderHud();
  }

  setGateOpen(entity, open, announce) {
    if (entity.state.open === open) return;
    entity.state.open = open;
    entity.mesh.position.y = open ? -3.2 : 0;
    if (announce && open) this.notify(`${entity.def.label} opens.`);
  }

  tryDash() {
    if (!this.state.abilities.dash || this.player.dashCooldown > 0) return;
    this.player.dashTimer = 0.18;
    this.player.dashCooldown = 0.95;
    this.player.invuln = Math.max(this.player.invuln, 0.22);
    this.audio.play('dash');
  }

  useMagnet() {
    if (!this.state.abilities.magnet || this.player.magnetCooldown > 0 || this.overlayVisible) return;
    const hit = this.castCenterRay(18);
    const entity = hit?.entity;
    if (!entity || entity.kind !== 'anchor') {
      this.notify('Nothing magnetic is in your line.');
      return;
    }
    if (entity.state.active) {
      this.notify('That anchor is already locked in place.');
      return;
    }
    entity.state.active = true;
    this.player.magnetCooldown = 0.6;
    this.audio.play('magnet');
    this.markGroupMember(entity.def.group, entity.id);
    this.spawnBurst(tileToWorld(this.level, entity.def.x, entity.def.z).add(new THREE.Vector3(0, 1.1, 0)), THEMES[this.level.theme].accentSoft, 12);

    if (this.level.id === 'boss') {
      const boss = this.entities.get('vault-king');
      if (boss && !this.state.flags.bossCleared) {
        const active = this.groupStates.get('boss-shields').membersActive.size;
        boss.state.shieldCount = Math.max(0, 4 - active);
        if (this.groupStates.get('boss-shields').completed) {
          boss.state.shieldCount = 0;
          this.notify('The Choir King loses its shield.');
        }
      }
    }
  }

  useStarfall() {
    if (!this.state.abilities.starfall || this.player.novaCooldown > 0 || this.overlayVisible) return;
    this.player.novaCooldown = 7.5;
    this.audio.play('nova');
    this.shakeAmount = 0.6;
    this.spawnBurst(this.player.position.clone().add(new THREE.Vector3(0, 1.2, 0)), THEMES[this.level.theme].accent, 18);

    this.enemyEntities.forEach((enemy) => {
      if (!enemy.state.alive) return;
      if (distance2D(enemy.mesh.position, this.player.position) < 14) {
        this.damageEnemy(enemy, enemy.kind === 'boss' ? 2 : 4);
      }
    });

    this.entities.forEach((entity) => {
      if (entity.kind === 'crackedWall' && this.shouldEntityBeVisible(entity)) {
        const target = tileToWorld(this.level, entity.def.x, entity.def.z);
        if (distance2D(target, this.player.position) < 8.5) {
          this.destroyCrackedWall(entity);
        }
      }
    });
  }

  destroyCrackedWall(entity) {
    const tileId = `${this.level.id}:${entity.def.x},${entity.def.z}`;
    if (this.state.destroyedTiles.includes(tileId)) return;
    this.state.destroyedTiles.push(tileId);
    const mesh = this.staticCrackedTiles.get(`cracked:${entity.def.x},${entity.def.z}`);
    if (mesh) mesh.visible = false;
    entity.mesh.visible = false;
    if (entity.id === 'sky-vault-wall') {
      this.state.flags.skyVaultOpened = true;
      this.notify('The hidden sky vault opens.');
    }
    this.saveState();
    this.spawnBurst(tileToWorld(this.level, entity.def.x, entity.def.z).add(new THREE.Vector3(0, 1.5, 0)), 0xffddaa, 20);
  }

  shoot() {
    if (this.player.shotCooldown > 0 || this.overlayVisible) return;
    this.player.shotCooldown = Math.max(0.14, 0.32 - this.state.shotLevel * 0.03);
    this.audio.play('shoot');

    const hit = this.castCenterRay(24);
    const origin = this.camera.position.clone();
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const end = hit?.point ? hit.point.clone() : origin.clone().add(direction.multiplyScalar(22));
    this.spawnTracer(origin, end, THEMES[this.level.theme].accentSoft);

    if (!hit?.entity) {
      this.spawnBurst(end, 0xffffff, 8);
      return;
    }

    const entity = hit.entity;
    switch (entity.kind) {
      case 'enemy':
      case 'boss':
        this.damageEnemy(entity, 1 + Math.floor(this.state.shotLevel / 2));
        break;
      case 'brazier':
        this.activateBrazier(entity);
        break;
      case 'resonator':
        this.activateResonator(entity);
        break;
      case 'pot':
        this.breakPot(entity);
        break;
      case 'chest':
        this.openChest(entity);
        break;
      default:
        this.spawnBurst(end, THEMES[this.level.theme].accent, 8);
        break;
    }
  }

  breakPot(entity) {
    if (!entity.state.alive) return;
    entity.state.alive = false;
    entity.mesh.visible = false;
    if (!this.state.brokenPots.includes(entity.id)) this.state.brokenPots.push(entity.id);
    this.spawnLoot(entity.mesh.position.clone(), Math.random() > 0.75 ? 'heart' : 'shard');
    this.spawnBurst(entity.mesh.position.clone().add(new THREE.Vector3(0, 0.7, 0)), 0xffbe88, 10);
    this.audio.play('hit');
    this.saveState();
  }

  damageEnemy(enemy, amount) {
    if (!enemy.state.alive) return;
    if (enemy.kind === 'boss') {
      const shieldsDown = this.groupStates.get('boss-shields')?.completed;
      if (!shieldsDown) {
        this.notify('The shield still hums. Pull the four chains first.');
        return;
      }
    }

    enemy.state.hp -= amount;
    this.spawnBurst(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), THEMES[this.level.theme].accent, 10);
    this.audio.play('hit');

    if (enemy.state.hp <= 0) {
      this.killEnemy(enemy);
    }
  }

  killEnemy(enemy) {
    enemy.state.alive = false;
    enemy.mesh.visible = false;

    if (enemy.kind === 'boss') {
      this.audio.play('unlock');
      this.state.flags.bossCleared = true;
      this.saveState();
      this.refreshConditionalEntities();
      this.notify('The Choir King collapses. Claim the core.');
      return;
    }

    if (!this.state.defeatedEnemies.includes(enemy.id)) this.state.defeatedEnemies.push(enemy.id);
    const shards = ENEMY_STATS[enemy.def.enemyType].shards;
    for (let i = 0; i < shards; i += 1) this.spawnLoot(enemy.mesh.position.clone(), 'shard');
    if (Math.random() > 0.78) this.spawnLoot(enemy.mesh.position.clone(), 'heart');
    this.audio.play('enemyDown');
    this.spawnBurst(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)), THEMES[this.level.theme].accentSoft, 12);
    this.saveState();

    this.groupStates.forEach((group) => {
      if (group.type === 'clearEnemies' && group.members.includes(enemy.id)) {
        this.markGroupMember(group.id, enemy.id);
      }
    });
  }

  spawnLoot(position, type) {
    const color = type === 'heart' ? 0xff7a8a : THEMES[this.level.theme].accent;
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(type === 'heart' ? 0.4 : 0.24, 0),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.65, roughness: 0.18 }),
    );
    mesh.position.copy(position).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.7, (Math.random() - 0.5) * 0.8));
    this.scene.add(mesh);
    this.pickups.push({ type, mesh, life: 18, spin: Math.random() * Math.PI * 2 });
  }

  spawnTracer(start, end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.particles.push({ mesh: line, life: 0.08, mode: 'fade' });
  }

  spawnBurst(position, color, count = 10) {
    const burst = makeImpactBurst(color, count);
    burst.position.copy(position);
    this.scene.add(burst);
    this.particles.push({ mesh: burst, life: 0.45, mode: 'burst' });
  }

  castCenterRay(distance = 10) {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const hits = this.raycaster.intersectObjects(this.raycastRoots, true);
    for (const hit of hits) {
      if (hit.distance > distance) break;
      let current = hit.object;
      while (current) {
        if (current.userData.entityId) {
          const entity = this.entities.get(current.userData.entityId);
          if (entity && entity.mesh.visible) return { entity, point: hit.point, distance: hit.distance };
          break;
        }
        if (current.userData.world) return { entity: null, point: hit.point, distance: hit.distance };
        current = current.parent;
      }
    }
    return null;
  }

  currentObjective() {
    const groups = this.groupStates;
    switch (this.level?.id) {
      case 'town':
        if (!this.state.flags.elderIntro) return 'Speak with Elder Suri by the fountain.';
        if (this.state.abilities.starfall && !this.state.openedChests.includes('sky-vault-chest')) return 'Use Starfall on the star-marked wall and open the sky vault.';
        if (this.state.abilities.magnet && !this.state.abilities.wayfinder) return 'Starlight Row and the Echo Gallery both hint at a hidden archive worth exploring.';
        if (this.state.flags.bossCleared) return 'Bellroot is safe. Explore and celebrate.';
        return 'Enter Echo Cave and follow the old song.';
      case 'starlight-row':
        if (!this.state.abilities.wayfinder) return 'Talk to the locals and look for the archive rumored off the Echo Gallery.';
        if (!this.state.openedChests.includes('festival-cache')) return 'The Wayfinder Lens reveals a tucked-away festival cache.';
        return 'Starlight Row is yours to enjoy. Return when ready.';
      case 'cave-1':
        if (!groups.get('iris-braziers')?.completed) return 'Light the three braziers to open the stone iris.';
        if (!this.state.claimedPedestals.includes('glow-lantern')) return 'Claim the Glow Lantern.';
        return 'Descend to the reservoir.';
      case 'cave-2':
        if (!this.state.abilities.dash) return 'Take the Comet Boots from the dais.';
        if (!groups.get('reservoir-run')?.completed) return 'Dash the pressure route before the vents reset.';
        return 'Follow the echo deeper.';
      case 'cave-3':
        if (!groups.get('echo-choir')?.completed) return 'Strike the resonators in the order hidden on the choir plaque.';
        if (!this.state.abilities.magnet) return 'Claim the Aether Hook from the center dais.';
        if (!groups.get('bridge-hooks')?.completed) return 'Pull the three bridge pins with Q.';
        if (!this.state.abilities.wayfinder) return 'An optional archive waits off this gallery if you want another relic before the forge.';
        return 'Climb to the Forgeheart Stair.';
      case 'moonlit-archive':
        if (!groups.get('archive-choir')?.completed) return 'Strike the archive seals in the order named on the plaque.';
        if (!groups.get('archive-locks')?.completed) return 'Pull both lens locks with the Aether Hook.';
        if (!this.state.abilities.wayfinder) return 'Claim the Wayfinder Lens.';
        return 'Return to Bellroot with the lens.';
      case 'cave-4':
        if (!groups.get('forge-hooks')?.completed) return 'Hook both forge locks.';
        if (!groups.get('forge-run')?.completed) return 'Dash both forge plates before the timer dies.';
        if (!groups.get('forge-wardens')?.completed) return 'Defeat the wardens haunting the stair.';
        if (!this.state.abilities.forgeHeart) return 'Claim the Forge Heart before the boss.';
        return 'Enter the Crown Vault.';
      case 'boss':
        if (!this.state.flags.bossCleared && !groups.get('boss-shields')?.completed) return 'Pull the four chain anchors to drop the boss shield.';
        if (!this.state.flags.bossCleared) return "Dash the Choir King's attacks and break the core.";
        if (!this.state.abilities.starfall) return 'Claim the Starfall Core.';
        return 'Return to Bellroot and open the hidden sky vault.';
      default:
        return 'Explore.';
    }
  }

  updatePrompt() {
    const hit = this.castCenterRay(9.5);
    const entity = hit?.entity;
    this.promptEntity = null;
    if (!entity) {
      this.dom.prompt.classList.add('hidden');
      return;
    }

    if (!this.isInteractable(entity.kind) && entity.kind !== 'anchor') {
      this.dom.prompt.classList.add('hidden');
      return;
    }

    const label = entity.def.label || entity.def.id;
    let action = '[E]';
    if (entity.kind === 'portal') action = '[E] Travel';
    else if (entity.kind === 'npc') action = '[E] Talk';
    else if (entity.kind === 'shrine') action = '[E] Forge';
    else if (entity.kind === 'fountain') action = '[E] Drink';
    else if (entity.kind === 'lore') action = '[E] Read';
    else if (entity.kind === 'pedestal') action = '[E] Claim';
    else if (entity.kind === 'anchor') action = this.state.abilities.magnet ? '[Q] Pull' : 'Need Aether Hook';
    else if (entity.kind === 'crackedWall') action = this.state.abilities.starfall ? '[F] Starfall' : 'Dormant';
    else if (entity.kind === 'brazier' || entity.kind === 'resonator') action = '[E or Shoot]';
    else if (entity.kind === 'chest') action = '[E] Open';

    this.promptEntity = entity.kind === 'anchor' ? null : entity;
    this.dom.prompt.textContent = `${action} ${label}`;
    this.dom.prompt.classList.remove('hidden');
  }

  updateGroups(dt) {
    this.groupStates.forEach((group) => {
      if (group.type !== 'timedPlates' || group.completed || group.timer <= 0) return;
      group.timer -= dt;
      if (group.timer <= 0) {
        group.membersActive.clear();
        group.progress = 0;
        group.members.forEach((memberId) => {
          const entity = this.entities.get(memberId);
          if (entity) entity.state.active = false;
        });
        this.notify('The route cools off. Start the dash again.');
      }
    });
  }

  movePlayer(dx, dz) {
    const tryAxis = (axis, amount) => {
      if (!amount) return;
      const target = this.player.position.clone();
      target[axis] += amount;
      if (!this.collides(target.x, target.z, this.player.radius)) {
        this.player.position[axis] = target[axis];
      }
    };
    tryAxis('x', dx);
    tryAxis('z', dz);
  }

  moveEntity(entity, dx, dz, radius = 0.48) {
    const tryAxis = (axis, amount) => {
      if (!amount) return;
      const next = entity.mesh.position.clone();
      next[axis] += amount;
      if (!this.collides(next.x, next.z, radius)) {
        entity.mesh.position[axis] = next[axis];
      }
    };
    tryAxis('x', dx);
    tryAxis('z', dz);
  }

  collides(x, z, radius = this.player.radius) {
    const samples = [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius * 0.7, radius * 0.7],
      [-radius * 0.7, radius * 0.7],
      [radius * 0.7, -radius * 0.7],
      [-radius * 0.7, -radius * 0.7],
    ];

    return samples.some(([sx, sz]) => {
      const tile = worldToTile(this.level, x + sx, z + sz);
      const row = this.level.map[tile.z];
      if (!row) return true;
      const char = row[tile.x];
      if (!char) return true;
      if (isBaseSolid(char)) {
        if (char === '!') return !this.state.destroyedTiles.includes(`${this.level.id}:${tile.x},${tile.z}`);
        return true;
      }
      const gate = this.gates.get(`${tile.x},${tile.z}`);
      return gate ? !gate.state.open : false;
    });
  }

  damagePlayer(amount, sourcePosition) {
    if (this.player.invuln > 0) return;
    this.state.health -= amount;
    this.player.invuln = 0.72;
    this.player.hurtCooldown = 0.4;
    this.flashAmount = 1;
    this.shakeAmount = 0.35;
    this.audio.play('hurt');

    if (sourcePosition) {
      const knock = this.player.position.clone().sub(sourcePosition).setY(0);
      if (knock.lengthSq() > 0) {
        knock.normalize().multiplyScalar(18);
        this.player.knockback.add(knock);
      }
    }

    if (this.state.health <= 0) {
      this.state.health = this.state.maxHealth;
      this.loadLevel(this.level.id, 'default');
      this.showModal({
        eyebrow: 'Bellroot Recall',
        title: 'You were knocked out',
        body: 'The cave spits you back to the last threshold. Nothing important was lost.',
        buttons: [{ label: 'Return', accent: 'primary', action: () => this.hideModal(true) }],
      });
    }
    this.renderHud();
  }

  updatePlayer(dt, elapsed) {
    if (this.overlayVisible || !this.level) return;

    if (this.isTouch) {
      this.player.yaw -= this.input.lookPad.x * dt * 2.4;
      this.player.pitch += this.input.lookPad.y * dt * 2.1;
      this.player.pitch = clamp(this.player.pitch, -1.15, 1.15);
    }

    this.player.shotCooldown = Math.max(0, this.player.shotCooldown - dt);
    this.player.dashCooldown = Math.max(0, this.player.dashCooldown - dt);
    this.player.magnetCooldown = Math.max(0, this.player.magnetCooldown - dt);
    this.player.novaCooldown = Math.max(0, this.player.novaCooldown - dt);
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    this.player.hurtCooldown = Math.max(0, this.player.hurtCooldown - dt);

    const move = new THREE.Vector2(
      (this.input.keys.has('KeyD') ? 1 : 0) - (this.input.keys.has('KeyA') ? 1 : 0) + this.input.movePad.x,
      (this.input.keys.has('KeyS') ? 1 : 0) - (this.input.keys.has('KeyW') ? 1 : 0) + this.input.movePad.y,
    );

    const moving = move.lengthSq() > 0.02;
    if (moving) move.normalize();

    const forward = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const moveDir = new THREE.Vector3().addScaledVector(right, move.x).addScaledVector(forward, -move.y);
    if (moveDir.lengthSq() > 0) moveDir.normalize();

    let speed = this.player.moveSpeed * (this.input.keys.has('ShiftLeft') ? this.player.sprint : 1);
    if (this.player.dashTimer > 0) {
      this.player.dashTimer -= dt;
      speed *= 3.7;
      this.player.invuln = Math.max(this.player.invuln, 0.05);
    }

    const velocity = moveDir.multiplyScalar(speed * dt);
    if (this.player.knockback.lengthSq() > 0.0001) {
      velocity.add(this.player.knockback.clone().multiplyScalar(dt));
      this.player.knockback.multiplyScalar(Math.pow(0.04, dt));
    }

    this.movePlayer(velocity.x, velocity.z);

    this.entities.forEach((entity) => {
      if (entity.kind === 'plate' && !entity.state.active) {
        if (distance2D(entity.mesh.position, this.player.position) < 1.6) {
          this.markGroupMember(entity.def.group, entity.id);
        }
      }
    });

    const tile = worldToTile(this.level, this.player.position.x, this.player.position.z);
    const char = this.level.map[tile.z]?.[tile.x] || '#';
    if (isHazard(char) && this.player.hurtCooldown <= 0 && this.player.invuln <= 0) {
      this.damagePlayer(1, tileToWorld(this.level, tile.x, tile.z));
    }

    this.player.bob = moving ? this.player.bob + dt * (this.player.dashTimer > 0 ? 18 : 9) : this.player.bob * 0.9;
    const bobOffset = moving ? Math.sin(this.player.bob) * 0.08 : 0;
    const shakeX = (Math.random() - 0.5) * this.shakeAmount;
    const shakeY = (Math.random() - 0.5) * this.shakeAmount;
    const shakeZ = (Math.random() - 0.5) * this.shakeAmount;
    this.camera.position.set(this.player.position.x + shakeX, 1.7 + bobOffset + shakeY, this.player.position.z + shakeZ);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    this.shakeAmount *= 0.84;

    this.updatePrompt();
    this.updateTouchHud();
  }

  updateEnemies(dt, elapsed) {
    this.enemyEntities.forEach((enemy) => {
      if (!enemy.state.alive || !enemy.mesh.visible) return;

      if (enemy.kind === 'boss') {
        this.updateBoss(enemy, dt, elapsed);
        return;
      }

      const stats = ENEMY_STATS[enemy.def.enemyType];
      const toPlayer = this.player.position.clone().sub(enemy.mesh.position);
      const dist = Math.hypot(toPlayer.x, toPlayer.z);
      enemy.state.cooldown = Math.max(0, enemy.state.cooldown - dt);

      if (enemy.def.enemyType === 'crawler') {
        if (dist > stats.range) {
          const dir = toPlayer.normalize();
          this.moveEntity(enemy, dir.x * stats.speed * dt, dir.z * stats.speed * dt, 0.46);
        } else if (enemy.state.cooldown <= 0) {
          enemy.state.cooldown = stats.cooldown;
          this.damagePlayer(stats.damage, enemy.mesh.position);
        }
      } else {
        if (dist > stats.range) {
          const dir = toPlayer.normalize();
          this.moveEntity(enemy, dir.x * stats.speed * dt, dir.z * stats.speed * dt, 0.46);
        }
        if (dist < stats.range - 2.5) {
          const dir = toPlayer.normalize();
          this.moveEntity(enemy, -dir.x * stats.speed * 0.6 * dt, -dir.z * stats.speed * 0.6 * dt, 0.46);
        }
        if (enemy.state.cooldown <= 0 && dist < stats.range + 3) {
          enemy.state.cooldown = stats.cooldown;
          this.spawnEnemyProjectile(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), this.player.position.clone().add(new THREE.Vector3(0, 1.4, 0)), enemy.def.enemyType === 'warden' ? 1.3 : 1);
        }
      }
    });
  }

  updateBoss(boss, dt, elapsed) {
    const center = tileToWorld(this.level, boss.def.x, boss.def.z);
    const hpRatio = boss.state.hp / boss.state.maxHp;
    boss.state.attackTimer -= dt;
    boss.state.waveTimer -= dt;

    if (!this.state.flags.bossCleared) {
      const radius = hpRatio > 0.5 ? 5.5 : 7.2;
      const angle = elapsed * (hpRatio > 0.4 ? 0.45 : 0.7);
      boss.mesh.position.set(center.x + Math.cos(angle) * radius, 0, center.z + Math.sin(angle * 1.2) * radius * 0.58);
    }

    if (boss.state.attackTimer <= 0) {
      boss.state.attackTimer = hpRatio > 0.5 ? 1.7 : 1.2;
      const shots = hpRatio > 0.4 ? 3 : 5;
      for (let i = 0; i < shots; i += 1) {
        const spread = (i - (shots - 1) / 2) * 0.13;
        const target = this.player.position.clone().add(new THREE.Vector3(spread * 8, 1.3, spread * 4));
        this.spawnEnemyProjectile(boss.mesh.position.clone().add(new THREE.Vector3(0, 2, 0)), target, 1.4, true);
      }
      this.audio.play('bossCharge');
    }

    if (hpRatio < 0.7 && boss.state.waveTimer <= 0) {
      boss.state.waveTimer = hpRatio < 0.35 ? 4 : 6;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.08, 12, 50),
        new THREE.MeshBasicMaterial({ color: THEMES[this.level.theme].hazard, transparent: true, opacity: 0.7 }),
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(center.x, 0.45, center.z);
      this.scene.add(mesh);
      this.projectiles.push({ kind: 'wave', mesh, radius: 2.2, speed: 12, max: 20, damage: 1 });
    }

    if (hpRatio < 0.45 && !boss.state.summoned) {
      boss.state.summoned = true;
      ['boss-add-1', 'boss-add-2'].forEach((id, index) => {
        const def = { id, kind: 'enemy', enemyType: index === 0 ? 'crawler' : 'wisp', x: boss.def.x + (index === 0 ? -2 : 2), z: boss.def.z + 3 };
        const { mesh, animators } = createObjectVisual(def, this.level.theme);
        mesh.position.copy(tileToWorld(this.level, def.x, def.z));
        setEntityTag(mesh, def.id);
        this.scene.add(mesh);
        this.raycastRoots.push(mesh);
        const entity = {
          id: def.id,
          def,
          kind: 'enemy',
          mesh,
          animators,
          state: { hp: ENEMY_STATS[def.enemyType].maxHp, maxHp: ENEMY_STATS[def.enemyType].maxHp, cooldown: 0.6, alive: true },
        };
        this.entities.set(def.id, entity);
        this.enemyEntities.push(entity);
      });
      this.notify('The Choir King calls in echoes.');
    }
  }

  spawnEnemyProjectile(origin, target, speedFactor = 1, bossShot = false) {
    const direction = target.clone().sub(origin).setY(0);
    if (direction.lengthSq() === 0) direction.set(0, 0, 1);
    direction.normalize();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(bossShot ? 0.32 : 0.22, 12, 12),
      new THREE.MeshStandardMaterial({
        color: bossShot ? THEMES[this.level.theme].accent : THEMES[this.level.theme].hazard,
        emissive: bossShot ? THEMES[this.level.theme].accent : THEMES[this.level.theme].hazard,
        emissiveIntensity: 0.85,
      }),
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      kind: 'bolt',
      hostile: true,
      mesh,
      velocity: direction.multiplyScalar((bossShot ? 13 : 10) * speedFactor),
      life: bossShot ? 4.8 : 3.6,
      damage: 1,
    });
  }

  updateProjectiles(dt) {
    this.projectiles = this.projectiles.filter((projectile) => {
      if (projectile.kind === 'wave') {
        projectile.radius += projectile.speed * dt;
        projectile.mesh.scale.setScalar(projectile.radius / 2.2);
        projectile.mesh.material.opacity = clamp(1 - projectile.radius / projectile.max, 0, 0.85);
        const dist = distance2D(projectile.mesh.position, this.player.position);
        if (Math.abs(dist - projectile.radius) < 0.9 && this.player.invuln <= 0) {
          this.damagePlayer(projectile.damage, projectile.mesh.position);
        }
        if (projectile.radius > projectile.max) {
          this.scene.remove(projectile.mesh);
          return false;
        }
        return true;
      }

      projectile.life -= dt;
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      if (projectile.life <= 0) {
        this.scene.remove(projectile.mesh);
        return false;
      }
      if (this.collides(projectile.mesh.position.x, projectile.mesh.position.z, 0.12)) {
        this.spawnBurst(projectile.mesh.position.clone(), THEMES[this.level.theme].hazard, 8);
        this.scene.remove(projectile.mesh);
        return false;
      }
      if (distance2D(projectile.mesh.position, this.player.position) < 1.0) {
        this.damagePlayer(projectile.damage, projectile.mesh.position);
        this.scene.remove(projectile.mesh);
        return false;
      }
      return true;
    });
  }

  updatePickups(dt, elapsed) {
    this.pickups = this.pickups.filter((pickup) => {
      pickup.life -= dt;
      pickup.spin += dt * 3;
      pickup.mesh.rotation.y += dt * 2.4;
      pickup.mesh.position.y = 0.7 + Math.sin(elapsed * 4 + pickup.spin) * 0.15;
      const dist = distance2D(pickup.mesh.position, this.player.position);
      if (this.state.abilities.wayfinder && pickup.type === 'shard' && dist < 4.4) {
        const pull = this.player.position.clone().sub(pickup.mesh.position).setY(0);
        if (pull.lengthSq() > 0) {
          pull.normalize();
          pickup.mesh.position.addScaledVector(pull, dt * 6.5);
        }
      }
      if (dist < (this.state.abilities.wayfinder ? 1.9 : 1.2)) {
        if (pickup.type === 'heart') {
          this.state.health = Math.min(this.state.maxHealth, this.state.health + 1);
          this.audio.play('heal');
        } else {
          this.state.shards += 1;
          this.audio.play('pickup');
        }
        this.renderHud();
        this.scene.remove(pickup.mesh);
        this.saveState();
        return false;
      }
      if (pickup.life <= 0) {
        this.scene.remove(pickup.mesh);
        return false;
      }
      return true;
    });
  }

  updateParticles(dt) {
    this.particles = this.particles.filter((particle) => {
      particle.life -= dt;
      if (particle.mode === 'fade') {
        particle.mesh.material.opacity = Math.max(0, particle.life * 12);
      }
      if (particle.mode === 'burst') {
        particle.mesh.userData.pieces?.forEach((piece) => {
          piece.position.addScaledVector(piece.userData.velocity, dt);
          piece.userData.velocity.multiplyScalar(0.88);
        });
      }
      if (particle.life <= 0) {
        this.scene.remove(particle.mesh);
        return false;
      }
      return true;
    });
  }

  updateTouchHud() {
    this.dom.touchHook.hidden = !this.state.abilities.magnet;
    this.dom.touchDash.hidden = !this.state.abilities.dash;
    this.dom.touchNova.hidden = !this.state.abilities.starfall;
  }

  notify(message, duration = 2.2) {
    if (!message) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.dom.toasts.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('gone');
      window.setTimeout(() => toast.remove(), 260);
    }, duration * 1000);
  }

  renderHud() {
    if (!this.level) return;
    this.dom.areaName.textContent = this.level.name;
    this.dom.objective.textContent = this.currentObjective();
    this.dom.health.innerHTML = Array.from({ length: this.state.maxHealth }, (_, index) => `<span class="heart ${index < this.state.health ? 'full' : ''}">&#9670;</span>`).join('');
    this.dom.shards.textContent = this.state.shards;
    this.dom.bolts.textContent = this.state.shotLevel;

    const abilities = Object.entries(this.state.abilities)
      .filter(([, unlocked]) => unlocked)
      .map(([key]) => `<span class="ability-chip">${ABILITY_META[key].short}<small>${ABILITY_META[key].key}</small></span>`)
      .join('');
    this.dom.abilities.innerHTML = abilities || '<span class="ability-chip dim">Spark Bolt<small>Starter</small></span>';
    this.dom.minimap.parentElement.classList.toggle('wayfinder-ready', this.state.abilities.wayfinder);

    const boss = this.entities.get('vault-king');
    const bossActive = boss && boss.state.alive && !this.state.flags.bossCleared;
    this.dom.bossHud.classList.toggle('hidden', !bossActive);
    if (bossActive) {
      this.dom.bossBar.style.width = `${clamp((boss.state.hp / boss.state.maxHp) * 100, 0, 100)}%`;
      this.dom.bossLabel.textContent = 'The Choir King';
    }
  }

  drawMinimap() {
    if (!this.level) return;
    const ctx = this.dom.minimap.getContext('2d');
    const width = this.dom.minimap.width;
    const height = this.dom.minimap.height;
    const mapWidth = this.level.map[0].length;
    const mapHeight = this.level.map.length;
    const size = Math.min(width / mapWidth, height / mapHeight);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(10, 14, 18, 0.65)';
    ctx.fillRect(0, 0, width, height);

    this.level.map.forEach((row, z) => {
      row.split('').forEach((char, x) => {
        if (char === '#') ctx.fillStyle = '#111';
        else if (char === '^') ctx.fillStyle = '#f08a4b';
        else if (char === '!') ctx.fillStyle = this.state.destroyedTiles.includes(`${this.level.id}:${x},${z}`) ? '#222' : '#f7d786';
        else ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x * size + 1, z * size + 1, size - 2, size - 2);
      });
    });

    this.entities.forEach((entity) => {
      if (entity.kind === 'crackedWall' && this.state.destroyedTiles.includes(`${this.level.id}:${entity.def.x},${entity.def.z}`)) return;
      if (!entity.mesh.visible && !(this.state.abilities.wayfinder && (entity.kind === 'chest' || entity.kind === 'crackedWall'))) return;
      const x = entity.def.x * size + size / 2;
      const z = entity.def.z * size + size / 2;
      if (entity.kind === 'portal') ctx.fillStyle = '#9af3ff';
      else if (entity.kind === 'npc') ctx.fillStyle = '#ffd66b';
      else if (entity.kind === 'boss') ctx.fillStyle = '#ff5da4';
      else if (entity.kind === 'chest') ctx.fillStyle = entity.state.opened ? '#555' : '#ffba61';
      else if (entity.kind === 'pedestal') ctx.fillStyle = '#b7a4ff';
      else if (entity.kind === 'crackedWall' && this.state.abilities.wayfinder) ctx.fillStyle = '#f7d786';
      else return;
      ctx.beginPath();
      ctx.arc(x, z, Math.max(2, size * (entity.kind === 'crackedWall' ? 0.18 : 0.22)), 0, Math.PI * 2);
      ctx.fill();
    });

    const playerTile = worldToTile(this.level, this.player.position.x, this.player.position.z);
    const px = playerTile.x * size + size / 2;
    const pz = playerTile.z * size + size / 2;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-this.player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.34);
    ctx.lineTo(size * 0.22, size * 0.28);
    ctx.lineTo(-size * 0.22, size * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(this.clock.getDelta(), 0.033);
    const elapsed = this.clock.elapsedTime;

    this.flashAmount *= 0.9;
    this.dom.flash.style.opacity = this.flashAmount.toFixed(3);

    if (this.level) {
      this.levelAnimators.forEach((animator) => animator(elapsed));
      this.entities.forEach((entity) => entity.animators?.forEach((animator) => animator(elapsed, entity)));
      this.updateGroups(dt);
      this.updatePlayer(dt, elapsed);
      this.updateEnemies(dt, elapsed);
      this.updateProjectiles(dt);
      this.updatePickups(dt, elapsed);
      this.updateParticles(dt);
      this.renderHud();
      this.drawMinimap();
    }

    this.renderer.render(this.scene, this.camera);
  }
}


