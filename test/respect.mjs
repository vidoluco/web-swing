// Respect, levels, perks and buffs: thresholds and perk tables straight in Node, then the running game
// (level-up events, losses that never go below the level reached, the value saved, the HUD panel, the
// 30 s buffs and their effect on the player). Usage: PORT=5225 node test/respect.mjs   (exit code 1 on any failure)
import { startServer, launch, open } from './harness.mjs';
import { LEVELS, MAX_LEVEL, levelFor, perksFor } from '../src/respect.js';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

// ---------- the tables, in Node ----------
{
  const gaps = LEVELS.slice(1).map((v, i) => v - LEVELS[i]);
  check('ten levels, thresholds start at 0 and the gaps keep growing', LEVELS.length === 10 && MAX_LEVEL === 10 && LEVELS[0] === 0 && gaps.every((g, i) => g > 0 && (i === 0 || g > gaps[i - 1])), { LEVELS, gaps });
  const at = [0, 99, 100, 249, 250, 3199, 3200, 1e9].map((v) => levelFor(v));
  check('levelFor puts every threshold on the right side', JSON.stringify(at) === JSON.stringify([1, 1, 2, 2, 3, 9, 10, 10]), at);
  const ps = Array.from({ length: 10 }, (_, i) => perksFor(i + 1));
  const mono = (k) => ps.every((p, i) => i === 0 || p[k] >= ps[i - 1][k]);
  check('perks: nothing at level 1, never lost on the way up, a longer rope, more health, a doubled throw, more scarf colours',
    ps[0].ropeLen === 1 && ps[0].maxHp === 1 && ps[0].throwCount === 1 && ps[0].scarves === 1 && ['ropeLen', 'maxHp', 'throwCount', 'scarves'].every(mono) && ps[9].ropeLen > 1.2 && ps[9].maxHp >= 1.5 && ps[4].throwCount === 2 && ps[8].throwCount === 3 && ps[9].scarves > ps[0].scarves, ps[9]);
  check('PET scarf colours add to the ones the level unlocks', perksFor(3, 2).scarves === perksFor(3).scarves + 2, {});
}

const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, 'shot=street&lowq&seed=7', errors);
  await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.05);
    window.__log = [];
    g.events.on('level:up', (e) => window.__log.push(['up', e.level]));
    g.events.on('respect', (e) => window.__log.push(['respect', e.amount, e.why]));
  });

  // ---------- starting state, and small gains ----------
  let r = await page.evaluate(() => {
    const g = window.__game;
    const start = { value: g.respect.value, level: g.respect.level, perks: { ...g.perks }, saved: g.save.get('respect') };
    g.respect.add(50, 'test');
    return { start, value: g.respect.value, level: g.respect.level, into: g.respect.into, span: g.respect.span, log: window.__log.slice() };
  });
  check('a new game starts at 0, level 1, no perks', r.start.value === 0 && r.start.level === 1 && r.start.perks.ropeLen === 1 && r.start.perks.maxHp === 1 && r.start.perks.throwCount === 1, r.start);
  check('a small gain adds up, stays on level 1, sends no level-up, and announces the respect', r.value === 50 && r.level === 1 && r.into === 50 && r.span === 100 && JSON.stringify(r.log) === '[["respect",50,"test"]]', r);

  // ---------- crossing a threshold ----------
  r = await page.evaluate(() => {
    const g = window.__game;
    window.__log.length = 0;
    g.respect.add(50, 'test');
    return { value: g.respect.value, level: g.respect.level, log: window.__log.slice(), maxHp: g.perks.maxHp, saved: g.save.get('respect'), toast: document.getElementById('toast').textContent };
  });
  check('reaching 100 makes level 2, exactly one level-up, and the perks follow', r.level === 2 && r.log.filter((e) => e[0] === 'up').length === 1 && r.log.find((e) => e[0] === 'up')[1] === 2 && Math.abs(r.maxHp - 1.1) < 1e-9 && r.saved.value === 100 && /Livello 2/.test(r.toast), r);

  // ---------- losses ----------
  r = await page.evaluate(() => {
    const g = window.__game;
    g.respect.add(30, 'test'); // 130
    window.__log.length = 0;
    const a = g.respect.add(-50, 'busted'); // 130 -> 100, the floor of level 2
    const v1 = g.respect.value, l1 = g.respect.level;
    const b = g.respect.add(-1000, 'busted');
    const v2 = g.respect.value, l2 = g.respect.level;
    return { a, v1, l1, b, v2, l2, maxHp: g.perks.maxHp, ups: window.__log.filter((e) => e[0] === 'up').length };
  });
  check('a loss costs points but never goes below the level reached, never negative, never loses a perk or fires a level-up', r.a === -30 && r.v1 === 100 && r.l1 === 2 && r.b === 0 && r.v2 === 100 && r.l2 === 2 && r.v2 >= 0 && Math.abs(r.maxHp - 1.1) < 1e-9 && r.ups === 0, r);

  r = await page.evaluate(() => {
    const g = window.__game;
    const before = g.respect.value;
    const out = [g.respect.add(NaN), g.respect.add(undefined), g.respect.add('12'), g.respect.add(Infinity), g.respect.add(0)];
    return { out, same: g.respect.value === before };
  });
  check('nonsense amounts are ignored', r.same && r.out.every((v) => v === 0), r);

  // ---------- a crime stopped pays ----------
  r = await page.evaluate(() => {
    const g = window.__game;
    const before = g.respect.value;
    g.events.emit('crime:solved', { id: 1, how: 'tied' });
    return { gain: g.respect.value - before };
  });
  check('a crime:solved event pays respect, and only once per event', r.gain === 20, r);

  // ---------- several levels at once, and the top ----------
  r = await page.evaluate(() => {
    const g = window.__game;
    window.__log.length = 0;
    g.respect.add(9000, 'test');
    return { value: g.respect.value, level: g.respect.level, ups: window.__log.filter((e) => e[0] === 'up').map((e) => e[1]), perks: { ...g.perks }, into: g.respect.into, span: g.respect.span };
  });
  check('a big gain climbs level by level, with an event for each, and stops at 10', r.level === 10 && JSON.stringify(r.ups) === '[3,4,5,6,7,8,9,10]' && r.span === 0 && r.perks.throwCount === 3 && r.perks.ropeLen > 1.2, r);

  // ---------- the HUD panel ----------
  r = await page.evaluate(() => {
    window.__game.advance(0.3);
    return { text: document.querySelector('.hud-item[data-id="level"]')?.textContent, fillWidth: document.querySelector('.hud-item[data-id="level"] i')?.style.width };
  });
  check('the level panel shows the level and MAX at the top', /10/.test(r.text) && /MAX/.test(r.text) && r.fillWidth === '100%', r);

  // ---------- saved, and back after a reload ----------
  const saved = await page.evaluate(() => window.__game.save.get('respect'));
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  r = await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.2);
    return { value: g.respect.value, level: g.respect.level, perks: { ...g.perks }, text: document.querySelector('.hud-item[data-id="level"]')?.textContent };
  });
  check('the value is saved and comes back after a reload with the same level and perks', r.value === saved.value && r.level === 10 && r.perks.throwCount === 3 && /10/.test(r.text), { saved, ...r });

  // The half-full bar, from a save at 325 (level 3 starts at 250 and level 4 at 450: 75 of 200).
  await page.evaluate(() => window.__game.save.set('respect', { value: 325 }));
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
  r = await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.3);
    return { level: g.respect.level, width: document.querySelector('.hud-item[data-id="level"] i')?.style.width, text: document.querySelector('.hud-item[data-id="level"]')?.textContent };
  });
  check('the progress bar is as full as the points into the level (75 of 200 is 38%)', r.level === 3 && r.width === '38%' && /75\/200/.test(r.text), r);

  // ---------- buffs ----------
  r = await page.evaluate(() => {
    const g = window.__game;
    const t0 = g.time;
    const none = ['turbo', 'shield', 'fire', 'energy'].map((n) => g.buffs.has(n));
    g.buffs.add('turbo');
    g.advance(10);
    const left10 = g.buffs.left('turbo');
    g.buffs.add('turbo'); // taking it again refreshes to 30 s, it does not add up to 50
    const refreshed = g.buffs.left('turbo');
    g.advance(29);
    const at29 = g.buffs.has('turbo');
    g.advance(2);
    const at31 = g.buffs.has('turbo');
    return { none, left10, refreshed, at29, at31, active: g.buffs.active(), elapsed: g.time - t0 };
  });
  check('a buff lasts 30 s, taking it again refreshes it without stacking, and it is gone after that', r.none.every((v) => !v) && Math.abs(r.left10 - 20) < 0.2 && Math.abs(r.refreshed - 30) < 0.01 && r.at29 && !r.at31 && r.active.length === 0, r);

  r = await page.evaluate(() => {
    const g = window.__game, P = g.player;
    const base = { ...P.mods };
    g.buffs.add('turbo');
    g.buffs.add('energy');
    g.advance(0.1);
    const on = { ...P.mods };
    // the jump: the launch speed follows the multiplier
    P.reset();
    P.pos.set(0, 30, 0);
    P.mode = 'ground';
    P.jump();
    const jumpOn = P.vel.y;
    g.advance(31);
    const off = { ...P.mods };
    P.reset();
    P.jump();
    const jumpOff = P.vel.y;
    return { base, on, off, jumpOn, jumpOff, rope: g.perks.ropeLen };
  });
  check('turbo makes swing x1.25 and jump x1.2, energy makes run and climb x1.4, and both wear off with the rope perk kept',
    r.base.run === 1 && r.on.run === 1.4 && r.on.climb === 1.4 && r.on.jump === 1.2 && r.on.swing === 1.25 && Math.abs(r.jumpOn / r.jumpOff - 1.2) < 1e-6 && r.off.run === 1 && r.off.jump === 1 && r.off.swing === 1 && r.off.rope === r.rope && r.rope > 1, r);

  check('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
