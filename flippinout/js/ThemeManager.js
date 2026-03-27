import { THEMES } from './constants.js';

export class ThemeManager {
  constructor(boardEl) {
    this.boardEl = boardEl;
    this.currentTheme = 'classic';
    this.themeNames = Object.keys(THEMES);
    this._applyTheme(this.currentTheme);
  }

  cycleTheme() {
    const currentIndex = this.themeNames.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % this.themeNames.length;
    this.currentTheme = this.themeNames[nextIndex];
    this._applyTheme(this.currentTheme);
    return THEMES[this.currentTheme].name;
  }

  _applyTheme(themeName) {
    const theme = THEMES[themeName];
    const root = document.documentElement;
    
    root.style.setProperty('--theme-text-color', theme.textColor);
    root.style.setProperty('--theme-bg-color', theme.bgColor);
    root.style.setProperty('--theme-tile-bg', theme.tileBg);
    root.style.setProperty('--theme-board-bg', theme.boardBg);
    root.style.setProperty('--theme-accent-color', theme.accentColor);
    
    // Apply to board element
    if (this.boardEl) {
      this.boardEl.style.background = theme.boardBg;
    }
    
    // Store current theme
    this.currentThemeData = theme;
  }

  getTheme() {
    return this.currentThemeData;
  }
}
