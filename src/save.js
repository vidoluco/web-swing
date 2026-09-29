// Progress kept in the browser under one localStorage key. Storage can be missing or throw
// (private windows, blocked site data): every access is guarded and the values stay in memory.
const KEY = 'webswing.v1';

export class Save {
  constructor(key = KEY) {
    this.key = key;
    this.mem = new Map(); // name -> JSON text, so callers never share objects with the store
    for (const [k, v] of Object.entries(this.read())) this.mem.set(k, JSON.stringify(v));
  }

  read() {
    try {
      const o = JSON.parse(localStorage.getItem(this.key) || '{}');
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }

  get(name, fallback) {
    const s = this.mem.get(name);
    return s === undefined ? fallback : JSON.parse(s);
  }

  // Values must survive JSON. Setting undefined removes the name.
  set(name, value) {
    if (value === undefined) this.mem.delete(name);
    else this.mem.set(name, JSON.stringify(value));
    try {
      // Read again first so a second tab's other names are not overwritten.
      const stored = this.read();
      if (value === undefined) delete stored[name];
      else stored[name] = value;
      localStorage.setItem(this.key, JSON.stringify(stored));
    } catch {
      // memory only
    }
  }
}
