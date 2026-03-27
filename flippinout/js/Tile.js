import { CHARSET, SCRAMBLE_DURATION, FLIP_DURATION } from './constants.js';

export class Tile {
  constructor(row, col) {
    this.row = row;
    this.col = col;
    this.currentChar = ' ';
    this.isAnimating = false;
    this._scrambleTimer = null;

    // Build DOM
    this.el = document.createElement('div');
    this.el.className = 'tile';

    this.innerEl = document.createElement('div');
    this.innerEl.className = 'tile-inner';

    this.frontEl = document.createElement('div');
    this.frontEl.className = 'tile-front';
    this.frontSpan = document.createElement('span');
    this.frontEl.appendChild(this.frontSpan);

    this.backEl = document.createElement('div');
    this.backEl.className = 'tile-back';
    this.backSpan = document.createElement('span');
    this.backEl.appendChild(this.backSpan);

    this.innerEl.appendChild(this.frontEl);
    this.innerEl.appendChild(this.backEl);
    this.el.appendChild(this.innerEl);
  }

  setChar(char) {
    this.currentChar = char;
    this.frontSpan.textContent = char === ' ' ? '' : char;
    this.backSpan.textContent = '';
    this.frontEl.style.backgroundColor = '';
  }

  scrambleTo(targetChar, delay) {
    if (targetChar === this.currentChar) return;

    // Cancel any in-progress animation
    if (this._scrambleTimer) {
      clearInterval(this._scrambleTimer);
      this._scrambleTimer = null;
    }
    this.isAnimating = true;

    setTimeout(() => {
      this.el.classList.add('scrambling');
      let scrambleCount = 0;
      const maxScrambles = 12 + Math.floor(Math.random() * 6);
      const scrambleInterval = 65;

      this._scrambleTimer = setInterval(() => {
        // Random character flipping - authentic mechanical behavior
        // Real split-flap boards just cycle through characters, no color changes
        let randChar;
        if (Math.random() < 0.3 && targetChar !== ' ') {
          // Sometimes show target character early (mechanical overshoot behavior)
          randChar = targetChar;
        } else {
          randChar = CHARSET[Math.floor(Math.random() * CHARSET.length)];
        }
        this.frontSpan.textContent = randChar === ' ' ? '' : randChar;

        scrambleCount++;

        if (scrambleCount >= maxScrambles) {
          clearInterval(this._scrambleTimer);
          this._scrambleTimer = null;

          // Prepare back face with new character
          this.backSpan.textContent = targetChar === ' ' ? '' : targetChar;

          // Full 3D mechanical flip animation
          this.innerEl.classList.add('flipping');
          this.innerEl.style.transition = `transform ${FLIP_DURATION * 1.5}ms ease-in-out`;
          this.innerEl.style.transform = 'perspective(600px) rotateX(-180deg)';

          setTimeout(() => {
            // Swap characters
            this.frontSpan.textContent = targetChar === ' ' ? '' : targetChar;
            this.backSpan.textContent = '';
            
            // Reset rotation
            this.innerEl.style.transition = 'none';
            this.innerEl.style.transform = '';
            this.innerEl.classList.remove('flipping');
            
            // Brief settle bounce
            setTimeout(() => {
              this.innerEl.style.transition = `transform ${FLIP_DURATION / 2}ms cubic-bezier(0.68, -0.55, 0.265, 1.55)`;
              this.innerEl.style.transform = 'perspective(600px) rotateX(-3deg)';
              
              setTimeout(() => {
                this.innerEl.style.transform = '';
                setTimeout(() => {
                  this.innerEl.style.transition = '';
                  this.el.classList.remove('scrambling');
                  this.currentChar = targetChar;
                  this.isAnimating = false;
                }, 50);
              }, 60);
            }, 10);
          }, FLIP_DURATION * 1.5);
        }
      }, scrambleInterval);
    }, delay);
  }
}
