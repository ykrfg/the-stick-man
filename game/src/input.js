// Keyboard and mouse state for the game loop. The loop reads `keys` for held keys and
// `pressed` for one-frame taps (interact, pause, confirm); main.js clears `pressed`
// at the end of every frame. Mouse position is kept in screen pixels and converted
// to world coordinates by the camera code in main.js. On touch devices the virtual
// joystick and buttons in touch.js write into these same sets (and into `stick`),
// so every system downstream reads one input layer regardless of device.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    // Analog virtual-joystick axes, each -1..1, written by touch.js while a
    // thumb is on the stick; inactive (active=false) on keyboard/mouse.
    this.stick = { x: 0, y: 0, active: false };
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

  /** A virtual button going down: same effect as a key tap plus hold. */
  pressButton(code) {
    this.keys.add(code);
    this.pressed.add(code);
  }

  /** A virtual button released: ends the hold (taps are cleared per frame). */
  releaseButton(code) {
    this.keys.delete(code);
  }

  /**
   * Movement axes: the virtual joystick while a thumb is on it (analog,
   * -1..1 per axis), otherwise WASD or the arrow keys (-1, 0, 1).
   */
  axes() {
    if (this.stick.active) return { x: this.stick.x, y: this.stick.y };
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
