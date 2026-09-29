// Tiny event bus shared by the systems. Names and payloads are listed in the README.
export class Events {
  constructor() {
    this.map = new Map();
  }

  // Returns the function that unsubscribes.
  on(name, fn) {
    let set = this.map.get(name);
    if (!set) this.map.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  // A listener that throws is logged and must not stop the others.
  emit(name, payload) {
    const set = this.map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`event ${name}`, e);
      }
    }
  }
}
