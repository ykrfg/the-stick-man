// Keyboard and mouse state for the game loop. The loop reads `keys` for held keys and
// `pressed` for one-frame taps (interact, pause, confirm); main.js clears `pressed`
// at the end of every frame. Mouse position is kept in screen pixels and converted
// to world coordinates by the camera code in main.js.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, clicked: false };
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      this.pressed.add(event.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = event.clientX - rect.left;
      this.mouse.y = event.clientY - rect.top;
    });
    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) {
        this.mouse.down = true;
        this.mouse.clicked = true;
      }
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mouse.down = false;
    });
  }

  /** True while any of the given key codes is held. */
  down(...codes) {
    return codes.some((code) => this.keys.has(code));
  }

  /** True only on the frame the key went down. */
  tapped(...codes) {
    return codes.some((code) => this.pressed.has(code));
  }

  /** Movement axes from WASD or the arrow keys: x and y in -1, 0, 1. */
  axes() {
    const x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.down('KeyW', 'ArrowUp') ? 1 : 0);
    return { x, y };
  }

  /** Call once per frame after the update has read the taps. */
  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
  }
}
