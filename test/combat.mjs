// Bunica and the fights: health, the papuc combo, the thrown papuc, tying, the dodge, the knockout,
// the golani and the clothesline. Positive and negative cases for each. The cost is reported in ms
// per tick, not as a frame rate. Usage: PORT=5222 node test/combat.mjs   (exit code 1 on any failure)
import { mkdirSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';

mkdirSync('shots', { recursive: true });

const srv = await startServer();
const browser = await launch();
const errors = [];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
try {
  const page = await open(browser, 'shot=street&lowq', errors, 1100, 620);

  // Helpers that live in the page. The street is the tree-lined median of Bd. Unirii: open ground.
  await page.evaluate(() => {
    const g = window.__game;
    const T = (window.__t = {});
    T.log = [];
    for (const n of ['hit', 'actor:down', 'actor:tied', 'bunica:hurt', 'bunica:down', 'bunica:respawn', 'heat']) g.events.on(n, (p) => T.log.push([n, p]));
    T.count = (n) => T.log.filter((e) => e[0] === n).length;
    T.stand = (x = -300, z = 12) => {
      g.combat.thugs().forEach((b) => b.a.remove());
      g.actors.clear();
      g.player.reset();
      g.player.pos.set(x, 0, z);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
      g.health.hp = g.health.max;
      g.health.invulnerableLeft = 0;
      g.setInput(null);
      g.look(0, -0.1);
      T.log.length = 0;
      g.simulate(0.3);
    };
    // A thug d metres in front (north, -z) of where she stands, facing her.
    T.thug = (d, opts = {}) => g.combat.spawnThug(g.player.pos.x + (opts.dx || 0), g.player.pos.z - d, { exact: true, ...opts });
    // One tick with these keys down.
    T.press = (o) => {
      g.setInput(o);
      g.simulate(1 / 60);
      g.setInput({});
    };
    T.wait = (s) => g.simulate(s, 1 / 60);
    T.until = (fn, max = 8, step = 1 / 30) => {
      let t = 0;
      while (t < max && !fn()) {
        g.simulate(step, step);
        t += step;
      }
      return t;
    };
  });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // 1. The pieces exist: game.health with its contract, the combat helper, the bar in the HUD.
  let r = await ev(() => {
    const g = window.__game, h = g.health;
    return {
      hp: h.hp, max: h.max, fns: ['damage', 'heal', 'invulnerable'].every((f) => typeof h[f] === 'function'),
      combat: typeof g.combat.spawnThug === 'function', bar: /Salute/i.test(document.getElementById('hud-panels').textContent),
      system: !!g.systems.get('combat'),
    };
  });
  check('game.health, game.combat and the health bar exist', r.hp === 100 && r.max === 100 && r.fns && r.combat && r.bar && r.system, r);

  // 2. A 4 hit combo downs a thug (60 hp); the click is a blow, not a swing.
  r = await ev(async () => {
    const T = window.__t, g = window.__game;
    T.stand();
    const a = T.thug(2.2);
    const hp0 = a.hp;
    const modes = new Set();
    const hits = [];
    for (let i = 0; i < 4; i++) {
      T.press({ attackPressed: true, swingPressed: true, swing: true });
      T.wait(0.4);
      modes.add(g.player.mode);
      hits.push(a.hp);
    }
    T.wait(0.3);
    return { hp0, hits, state: a.state, hitEvents: T.count('hit'), downEvents: T.count('actor:down'), modes: [...modes], blows: g.combat.state().blows };
  });
  check('4 clicks with a thug in reach are a combo that downs it', r.state === 'down' && r.hitEvents === 4 && r.downEvents === 1 && r.hits[0] < r.hp0 && r.hits[3] === 0 && !r.modes.includes('air'), r);

  // 3. No thug within 5 m: the click swings (she hops off the ground) and nothing is struck.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    const far = T.thug(8);
    const b0 = g.combat.state().blows;
    T.press({ attackPressed: true, swingPressed: true, swing: true });
    T.wait(0.3);
    const idle = { mode: g.player.mode, phase: g.combat.state().phase, hp: far.hp, blows: g.combat.state().blows - b0 };
    // The same click with the thug at 3 m is a blow, and she stays on the ground.
    T.stand();
    const near = T.thug(3);
    T.press({ attackPressed: true, swingPressed: true, swing: true });
    T.wait(0.05);
    const during = { mode: g.player.mode, phase: g.combat.state().phase };
    T.wait(0.5);
    return { idle, during, nearHp: near.hp };
  });
  check('a click with nobody within 5 m swings, with a thug in reach it strikes', r.idle.mode === 'air' && r.idle.phase === 'idle' && r.idle.hp === 60 && r.idle.blows === 0 && r.during.mode === 'ground' && r.during.phase !== 'idle' && r.nearHp < 60, r);

  // 4. The thrown papuc: flies out, stuns, comes back to her hand.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    const a = g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - 12 }, { exact: true, persist: true });
    const seen = new Set();
    T.press({ throwPressed: true });
    for (let i = 0; i < 150; i++) {
      T.wait(1 / 30);
      for (const s of g.combat.state().papucs) seen.add(s);
      if (a.state === 'stunned') seen.add('stunned');
    }
    return { seen: [...seen], hp: a.hp, papucsLeft: g.combat.state().papucs.length, stunnedNow: a.state === 'stunned', stunT: a.stunT };
  });
  check('Q throws the papuc: it stuns the thug from afar, then returns to her hand', r.seen.includes('out') && r.seen.includes('back') && r.seen.includes('stunned') && r.hp === 52 && r.papucsLeft === 0, r);

  // 5. Tying: a stunned thug is wound up in the clothesline and is out of the game; a healthy one is not.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    const healthy = g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - 3 }, { exact: true, persist: true });
    T.press({ tiePressed: true });
    T.wait(1.2);
    const fail = { tied: healthy.tied, state: healthy.state, tiedEvents: T.count('actor:tied') };
    T.stand();
    const a = g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - 6 }, { exact: true, persist: true });
    a.stun(3);
    T.press({ tiePressed: true });
    T.wait(1.5);
    const ok = { tied: a.tied, state: a.state, tiedEvents: T.count('actor:tied'), ties: g.combat.state().ties };
    T.wait(8.5);
    return { fail, ok, removed: a.removed, tiesAfter: g.combat.state().ties };
  });
  check('C ties a stunned thug and he is gone a few seconds later; a healthy one cannot be tied', !r.fail.tied && r.fail.tiedEvents === 0 && r.ok.tied && r.ok.state === 'tied' && r.ok.tiedEvents === 1 && r.ok.ties === 1 && r.removed && r.tiesAfter === 0, r);

  // 6. Dodge: Space while a strike is announced. The strike lands 0.4 s after the '!' shows.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    const out = {};
    const y = { max: 0 };
    const track = (secs) => {
      for (let t = 0; t < secs; t += 1 / 60) {
        g.simulate(1 / 60, 1 / 60);
        y.max = Math.max(y.max, g.player.pos.y);
      }
    };
    // Dodged.
    T.stand();
    T.thug(4.5);
    const t0 = T.until(() => g.combat.state().telegraphs > 0, 8);
    const marker = g.scene.children.filter((o) => o.isSprite && o.visible).length;
    T.press({ jumpPressed: true });
    track(1.2);
    out.dodged = { seenTelegraph: t0 < 8, marker, hp: g.health.hp, dodges: g.combat.state().dodges, maxY: y.max, hurt: T.count('bunica:hurt') };
    // Not dodged: the same thug, Space never pressed.
    T.stand();
    T.thug(4.5);
    T.until(() => g.combat.state().telegraphs > 0, 8);
    const hp0 = g.health.hp;
    let tell = 0;
    while (g.health.hp === hp0 && tell < 1.5) {
      g.simulate(1 / 60, 1 / 60);
      tell += 1 / 60;
    }
    out.struck = { hp: g.health.hp, lost: hp0 - g.health.hp, delay: Math.round(tell * 100) / 100, hurt: T.count('bunica:hurt') };
    // A bat hits harder.
    T.stand();
    const bat = T.thug(4.5, { bat: true });
    T.until(() => g.combat.state().telegraphs > 0, 8);
    const hp1 = g.health.hp;
    T.until(() => g.health.hp < hp1, 1.5, 1 / 60);
    out.bat = { lost: hp1 - g.health.hp, mesh: g.combat.thugs().some((b) => b.bat && b.bat.visible) };
    // No strike announced: Space is a plain jump.
    T.stand();
    const d0 = g.combat.state().dodges;
    T.press({ jumpPressed: true });
    g.simulate(0.15);
    out.jump = { mode: g.player.mode, y: Math.round(g.player.pos.y * 100) / 100, dodges: g.combat.state().dodges - d0 };
    return out;
  });
  check('Space dodges an announced strike with no damage', r.dodged.seenTelegraph && r.dodged.marker >= 1 && r.dodged.hp === 100 && r.dodged.dodges === 1 && r.dodged.hurt === 0 && r.dodged.maxY < 0.3, r.dodged);
  check('a strike that is not dodged lowers hp, 0.4 s after the marker, a bat more than a fist', r.struck.lost === 8 && r.struck.delay > 0.25 && r.struck.delay < 0.6 && r.struck.hurt === 1 && r.bat.lost === 14 && r.bat.mesh, { struck: r.struck, bat: r.bat });
  check('Space with no strike announced is a jump, not a dodge', r.jump.mode === 'air' && r.jump.y > 0.3 && r.jump.dodges === 0, r.jump);

  // 7. Health: never below 0 or above max, bad numbers ignored, regenerates slowly out of combat only.
  r = await ev(() => {
    const T = window.__t, g = window.__game, h = g.health;
    T.stand();
    const out = {};
    out.negative = h.damage(-5, 'x') === 0 && h.damage(NaN, 'x') === 0 && h.hp === 100;
    out.atMax = (h.heal(50), h.hp === 100);
    out.partial = h.damage(30, 'x') === 30 && h.hp === 70 && h.heal(1000) === 30 && h.hp === 100;
    g.perks = { maxHp: 1.5 };
    h.heal(1000);
    out.perk = { max: h.max, hp: h.hp };
    g.perks = undefined;
    g.simulate(1 / 30, 1 / 30);
    out.perkGone = h.hp;
    g.buffs = { has: (n) => n === 'shield' };
    out.shield = h.damage(10, 'x');
    g.buffs = undefined;
    h.hp = h.max;
    // Regeneration: nothing for 6 s after a hit, then a couple of hp per second.
    h.damage(20, 'x');
    T.wait(4);
    out.noRegen = h.hp;
    T.wait(6);
    out.regen = Math.round(h.hp * 10) / 10;
    return out;
  });
  check('health stays within 0..max, ignores bad damage, shield halves it', r.negative && r.atMax && r.partial && r.perk.max === 150 && r.perk.hp === 150 && r.perkGone === 100 && r.shield === 5, r);
  check('health regenerates only after 6 s out of combat', r.noRegen === 80 && r.regen > 80.5 && r.regen < 90, { noRegen: r.noRegen, regen: r.regen });

  // 8. Knockout: she faints, cannot be moved, and wakes on the nearest safe roof, poorer in respect.
  r = await ev(() => {
    const T = window.__t, g = window.__game, h = g.health;
    T.stand();
    const respect = [];
    g.respect = { add: (n, why) => respect.push([n, why]) };
    const from = g.player.pos.clone();
    const dealt = h.damage(1000, 'test');
    const down = { hp: h.hp, fainted: g.combat.state().fainted, downEvents: T.count('bunica:down'), dealt };
    const again = h.damage(10, 'test');
    g.setInput({ moveY: 1 });
    T.wait(1);
    g.setInput(null);
    const held = Math.hypot(g.player.pos.x - from.x, g.player.pos.z - from.z);
    T.wait(3);
    const P = g.player, box = P.groundBox;
    const out = { down, again, held: Math.round(held * 100) / 100, respawnEvents: T.count('bunica:respawn'), fainted: g.combat.state().fainted, hp: h.hp, onRoof: !!box && Math.abs(P.pos.y - box.y1) < 0.5 && P.pos.y > 10, away: Math.round(Math.hypot(P.pos.x - from.x, P.pos.z - from.z)), respect };
    g.respect = undefined;
    return out;
  });
  check('at 0 hp she faints, is out for a while and respawns on a roof with a respect penalty', r.down.hp === 0 && r.down.fainted && r.down.downEvents === 1 && r.again === 0 && r.held < 0.5 && r.respawnEvents === 1 && !r.fainted && r.hp === 50 && r.onRoof && r.away < 700 && r.respect.length === 1 && r.respect[0][0] < 0, r);

  // 9. Lock-on and the '!': shown near a thug, gone with none.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    g.simulate(0.2);
    const ring = () => g.scene.children.some((o) => o.geometry?.type === 'RingGeometry' && o.visible);
    const none = { lock: g.combat.state().lock, ring: ring() };
    const a = T.thug(9);
    g.combat.thugs()[0].state = 'idle';
    g.simulate(0.2);
    const near = { lock: g.combat.state().lock, id: a.id, ring: ring() };
    a.remove();
    g.simulate(0.2);
    return { none, near, after: ring() };
  });
  check('the lock-on ring follows the nearest thug and disappears with none', r.none.lock === null && !r.none.ring && r.near.lock === r.near.id && r.near.ring && !r.after, r);

  // 10. A wall stops everything: the papuc, the blow and the thug's strike.
  r = await ev(() => {
    const T = window.__t, g = window.__game, out = {};
    const wall = (z, half = 40) => {
      const x = g.player.pos.x;
      g.city.addPrism({ outer: Float32Array.from([x - half, z - 0.2, x + half, z - 0.2, x + half, z + 0.2, x - half, z + 0.2]), holes: [], signs: [1], y0: 0, y1: 9, minx: x - half, maxx: x + half, minz: z - 0.2, maxz: z + 0.2, kind: 'building', test: true });
    };
    // The papuc thrown at a thug behind a wall bounces back; the same throw in the open connects.
    T.stand();
    wall(g.player.pos.z - 4);
    const behind = g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - 9 }, { exact: true, persist: true });
    out.clearAcross = g.combat.clear(g.player.pos.x, g.player.pos.z, behind.pos.x, behind.pos.z);
    g.look(0, -0.05);
    T.press({ throwPressed: true });
    T.wait(2);
    out.papuc = { hp: behind.hp, state: behind.state, left: g.combat.state().papucs.length };
    // A click with only a walled-off thug 3 m away swings.
    T.stand();
    const wallZ = g.player.pos.z - 1.5;
    wall(wallZ);
    const near = T.thug(3);
    T.press({ attackPressed: true, swingPressed: true, swing: true });
    T.wait(0.3);
    out.click = { mode: g.player.mode, phase: g.combat.state().phase, hp: near.hp };
    // Its strike never comes through: 4 s on the other side of the wall, no announcement, no damage.
    T.stand();
    wall(g.player.pos.z - 1.8);
    const thug = T.thug(3.5);
    let announced = 0;
    for (let t = 0; t < 4; t += 1 / 30) {
      g.simulate(1 / 30, 1 / 30);
      if (['telegraph', 'strike'].includes(g.combat.thugs()[0]?.state)) announced++;
    }
    out.thug = { announced, hp: g.health.hp, hurt: T.count('bunica:hurt'), state: g.combat.thugs()[0]?.state };
    // Take the test walls out again.
    for (const [k, a] of g.city.grid) g.city.grid.set(k, a.filter((p) => !p.test));
    g.city.prisms = g.city.prisms.filter((p) => !p.test);
    return out;
  });
  check('a wall stops the papuc, the click and the thug (nothing lands through it)', !r.clearAcross && r.papuc.hp === 60 && r.papuc.state !== 'stunned' && r.papuc.left === 0 && r.click.mode === 'air' && r.click.hp === 60 && r.thug.announced === 0 && r.thug.hp === 100 && r.thug.hurt === 0, r);

  // 11. Thugs in a group: at most two strike at once, none stacks on another, a lone hurt one runs.
  r = await ev(() => {
    const T = window.__t, g = window.__game, out = {};
    T.stand();
    for (const [dx, dz] of [[-9, -9], [9, -9], [-10, -3], [10, -3], [0, -11]]) g.combat.spawnThug(g.player.pos.x + dx, g.player.pos.z + dz, { exact: true });
    const P = g.player.pos;
    let maxAttackers = 0, minGap = 99, engaged = 0;
    for (let t = 0; t < 9; t += 1 / 30) {
      g.simulate(1 / 30, 1 / 30);
      g.health.hp = g.health.max; // keep her up: this is about them
      const bs = g.combat.thugs();
      const att = bs.filter((b) => ['telegraph', 'strike', 'recover'].includes(b.state)).length;
      maxAttackers = Math.max(maxAttackers, att);
      const live = bs.map((b) => b.a);
      for (let i = 0; i < live.length; i++)
        for (let j = i + 1; j < live.length; j++) minGap = Math.min(minGap, Math.hypot(live[i].pos.x - live[j].pos.x, live[i].pos.z - live[j].pos.z));
      engaged = Math.max(engaged, live.filter((a) => Math.hypot(a.pos.x - P.x, a.pos.z - P.z) < 3).length);
    }
    out.group = { maxAttackers, minGap: Math.round(minGap * 100) / 100, engaged };
    // Alone and hurt: it runs away. With a mate beside it, it stays.
    T.stand();
    const lone = g.combat.spawnThug(g.player.pos.x, g.player.pos.z - 5, { exact: true });
    lone.hit(38, 'test');
    lone.stunT = 0;
    lone.state = 'idle';
    const d0 = Math.hypot(lone.pos.x - g.player.pos.x, lone.pos.z - g.player.pos.z);
    g.simulate(4, 1 / 30);
    const d1 = Math.hypot(lone.pos.x - g.player.pos.x, lone.pos.z - g.player.pos.z);
    out.flee = { state: g.combat.thugs()[0].state, d0: Math.round(d0), d1: Math.round(d1) };
    T.stand();
    const hurt = g.combat.spawnThug(g.player.pos.x, g.player.pos.z - 5, { exact: true });
    g.combat.spawnThug(g.player.pos.x + 2, g.player.pos.z - 6, { exact: true });
    hurt.hit(38, 'test');
    hurt.stunT = 0;
    hurt.state = 'idle';
    g.simulate(1.5, 1 / 30);
    out.stays = g.combat.thugs().find((b) => b.a === hurt)?.state;
    return out;
  });
  check('two strike at most at once and they keep their distance from each other', r.group.maxAttackers <= 2 && r.group.maxAttackers >= 1 && r.group.minGap > 0.7, r.group);
  check('a lone hurt thug flees, one with company keeps fighting', r.flee.state === 'flee' && r.flee.d1 > r.flee.d0 + 8 && r.stays !== 'flee', { flee: r.flee, stays: r.stays });

  // 12. Hitting a passer-by raises the heat; hitting only thugs does not.
  r = await ev(() => {
    const T = window.__t, g = window.__game, out = {};
    const hits = (n) => T.log.filter((e) => e[0] === n);
    T.stand();
    const thug = T.thug(2.4);
    const civ = g.actors.spawn('civilian', { x: g.player.pos.x + 0.3, z: g.player.pos.z - 1.4 }, { exact: true, persist: true });
    const behind = g.actors.spawn('civilian', { x: g.player.pos.x, z: g.player.pos.z + 1.2 }, { exact: true, persist: true });
    T.press({ attackPressed: true });
    T.wait(0.5);
    const heat = hits('heat');
    out.blow = { heat: heat.length, amount: heat[0]?.[1].amount, why: heat[0]?.[1].why, civHp: civ.hp, behindHp: behind.hp, thugHp: thug.hp };
    // The thrown papuc through a passer-by counts too.
    T.stand();
    const c2 = g.actors.spawn('civilian', { x: g.player.pos.x, z: g.player.pos.z - 8 }, { exact: true, persist: true });
    T.press({ throwPressed: true });
    T.wait(1.2);
    out.papuc = { heat: hits('heat').length, hp: c2.hp, state: c2.state };
    // Only thugs: no heat.
    T.stand();
    T.thug(2.4);
    T.press({ attackPressed: true });
    T.wait(0.6);
    out.thugsOnly = hits('heat').length;
    return out;
  });
  check('a blow that catches a passer-by raises heat, one behind her is spared', r.blow.heat === 1 && r.blow.amount === 0.5 && r.blow.civHp < 30 && r.blow.behindHp === 30 && r.blow.thugHp < 60, r.blow);
  check('the thrown papuc stuns a passer-by and raises heat; hitting only thugs does not', r.papuc.heat === 1 && r.papuc.hp < 30 && r.thugsOnly === 0, { papuc: r.papuc, thugsOnly: r.thugsOnly });

  // 13. Buffs and perks from the missions: turbo doubles the papuc, fire throws them back, throwCount allows two.
  r = await ev(() => {
    const T = window.__t, g = window.__game, out = {};
    const throwAt = (buff, d = 10) => {
      T.stand();
      g.buffs = { has: (n) => n === buff };
      const a = g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - d }, { exact: true, persist: true });
      const z0 = a.pos.z;
      T.press({ throwPressed: true });
      T.wait(1.6);
      g.buffs = undefined;
      return { hp: a.hp, pushed: Math.round((z0 - a.pos.z) * 10) / 10 };
    };
    out.plain = throwAt(null);
    out.turbo = throwAt('turbo');
    out.fire = throwAt('fire');
    T.stand();
    g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - 20 }, { exact: true, persist: true });
    T.press({ throwPressed: true });
    T.wait(0.3);
    T.press({ throwPressed: true });
    out.single = g.combat.state().papucs.length;
    T.wait(3);
    g.perks = { throwCount: 2 };
    T.press({ throwPressed: true });
    T.wait(0.3);
    T.press({ throwPressed: true });
    out.double = g.combat.state().papucs.length;
    g.perks = undefined;
    return out;
  });
  check('turbo doubles the papuc damage, fire knocks the thug back', r.plain.hp === 52 && r.turbo.hp === 44 && r.fire.pushed > r.plain.pushed + 2, { plain: r.plain, turbo: r.turbo, fire: r.fire });
  check('one papuc in the air at a time, two with the throwCount perk', r.single === 1 && r.double === 2, { single: r.single, double: r.double });

  // 14. The hit stop freezes the game for 60 ms of real time at each hit.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    T.thug(2);
    const t0 = g.time;
    T.press({ attackPressed: true });
    T.wait(0.6);
    return { lost: Math.round((0.6 + 1 / 60 - (g.time - t0)) * 1000) / 1000 };
  });
  check('the first hit of a blow stops the game for about 60 ms', r.lost > 0.04 && r.lost < 0.09, r);

  // 15. The clothesline: laundry hangs on the cord while she swings, nothing when she does not.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand(-300, 12);
    const before = { shown: g.clothesline.shown, cord: g.clothesline.cord.visible };
    g.look(Math.PI / 2, -0.2);
    g.setInput({ moveY: 1 });
    g.simulate(0.3);
    g.setInput({ moveY: 1, jumpPressed: true });
    g.simulate(1 / 60);
    g.setInput({ moveY: 1 });
    g.simulate(0.3);
    g.setInput({ moveY: 1, swing: true });
    const modes = new Set();
    let shown = 0, cord = false;
    for (let i = 0; i < 90; i++) {
      g.simulate(1 / 30, 1 / 30);
      modes.add(g.player.mode);
      shown = Math.max(shown, g.clothesline.shown);
      cord = cord || g.clothesline.cord.visible;
    }
    g.setInput(null);
    g.simulate(1.5);
    return { before, swung: modes.has('swing'), shown, cord, after: { shown: g.clothesline.shown, cord: g.clothesline.cord.visible } };
  });
  check('the web is a clothesline with laundry while swinging, gone after', r.before.shown === 0 && !r.before.cord && r.swung && r.shown >= 2 && r.cord && r.after.shown === 0 && !r.after.cord, r);

  // 16. V cycles the colour of the basma.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    const seen = [g.hero.suit];
    for (let i = 0; i < 7; i++) {
      T.press({ suitPressed: true });
      seen.push(g.hero.suit);
    }
    return { seen, label: g.hero.suitLabel, state: g.state().suit };
  });
  check('V cycles through six basma colours and comes back to the first', new Set(r.seen).size === 6 && r.seen[6] === r.seen[0] && r.seen[7] !== r.seen[0], r);

  // 17. What the system costs per tick with a fight going on, measured on the system itself.
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    T.stand();
    for (const [dx, dz] of [[-8, -8], [8, -8], [-9, -3], [9, -3], [0, -10], [5, 8]]) g.combat.spawnThug(g.player.pos.x + dx, g.player.pos.z + dz, { exact: true, bat: dx > 0 });
    const sys = g.systems.get('combat');
    const orig = sys.update;
    let ms = 0, n = 0;
    sys.update = (dt) => {
      const t = performance.now();
      orig(dt);
      ms += performance.now() - t;
      n++;
    };
    for (let i = 0; i < 300; i++) {
      g.health.hp = g.health.max;
      g.simulate(1 / 60, 1 / 60);
    }
    sys.update = orig;
    return { msPerTick: Math.round((ms / n) * 1000) / 1000, ticks: n };
  });
  console.log(`COST  combat system with 6 thugs: ${r.msPerTick} ms per tick over ${r.ticks} ticks`);
  check('the combat system costs under 1 ms per tick with six thugs fighting', r.msPerTick < 1, r);

  // 18. The voice lines are asked for at the right moments (silent no-ops until the lines exist).
  r = await ev(() => {
    const T = window.__t, g = window.__game;
    const said = [];
    const orig = g.voice.say;
    g.voice.say = (k) => said.push(k);
    const kinds = () => [...new Set(said.splice(0))];
    const out = {};
    T.stand();
    T.thug(2.2);
    T.press({ attackPressed: true });
    T.wait(0.5);
    out.blow = kinds();
    T.stand();
    g.actors.spawn('thug', { x: g.player.pos.x, z: g.player.pos.z - 6 }, { exact: true, persist: true });
    T.press({ throwPressed: true });
    T.wait(0.9);
    T.press({ tiePressed: true });
    T.wait(1.5);
    out.throwAndTie = kinds();
    T.stand();
    T.thug(4.5);
    T.until(() => g.combat.state().telegraphs > 0, 8);
    T.press({ jumpPressed: true });
    T.wait(1);
    out.dodge = kinds();
    T.stand();
    g.health.damage(10, 'x');
    out.hurt = kinds();
    g.health.damage(65, 'x');
    out.low = kinds();
    g.health.damage(1000, 'x');
    out.down = kinds();
    T.wait(4);
    g.voice.say = orig;
    return out;
  });
  check(
    'punch, thrown, tie, dodge, hurt, lowHealth and knockout are said at their moments',
    r.blow.includes('punch') && r.throwAndTie.includes('thrown') && r.throwAndTie.includes('tie') && r.dodge.includes('dodge') && r.hurt.includes('hurt') && r.low.includes('lowHealth') && r.down.includes('knockout'),
    r,
  );

  // 19. The real keys in the real loop (no stepping by the test): J four times downs a thug, Q throws the papuc.
  {
    const live = await open(browser, 'shot=street&lowq', errors, 800, 450);
    await live.evaluate(() => {
      const g = window.__game;
      g.player.reset();
      g.player.pos.set(-300, 0, 12);
      g.player.groundBox = null;
      g.actors.clear();
      window.__th = g.combat.spawnThug(-300, 9.8, { exact: true });
      window.__far = g.actors.spawn('thug', { x: -300, z: -6 }, { exact: true, persist: true });
    });
    await live.waitForTimeout(400);
    for (let i = 0; i < 4; i++) {
      await live.keyboard.press('KeyJ');
      await live.waitForTimeout(400);
    }
    await live.keyboard.press('KeyQ');
    await live.waitForTimeout(1500);
    r = await live.evaluate(() => ({ near: window.__th.state, farHp: window.__far.hp, blows: window.__game.combat.state().blows, papucs: window.__game.combat.state().papucs.length }));
    check('the J key and Q in the real loop: the combo downs the near thug, the papuc hits the far one', r.near === 'down' && r.farHp < 60 && r.blows >= 5 && r.papucs === 0, r);
    await live.close();
  }
} catch (e) {
  console.log('CRASH', e);
  results.push({ name: 'crash', ok: false });
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
