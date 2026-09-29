// The police (src/police.js): stars from heat, patrol cars from star 1, cops on foot and roadblocks
// from star 3, stars lost out of sight, and being busted. Usage: PORT=5224 node test/police.mjs
// (exit code 1 on any failure)
import { mkdirSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';

mkdirSync('shots', { recursive: true });

const srv = await startServer();
const browser = await launch();
const errors = [];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

// In the page: helpers shared by the checks below, on window.__t.
const SETUP = async () => {
  const g = window.__game;
  await g.city.streamAround(0, 0, 1100);
  g.systems.get('crimes').auto = false;
  const po = g.systems.get('police');
  const T = (window.__t = { g, po });
  // Ordinary traffic has police cars in it, and they see; the checks here place their own.
  g.traffic.pickType = () => 'sedan';
  for (const c of g.traffic.cars.filter((x) => x.type === 'police' && x.mode === 'traffic')) g.traffic.remove(c);
  T.sim = (s) => g.simulate(s, 1 / 30);
  T.stand = (x, z) => {
    g.player.reset();
    g.player.pos.set(x, 0, z);
    g.player.groundBox = null;
    g.player.vel.set(0, 0, 0);
  };
  // A tall roof near (x, z), and Bunica on it.
  T.roof = (x = -300, z = 12) => {
    const r = g.city.roofNear(x, z, 300);
    g.player.reset();
    g.player.pos.copy(r.pos);
    g.player.groundBox = r.box;
    return r.pos.y;
  };
  T.log = [];
  for (const n of ['wanted', 'busted', 'respect', 'heat']) g.events.on(n, (e) => T.log.push({ n, t: g.time, ...e }));
  T.of = (n) => T.log.filter((e) => e.n === n);
  const say = g.voice.say.bind(g.voice);
  T.said = [];
  g.voice.say = (k, d) => (T.said.push(k), say(k, d));
  // The units wanted at each star, saved so that a check can switch them off or set them.
  T.caps = { cars: [...po.caps.cars], cops: [...po.caps.cops], blocks: [...po.caps.blocks] };
  T.setCaps = (c) => {
    for (const k of ['cars', 'cops', 'blocks']) po.caps[k].splice(0, 6, ...(c?.[k] ?? T.caps[k]));
  };
  T.made = [];
  T.reset = () => {
    T.setCaps();
    po.dispose(true);
    for (const c of T.made.splice(0)) if (g.traffic.cars.includes(c)) g.traffic.remove(c);
    if (g.driving()) g.exitCar(false);
    g.actors.clear();
    g.drunk.level = 0;
    delete g.health;
    delete g.respect;
    T.log.length = 0;
    T.said.length = 0;
  };
  // A car of the given type parked in `mode` at (x, z). A police car in mode 'block' is an officer that sees.
  T.car = (type, mode, x, z, yaw = 0) => {
    const c = g.traffic.make(type);
    Object.assign(c, { x, z, yaw, speed: 0, mode });
    g.traffic.cars.push(c);
    g.traffic.poseObj(c);
    T.made.push(c);
    return c;
  };
  // A free spot `d` m from Bunica with (want) or without a line of sight to her.
  T.los = (want, dists = [40, 30, 50, 60, 25]) => {
    const p = g.player.pos;
    for (const d of dists) {
      for (let k = 0; k < 36; k++) {
        const a = (k / 36) * Math.PI * 2, x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (g.actors.blocked(x, z, 1.5) || g.city.isWater(x, z)) continue;
        if (po.sees(x, 1.5, z, p.x, p.y + 1.2, p.z) === want) return { x, z, d };
      }
    }
    return null;
  };
  // Bunica put where a spot `dists` m off cannot see her (round a building); returns that spot.
  T.covered = (dists) => {
    for (let ox = -150; ox <= 150; ox += 10) {
      for (let oz = -150; oz <= 150; oz += 10) {
        T.stand(-300 + ox, 12 + oz);
        if (g.actors.blocked(g.player.pos.x, g.player.pos.z, 0.5)) continue;
        const s = T.los(false, dists);
        if (s) return s;
      }
    }
    return null;
  };
  T.dist = (o) => Math.hypot((o.x ?? o.pos.x) - g.player.pos.x, (o.z ?? o.pos.z) - g.player.pos.z);
  // How far (m) a point is outside the asphalt of the nearest loaded road (0 when on it).
  T.offRoad = (x, z, majorOnly) => {
    let best = 99;
    for (const rec of g.city.recs.values()) for (const rd of rec.roads || []) {
      if (majorOnly && !rd.major) continue;
      for (let i = 0; i + 3 < rd.pts.length; i += 2) {
        const ex = rd.pts[i + 2] - rd.pts[i], ez = rd.pts[i + 3] - rd.pts[i + 1], t = Math.max(0, Math.min(1, ((x - rd.pts[i]) * ex + (z - rd.pts[i + 1]) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(x - rd.pts[i] - ex * t, z - rd.pts[i + 1] - ez * t) - rd.w / 2);
      }
    }
    return Math.max(0, best);
  };
  T.heat = (n) => g.events.emit('heat', { amount: n, why: 'test' });
};

try {
  let page = await open(browser, 'shot=street&lowq&seed=5&cars=12', errors);
  await page.evaluate(SETUP);
  // The machine can be short of memory (other jobs share it) and drop the page: open it again once and redo the check.
  const run = async (fn, arg) => {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/crashed|closed/i.test(e.message)) throw e;
      console.log('page dropped, opening it again:', e.message.split('\n')[0]);
      await page.close().catch(() => {});
      page = await open(browser, 'shot=street&lowq&seed=5&cars=12', errors);
      await page.evaluate(SETUP);
      return page.evaluate(fn, arg);
    }
  };

  // 1. Heat becomes stars; half stars add up; never more than 5 or less than 0.
  let r = await run(() => {
    const { g, po, stand, reset, heat, of } = window.__t;
    reset();
    stand(-300, 12);
    const seq = [];
    const step = (n) => {
      heat(n);
      seq.push([g.wanted.stars, +g.wanted.level.toFixed(2)]);
    };
    step(1);
    step(0.5);
    step(0.5);
    step(10);
    step(-100);
    // Junk amounts change nothing.
    for (const v of [NaN, undefined, 0, 'x']) g.wanted.add(v);
    const end = [g.wanted.stars, g.wanted.level];
    g.wanted.add(100);
    const top = [g.wanted.stars, g.wanted.level];
    g.wanted.clear();
    g.wanted.clear();
    return { seq, end, top, cleared: [g.wanted.stars, g.wanted.level], events: of('wanted').map((e) => e.stars) };
  });
  check(
    'heat becomes stars (half stars add up); 5 is the top and 0 the bottom',
    JSON.stringify(r.seq) === JSON.stringify([[1, 1], [1, 1.5], [2, 2], [5, 5], [0, 0]]) && r.end[0] === 0 && r.end[1] === 0 && r.top[0] === 5 && r.top[1] === 5 && r.cleared[0] === 0 && r.cleared[1] === 0 && r.events.join() === '1,2,5,0,5,0',
    r,
  );

  // 1b. The HUD: hidden at zero, stars at 13 px or more, lit up to the level.
  r = await run(() => {
    const { g, po, stand, reset, heat, sim } = window.__t;
    reset();
    stand(-300, 12);
    window.__t.setCaps({ cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 0, 0, 0], blocks: [0, 0, 0, 0, 0, 0] });
    const el = document.querySelector('.hud-item[data-id=wanted]');
    sim(0.3);
    const out = { present: !!el, hiddenAtZero: el.hidden || getComputedStyle(el).display === 'none' };
    heat(3);
    heat(0.5);
    sim(0.3);
    const stars = [...el.firstChild.children];
    out.hiddenAt3 = el.hidden;
    out.lit = stars.map((s) => (s.style.color === 'rgb(255, 212, 0)' ? 1 : s.style.color === 'transparent' ? 0.5 : 0)).join();
    out.starPx = parseFloat(getComputedStyle(stars[0]).fontSize);
    out.notePx = parseFloat(getComputedStyle(el.lastChild).fontSize);
    out.note = el.lastChild.textContent;
    g.wanted.clear();
    sim(0.3);
    out.hiddenAfter = el.hidden;
    return out;
  });
  check('the HUD shows the stars only while wanted, lit up to the level with a half star, text at 13 px or more', r.present && r.hiddenAtZero && !r.hiddenAt3 && r.lit === '1,1,1,0.5,0' && r.starPx >= 22 && r.notePx >= 13 && /Nascosta/.test(r.note) && r.hiddenAfter, r);

  // 2. Nothing is wanted for doing nothing, nor for solving crimes.
  r = await run(() => {
    const { g, po, stand, reset, sim, of } = window.__t;
    reset();
    stand(-300, 12);
    sim(30);
    const idle = { stars: g.wanted.stars, units: po.pursuers.length + po.cops.length + po.blocks.length, events: of('wanted').length };
    // A thug hit, a crime solved: still nothing.
    const cr = g.systems.get('crimes');
    const c = cr.spawn('scippo', { range: [60, 90] });
    stand(c.x - 8, c.z - 8);
    sim(0.5);
    c.thief.hit(999, 'player');
    sim(1);
    const solved = !cr.list.includes(c);
    g.events.emit('hit', { target: c.thief, dmg: 10, by: 'player' });
    sim(5);
    return { idle, solved, stars: g.wanted.stars, level: g.wanted.level, units: po.pursuers.length + po.cops.length + po.blocks.length };
  });
  check('hitting no one raises no stars: 30 s of nothing, and a thug downed to solve a crime, leave them at 0', r.idle.stars === 0 && r.idle.units === 0 && r.idle.events === 0 && r.solved && r.stars === 0 && r.level === 0 && r.units === 0, r);

  // 3. Star 1: a patrol car, on the roads, driving to her. No roadblock, and cops on foot only from the car once it has stopped.
  r = await run(() => {
    const { g, po, stand, reset, sim, heat, dist, offRoad, of } = window.__t;
    reset();
    stand(-300, 12);
    heat(1);
    const out = { firstAt: null, minD: 999, maxCars: 0, copBeforeStop: false, maxBlocks: 0, offRoad: 0, first: null, stopAt: null };
    let stopped = false;
    for (let i = 0; i < 160 && !of('busted').length; i++) {
      sim(0.25);
      if (po.pursuers.length && out.firstAt === null) {
        out.firstAt = +(g.time - of('heat')[0].t).toFixed(1);
        const car = po.pursuers[0].car;
        out.first = { type: car.type, mode: car.mode, d: Math.round(dist(car)), listed: g.traffic.cars.includes(car) };
      }
      for (const u of po.pursuers) {
        out.minD = Math.min(out.minD, dist(u.car));
        out.offRoad = Math.max(out.offRoad, offRoad(u.car.x, u.car.z));
        if (u.state === 'stop' && !stopped) (stopped = true), (out.stopAt = +(g.time - of('heat')[0].t).toFixed(1));
      }
      if (po.cops.length && !stopped) out.copBeforeStop = true;
      out.maxCars = Math.max(out.maxCars, po.pursuers.length);
      out.maxBlocks = Math.max(out.maxBlocks, po.blocks.length);
    }
    out.busted = of('busted').length;
    return out;
  });
  check('star 1: a patrol car appears within a few seconds on a road 120 to 260 m away, stays on the roads and drives up to her and stops', r.firstAt !== null && r.firstAt < 6 && r.first.type === 'police' && r.first.mode === 'pursuit' && r.first.listed && r.first.d >= 120 && r.first.d <= 260 && r.stopAt !== null && r.stopAt < 40 && r.minD < 30 && r.maxCars === 1 && r.offRoad < 1.2, r);
  check('star 1: no roadblock, and no cop on foot until the car has stopped beside her', !r.copBeforeStop && r.maxBlocks === 0, r);

  // 4. Star 3: cops on foot with a cap, and a roadblock across a major road 150 to 280 m away.
  r = await run(() => {
    const { g, po, stand, reset, sim, heat, dist, offRoad, of, said } = window.__t;
    reset();
    stand(-300, 12);
    heat(3);
    const out = { cops: 0, blocks: 0, cars: 0, block: null, kinds: new Set(), states: new Set() };
    for (let i = 0; i < 80 && !of('busted').length; i++) {
      sim(0.25);
      out.cops = Math.max(out.cops, po.cops.length);
      out.cars = Math.max(out.cars, po.pursuers.length);
      for (const c of po.cops) (out.kinds.add(c.a.kind), out.states.add(c.a.state));
      if (po.blocks.length && !out.block) {
        const b = po.blocks[0];
        out.block = { cars: b.cars.length, modes: b.cars.map((c) => c.mode).join(), d: Math.round(Math.hypot(b.x - g.player.pos.x, b.z - g.player.pos.z)), off: +Math.max(...b.cars.map((c) => offRoad(c.x, c.z, true))).toFixed(1), types: b.cars.map((c) => c.type).join() };
      }
      out.blocks = Math.max(out.blocks, po.blocks.length);
    }
    out.kinds = [...out.kinds];
    out.states = [...out.states];
    out.said = said.filter((k) => /wanted/.test(k)).join();
    return out;
  });
  check('star 3: at most 2 patrol cars, cops on foot come (3 at most, real cop actors that run), one roadblock of two cars on a major road', r.cops >= 1 && r.cops <= 3 && r.kinds.join() === 'cop' && r.states.includes('run') && r.cars <= 2 && r.blocks === 1 && r.block?.cars === 2 && r.block.modes === 'block,block' && r.block.types === 'police,police' && r.block.d >= 150 && r.block.d <= 280 && r.block.off < 1, r);
  check('the voice says wanted3 when the third star arrives', r.said === 'wanted3', r);

  // 5. Star 5 on a high roof, where nobody can reach her: more of everything, within the caps, and no bust.
  r = await run(() => {
    const { g, po, roof, reset, sim, heat, of } = window.__t;
    reset();
    const y = roof();
    sim(0.5);
    heat(5);
    const out = { roofY: Math.round(y), cars: 0, cops: 0, blocks: 0, allCars: 0, stars: [] };
    for (let i = 0; i < 40; i++) {
      sim(1.5);
      out.cars = Math.max(out.cars, po.pursuers.length);
      out.cops = Math.max(out.cops, po.cops.length);
      out.blocks = Math.max(out.blocks, po.blocks.length);
      out.allCars = Math.max(out.allCars, g.traffic.cars.filter((c) => c.type === 'police' && (c.mode === 'pursuit' || c.mode === 'block')).length);
      if (i % 10 === 9) out.stars.push(g.wanted.stars);
    }
    out.busted = of('busted').length;
    out.onRoof = g.player.pos.y > y - 1;
    return out;
  });
  check('star 5: up to 5 patrol cars, 5 to 7 cops and 2 roadblocks, never more; nobody reaches her on a high roof', r.roofY > 25 && r.cars === 5 && r.cops >= 5 && r.cops <= 7 && r.blocks === 2 && r.allCars <= 9 && r.busted === 0 && r.onRoof, r);

  // 6. Out of sight the stars go down: 25 s at two stars on the street, faster on a high roof.
  r = await run(() => {
    const { g, po, stand, roof, reset, sim, heat, of, said, setCaps } = window.__t;
    const none = { cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 0, 0, 0], blocks: [0, 0, 0, 0, 0, 0] };
    const run = (place) => {
      reset();
      setCaps(none);
      place();
      sim(0.3);
      heat(2);
      const t0 = g.time;
      for (let i = 0; i < 400 && g.wanted.stars > 0; i++) sim(0.25);
      const ev = of('wanted').map((e) => [e.stars, +(e.t - t0).toFixed(1)]);
      return { ev, said: [...said], level: g.wanted.level };
    };
    return { street: run(() => stand(-300, 12)), roof: run(() => roof()) };
  });
  const ev = (o) => o.ev.map((e) => e[0]).join();
  check(
    'hiding: two stars go to one after 25 s and to zero 20 s later, out of sight on the street; the voice says wanted1 then escaped',
    ev(r.street) === '2,1,0' && Math.abs(r.street.ev[1][1] - 25) < 0.6 && Math.abs(r.street.ev[2][1] - 45) < 0.9 && r.street.said.join() === 'wanted1,escaped',
    r.street,
  );
  check('hiding on a high roof is faster (x1.5) than on the street', ev(r.roof) === '2,1,0' && r.roof.ev[1][1] < r.street.ev[1][1] - 6 && Math.abs(r.roof.ev[1][1] - 25 / 1.5) < 0.6 && r.roof.ev[2][1] < r.street.ev[2][1] - 12, r.roof);

  // 6b. An officer with a line of sight keeps the stars; the same officer behind a building does not.
  r = await run(() => {
    const { g, po, stand, reset, sim, heat, of, los, car, setCaps } = window.__t;
    reset();
    setCaps({ cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 0, 0, 0], blocks: [0, 0, 0, 0, 0, 0] });
    stand(-300, 12);
    // covered() puts Bunica where a spot cannot see her; the open spot is then looked for from there.
    const shut = window.__t.covered([40, 30, 25]);
    const here = los(true, [15, 20, 25, 30, 40]);
    const out = { shut: !!shut, here: !!here };
    const c = car('police', 'block', here.x, here.z);
    sim(0.3);
    heat(2);
    sim(70);
    out.withSight = { stars: g.wanted.stars, seen: po.seen, sightT: +po.sightT.toFixed(1) };
    c.x = shut.x;
    c.z = shut.z;
    g.traffic.poseObj(c);
    const t0 = g.time;
    for (let i = 0; i < 400 && g.wanted.stars === 2; i++) sim(0.25);
    out.behind = { stars: g.wanted.stars, after: +(g.time - t0).toFixed(1), seen: po.seen };
    return out;
  });
  check('an officer who can see her keeps the stars for over a minute; behind a building the wait starts (25 s)', r.shut && r.here && r.withSight.stars === 2 && r.withSight.seen && r.withSight.sightT < 1 && r.behind.stars === 1 && r.behind.after > 24 && r.behind.after < 27, r);

  // 7. Busted by a cop who reaches her: end to end on the street, then from far away.
  r = await run(async () => {
    const { g, po, stand, reset, sim, heat, of, said } = window.__t;
    reset();
    g.respect = { value: 100, add(n) { this.value += n; } };
    stand(-300, 12);
    heat(3);
    const from = { x: g.player.pos.x, z: g.player.pos.z };
    let n = 0;
    while (!of('busted').length && n++ < 480) sim(0.25);
    const bust = of('busted')[0];
    while (po.busting) await new Promise((ok) => setTimeout(ok, 30));
    const p = g.player.pos;
    let best = null;
    for (const s of po.stations) {
      const d = Math.hypot(s[1] - from.x, s[2] - from.z);
      if (!best || d < best.d) best = { name: s[0], x: s[1], z: s[2], d };
    }
    const out = {
      after: bust && +(bust.t - of('heat')[0].t).toFixed(1),
      station: bust?.station === best.name,
      nearStation: +Math.hypot(p.x - best.x, p.z - best.z).toFixed(1),
      inBuilding: g.actors.blocked(p.x, p.z, 0.3),
      stars: g.wanted.stars,
      wanted: of('wanted').map((e) => e.stars).join(),
      respect: g.respect.value,
      said: said.filter((k) => k === 'busted').length,
      mode: g.player.mode,
    };
    sim(30);
    out.units = po.pursuers.length + po.cops.length + po.blocks.length;
    out.stillOne = g.wanted.stars;
    out.bustedOnce = of('busted').length;
    return out;
  });
  check(
    'a cop reaching her busts her: stars gone, 25 Respect less, on foot within 45 m of the nearest station, the units stand down',
    r.after !== null && r.station && r.nearStation < 45 && !r.inBuilding && r.stars === 0 && r.wanted === '3,0' && r.respect === 75 && r.said === 1 && r.mode === 'ground' && r.units === 0 && r.stillOne === 0 && r.bustedOnce === 1,
    r,
  );

  r = await run(async () => {
    const { g, po, stand, reset } = window.__t;
    const out = [];
    for (const [x, z] of [[2000, 1500], [-1800, -1200], [900, -1500]]) {
      reset();
      g.respect = { value: 100, add(n) { this.value += n; } };
      stand(x, z);
      const st = po.nearestStation(x, z);
      const rec = g.city.recs.get(`${Math.floor(st.x / 400)}_${Math.floor(st.z / 400)}`);
      const loadedBefore = rec ? rec.state === 'loaded' : null;
      await po.bust('test');
      const p = g.player.pos;
      out.push({ from: [x, z], station: st.name, d: Math.round(st.d), loadedBefore, loadedAfter: rec ? rec.state === 'loaded' : null, near: +Math.hypot(p.x - st.x, p.z - st.z).toFixed(1), blocked: g.actors.blocked(p.x, p.z, 0.3), respect: g.respect.value });
    }
    return out;
  });
  check('a bust from anywhere goes to the nearest station, loading its surroundings first when they are not there', r.every((o) => o.near < 45 && !o.blocked && o.respect === 75) && r.some((o) => o.loadedBefore === false && o.loadedAfter === true), r);

  // 7b. Who can bust her: a cop next to her on her level; not one 6 m off, tied, down, stunned, or far below a roof.
  r = await run(async () => {
    const { g, po, stand, roof, reset, sim, heat, of, setCaps } = window.__t;
    const only = { cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 1, 1, 1], blocks: [0, 0, 0, 0, 0, 0] };
    const trial = async (name, place, prep, hold) => {
      reset();
      setCaps(only);
      place();
      sim(0.3);
      heat(3);
      const cop = po.spawnCop({ x: g.player.pos.x + 1.3, z: g.player.pos.z });
      prep?.(cop);
      for (let i = 0; i < 25; i++) {
        if (hold) {
          cop.pos.set(g.player.pos.x + hold, cop.pos.y, g.player.pos.z);
          cop.hasGoal = false;
          po.cops[0].goalT = 9;
        }
        sim(0.1);
      }
      const busted = of('busted').length;
      while (po.busting) await new Promise((ok) => setTimeout(ok, 30));
      return [name, busted];
    };
    const out = [];
    out.push(await trial('beside', () => stand(-300, 12)));
    out.push(await trial('6m off', () => stand(-300, 12), null, 6));
    out.push(await trial('tied', () => stand(-300, 12), (c) => c.tie()));
    out.push(await trial('down', () => stand(-300, 12), (c) => c.hit(9999, 'test')));
    out.push(await trial('stunned', () => stand(-300, 12), (c) => c.stun(5)));
    out.push(await trial('below a roof', () => roof(), (c) => (c.pos.y = 0)));
    return out;
  });
  check('only a cop next to her, up and on her level, busts her (not at 6 m, tied, down, stunned, or far below a roof)', JSON.stringify(r) === JSON.stringify([['beside', 1], ['6m off', 0], ['tied', 0], ['down', 0], ['stunned', 0], ['below a roof', 0]]), r);

  // 8. Nets and tasers: a cop with a line of sight in range fires; without one, or out of range, he does not.
  r = await run(async () => {
    const { g, po, stand, reset, sim, heat, los, covered, setCaps, of } = window.__t;
    const only = { cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 1, 1, 1], blocks: [0, 0, 0, 0, 0, 0] };
    const trial = (type, at, dist) => {
      reset();
      setCaps(only);
      g.health = { hp: 100, calls: [], damage(n, by) { this.hp -= n; this.calls.push([n, by]); } };
      stand(-300, 12);
      const spot = at === 'clear' ? los(true, [dist]) : covered([9, 10, 11, 12, 13]);
      if (!spot) return { skipped: true };
      heat(3);
      const cop = po.spawnCop(spot);
      const rec = po.cops.find((c) => c.a === cop);
      rec.type = type;
      rec.cool = 0;
      const out = { dist: Math.round(Math.hypot(spot.x - g.player.pos.x, spot.z - g.player.pos.z)), netted: false, speedInNet: null, damage: 0 };
      // Hold the cop where he stands, so that it is the shot that is tested and not the chase.
      const hold = { x: cop.pos.x, z: cop.pos.z };
      for (let i = 0; i < 90; i++) {
        cop.pos.set(hold.x, cop.pos.y, hold.z);
        cop.hasGoal = false;
        rec.goalT = 9;
        if (po.netted && out.speedInNet === null) {
          g.player.vel.set(10, 0, 0);
          sim(0.3);
          out.speedInNet = +Math.hypot(g.player.vel.x, g.player.vel.z).toFixed(1);
        }
        sim(0.1);
        out.netted ||= po.netted;
        if (out.speedInNet !== null && !po.netted) break;
      }
      out.damage = g.health.calls.length;
      out.call = g.health.calls[0];
      out.left = po.netted;
      out.busted = of('busted').length;
      return out;
    };
    return {
      net: trial('net', 'clear', 9),
      taser: trial('taser', 'clear', 9),
      behind: trial('net', 'shut'),
      far: trial('taser', 'clear', 60),
    };
  });
  check('a net from a cop who sees her tangles her (slowed, and it wears off)', r.net.netted && r.net.speedInNet < 5 && r.net.left === false && r.net.damage === 0 && r.net.busted === 0, r.net);
  check('a taser from a cop who sees her hurts her (6 damage)', r.taser.damage >= 1 && r.taser.call?.join() === '6,cop', r.taser);
  check('no shot from a cop behind a building, nor from one 60 m away', !r.behind.skipped && !r.behind.netted && r.behind.damage === 0 && !r.far.skipped && !r.far.netted && r.far.damage === 0, { behind: r.behind, far: r.far });

  // 9. Heat the police make themselves: a stolen car in front of an officer, a police car, drunk driving, ramming.
  r = await run(() => {
    const { g, po, stand, reset, sim, of, los, covered, car, setCaps } = window.__t;
    const none = { cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 0, 0, 0], blocks: [0, 0, 0, 0, 0, 0] };
    const steal = (type, witness) => {
      reset();
      setCaps(none);
      stand(-300, 12);
      let s = null;
      if (witness === 'seen') s = los(true, [40]);
      else if (witness === 'behind') s = covered([40, 30, 25]);
      if (s) car('police', 'block', s.x, s.z);
      const p = g.player.pos;
      const c = car(type, 'parked', p.x + 1.5, p.z);
      sim(0.3);
      g.enterCar(c);
      sim(0.3);
      const out = { stars: g.wanted.stars, level: g.wanted.level, why: of('heat').map((e) => e.why).join(), spot: witness === 'none' || !!s };
      g.exitCar(false);
      return out;
    };
    return {
      seen: steal('sedan', 'seen'),
      none: steal('sedan', 'none'),
      behind: steal('sedan', 'behind'),
      police: steal('police', 'none'),
      policeSeen: steal('police', 'seen'),
    };
  });
  check('a car stolen in front of an officer is 1 star; with nobody looking, or him behind a building, nothing', r.seen.spot && r.behind.spot && r.seen.stars === 1 && r.seen.why === 'stolen-car' && r.none.level === 0 && r.none.why === '' && r.behind.level === 0 && r.behind.why === '', r);
  check('a stolen police car is a star even unseen (1.5 with a witness)', r.police.level === 1 && r.police.why === 'stolen-police-car' && r.policeSeen.level === 1.5, r);

  r = await run(() => {
    const { g, po, stand, reset, sim, of, los, car, setCaps, log } = window.__t;
    const none = { cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 0, 0, 0], blocks: [0, 0, 0, 0, 0, 0] };
    const drive = (drunk, witness) => {
      reset();
      setCaps(none);
      stand(-300, 12);
      const p = g.player.pos;
      // Get in first, so that the theft itself is not what is seen; then the officer turns up.
      const c = car('sedan', 'parked', p.x + 1.5, p.z);
      g.enterCar(c);
      if (witness) {
        const s = los(true, [30]);
        car('police', 'block', s.x, s.z);
      }
      log.length = 0;
      g.wanted.clear();
      g.drunk.level = drunk;
      sim(1);
      const first = g.wanted.level;
      sim(9);
      const out = { first, later: g.wanted.level, heats: of('heat').map((e) => e.why + ':' + e.amount).join() };
      g.exitCar(false);
      return out;
    };
    return { drunkSeen: drive(5, true), drunkAlone: drive(5, false), soberSeen: drive(0, true), tipsy: drive(1, true) };
  });
  check('drunk at the wheel with an officer looking: half a star at once, another after 8 s', r.drunkSeen.first === 0.5 && r.drunkSeen.later === 1 && r.drunkSeen.heats === 'drunk-driving:0.5,drunk-driving:0.5', r.drunkSeen);
  check('and none when alone, sober, or only a little tipsy', r.drunkAlone.later === 0 && r.soberSeen.later === 0 && r.tipsy.later === 0, { alone: r.drunkAlone, sober: r.soberSeen, tipsy: r.tipsy });

  r = await run(() => {
    const { g, po, stand, reset, sim, of, car, setCaps } = window.__t;
    const none = { cars: [0, 0, 0, 0, 0, 0], cops: [0, 0, 0, 0, 0, 0], blocks: [0, 0, 0, 0, 0, 0] };
    // A car she drives, `gap` m behind the target and moving at `speed` (with the throttle down if `gas`).
    const ram = (targetType, gap, speed, gas) => {
      reset();
      setCaps(none);
      stand(-300, 12);
      const p = g.player.pos;
      const me = car('sedan', 'parked', p.x - gap, p.z, Math.PI / 2);
      g.enterCar(me);
      const t = car(targetType, targetType === 'police' ? 'block' : 'parked', p.x, p.z, 0);
      t.x = me.x + gap;
      t.z = me.z;
      g.traffic.poseObj(t);
      me.speed = speed;
      g.wanted.clear();
      window.__t.log.length = 0;
      g.setInput({ moveY: gas ? 1 : 0 });
      let contact = 999;
      for (let i = 0; i < 40; i++) {
        sim(0.05);
        contact = Math.min(contact, Math.hypot(me.x - t.x, me.z - t.z));
      }
      g.setInput(null);
      const out = { level: g.wanted.level, why: of('heat').map((e) => e.why).join(), contact: +contact.toFixed(1) };
      g.exitCar(false);
      return out;
    };
    return { fast: ram('police', 12, 22, true), slow: ram('police', 4.3, 2.5, false), other: ram('sedan', 12, 22, true) };
  });
  check('ramming a patrol car at speed is a star; a slow bump or ramming an ordinary car is not', r.fast.level === 1 && r.fast.why === 'police-ram' && r.fast.contact < 4 && r.slow.level === 0 && r.slow.contact < 4.2 && r.other.level === 0 && r.other.contact < 4, r);

  // 10. Sirens through the sfx context: loud when a patrol car is near, silent when there is none.
  r = await run(() => {
    const { g, po, stand, reset, sim, heat } = window.__t;
    reset();
    g.sfx.init();
    stand(-300, 12);
    const out = { ctx: !!g.sfx.ctx };
    sim(0.3);
    out.before = po.sirenLevel;
    heat(1);
    for (let i = 0; i < 60 && !po.pursuers.length; i++) sim(0.25);
    const u = po.pursuers[0];
    out.spawned = !!u;
    const at = (d) => {
      u.car.x = g.player.pos.x + d;
      u.car.z = g.player.pos.z;
      u.drv.follow(null); // no route to pull it back to the road
      sim(0.1);
      return +po.sirenLevel.toFixed(3);
    };
    out.near = at(40);
    out.mid = at(150);
    out.far = at(300);
    g.wanted.clear();
    for (let i = 0; i < 160 && po.pursuers.length; i++) sim(0.25);
    out.after = po.sirenLevel;
    return out;
  });
  check('sirens: silent with no patrol car, louder the nearer one is, silent again once they stand down', r.ctx && r.before === 0 && r.spawned && r.near > 0.05 && r.near > r.mid && r.mid > r.far && r.far === 0 && r.after === 0, r);

  // 11. A patrol car left far behind is dropped and a new one comes near.
  r = await run(() => {
    const { g, po, stand, reset, sim, heat, dist } = window.__t;
    reset();
    stand(-300, 12);
    heat(1);
    for (let i = 0; i < 60 && !po.pursuers.length; i++) sim(0.25);
    const first = po.pursuers[0].car;
    stand(500, 500);
    let gone = null;
    for (let i = 0; i < 80; i++) {
      sim(0.25);
      if (gone === null && !g.traffic.cars.includes(first)) gone = i * 0.25;
    }
    return { gone, removedFromList: !po.pursuers.some((u) => u.car === first), now: po.pursuers.map((u) => Math.round(dist(u.car))) };
  });
  check('a patrol car left behind (over 400 m) is dropped and a new one comes near', r.gone !== null && r.removedFromList && r.now.length === 1 && r.now[0] < 300, r);

  // 12. Cost with everything active: 5 stars, on a roof so that nothing ends it.
  r = await run(() => {
    const { g, po, roof, reset, sim, heat } = window.__t;
    reset();
    roof();
    sim(0.5);
    heat(5);
    const most = { cars: 0, cops: 0, blocks: 0 };
    for (let i = 0; i < 25; i++) {
      sim(1);
      most.cars = Math.max(most.cars, po.pursuers.length);
      most.cops = Math.max(most.cops, po.cops.length);
      most.blocks = Math.max(most.blocks, po.blocks.length);
    }
    let acc = 0, n = 0, worst = 0;
    const orig = po.update;
    po.update = (dt) => {
      const t0 = performance.now();
      orig.call(po, dt);
      const ms = performance.now() - t0;
      acc += ms;
      worst = Math.max(worst, ms);
      n++;
    };
    sim(15);
    po.update = orig;
    return { most, ticks: n, msPerTick: +(acc / n).toFixed(4), worstMs: +worst.toFixed(2), stars: g.wanted.stars };
  });
  console.log(`COST  police  5 stars, ${r.most.cars} cars, ${r.most.cops} cops, ${r.most.blocks} roadblocks: ${r.msPerTick} ms per tick (worst ${r.worstMs} ms) over ${r.ticks} ticks`);
  check('the police cost under 1 ms per tick at 5 stars with all units out', r.most.cars >= 4 && r.most.cops >= 5 && r.msPerTick < 1, r);

  // 13. Brasov: the same, with its own stations.
  const brasov = await open(browser, 'city=brasov&lowq&seed=5', errors);
  await brasov.evaluate(async () => {
    const g = window.__game;
    await g.city.streamAround(0, 0, 1300);
    g.systems.get('crimes').auto = false;
  });
  r = await brasov.evaluate(async () => {
    const g = window.__game, po = g.systems.get('police');
    g.respect = { value: 100, add(n) { this.value += n; } };
    g.player.reset();
    g.player.pos.set(0, 0, 100);
    g.player.groundBox = null;
    g.simulate(0.5, 1 / 30);
    g.events.emit('heat', { amount: 3, why: 'test' });
    const out = { cars: 0, cops: 0, blocks: 0 };
    for (let i = 0; i < 40 && !po.busting; i++) {
      g.simulate(0.5, 1 / 30);
      out.cars = Math.max(out.cars, po.pursuers.length);
      out.cops = Math.max(out.cops, po.cops.length);
      out.blocks = Math.max(out.blocks, po.blocks.length);
    }
    while (po.busting) await new Promise((ok) => setTimeout(ok, 30));
    const from = { x: g.player.pos.x, z: g.player.pos.z };
    await po.bust('test');
    let best = null;
    for (const s of po.stations) {
      const d = Math.hypot(s[1] - from.x, s[2] - from.z);
      if (!best || d < best.d) best = { name: s[0], x: s[1], z: s[2], d };
    }
    const p = g.player.pos;
    out.station = best.name;
    out.count = po.stations.length;
    out.near = +Math.hypot(p.x - best.x, p.z - best.z).toFixed(1);
    out.blocked = g.actors.blocked(p.x, p.z, 0.3);
    out.stars = g.wanted.stars;
    return out;
  });
  check('Brasov: patrol cars and cops come at 3 stars, and a bust goes to a Brasov station', r.cars >= 1 && r.cops >= 1 && r.count === 8 && r.near < 45 && !r.blocked && r.stars === 0 && /Secția|IJP|Poliția/.test(r.station), r);
  await brasov.close();
} finally {
  await browser.close();
  srv.kill();
}
check('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
process.exit(results.every((x) => x.ok) ? 0 : 1);
