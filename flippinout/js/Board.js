import { Tile } from './Tile.js';
import {
  DEFAULT_GRID_COLS,
  DEFAULT_GRID_ROWS,
  MIN_GRID_COLS,
  MAX_GRID_COLS,
  MIN_GRID_ROWS,
  MAX_GRID_ROWS,
  STAGGER_DELAY,
  TOTAL_TRANSITION
} from './constants.js';

export class Board {
  constructor(containerEl, soundEngine, themeManager) {
    this.containerEl = containerEl;
    this.cols = DEFAULT_GRID_COLS;
    this.rows = DEFAULT_GRID_ROWS;
    this.soundEngine = soundEngine;
    this.themeManager = themeManager;
    this.isTransitioning = false;
    this.tiles = [];
    this.currentGrid = [];
    this.lastLines = [];
    this.resizeObserver = null;

    this.boardEl = document.createElement('div');
    this.boardEl.className = 'board';

    this.leftBar = this._createAccentBar('accent-bar-left');
    this.boardEl.appendChild(this.leftBar);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'tile-grid';
    this.boardEl.appendChild(this.gridEl);

    this.rightBar = this._createAccentBar('accent-bar-right');
    this.boardEl.appendChild(this.rightBar);

    this.settingsButton = document.createElement('button');
    this.settingsButton.type = 'button';
    this.settingsButton.className = 'board-settings-button';
    this.settingsButton.setAttribute('aria-expanded', 'false');
    this.settingsButton.setAttribute('aria-controls', 'board-settings-panel');
    this.settingsButton.textContent = 'Grid';
    this.boardEl.appendChild(this.settingsButton);

    this.settingsPanel = this._createSettingsPanel();
    this.boardEl.appendChild(this.settingsPanel);

    const hint = document.createElement('div');
    hint.className = 'keyboard-hint';
    hint.textContent = 'N';
    hint.title = 'Keyboard shortcuts';
    hint.addEventListener('click', (event) => {
      event.stopPropagation();
      const overlay = this.boardEl.querySelector('.shortcuts-overlay');
      if (overlay) overlay.classList.toggle('visible');
    });
    this.boardEl.appendChild(hint);

    const overlay = document.createElement('div');
    overlay.className = 'shortcuts-overlay';
    overlay.innerHTML = `
      <div><span>Next message</span><kbd>Enter</kbd></div>
      <div><span>Previous</span><kbd>\u2190</kbd></div>
      <div><span>Settings</span><kbd>G</kbd></div>
      <div><span>Clock mode</span><kbd>C</kbd></div>
      <div><span>Change theme</span><kbd>T</kbd></div>
      <div><span>Fullscreen</span><kbd>F</kbd></div>
      <div><span>Mute</span><kbd>M</kbd></div>
    `;
    this.boardEl.appendChild(overlay);

    const settingsTiles = document.createElement('div');
    settingsTiles.className = 'settings-tiles';

    this.leftSettingTile = document.createElement('div');
    this.leftSettingTile.className = 'settings-tile';
    this.leftSettingTile.id = 'left-setting-tile';
    this.leftSettingTile.textContent = 'GRID';

    this.centerSettingTile = document.createElement('div');
    this.centerSettingTile.className = 'settings-tile';
    this.centerSettingTile.id = 'center-setting-tile';
    this.centerSettingTile.textContent = 'CLOCK';

    this.rightSettingTile = document.createElement('div');
    this.rightSettingTile.className = 'settings-tile settings-tile-primary';
    this.rightSettingTile.id = 'right-setting-tile';
    this.rightSettingTile.textContent = 'FULL';

    settingsTiles.appendChild(this.leftSettingTile);
    settingsTiles.appendChild(this.centerSettingTile);
    settingsTiles.appendChild(this.rightSettingTile);
    this.boardEl.appendChild(settingsTiles);

    containerEl.appendChild(this.boardEl);

    this._rebuildGrid();
    this._attachEvents();
    this._updateLayout();
    this._updateAccentColors();
  }

  _createSettingsPanel() {
    const panel = document.createElement('aside');
    panel.className = 'board-settings-panel';
    panel.id = 'board-settings-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="settings-panel-header">
        <div>
          <p class="settings-panel-eyebrow">Display settings</p>
          <h2>Grid layout</h2>
        </div>
        <button type="button" class="settings-close-button" aria-label="Close settings">Close</button>
      </div>
      <p class="settings-panel-copy">Choose how many flippers to render. Tile sizing adjusts automatically, including in fullscreen.</p>
      <form class="settings-grid-form">
        <label>
          <span>Columns</span>
          <input id="grid-cols-input" name="cols" type="number" min="${MIN_GRID_COLS}" max="${MAX_GRID_COLS}" value="${this.cols}">
        </label>
        <label>
          <span>Rows</span>
          <input id="grid-rows-input" name="rows" type="number" min="${MIN_GRID_ROWS}" max="${MAX_GRID_ROWS}" value="${this.rows}">
        </label>
      </form>
      <div class="settings-panel-actions">
        <button type="button" class="settings-action" data-action="apply-grid">Apply grid</button>
        <button type="button" class="settings-action settings-action-secondary" data-action="reset-grid">Reset</button>
        <button type="button" class="settings-action settings-action-secondary" data-action="cycle-theme">Theme</button>
        <button type="button" class="settings-action settings-action-secondary" data-action="toggle-clock">Clock</button>
        <button type="button" class="settings-action settings-action-secondary" data-action="toggle-fullscreen">Fullscreen</button>
      </div>
      <p class="settings-grid-summary">Current grid: <strong>${this.cols} x ${this.rows}</strong></p>
    `;
    return panel;
  }

  _attachEvents() {
    this.settingsButton.addEventListener('click', () => this.toggleSettingsPanel());
    this.settingsPanel.querySelector('.settings-close-button').addEventListener('click', () => this.closeSettingsPanel());
    this.settingsPanel.querySelector('[data-action="apply-grid"]').addEventListener('click', () => this.applyGridInputs());
    this.settingsPanel.querySelector('[data-action="reset-grid"]').addEventListener('click', () => {
      this.setGridSize(DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS);
    });

    const { colsInput, rowsInput } = this.getGridInputs();
    [colsInput, rowsInput].forEach((input) => {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.applyGridInputs();
        }
      });
    });

    document.addEventListener('click', (event) => {
      if (!this.isSettingsOpen()) return;
      if (this.settingsPanel.contains(event.target) || this.settingsButton.contains(event.target)) return;
      this.closeSettingsPanel();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeSettingsPanel();
      }
    });

    window.addEventListener('resize', () => this._updateLayout());
    document.addEventListener('fullscreenchange', () => this._updateLayout());

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this._updateLayout());
      this.resizeObserver.observe(this.containerEl);
      this.resizeObserver.observe(this.boardEl);
    }
  }

  getGridInputs() {
    return {
      colsInput: this.settingsPanel.querySelector('#grid-cols-input'),
      rowsInput: this.settingsPanel.querySelector('#grid-rows-input')
    };
  }

  getSettingsActions() {
    return {
      cycleTheme: this.settingsPanel.querySelector('[data-action="cycle-theme"]'),
      toggleClock: this.settingsPanel.querySelector('[data-action="toggle-clock"]'),
      toggleFullscreen: this.settingsPanel.querySelector('[data-action="toggle-fullscreen"]')
    };
  }

  isSettingsOpen() {
    return !this.settingsPanel.hidden;
  }

  toggleSettingsPanel(forceOpen) {
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !this.isSettingsOpen();
    this.settingsPanel.hidden = !shouldOpen;
    this.settingsButton.setAttribute('aria-expanded', String(shouldOpen));
    this.boardEl.classList.toggle('settings-open', shouldOpen);

    if (shouldOpen) {
      this.syncSettingsInputs();
    }
  }

  closeSettingsPanel() {
    if (this.isSettingsOpen()) {
      this.toggleSettingsPanel(false);
    }
  }

  syncSettingsInputs() {
    const { colsInput, rowsInput } = this.getGridInputs();
    colsInput.value = this.cols;
    rowsInput.value = this.rows;
    const summary = this.settingsPanel.querySelector('.settings-grid-summary strong');
    summary.textContent = `${this.cols} x ${this.rows}`;
  }

  applyGridInputs() {
    const { colsInput, rowsInput } = this.getGridInputs();
    const cols = Number.parseInt(colsInput.value, 10);
    const rows = Number.parseInt(rowsInput.value, 10);
    this.setGridSize(cols, rows);
  }

  _clampGridValue(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  setGridSize(cols, rows) {
    const nextCols = this._clampGridValue(cols, MIN_GRID_COLS, MAX_GRID_COLS, this.cols);
    const nextRows = this._clampGridValue(rows, MIN_GRID_ROWS, MAX_GRID_ROWS, this.rows);

    if (nextCols === this.cols && nextRows === this.rows) {
      this.syncSettingsInputs();
      this._updateLayout();
      return;
    }

    this.cols = nextCols;
    this.rows = nextRows;
    this._rebuildGrid();
    this.renderLines(this.lastLines, { animate: false });
    this.syncSettingsInputs();
    this._updateLayout();
  }

  _rebuildGrid() {
    this.gridEl.replaceChildren();
    this.tiles = [];
    this.currentGrid = [];
    this.boardEl.style.setProperty('--grid-cols', this.cols);
    this.boardEl.style.setProperty('--grid-rows', this.rows);

    for (let r = 0; r < this.rows; r++) {
      const row = [];
      const charRow = [];
      for (let c = 0; c < this.cols; c++) {
        const tile = new Tile(r, c);
        tile.setChar(' ');
        this.gridEl.appendChild(tile.el);
        row.push(tile);
        charRow.push(' ');
      }
      this.tiles.push(row);
      this.currentGrid.push(charRow);
    }
  }

  _createAccentBar(extraClass) {
    const bar = document.createElement('div');
    bar.className = `accent-bar ${extraClass}`;
    for (let i = 0; i < 2; i++) {
      const seg = document.createElement('div');
      seg.className = 'accent-segment';
      bar.appendChild(seg);
    }
    return bar;
  }

  _updateAccentColors() {
    const theme = this.themeManager ? this.themeManager.getTheme() : null;
    const color = theme ? theme.accentColor : '#FFFFFF';

    const segments = this.boardEl.querySelectorAll('.accent-segment');
    segments.forEach((seg) => {
      seg.style.backgroundColor = color;
      seg.style.boxShadow = `0 0 12px ${color}, 0 0 4px ${color}`;
    });
  }

  displayMessage(lines) {
    this.renderLines(lines, { animate: true });
  }

  renderLines(lines, { animate = true } = {}) {
    this.lastLines = Array.isArray(lines) ? [...lines] : [];

    if (!animate) {
      const newGrid = this._formatToGrid(this.lastLines);
      this._applyGridImmediately(newGrid);
      return;
    }

    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const newGrid = this._formatToGrid(this.lastLines);
    let hasChanges = false;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const newChar = newGrid[r][c];
        const oldChar = this.currentGrid[r][c];

        if (newChar !== oldChar) {
          const delay = (r * this.cols + c) * STAGGER_DELAY;
          this.tiles[r][c].scrambleTo(newChar, delay);
          hasChanges = true;
        }
      }
    }

    if (hasChanges && this.soundEngine) {
      this.soundEngine.playTransition();
    }

    this._updateAccentColors();
    this.currentGrid = newGrid;

    setTimeout(() => {
      this.isTransitioning = false;
    }, TOTAL_TRANSITION + 200);
  }

  _applyGridImmediately(newGrid) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.tiles[r][c].setChar(newGrid[r][c]);
      }
    }
    this.currentGrid = newGrid;
    this.isTransitioning = false;
    this._updateAccentColors();
  }

  _formatToGrid(lines) {
    const incomingLines = Array.isArray(lines) ? lines.map((line) => String(line || '').toUpperCase()) : [];
    const trimmedLines = [...incomingLines];

    while (trimmedLines.length && !trimmedLines[0].trim()) trimmedLines.shift();
    while (trimmedLines.length && !trimmedLines[trimmedLines.length - 1].trim()) trimmedLines.pop();

    const visibleLines = trimmedLines.length ? trimmedLines.slice(0, this.rows) : [];
    const topPad = Math.max(0, Math.floor((this.rows - visibleLines.length) / 2));

    return Array.from({ length: this.rows }, (_, rowIndex) => {
      const line = (visibleLines[rowIndex - topPad] ?? '').slice(0, this.cols);
      const padTotal = this.cols - line.length;
      const padLeft = Math.max(0, Math.floor(padTotal / 2));
      const padded = ' '.repeat(padLeft) + line + ' '.repeat(Math.max(0, this.cols - padLeft - line.length));
      return padded.split('');
    });
  }

  _updateLayout() {
    const hostRect = this.containerEl.getBoundingClientRect();
    const boardStyles = window.getComputedStyle(this.boardEl);
    const isFullscreen = Boolean(document.fullscreenElement);
    const horizontalPadding = parseFloat(boardStyles.paddingLeft) + parseFloat(boardStyles.paddingRight);
    const verticalPadding = parseFloat(boardStyles.paddingTop) + parseFloat(boardStyles.paddingBottom);
    const accentAllowance = window.innerWidth >= 768 ? 40 : 0;
    const bottomControlsAllowance = window.innerWidth < 768 ? 52 : 0;

    const availableWidth = Math.max(160, hostRect.width - horizontalPadding - accentAllowance);
    const availableHeight = isFullscreen
      ? Math.max(120, window.innerHeight - verticalPadding - bottomControlsAllowance)
      : Number.POSITIVE_INFINITY;

    const gap = isFullscreen ? 2 : Math.max(2, Math.min(6, Math.round(availableWidth / 220)));
    const widthSize = (availableWidth - (gap * (this.cols - 1))) / this.cols;
    const heightSize = Number.isFinite(availableHeight)
      ? (availableHeight - (gap * (this.rows - 1))) / this.rows
      : widthSize;
    const unclampedSize = Math.min(widthSize, heightSize);
    const maxTileSize = isFullscreen ? 160 : 72;
    const tileSize = Math.max(14, Math.min(maxTileSize, Math.floor(unclampedSize)));

    this.boardEl.style.setProperty('--tile-gap', `${gap}px`);
    this.boardEl.style.setProperty('--tile-size', `${tileSize}px`);
  }
}
