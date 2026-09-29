// Timed bonuses from the PET bottles, 30 seconds each: turbo (swing speed x1.25, jump x1.2, and
// double slipper damage in combat), shield (half the damage taken), fire (the thrown slipper is
// aflame), energy (run and climb speed x1.4). Taking one again refreshes the timer, it does not
// add up. The player's own effects are applied here through player.mods; combat reads has() and
// left() from game.buffs. Time is game.time, so the timers run with advance and simulate.
export const BUFF_SECONDS = 30;

export function create(game) {
  const until = new Map();
  const buffs = (game.buffs = {
    add(name, seconds = BUFF_SECONDS) {
      until.set(name, game.time + seconds);
      game.events.emit('buff', { name, seconds });
    },
    has: (name) => (until.get(name) ?? 0) > game.time,
    left: (name) => Math.max(0, (until.get(name) ?? 0) - game.time),
    // Names still running, longest first.
    active: () => [...until.keys()].filter((n) => buffs.has(n)).sort((a, b) => buffs.left(b) - buffs.left(a)),
  });

  return {
    name: 'buffs',
    update() {
      const m = game.player.mods;
      m.run = m.climb = buffs.has('energy') ? 1.4 : 1;
      m.jump = buffs.has('turbo') ? 1.2 : 1;
      m.swing = buffs.has('turbo') ? 1.25 : 1;
      m.rope = game.perks?.ropeLen ?? 1;
    },
  };
}
