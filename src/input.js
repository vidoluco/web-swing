// Keyboard + mouse with pointer lock. Edge-triggered presses are cleared every frame.
// The combat and interaction keys (J or left click, Q, C, G, P) only report; the systems decide what they do.
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
      attackPressed: this.mousePressed || this.pressed.has('KeyJ'),
      throwPressed: this.pressed.has('KeyQ'),
      tiePressed: this.pressed.has('KeyC'),
      interactPressed: this.pressed.has('KeyG'),
      pausePressed: this.pressed.has('KeyP'),
      spot: [...this.pressed].map((c) => (/^Digit\d$/.test(c) ? ((+c[5] + 9) % 10) + (k.has('AltLeft') || k.has('AltRight') ? 10 : 0) : -1)).find((v) => v >= 0), // bars: Alt plus a digit is the second row of places
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
