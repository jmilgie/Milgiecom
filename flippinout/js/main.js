import { Board } from './Board.js';
import { SoundEngine } from './SoundEngine.js';
import { MessageRotator } from './MessageRotator.js';
import { KeyboardController } from './KeyboardController.js';
import { ThemeManager } from './ThemeManager.js';
import { ClockMode } from './ClockMode.js';

document.addEventListener('DOMContentLoaded', () => {
  const boardContainer = document.getElementById('board-container');
  const soundEngine = new SoundEngine();

  const themeManager = new ThemeManager(null);
  const board = new Board(boardContainer, soundEngine, themeManager);
  themeManager.boardEl = board.boardEl;

  const rotator = new MessageRotator(board);
  const clockMode = new ClockMode(board);
  const keyboard = new KeyboardController(rotator, soundEngine);

  let isClockMode = false;

  const enterClockMode = () => {
    if (isClockMode) return;
    isClockMode = true;
    rotator.stop();
    clockMode.start();
    board.centerSettingTile.classList.add('active');
    showNotification('Clock Mode ON');
  };

  const exitClockMode = () => {
    if (!isClockMode) return;
    isClockMode = false;
    clockMode.stop();
    rotator.start();
    board.centerSettingTile.classList.remove('active');
    showNotification('Message Mode ON');
  };

  const toggleClockMode = () => {
    if (isClockMode) {
      exitClockMode();
    } else {
      enterClockMode();
    }
  };

  const cycleTheme = () => {
    const themeName = themeManager.cycleTheme();
    showNotification(`Theme: ${themeName}`);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        showNotification('Fullscreen not available');
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const { cycleTheme: cycleThemeAction, toggleClock: toggleClockAction, toggleFullscreen: toggleFullscreenAction } = board.getSettingsActions();
  cycleThemeAction.addEventListener('click', cycleTheme);
  toggleClockAction.addEventListener('click', toggleClockMode);
  toggleFullscreenAction.addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

    if (event.key === 't' || event.key === 'T') {
      cycleTheme();
    }

    if (event.key === 'c' || event.key === 'C') {
      toggleClockMode();
    }

    if (event.key === 'g' || event.key === 'G') {
      event.preventDefault();
      board.toggleSettingsPanel();
    }
  });

  let audioInitialized = false;
  const initAudio = async () => {
    if (audioInitialized) return;
    audioInitialized = true;
    await soundEngine.init();
    soundEngine.resume();
    document.removeEventListener('click', initAudio);
    document.removeEventListener('keydown', initAudio);
  };
  document.addEventListener('click', initAudio);
  document.addEventListener('keydown', initAudio);

  rotator.start();

  const volumeBtn = document.getElementById('volume-btn');
  if (volumeBtn) {
    volumeBtn.addEventListener('click', () => {
      initAudio();
      const muted = soundEngine.toggleMute();
      volumeBtn.classList.toggle('muted', muted);
    });
  }

  const ctaBtn = document.getElementById('cta-btn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', (event) => {
      event.preventDefault();
      initAudio();
      boardContainer.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => {
        document.documentElement.requestFullscreen().catch(() => {});
      }, 400);
    });
  }

  const leftSettingTile = document.getElementById('left-setting-tile');
  const centerSettingTile = document.getElementById('center-setting-tile');
  const rightSettingTile = document.getElementById('right-setting-tile');

  if (leftSettingTile) {
    leftSettingTile.addEventListener('click', () => {
      leftSettingTile.classList.add('flipping');
      setTimeout(() => {
        board.toggleSettingsPanel(true);
        leftSettingTile.classList.remove('flipping');
      }, 150);
    });
  }

  if (centerSettingTile) {
    centerSettingTile.addEventListener('click', () => {
      centerSettingTile.classList.add('flipping');
      setTimeout(() => {
        toggleClockMode();
        centerSettingTile.classList.remove('flipping');
      }, 150);
    });
  }

  if (rightSettingTile) {
    rightSettingTile.addEventListener('click', toggleFullscreen);
  }

  document.addEventListener('fullscreenchange', () => {
    board.closeSettingsPanel();
  });

  void keyboard;

  function showNotification(message) {
    const existing = document.querySelector('.mode-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.className = 'mode-notification';
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => notif.classList.add('visible'), 10);
    setTimeout(() => {
      notif.classList.remove('visible');
      setTimeout(() => notif.remove(), 300);
    }, 2000);
  }
});
