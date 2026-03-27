export class ClockMode {
  constructor(board) {
    this.board = board;
    this.isActive = false;
    this.updateInterval = null;
    this.lastTimeString = '';
  }

  start() {
    this.isActive = true;
    this._updateClock();
    this.updateInterval = setInterval(() => this._updateClock(), 1000);
  }

  stop() {
    this.isActive = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  _updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const date = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();

    const timeString = `${hours}:${minutes}:${seconds}`;
    
    // Only update if time changed (prevent unnecessary flips)
    if (timeString !== this.lastTimeString) {
      this.lastTimeString = timeString;
      
      const message = [
        '',
        dayName,
        `${date} ${monthName} ${year}`,
        '',
        `${hours}:${minutes}:${seconds}`,
        '',
        ''
      ];
      
      this.board.displayMessage(message);
    }
  }
}
