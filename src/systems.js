import LOADERS from './systems-list.js';

// Registry of the gameplay systems (see systems-list.js). Reachable as game.systems.
// A system that throws is logged once and keeps running, so one bug does not freeze the game.
export class Systems {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.started = new Set();
    this.failed = new Set();
  }

  // Creates every system from the list; nothing is initialised yet, so create() may not use the others.
  async load(loaders = LOADERS) {
    for (const load of loaders) this.list.push((await load()).create(this.game));
  }

  // Runs init on the systems that have not started, then onCityChange with the current city.
  // At boot that is all of them, in list order, once every system exists.
  start() {
    const fresh = this.list.filter((s) => !this.started.has(s));
    for (const s of fresh) {
      this.started.add(s);
      this.call(s, 'init');
    }
    for (const s of fresh) this.call(s, 'onCityChange', this.game.cityId);
  }

  update(dt) {
    for (const s of this.list) this.call(s, 'update', dt);
  }

  get(name) {
    return this.list.find((s) => s.name === name);
  }

  // A system created by hand, for tests and tools; it goes last and starts right away.
  add(system) {
    this.list.push(system);
    this.start();
    return system;
  }

  remove(name) {
    const s = this.get(name);
    if (!s) return;
    this.list.splice(this.list.indexOf(s), 1);
    this.started.delete(s);
    this.call(s, 'dispose');
  }

  call(s, fn, ...args) {
    try {
      s[fn]?.(...args);
    } catch (e) {
      if (this.failed.has(s)) return;
      this.failed.add(s);
      console.error(`system ${s.name}.${fn}`, e);
    }
  }
}
