// Respect: points from missions, races, jars of zacusca, PET bonuses and crimes stopped. Ten levels,
// and each level unlocks perks (a longer rope, more health, more thrown slippers, scarf colours) that
// the other systems read from game.perks. The value is saved under 'respect'.

// Points needed to reach level 1..10; the gaps grow.
export const LEVELS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];
export const MAX_LEVEL = LEVELS.length;

export function levelFor(value) {
  let level = 1;
  for (let i = 1; i < MAX_LEVEL; i++) if (value >= LEVELS[i]) level = i + 1;
  return level;
}

// Multipliers and counts a level unlocks. `petScarves` are the extra colours won from PET bottles.
export function perksFor(level, petScarves = 0) {
  return {
    ropeLen: 1 + 0.08 * Math.floor((level - 1) / 2),
    maxHp: 1 + 0.1 * Math.floor(level / 2),
    throwCount: level >= 9 ? 3 : level >= 5 ? 2 : 1,
    scarves: 1 + Math.floor(level / 2) + petScarves,
  };
}

const CRIME_RESPECT = 20;

export function create(game) {
  const { save, events } = game;
  let value = Math.max(0, +save.get('respect', {}).value || 0);
  const perks = (game.perks = perksFor(levelFor(value)));
  const refreshPerks = () => Object.assign(perks, perksFor(levelFor(value), Math.floor((save.get('pet', {}).total || 0) / 10)));
  refreshPerks();

  const respect = (game.respect = {
    get value() {
      return value;
    },
    get level() {
      return levelFor(value);
    },
    // Points into the current level, and the size of it (both 0 at the top), for a progress bar.
    get into() {
      return this.level >= MAX_LEVEL ? 0 : value - LEVELS[this.level - 1];
    },
    get span() {
      return this.level >= MAX_LEVEL ? 0 : LEVELS[this.level] - LEVELS[this.level - 1];
    },
    // n may be negative (busted, knocked out): the value never goes below the start of the level
    // reached, so a loss costs progress but never a level or a perk. Returns the change applied.
    add(n, why = '') {
      if (!Number.isFinite(n) || n === 0) return 0;
      const before = value, from = levelFor(value);
      value = n > 0 ? value + n : Math.max(LEVELS[from - 1], value + n);
      const delta = value - before;
      if (delta === 0) return 0;
      save.set('respect', { value });
      const level = levelFor(value);
      if (level > from) refreshPerks();
      events.emit('respect', { amount: delta, why });
      for (let l = from + 1; l <= level; l++) events.emit('level:up', { level: l });
      return delta;
    },
  });

  return {
    name: 'respect',
    init() {
      events.on('crime:solved', (e) => respect.add(CRIME_RESPECT, `crime:${e?.how ?? ''}`));
      events.on('collect', (e) => e?.kind === 'pet' && refreshPerks());
      events.on('level:up', ({ level }) => {
        game.hud.toast(`Livello ${level}!`, 2.6);
        game.voice?.say('levelUp');
      });
    },
  };
}
