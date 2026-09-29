// Keyboard + mouse with pointer lock. Edge-triggered presses are cleared every frame.
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDown = false;
    this.mousePressed = false;
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    this.lastMouseMove = 0;
    this.override = null; // autopilot for ?demo

    addEventListener('keydown', (e) => {
      if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      }
      if (e.button === 2) this.pressed.add('KeyE');
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
      this.lastMouseMove = performance.now();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
    });
  }

  lock() {
    this.el.requestPointerLock?.();
  }

  get state() {
    if (this.override) return this.override;
    const k = this.keys;
    const x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const y = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    return {
      moveX: x,
      moveY: y,
      jump: k.has('Space'),
      jumpPressed: this.pressed.has('Space'),
      swing: this.mouseDown || k.has('ShiftLeft') || k.has('ShiftRight'),
      swingPressed: this.mousePressed || this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'),
      zipPressed: this.pressed.has('KeyE'),
      suitPressed: this.pressed.has('KeyV'),
      resetPressed: this.pressed.has('KeyR'),
      mapPressed: this.pressed.has('KeyM'),
      carPressed: this.pressed.has('KeyF'),
      spot: [...this.pressed].map((c) => (/^Digit\d$/.test(c) ? (+c[5] + 9) % 10 : -1)).find((v) => v >= 0),
    };
  }

  consumeMouse() {
    const d = [this.dx, this.dy];
    this.dx = this.dy = 0;
    return d;
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed = false;
  }
}
