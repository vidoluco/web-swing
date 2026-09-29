// The living city: pedestrians, trams, stray dogs and bears, pigeons and the sound of the streets.
// Every system has a positive case (the thing happens and is right) and a negative one (it does not
// happen when it must not), plus what it costs per game tick. Usage: PORT=5226 node test/living.mjs
// (exit code 1 on any failure). The scripts step the game themselves, so the browser loop is stopped.
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

// Helpers that live in the page.
const helpers = () => {
  const g = window.__game, A = g.actors;
  const T = (window.__t = {});
  T.tick = (secs, step = 1 / 30) => g.simulate(secs, step);
  T.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Stand on a dry pavement near (x, z), with the chunks around it loaded, and let the crowd fill in.
  T.at = async (x, z, r = 40) => {
    await g.city.streamAround(x, z, 800);
    g.player.reset();
    const w = A.randomWalkPoint({ x, z }, r);
    g.player.pos.set(w.x, 0, w.z);
    g.player.groundBox = null;
    g.player.vel.set(0, 0, 0);
    g.player.mode = 'ground';
    return w;
  };
  T.sys = (n) => g.systems.get(n);
  // The road pieces around a point, for an independent test of "is this on a carriageway".
  T.roads = (cx, cz, R) => {
    const segs = [];
    for (const c of g.city.mmCells.values()) {
      for (const r of c.r) {
        if (r.cls !== 'road') continue;
        const p = r.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          if (Math.abs(p[i] - cx) > R || Math.abs(p[i + 1] - cz) > R) continue;
          segs.push([p[i], p[i + 1], p[i + 2], p[i + 3], r.w / 2 - 0.3]);
        }
      }
    }
    return segs;
  };
  T.onRoad = (segs, x, z) => {
    for (const [ax, az, bx, bz, h] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < h) return true;
    }
    return false;
  };
  // n new people around the player between rMin and rMax metres.
  T.crowd = (n, rMin, rMax) => {
    const P = g.systems.get('pedestrians'), out = [], c = g.player.pos;
    for (let i = 0; i < 600 && out.length < n; i++) {
      const a = Math.random() * 6.283, d = rMin + Math.random() * (rMax - rMin);
      const w = A.randomWalkPoint({ x: c.x + Math.sin(a) * d, z: c.z + Math.cos(a) * d }, 6);
      const dd = Math.hypot(w.x - c.x, w.z - c.z);
      if (dd < rMin - 1 || dd > rMax + 1 || A.blocked(w.x, w.z, 0.4) || A.paths.onRoad(w.x, w.z)) continue;
      const p = P.add(w.x, w.z, { scale: 1 });
      if (p) out.push(p);
    }
    return out;
  };
  // Sum of squares of the last block of samples of an analyser (energy).
  T.energy = async (an, ms) => {
    const buf = new Float32Array(an.fftSize);
    let e = 0, n = 0;
    for (let t = 0; t < ms; t += 25) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) (e += v * v), n++;
      await T.wait(25);
    }
    return Math.sqrt(e / n);
  };
  // Spectrum tools for the offline renders.
  T.amp = (x, sr, f) => {
    const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (const v of x) {
      const s0 = v + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return (Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length) * 2;
  };
};

try {
  // ==================================================================================================
  // Bucharest
  // ==================================================================================================
  const page = await open(browser, 'shot=perch&seed=7', errors);
  await page.evaluate(helpers);
  let r;

  // ---------- pedestrians ----------

  // 1. Old Town: a crowd on walkable ground, not inside buildings, water or the carriageway; varied.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(14);
    const roads = T.roads(g.player.pos.x, g.player.pos.z, 400);
    let blocked = 0, water = 0, road = 0, crossing = 0;
    for (const p of P.peds) {
      const a = p.a;
      if (g.city.isWater(a.pos.x, a.pos.z)) water++;
      else if (A.blocked(a.pos.x, a.pos.z, 0.2)) blocked++;
      if (T.onRoad(roads, a.pos.x, a.pos.z)) p.mode === 'cross' ? crossing++ : road++;
    }
    const scales = P.peds.map((p) => p.a.rig.group.scale.y);
    return { count: P.peds.length, target: P.target(g.player.pos.x, g.player.pos.z), blocked, water, road, crossing, scaleMin: +Math.min(...scales).toFixed(2), scaleMax: +Math.max(...scales).toFixed(2), outfits: new Set(P.peds.map((p) => p.a.mat)).size, variants: new Set(P.peds.map((p) => p.a.variant)).size, states: [...new Set(P.peds.map((p) => p.mode))] };
  });
  check('people fill the Old Town and stand on walkable ground, not in buildings, water or on the road', r.count >= 85 && r.blocked === 0 && r.water === 0 && r.road === 0, r);
  check('people differ: heights, outfits and accessories', r.scaleMax - r.scaleMin > 0.18 && r.outfits >= 12 && r.variants >= 4, { scaleMin: r.scaleMin, scaleMax: r.scaleMax, outfits: r.outfits, variants: r.variants });

  // 2. Thicker in the centre and near bars than on the outskirts.
  r = await page.evaluate(async () => {
    const g = window.__game, P = g.systems.get('pedestrians'), T = window.__t;
    const out = { old: P.peds.length };
    await T.at(-230, -530);
    T.tick(3);
    out.density = { oldTown: +P.density(-230, -530).toFixed(2), unirii: +P.density(0, 0).toFixed(2), outskirts: +P.density(-5000, -3500).toFixed(2) };
    await T.at(-5000, 1200);
    T.tick(16);
    out.outskirts = P.peds.length;
    out.outskirtsTarget = P.target(g.player.pos.x, g.player.pos.z);
    // A bar far from every busy place: its own neighbourhood is denser than 100 m away, where there is none.
    let bar = null;
    for (const c of g.city.mmCells.values()) for (const p of c.p) if (!bar && Math.hypot(p.x, p.z) > 2500 && Math.hypot(p.x + 230, p.z + 530) > 2500 && Math.hypot(p.x + 25, p.z + 950) > 2500) bar = p;
    if (bar) {
      await T.at(bar.x, bar.z);
      T.tick(2);
      out.bar = { near: +P.density(bar.x, bar.z).toFixed(2), away: +P.density(bar.x + 120, bar.z + 20).toFixed(2) };
    }
    return out;
  });
  check('the Old Town and the centre are busier than the outskirts', r.density.oldTown > 2 * r.density.outskirts && r.density.unirii > 1.5 * r.density.outskirts && r.old >= 85 && r.outskirts <= r.outskirtsTarget && r.outskirts <= 60, r);
  check('a bar draws people to it', r.bar && r.bar.near > r.bar.away + 0.1, r.bar);

  // 3. Nobody walks on the carriageway away from a crossing: 90 seconds, sampled twice a second.
  r = await page.evaluate(async () => {
    const g = window.__game, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(10);
    const roads = T.roads(g.player.pos.x, g.player.pos.z, 500);
    let samples = 0, violations = 0, crossingSamples = 0, worst = null;
    for (let i = 0; i < 180; i++) {
      T.tick(0.5);
      for (const p of P.peds) {
        if (!p.a.attached) continue;
        samples++;
        if (T.onRoad(roads, p.a.pos.x, p.a.pos.z)) {
          if (p.mode === 'cross') crossingSamples++;
          else {
            violations++;
            worst = worst || { mode: p.mode, at: [Math.round(p.a.pos.x), Math.round(p.a.pos.z)] };
          }
        }
      }
    }
    return { samples, violations, crossingSamples, worst, stats: { ...P.stats } };
  });
  check('people never walk on a carriageway away from a crossing (90 s, 100 people)', r.samples > 8000 && r.violations === 0, r);

  // 4. A crossing: the person waits while a car is coming, crosses when the road is clear, and gets to the other side.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(0, 0, 60);
    T.tick(2);
    let cross = null;
    for (const c of P.crossingsNear(g.player.pos.x, g.player.pos.z, 420)) if (c.len > 6 && c.len < 30 && !cross) cross = c;
    if (!cross) return { skipped: 'no crossing near the start' };
    g.player.pos.set(cross.ax, 0, cross.az);
    g.player.vel.set(0, 0, 0);
    T.tick(1);
    const roads = T.roads(cross.mx, cross.mz, 120);
    // A car 30 m from the crossing, moving. (mode parked so that the traffic does not steer this stand-in.)
    const fake = { x: cross.mx + 30, z: cross.mz, yaw: -Math.PI / 2, speed: 9, len: 4.6, wid: 1.9, mode: 'parked', vx: 0, vz: 0, obj: null, type: 'sedan' };
    g.traffic.cars.push(fake);
    const p = P.add(cross.ax, cross.az, { scale: 1 });
    P.beginCross(p, cross, 0);
    T.tick(1);
    const out = { len: +cross.len.toFixed(1) };
    let waited = 0, onRoadWhileWaiting = 0;
    for (let i = 0; i < 8; i++) {
      T.tick(0.5);
      if (p.mode === 'wait') waited++;
      if (T.onRoad(roads, p.a.pos.x, p.a.pos.z)) onRoadWhileWaiting++;
    }
    out.withCar = { waitingSteps: waited, onRoad: onRoadWhileWaiting, mode: p.mode };
    g.traffic.cars.splice(g.traffic.cars.indexOf(fake), 1);
    T.tick(2.5);
    out.clear = { mode: p.mode, crossings: P.stats.crossings };
    let t = 0, passedOnRoad = 0;
    while (t < 20 && p.mode !== 'idle') {
      T.tick(0.25);
      t += 0.25;
      if (T.onRoad(roads, p.a.pos.x, p.a.pos.z)) passedOnRoad++;
    }
    out.arrived = { left: +Math.hypot(p.a.pos.x - cross.bx, p.a.pos.z - cross.bz).toFixed(1), seconds: t, onRoadSteps: passedOnRoad };
    return out;
  });
  check(
    'at a crossing they wait for the car, then cross when it is clear, and reach the far side',
    !r.skipped && r.withCar.waitingSteps >= 7 && r.withCar.onRoad === 0 && r.clear.mode === 'cross' && r.arrived.left < 2.5 && r.arrived.onRoadSteps > 3,
    r,
  );

  // 5. They look at Bunica when she swings close, some film her, and not when she is slow or far.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(4);
    const pl = g.player;
    const fast = (v) => Object.defineProperty(pl, 'speed', { get: () => v, configurable: true });
    const reacting = (set) => set.filter((p) => ['watch', 'film'].includes(p.mode)).length;
    const out = {};
    // Slow: close people do not react.
    fast(2);
    const slow = T.crowd(12, 6, 12);
    T.tick(2);
    out.slowClose = reacting(slow);
    // Fast but far.
    fast(14);
    const far = T.crowd(12, 26, 34);
    T.tick(2);
    out.fastFar = reacting(far);
    // Fast and close.
    const near = T.crowd(24, 6, 14);
    T.tick(1.5);
    out.fastClose = reacting(near);
    const turned = near.filter((p) => ['watch', 'film'].includes(p.mode)).map((p) => {
      const want = Math.atan2(pl.pos.x - p.a.pos.x, pl.pos.z - p.a.pos.z);
      return Math.abs(Math.atan2(Math.sin(p.a.yaw - want), Math.cos(p.a.yaw - want)));
    });
    out.facingBunica = turned.filter((d) => d < 0.4).length;
    T.tick(5);
    const filming = near.filter((p) => p.mode === 'film' && p.phone);
    out.filming = filming.length;
    g.advance(0.05);
    const v = new (pl.pos.constructor)();
    out.phones = filming.slice(0, 4).map((p) => {
      p.phone.getWorldPosition(v);
      const hand = p.a.rig.bones[13].matrixWorld.elements;
      return { onHand: p.phone.parent === p.a.rig.bones[13], phoneY: +(v.y).toFixed(2), handY: +hand[13].toFixed(2), nearHead: Math.hypot(v.x - p.a.pos.x, v.z - p.a.pos.z) < 0.8 };
    });
    // Screenshot of a film.
    const f0 = filming[0];
    if (f0) {
      const yaw = f0.a.yaw;
      g.aerial(f0.a.pos.x + Math.sin(yaw) * 3.2 + Math.cos(yaw) * 0.8, 1.7, f0.a.pos.z + Math.cos(yaw) * 3.2 - Math.sin(yaw) * 0.8, f0.a.pos.x, f0.a.pos.z);
      g.advance(0.05);
    }
    delete pl.speed;
    return out;
  });
  check('people look at her when she swings close and do not when she is slow or far', r.slowClose === 0 && r.fastFar === 0 && r.fastClose >= 6 && r.facingBunica >= r.fastClose - 1, r);
  check('some of them film her with a phone in the raised hand', r.filming >= 2 && r.phones.every((p) => p.onHand && p.handY > 1.15 && p.phoneY > 1.1 && p.nearHead), r.phones);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/living-film.png' });

  // 6. A good landing is applauded; a hop is not.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(4);
    const pl = g.player;
    const out = {};
    const people = T.crowd(16, 7, 16);
    const c0 = P.stats.cheers;
    // A hop from two metres up: under half a second in the air.
    pl.pos.y = 2;
    pl.mode = 'air';
    pl.vel.set(0, 0, 0);
    T.tick(1.5, 1 / 60);
    out.afterHop = P.stats.cheers - c0;
    // A fall from 45 m: nearly two seconds.
    pl.pos.y = 45;
    pl.mode = 'air';
    pl.vel.set(0, 0, 0);
    let minHands = 9, raised = 0, cheering = 0;
    for (let i = 0; i < 90; i++) {
      T.tick(1 / 30, 1 / 30);
      for (const p of people) {
        if (p.mode !== 'cheer') continue;
        const L = p.a.rig.bones[9].matrixWorld.elements, R = p.a.rig.bones[13].matrixWorld.elements;
        minHands = Math.min(minHands, Math.hypot(L[12] - R[12], L[13] - R[13], L[14] - R[14]));
        if (L[13] > 1.0 && R[13] > 1.0) raised++;
      }
    }
    out.afterFall = P.stats.cheers - c0;
    out.cheeringNow = people.filter((p) => p.mode === 'cheer').length;
    out.handsClose = +minHands.toFixed(2);
    out.handsRaisedSamples = raised;
    return out;
  });
  check('a short hop is not applauded, a long fall and landing is, with the hands together in front', r.afterHop === 0 && r.afterFall >= 4 && r.handsClose < 0.6 && r.handsRaisedSamples > 5, r);

  // 7. A fight sends the near people running; the far ones stay.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(4);
    const f = A.randomWalkPoint(g.player.pos, 14);
    const thug = A.spawn('thug', f, { exact: true });
    const c = g.player.pos;
    g.player.pos.set(f.x, 0, f.z + 8);
    const near = T.crowd(12, 5, 20), farAway = T.crowd(8, 50, 70);
    g.player.pos.copy(c);
    g.player.pos.set(f.x, 0, f.z + 8);
    T.tick(1);
    const d0 = near.map((p) => Math.hypot(p.a.pos.x - f.x, p.a.pos.z - f.z));
    const before = { near: near.filter((p) => p.mode === 'flee').length, far: farAway.filter((p) => p.mode === 'flee').length };
    thug.hit(10, 'test');
    T.tick(1.5);
    const out = { before, near: near.filter((p) => p.mode === 'flee').length, running: near.filter((p) => p.mode === 'flee' && p.a.state === 'run').length, far: farAway.filter((p) => p.mode === 'flee').length };
    T.tick(4);
    const gained = near.map((p, i) => Math.hypot(p.a.pos.x - f.x, p.a.pos.z - f.z) - d0[i]).filter((v, i) => near[i].mode === 'flee' || v > 3);
    out.meanGain = +(gained.reduce((s, v) => s + v, 0) / Math.max(1, gained.length)).toFixed(1);
    return out;
  });
  check('a fight makes the people near it run away, and the far ones ignore it', r.before.near === 0 && r.near >= 8 && r.running >= 5 && r.far === 0 && r.meanGain > 8, r);

  // 8. A car that hits someone: they fall; the player's car raises the heat, another car does not; the slow car and the person beside are safe.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(3);
    const heat = [];
    g.events.on('heat', (e) => heat.push(e));
    const roads = T.roads(g.player.pos.x, g.player.pos.z, 100);
    // A long straight pavement point and a stretch of 12 m ahead of it that is free.
    const s = A.randomWalkPoint(g.player.pos, 20);
    const yaw = 1.2;
    const hx = Math.sin(yaw), hz = Math.cos(yaw);
    const out = {};
    const run = (mode, speed) => {
      const a = P.add(s.x, s.z, { scale: 1 }), b = P.add(s.x - hz * 5, s.z + hx * 5, { scale: 1 });
      a.a.hasGoal = b.a.hasGoal = false;
      a.until = b.until = 999;
      const car = { x: s.x - hx * 9, z: s.z - hz * 9, yaw, speed, len: 4.6, wid: 1.9, mode, vx: hx * speed, vz: hz * speed, obj: null, type: 'sedan' };
      g.traffic.cars.push(car);
      const mover = g.systems.add({ name: 'mover', update(dt) { car.x += hx * speed * dt; car.z += hz * speed * dt; a.a.pos.set(s.x, 0, s.z); b.a.pos.set(s.x - hz * 5, 0, s.z + hx * 5); } });
      const h0 = heat.length;
      T.tick(2.5, 1 / 60);
      g.systems.remove('mover');
      g.traffic.cars.splice(g.traffic.cars.indexOf(car), 1);
      const res = { hit: a.a.state === 'down', beside: b.a.state === 'down', heat: heat.length - h0 };
      a.a.remove();
      b.a.remove();
      return res;
    };
    out.driven = run('driven', 10);
    out.other = run('parked', 10);
    out.slow = run('parked', 1);
    out.heat = heat.map((h) => ({ amount: h.amount, why: h.why }));
    return out;
  });
  check(
    'a car hits someone and they fall: heat only from the player\'s car; a slow car and a person beside the road are safe',
    r.driven.hit && r.driven.heat === 1 && !r.driven.beside && r.other.hit && r.other.heat === 0 && !r.slow.hit && r.slow.heat === 0 && r.heat[0].amount >= 1,
    r,
  );

  // 9. Culling: people beyond the actors' own hide distance cost nothing, next to the same number close by.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pedestrians'), T = window.__t;
    await T.at(-230, -530);
    T.tick(14);
    const want = P.target(g.player.pos.x, g.player.pos.z);
    const max = A.max;
    A.max = 400;
    // Keep 50 of the crowd and let the rest go, so that the total stays at the target and nobody is added meanwhile.
    for (const p of P.peds.slice(50)) p.a.remove();
    P.update(0.001);
    const base = P.peds.length;
    const ring = (n, r0) => {
      const out = [];
      for (let i = 0; i < 400 && out.length < n; i++) {
        const a = Math.random() * 6.283;
        const w = A.randomWalkPoint({ x: g.player.pos.x + Math.sin(a) * r0, z: g.player.pos.z + Math.cos(a) * r0 }, 8);
        if (Math.abs(Math.hypot(w.x - g.player.pos.x, w.z - g.player.pos.z) - r0) > 4) continue;
        const p = P.add(w.x, w.z, { scale: 1 });
        if (p) out.push(p);
      }
      return out;
    };
    const walk = A.walkTo.bind(A);
    let calls = 0;
    const measure = () => {
      calls = 0;
      A.walkTo = (...a) => (calls++, walk(...a));
      const t0 = performance.now();
      for (let i = 0; i < 400; i++) P.update(1 / 60);
      const ms = (performance.now() - t0) / 400;
      A.walkTo = walk;
      return { ms, calls };
    };
    const out = { want, base };
    const b0 = measure();
    const frozen = ring(want - base, 164);
    out.frozenAttached = frozen.filter((p) => p.a.attached).length;
    out.frozenHidden = frozen.filter((p) => !p.a.attached).length;
    const f = measure();
    out.frozenKept = frozen.filter((p) => !p.a.removed).length;
    for (const p of frozen) p.a.remove();
    P.update(0.001);
    const near = ring(want - P.peds.length, 30);
    const n = measure();
    for (const p of near) p.a.remove();
    A.max = max;
    out.baseMs = +b0.ms.toFixed(4);
    out.frozenExtraMs = +(f.ms - b0.ms).toFixed(4);
    out.nearExtraMs = +(n.ms - b0.ms).toFixed(4);
    out.walkCalls = { base: b0.calls, frozen: f.calls, near: n.calls };
    return out;
  });
  check(
    'people past the hide distance are not attached to the scene and cost nothing next to the same number close by',
    r.frozenAttached === 0 && r.frozenHidden >= 40 && r.frozenKept >= 40 && r.frozenExtraMs < 0.01 && r.nearExtraMs > 0.02 && r.frozenExtraMs < 0.3 * r.nearExtraMs && r.walkCalls.frozen <= r.walkCalls.base && r.walkCalls.near > r.walkCalls.base,
    r,
  );

  // ---------- trams ----------

  // 10. A tram follows its rail out and back, stops at a stop with the doors open, rings the bell to leave.
  r = await page.evaluate(async () => {
    const g = window.__game, Tr = g.systems.get('trams'), T = window.__t;
    g.systems.get('pedestrians').peds.forEach((p) => p.a.remove());
    await T.at(-300, 100);
    T.tick(6);
    Tr.onCityChange();
    Tr.limit(0);
    const net0 = Tr.network();
    const e = net0.edges.filter((q) => q.len > 380 && q.len < 700)[0];
    if (!e) return { skipped: 'no line' };
    const t = Tr.spawnOn(e, 60, 1);
    const bells = [];
    const stops = [];
    g.events.on('tram:bell', () => bells.push(+g.time.toFixed(1)));
    g.events.on('tram:stop', (s) => {
      const ed = t.edge, u = t.dir > 0 ? t.s : ed.len - t.s;
      const onStop = Tr.stopsOf(ed).some((p) => Math.abs(p - u) < 1);
      stops.push({ at: +g.time.toFixed(1), terminal: s.terminal, v: t.v, onStop, x: t.fx, z: t.fz, hx: t.hx, hz: t.hz, atEnd: u < 1 || u > ed.len - 1 });
    });
    // Distance of a point from the nearest rail of the current network.
    const off = (x, z) => {
      let best = 1e9;
      for (const ed of Tr.network().edges) {
        const p = ed.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], L2 = dx * dx + dz * dz || 1;
          const k = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / L2));
          best = Math.min(best, Math.hypot(x - p[i] - dx * k, z - p[i + 1] - dz * k));
        }
      }
      return best;
    };
    let maxOff = 0, maxV = 0, maxDecel = 0, prevV = 0, doorsOpenMid = 0, doorsClosedOnLeaving = 0, dwellSamples = 0, snap = 0, travelled = 0, px = t.fx, pz = t.fz;
    let last = t.mode;
    for (let i = 0; i < 30 * 260; i++) {
      T.tick(1 / 30, 1 / 30);
      if (i % 5 === 0) maxOff = Math.max(maxOff, off(t.fx, t.fz), off(t.units[0].cx, t.units[0].cz), off(t.units[1].cx, t.units[1].cz));
      maxV = Math.max(maxV, t.v);
      if (t.mode === 'run' && last === 'run') maxDecel = Math.max(maxDecel, (prevV - t.v) * 30);
      if (t.mode === 'dwell' && last === 'run') snap = Math.max(snap, prevV);
      prevV = t.v;
      if (t.mode === 'dwell') {
        dwellSamples++;
        if (t.timer > 3 && t.timer < t.dwellFor - 3) doorsOpenMid = Math.max(doorsOpenMid, t.doors);
      }
      if (t.mode === 'run' && last === 'dwell') doorsClosedOnLeaving = t.doors;
      last = t.mode;
      travelled += Math.hypot(t.fx - px, t.fz - pz);
      (px = t.fx), (pz = t.fz);
    }
    // The same stop passed in both directions, and the end of the line reached.
    const mid = stops.filter((s) => !s.terminal);
    let both = false;
    for (let i = 0; i < mid.length; i++) for (let j = i + 1; j < mid.length; j++) if (Math.hypot(mid[i].x - mid[j].x, mid[i].z - mid[j].z) < 4 && mid[i].hx * mid[j].hx + mid[i].hz * mid[j].hz < -0.5) both = true;
    return { len: Math.round(e.len), stops: stops.map((s) => ({ at: s.at, terminal: s.terminal, v: s.v, onStop: s.onStop, atEnd: s.atEnd })), bells: bells.length, maxOff: +maxOff.toFixed(2), maxV: +maxV.toFixed(1), maxDecel: +maxDecel.toFixed(2), arrivalSpeed: +snap.toFixed(2), doorsOpenMid: +doorsOpenMid.toFixed(2), doorsClosedOnLeaving: +doorsClosedOnLeaving.toFixed(2), reversals: Tr.stats.reversals, dwellSeconds: +(dwellSamples / 30).toFixed(0), travelled: Math.round(travelled), both, terminals: stops.filter((s) => s.terminal && s.atEnd).length };
  });
  check(
    'a tram runs along its rails, out to the end and back, stopping at a stop with the doors open, bell on leaving',
    !r.skipped && r.maxOff < 1.2 && r.stops.length >= 4 && r.stops.every((s) => s.v === 0 && (s.terminal ? s.atEnd : s.onStop)) && r.both && r.terminals >= 1 && r.reversals >= 1 && r.doorsOpenMid > 0.95 && r.doorsClosedOnLeaving < 0.05 && r.bells >= 4 && r.maxV <= 11.5 && r.maxDecel < 2.2 && r.arrivalSpeed < 1 && r.travelled > 2 * r.len,
    r,
  );

  // 11. Bunica lands on the roof and is carried; she leaves with the tram's speed; on the ground beside it she stays put.
  r = await page.evaluate(async () => {
    const g = window.__game, Tr = g.systems.get('trams'), T = window.__t;
    await T.at(-300, 100);
    Tr.onCityChange();
    Tr.limit(0);
    const e = Tr.network().edges.filter((q) => q.len > 380 && q.len < 700)[0];
    const t = Tr.spawnOn(e, 60, 1);
    T.tick(4);
    const u = t.units[0], pl = g.player;
    const said = [];
    g.voice.say = (k) => said.push(k);
    const rel = () => {
      const dx = pl.pos.x - u.cx, dz = pl.pos.z - u.cz;
      return [dx * Math.cos(u.yaw) - dz * Math.sin(u.yaw), dx * Math.sin(u.yaw) + dz * Math.cos(u.yaw)];
    };
    const out = { tramSpeed: +t.v.toFixed(1) };
    pl.pos.set(u.cx + Math.sin(u.yaw) * 1.5, 12, u.cz + Math.cos(u.yaw) * 1.5);
    pl.vel.set(0, 0, 0);
    pl.mode = 'air';
    pl.groundBox = null;
    T.tick(1.5, 1 / 60);
    out.landed = { mode: pl.mode, onRoof: pl.groundBox === u.prism, y: +pl.pos.y.toFixed(2), riding: !!Tr.ride(), said: said.slice() };
    const r0 = rel(), p0 = [t.fx, t.fz];
    T.tick(6, 1 / 60);
    const r1 = rel();
    out.carried = { drift: +Math.hypot(r1[0] - r0[0], r1[1] - r0[1]).toFixed(3), tramMoved: +Math.hypot(t.fx - p0[0], t.fz - p0[1]).toFixed(1), mode: pl.mode, y: +pl.pos.y.toFixed(2) };
    g.advance(0.05);
    // The camera on the roof, for the picture.
    g.rig.yaw = u.yaw + Math.PI;
    g.rig.pitch = -0.2;
    g.advance(0.05);
    out.shotCam = 'roof';
    // Jump off: she keeps the speed of the tram.
    g.setInput({ jumpPressed: true });
    T.tick(1 / 30, 1 / 30);
    g.setInput(null);
    out.jump = { mode: pl.mode, speedAlong: +(pl.vel.x * Math.sin(u.yaw) + pl.vel.z * Math.cos(u.yaw)).toFixed(1), tramV: +Math.hypot(u.vx, u.vz).toFixed(1) };
    return out;
  });
  check(
    'Bunica lands on a tram roof, is carried with it, says the line once, and jumps off with its speed',
    r.landed.onRoof && r.landed.mode === 'ground' && r.landed.y > 3 && r.landed.riding && r.landed.said.join() === 'tram' && r.carried.drift < 0.05 && r.carried.tramMoved > 10 && r.jump.mode === 'air' && r.jump.speedAlong > 0.8 * r.jump.tramV && r.jump.tramV > 3,
    r,
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/living-tram-roof.png' });

  r = await page.evaluate(async () => {
    const g = window.__game, Tr = g.systems.get('trams'), T = window.__t;
    await T.at(-300, 100);
    Tr.onCityChange();
    Tr.limit(0);
    const e = Tr.network().edges.filter((q) => q.len > 380 && q.len < 700)[0];
    const t = Tr.spawnOn(e, 60, 1);
    T.tick(3);
    const u = t.units[0], pl = g.player;
    const out = {};
    // On the ground four metres to the side of the moving tram: nothing carries her.
    const rx = Math.cos(u.yaw), rz = -Math.sin(u.yaw);
    pl.pos.set(u.cx + rx * 6, 0, u.cz + rz * 6);
    pl.vel.set(0, 0, 0);
    pl.mode = 'ground';
    pl.groundBox = null;
    const p0 = pl.pos.clone();
    T.tick(5, 1 / 60);
    out.beside = { moved: +pl.pos.distanceTo(p0).toFixed(3), riding: !!Tr.ride(), tramMoved: +Math.hypot(t.units[0].cx - u.pcx, 0).toFixed(1) };
    // Walking into the side of a tram that stands at a stop: she does not go through it.
    t.mode = 'dwell';
    t.dwellFor = 999;
    t.timer = 0;
    T.tick(1);
    const cx = t.units[0].cx, cz = t.units[0].cz, ux = t.units[0].yaw;
    const sx = Math.cos(ux), sz = -Math.sin(ux);
    pl.pos.set(cx + sx * 4, 0, cz + sz * 4);
    pl.mode = 'ground';
    g.look(Math.atan2(sx, sz), 0);
    g.setInput({ moveY: 1 });
    T.tick(2.5, 1 / 60);
    g.setInput(null);
    const off = Math.abs((pl.pos.x - cx) * sx + (pl.pos.z - cz) * sz);
    out.wall = { distFromAxis: +off.toFixed(2), mode: pl.mode, y: +pl.pos.y.toFixed(2) };
    return out;
  });
  check('on the ground next to a moving tram nothing carries her, and its side is a wall', r.beside.moved < 0.05 && !r.beside.riding && r.wall.distFromAxis > 1.5 && r.wall.y < 1, r);

  // 12. The tram picture, from the pavement.
  r = await page.evaluate(async () => {
    const g = window.__game, Tr = g.systems.get('trams'), T = window.__t;
    await T.at(-300, 100);
    Tr.onCityChange();
    Tr.limit(0);
    const e = Tr.network().edges.filter((q) => q.len > 380 && q.len < 700)[0];
    const t = Tr.spawnOn(e, 60, 1);
    T.tick(5);
    const mx = (t.units[0].cx + t.units[1].cx) / 2, mz = (t.units[0].cz + t.units[1].cz) / 2;
    const rx = t.hz, rz = -t.hx;
    g.player.pos.set(mx + rx * 30, 0, mz + rz * 30);
    g.aerial(mx + rx * 20 - t.hx * 6, 3, mz + rz * 20 - t.hz * 6, mx, mz);
    g.advance(0.05);
    return { speed: +t.v.toFixed(1) };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/living-tram.png' });

  // ---------- stray dogs ----------

  // 13. Dogs chase and bark, then scatter after a papuc lands, and are left alone when she is high up.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, S = g.systems.get('strays'), T = window.__t;
    g.systems.get('pedestrians').peds.forEach((p) => p.a.remove());
    await g.goTo(9);
    const w = A.randomWalkPoint(g.player.pos, 50);
    g.player.pos.set(w.x, 0, w.z);
    g.player.groundBox = null;
    g.player.mode = 'ground';
    T.tick(8);
    const bites = [], barks = [], voice = [];
    g.health = { damage: (n, by) => bites.push([n, by]) };
    g.voice.say = (k) => voice.push(k);
    g.events.on('dog:bark', (e) => barks.push(e.yelp ? 'y' : 'b'));
    const out = { packs: S.packs.map((k) => k.dogs.length) };
    const k = S.packs[0];
    if (!k) return out;
    const lead = k.dogs[0];
    // High up on a roof beside them: they only bark from below, no chase.
    k.cool = 0;
    g.player.pos.set(lead.pos.x + 8, 40, lead.pos.z + 8);
    g.player.mode = 'air';
    g.player.groundBox = null;
    g.player.vel.set(0, 0, 0);
    // (she falls; look at the first half second, still above 9 m)
    T.tick(0.5, 1 / 60);
    out.high = { mode: k.mode, y: +g.player.pos.y.toFixed(1) };
    // On the ground, 14 m away.
    g.player.pos.set(lead.pos.x + 10, 0, lead.pos.z + 10);
    g.player.vel.set(0, 0, 0);
    g.player.mode = 'ground';
    T.tick(0.3);
    T.tick(4);
    let close = 9;
    for (const a of k.dogs) close = Math.min(close, Math.hypot(a.pos.x - g.player.pos.x, a.pos.z - g.player.pos.z));
    out.chase = { mode: k.mode, closest: +close.toFixed(1), barks: barks.length, bites: bites.length, voice: voice.slice() };
    const ix = lead.pos.x + 2, iz = lead.pos.z;
    const d0 = k.dogs.map((a) => Math.hypot(a.pos.x - ix, a.pos.z - iz));
    g.events.emit('papuc:land', { x: ix, z: iz });
    out.scatterMode = k.mode;
    T.tick(3);
    const d1 = k.dogs.map((a) => Math.hypot(a.pos.x - ix, a.pos.z - iz));
    out.scatter = { mode: k.mode, gain: +((d1.reduce((s, v) => s + v, 0) - d0.reduce((s, v) => s + v, 0)) / d0.length).toFixed(1), each: d1.map((v, i) => v > d0[i] + 4), yelps: barks.filter((b) => b === 'y').length };
    // She stays ten metres from them: no new chase while they are still scared and for ten seconds after.
    g.player.pos.set(lead.pos.x + 8, 0, lead.pos.z + 8);
    T.tick(3);
    out.calm = k.mode;
    g.aerial(lead.pos.x + 10, 2.6, lead.pos.z + 10, lead.pos.x, lead.pos.z);
    g.advance(0.05);
    return out;
  });
  check('a stray pack barks and chases her on the ground and leaves her alone when she is high up', r.packs.length >= 1 && r.packs.every((n) => n >= 2 && n <= 4) && r.high.mode === 'roam' && r.chase.mode === 'chase' && r.chase.closest < 3 && r.chase.barks >= 5 && r.chase.bites >= 1 && r.chase.voice[0] === 'dog', r);
  check('a papuc landing among the dogs scatters them, and they do not come back at once', r.scatterMode === 'scatter' && r.scatter.gain > 10 && r.scatter.each.filter(Boolean).length >= r.scatter.each.length - 1 && r.scatter.yelps >= 1 && r.calm !== 'chase', r);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/living-dogs.png' });

  // 14. No bears in Bucharest.
  r = await page.evaluate(async () => {
    const g = window.__game, S = g.systems.get('strays'), T = window.__t;
    const out = { zones: S.zones().length };
    let seen = 0;
    for (const [x, z] of [[-1049, -5167], [-230, -530], [253, -375]]) {
      await T.at(x, z);
      for (let i = 0; i < 20; i++) {
        T.tick(3);
        seen = Math.max(seen, S.bears.length, g.actors.list.filter((a) => a.kind === 'bear').length);
      }
    }
    out.maxBears = seen;
    out.spawned = S.stats.bearsSpawned;
    return out;
  });
  check('there are no bears in Bucharest, not in the parks either (3 minutes)', r.zones === 0 && r.maxBears === 0 && r.spawned === 0, r);

  // ---------- pigeons ----------

  // 15. A flock on Piata Unirii: on the ground, calm when she is far, lifts in a swirl when she comes near, lands again.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, P = g.systems.get('pigeons'), T = window.__t;
    g.systems.get('pedestrians').peds.forEach((p) => p.a.remove());
    await g.city.streamAround(-15, 35, 600);
    g.player.reset();
    g.player.pos.set(-15 + 60, 0, 35 + 60);
    g.player.groundBox = null;
    g.player.mode = 'ground';
    T.tick(2);
    const f = P.flocks[0];
    const said = [];
    g.voice.say = (k) => said.push(k);
    const events = [];
    g.events.on('pigeons:lift', () => events.push(1));
    const air = () => {
      let n = 0, high = 0;
      for (let i = 0; i < f.n; i++) {
        if (f.mode[i] !== 0) n++;
        f.bodies.getMatrixAt(i, window.__m || (window.__m = new (g.camera.matrix.constructor)()));
        if (window.__m.elements[13] > 3) high++;
      }
      return { air: n, high };
    };
    const out = { flocks: P.flocks.length, birds: f.n, visible: f.bodies.visible };
    const g0 = g.city.groundAt(f.cx, f.cz);
    out.calm = { state: f.state, ...air() };
    T.tick(3);
    out.calmLater = { state: f.state, ...air() };
    g.player.pos.set(f.cx + 4, 0, f.cz + 3);
    T.tick(0.5);
    out.lifting = { state: f.state, ...air() };
    T.tick(3);
    out.up = { state: f.state, ...air(), said: said.slice(), events: events.length, voiceOnce: said.length };
    g.aerial(f.cx + 14, 4, f.cz + 16, f.cx, f.cz);
    g.advance(0.05);
    window.__flock = f;
    return out;
  });
  check('a flock of pigeons sits on Piata Unirii and stays put while she is 85 m away', r.flocks === 1 && r.birds >= 24 && r.visible && r.calm.air === 0 && r.calmLater.state === 'calm' && r.calmLater.air === 0, r);
  check('the pigeons lift off in a swirl when she comes near, high in the air, and say the line once', r.up.state === 'up' && r.up.air >= r.birds * 0.95 && r.up.high >= r.birds * 0.8 && r.up.events === 1 && r.up.said.join() === 'pigeon', r.up);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/living-pigeons.png' });
  r = await page.evaluate(async () => {
    const g = window.__game, P = g.systems.get('pigeons'), T = window.__t;
    const f = window.__flock;
    const out = {};
    g.player.pos.set(f.cx + 70, 0, f.cz + 60);
    T.tick(14);
    out.landing = { state: f.state, air: Array.from(f.mode).filter((m) => m !== 0).length };
    T.tick(8);
    out.landed = { state: f.state, air: Array.from(f.mode).filter((m) => m !== 0).length };
    // Far away: nothing is drawn, nothing is computed.
    const stand = (dx, dz) => {
      g.player.pos.set(f.cx + dx, 0, f.cz + dz);
      g.player.vel.set(0, 0, 0);
      g.player.mode = 'ground';
      g.player.groundBox = null;
    };
    stand(400, 0);
    T.tick(1);
    const d0 = P.stats.draws;
    T.tick(4);
    out.far = { visible: f.bodies.visible, draws: P.stats.draws - d0, at: Math.round(Math.hypot(g.player.pos.x - f.cx, g.player.pos.z - f.cz)) };
    // Back to the flock, and it is drawn again.
    stand(60, 0);
    T.tick(1);
    out.back = { visible: f.bodies.visible, draws: P.stats.draws - d0, at: Math.round(Math.hypot(g.player.pos.x - f.cx, g.player.pos.z - f.cz)) };
    return out;
  });
  check('after she leaves the pigeons come down again, and a flock 400 m away is neither drawn nor updated', r.landing.air <= 36 && r.landed.state === 'calm' && r.landed.air === 0 && !r.far.visible && r.far.draws === 0 && r.back.visible && r.back.draws > 0, r);

  // ---------- ambience ----------

  await page.mouse.click(300, 200); // the browser wants a click before it plays anything
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience');
    g.sfx.init();
    await g.sfx.ctx.resume();
    window.__t.tick(1);
    return { ...A.state(), sr: g.sfx.ctx.sampleRate };
  });
  check('the ambience builds its audio graph on the game\'s context once it runs', r.built && r.ctx === 'running', r);

  // 16. Every synth voice makes a sound of the right kind (rendered offline, so it does not depend on speakers).
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience'), T = window.__t;
    const out = {};
    const render = async (name, secs, o = {}, t0 = 0.05) => {
      const sr = 44100, ctx = new OfflineAudioContext(1, sr * secs, sr);
      A.voices[name](ctx, ctx.destination, t0, o);
      const buf = (await ctx.startRendering()).getChannelData(0);
      let e = 0, peak = 0, nan = false;
      for (const v of buf) {
        e += v * v;
        peak = Math.max(peak, Math.abs(v));
        if (!Number.isFinite(v)) nan = true;
      }
      return { buf, sr, rms: Math.sqrt(e / buf.length), peak, nan };
    };
    const all = {};
    for (const [k, secs, o] of [['bell', 1.5, {}], ['church', 4, { f: 220 }], ['horn', 1, { f: 420 }], ['bark', 1, {}], ['roar', 1.6, {}], ['chirp', 1, {}], ['flutter', 1.8, {}], ['hiss', 0.8, {}], ['siren', 3, { dur: 2.4 }]]) {
      const x = await render(k, secs, o);
      all[k] = { rms: +x.rms.toFixed(4), peak: +x.peak.toFixed(2), nan: x.nan };
      out[k + '_x'] = x;
    }
    const amp = (x, f, a = 0, b = 1e9) => T.amp(x.buf.subarray(Math.max(0, a), Math.min(x.buf.length, b)), x.sr, f);
    const bell = out.bell_x, church = out.church_x, horn = out.horn_x, roar = out.roar_x, chirp = out.chirp_x, siren = out.siren_x, bark = out.bark_x;
    const band = (x, lo, hi) => {
      let e = 0;
      for (let f = lo; f <= hi; f += (hi - lo) / 24) e += amp(x, f) ** 2;
      return e;
    };
    const res = {
      levels: all,
      bellPitch: +(amp(bell, 1180) / Math.max(1e-9, amp(bell, 300))).toFixed(1),
      churchPitch: +(amp(church, 220) / Math.max(1e-9, amp(church, 1500))).toFixed(1),
      hornPitch: +(amp(horn, 420) / Math.max(1e-9, amp(horn, 200))).toFixed(1),
      roarLow: +(band(roar, 40, 300) / Math.max(1e-9, band(roar, 3000, 6000))).toFixed(1),
      chirpHigh: +(band(chirp, 2500, 5500) / Math.max(1e-9, band(chirp, 100, 600))).toFixed(1),
      barkMid: +(band(bark, 500, 1200) / Math.max(1e-9, band(bark, 60, 160))).toFixed(1),
      sirenAlternates: [+(amp(siren, 690, 0.1 * siren.sr | 0, 0.6 * siren.sr | 0) / Math.max(1e-9, amp(siren, 960, 0.1 * siren.sr | 0, 0.6 * siren.sr | 0))).toFixed(1), +(amp(siren, 960, 0.75 * siren.sr | 0, 1.15 * siren.sr | 0) / Math.max(1e-9, amp(siren, 690, 0.75 * siren.sr | 0, 1.15 * siren.sr | 0))).toFixed(1)],
    };
    return res;
  });
  const lv = r.levels;
  check(
    'every synthesised voice is audible, finite and of the right kind (bell, church bell, horn, bark, growl, chirp, wings, hiss, siren)',
    Object.values(lv).every((x) => !x.nan && x.rms > 0.004 && x.peak < 1.6) && r.bellPitch > 4 && r.churchPitch > 8 && r.hornPitch > 5 && r.roarLow > 10 && r.chirpHigh > 10 && r.barkMid > 4 && r.sirenAlternates.every((v) => v > 1.5),
    r,
  );

  // 17. The events make sounds where they happen, and left is left.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience'), T = window.__t;
    const ctx = g.sfx.ctx;
    const out = {};
    g.traffic.max = 0;
    for (const c of [...g.traffic.cars]) g.traffic.remove(c);
    await T.at(-230, -530);
    T.tick(1);
    g.look(0.6, 0);
    g.advance(0.05);
    T.tick(0.3);
    const split = ctx.createChannelSplitter(2), aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
    aL.fftSize = aR.fftSize = 2048;
    g.sfx.master.connect(split);
    split.connect(aL, 0);
    split.connect(aR, 1);
    // The listener is where the ambience system put it on the last tick (the camera then, not the render camera now).
    const L = ctx.listener;
    const lx = L.positionX.value, ly = L.positionY.value, lz = L.positionZ.value;
    const fwd = [L.forwardX.value, L.forwardY.value, L.forwardZ.value];
    const hl = Math.hypot(fwd[0], fwd[2]) || 1;
    const right = [-fwd[2] / hl, 0, fwd[0] / hl];
    const cam = { position: { x: lx, y: ly, z: lz } };
    const base = await Promise.all([T.energy(aL, 200), T.energy(aR, 200)]);
    out.quiet = base.map((v) => +v.toFixed(4));
    const bellAt = async (k) => {
      g.events.emit('tram:bell', { x: lx + right[0] * 15 * k, y: 2, z: lz + right[2] * 15 * k });
      const [l, r] = await Promise.all([T.energy(aL, 350), T.energy(aR, 350)]);
      await T.wait(1200);
      return [+l.toFixed(4), +r.toFixed(4)];
    };
    out.bellRight = await bellAt(1);
    out.bellLeft = await bellAt(-1);
    out.listener = { x: +lx.toFixed(1), y: +ly.toFixed(1), player: [+g.player.pos.x.toFixed(1), +g.player.pos.z.toFixed(1)], forward: fwd.map((v) => +v.toFixed(2)) };
    const before = { ...A.stats.played };
    g.events.emit('dog:bark', { x: cam.position.x + 20, y: 0.6, z: cam.position.z, dog: null });
    g.events.emit('dog:bark', { x: cam.position.x - 20, y: 0.6, z: cam.position.z, yelp: true, dog: null });
    g.events.emit('bear:roar', { x: cam.position.x + 30, y: 1.2, z: cam.position.z });
    g.events.emit('pigeons:lift', { x: cam.position.x + 30, y: 1, z: cam.position.z });
    g.events.emit('tram:stop', { x: cam.position.x + 30, z: cam.position.z });
    out.played = Object.fromEntries(['bark', 'roar', 'flutter', 'hiss'].map((k) => [k, (A.stats.played[k] || 0) - (before[k] || 0)]));
    return out;
  });
  check(
    'the tram bell is heard on the side it rings on, and dogs, bears, pigeons and doors make their sounds',
    r.bellRight[1] > 2 * r.bellRight[0] && r.bellLeft[0] > 2 * r.bellLeft[1] && r.bellRight[1] > 1.5 * r.quiet[1] + 0.001 && Math.abs(r.listener.x - r.listener.player[0]) < 12 && r.played.bark === 2 && r.played.roar === 1 && r.played.flutter === 1 && r.played.hiss === 1,
    r,
  );

  // 18. The murmur follows the traffic, the wind follows the height, the bus ducks under the voice.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience'), T = window.__t;
    const out = {};
    g.traffic.max = 60;
    await T.at(0, 60);
    T.tick(25);
    await T.wait(2500);
    out.dense = { cars: g.traffic.cars.length, level: +A.level.traffic.toFixed(2), gain: +A.state().murmur.toFixed(3) };
    g.traffic.max = 0;
    for (const c of [...g.traffic.cars]) g.traffic.remove(c);
    T.tick(1);
    await T.wait(3200);
    out.empty = { cars: g.traffic.cars.length, level: +A.level.traffic.toFixed(2), gain: +A.state().murmur.toFixed(3) };
    // Height.
    g.player.pos.set(g.player.pos.x, 150, g.player.pos.z);
    g.player.mode = 'air';
    g.player.vel.set(0, 0, 0);
    const y0 = A.state().wind;
    T.tick(0.3, 1 / 60);
    g.player.pos.y = 150;
    g.player.vel.set(0, 0, 0);
    T.tick(0.3, 1 / 60);
    await T.wait(1800);
    out.wind = { ground: +y0.toFixed(4), high: +A.state().wind.toFixed(3), level: +A.level.wind.toFixed(2) };
    // The lines Bunica speaks push everything down and let it back up.
    g.player.pos.y = 0;
    g.player.mode = 'ground';
    g.voice.t = 3;
    T.tick(1);
    await T.wait(900);
    out.duckSpeaking = +A.state().duck.toFixed(2);
    g.voice.t = 0;
    T.tick(1);
    await T.wait(3500);
    out.duckAfter = +A.state().duck.toFixed(2);
    return out;
  });
  check(
    'the murmur follows the traffic, the wind the height, and everything steps aside while she speaks',
    r.dense.cars >= 20 && r.dense.gain > 2.5 * r.empty.gain && r.empty.level < 0.05 && r.wind.level > 0.9 && r.wind.high > 4 * Math.max(0.01, r.wind.ground) && r.duckSpeaking < 0.6 && r.duckAfter > 0.9,
    r,
  );

  // 19. Church bells on the hour, as many as the hour, and only when the hour changes.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience'), T = window.__t;
    await T.at(0, 60);
    g.env = { hours: 14.5 };
    T.tick(1);
    const s0 = A.stats.strikes, r0 = A.stats.req.church || 0;
    T.tick(5);
    const same = A.stats.strikes - s0;
    g.env.hours = 15.02;
    T.tick(0.2);
    const three = A.stats.strikes - s0;
    const near = A.churchesNear(g.player.pos.x, g.player.pos.z).length;
    g.env.hours = 23.9;
    T.tick(0.2);
    const s1 = A.stats.strikes;
    g.env.hours = 0.1;
    T.tick(0.2);
    const twelve = A.stats.strikes - s1;
    const out = { sameHour: same, three, twelve, near, sounds: (A.stats.req.church || 0) - r0 };
    delete g.env;
    return out;
  });
  check('the church bells strike the hour: three at three, twelve at midnight, nothing in between', r.sameHour === 0 && r.near === 2 && r.three === 3 * r.near && r.twelve === 12 * r.near && r.sounds === (3 + 11 + 12) * r.near, r);

  // 20. Manele from a passing car, and a siren far off.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience'), T = window.__t;
    g.traffic.max = 60;
    await T.at(0, 60);
    T.tick(25);
    const ctx = g.sfx.ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    g.sfx.master.connect(an);
    const car = g.traffic.cars.find((c) => c.mode === 'traffic' && Math.hypot(c.x - g.player.pos.x, c.z - g.player.pos.z) < 80);
    if (!car) return { skipped: 'no car near' };
    const quiet = await T.energy(an, 300);
    A.startManele(car);
    T.tick(0.5);
    const out = { on: A.state().manele };
    out.playing = +(await T.energy(an, 1200)).toFixed(4);
    out.quiet = +quiet.toFixed(4);
    // The car goes away: the music stops.
    car.x += 400;
    T.tick(0.5);
    out.after = A.state().manele;
    A.triggerSiren();
    T.tick(0.5);
    out.siren = A.state().siren;
    return out;
  });
  check('manele play from a car that drives past and stop when it is gone, and a siren starts far off', !r.skipped && r.on && r.playing > 1.5 * r.quiet && !r.after && r.siren, r);

  // 21. Birds in the parks by day, not at night, not on a paved street.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.systems.get('ambience'), T = window.__t;
    const out = {};
    g.env = { hours: 12 };
    // A place inside a green area: the middle of the first big polygon near Cismigiu.
    await g.city.streamAround(-900, -1200, 600);
    let spot = null;
    for (const c of g.city.mmCells.values()) {
      for (const ring of c.g) {
        if (spot || ring.length < 40) continue;
        let sx = 0, sz = 0;
        for (let i = 0; i < ring.length; i += 2) (sx += ring[i]), (sz += ring[i + 1]);
        const x = sx / (ring.length / 2), z = sz / (ring.length / 2);
        if (Math.hypot(x + 900, z + 1200) < 500 && !g.actors.blocked(x, z, 0.5)) spot = { x, z };
      }
    }
    if (!spot) return { skipped: 'no park' };
    g.player.reset();
    g.player.pos.set(spot.x, 0, spot.z);
    g.player.mode = 'ground';
    g.player.groundBox = null;
    T.tick(1);
    out.park = +A.level.park.toFixed(2);
    const c0 = A.stats.req.chirp || 0;
    T.tick(40);
    out.dayChirps = (A.stats.req.chirp || 0) - c0;
    g.env.hours = 2;
    T.tick(1);
    const c1 = A.stats.req.chirp || 0;
    T.tick(40);
    out.nightChirps = (A.stats.req.chirp || 0) - c1;
    g.env.hours = 12;
    // A paved street: the first candidate with no green within 60 m.
    for (const [x, z] of [[-230, -530], [0, -250], [400, 100], [-300, 100], [200, 900]]) {
      await T.at(x, z);
      T.tick(1);
      if (A.level.park === 0) {
        const c2 = A.stats.req.chirp || 0;
        T.tick(40);
        out.street = { at: [x, z], chirps: (A.stats.req.chirp || 0) - c2 };
        break;
      }
    }
    delete g.env;
    return out;
  });
  check('birds sing in the parks by day and not at night or on a paved street', !r.skipped && r.park === 1 && r.dayChirps >= 8 && r.nightChirps <= 3 && r.street && r.street.chirps === 0, r);

  // ---------- cost ----------

  // 22. All of it together: 100 people, 4 trams, 2 packs of dogs, pigeons in the air.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, T = window.__t;
    const S = (n) => g.systems.get(n);
    g.traffic.max = 60;
    g.env = undefined;
    await T.at(-15, 35);
    T.tick(25);
    const out = {};
    // Fill up to the load of the brief.
    const Tr = S('trams');
    Tr.limit(4);
    const edges = Tr.network().edges.filter((e) => e.len > 80).map((e) => {
      const q = Tr.pointAt(e, e.len / 2, {});
      return { e, d: Math.hypot(q.x - g.player.pos.x, q.z - g.player.pos.z) };
    }).sort((a, b) => a.d - b.d);
    for (const { e } of edges) {
      if (Tr.trams.length >= 4) break;
      if (e.len > 60 && !Tr.trams.some((t) => t.edge === e)) Tr.spawnOn(e, e.len * 0.6, 1);
    }
    const St = S('strays');
    let guard = 0;
    while (St.packs.length < 2 && guard++ < 30) St.spawnPack(g.player.pos.x + 40 + guard * 6, g.player.pos.z - 30);
    const Pg = S('pigeons');
    T.tick(10);
    if (Pg.flocks[0]) Pg.lift(Pg.flocks[0]);
    T.tick(0.5);
    out.load = { people: S('pedestrians').peds.length, trams: Tr.trams.length, packs: St.packs.length, dogs: St.packs.reduce((n, k) => n + k.dogs.length, 0), pigeonsAir: Pg.flocks[0] ? Array.from(Pg.flocks[0].mode).filter((m) => m !== 0).length : 0, actors: A.list.length, cars: g.traffic.cars.length };
    const mine = ['pedestrians', 'trams', 'strays', 'pigeons', 'ambience'];
    const times = { actors: 0 };
    const orig = {};
    for (const s of g.systems.list) {
      times[s.name] = 0;
      orig[s.name] = s.update;
      s.update = function (dt) {
        const t0 = performance.now();
        orig[s.name].call(this, dt);
        times[s.name] += performance.now() - t0;
      };
    }
    const au = A.update.bind(A);
    A.update = (dt, p) => {
      const t0 = performance.now();
      au(dt, p);
      times.actors += performance.now() - t0;
    };
    const N = 600;
    // The pigeons stay in the air for the measurement.
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (i % 120 === 0 && Pg.flocks[0] && Pg.flocks[0].state === 'calm') Pg.lift(Pg.flocks[0]);
      g.simulate(1 / 60, 1 / 60);
    }
    out.totalTickMs = +((performance.now() - t0) / N).toFixed(2);
    for (const s of g.systems.list) s.update = orig[s.name];
    A.update = au;
    out.perSystemMs = Object.fromEntries(mine.map((n) => [n, +(times[n] / N).toFixed(3)]));
    out.livingMs = +mine.reduce((s, n) => s + times[n] / N, 0).toFixed(3);
    out.actorsManagerMs = +(times.actors / N).toFixed(3);
    out.livingPlusActorsMs = +(out.livingMs + out.actorsManagerMs).toFixed(3);
    return out;
  });
  console.log('COST per game tick (no render), ms:', JSON.stringify(r));
  check('100 people, 4 trams, 2 packs of dogs and pigeons in the air together cost under 2 ms per game tick', r.load.people >= 90 && r.load.trams === 4 && r.load.packs === 2 && r.load.pigeonsAir >= 20 && r.livingMs < 2 && r.livingPlusActorsMs < 2, r);

  // ==================================================================================================
  // Brasov
  // ==================================================================================================
  const bpage = await open(browser, 'city=brasov&shot=perch&seed=7', errors);
  await bpage.evaluate(helpers);
  await bpage.mouse.click(300, 200);
  await bpage.evaluate(async () => {
    const g = window.__game;
    g.sfx.init();
    await g.sfx.ctx.resume();
  });

  // 23. No trams in Brasov; dogs and pigeons and bears yes.
  r = await bpage.evaluate(async () => {
    const g = window.__game, T = window.__t, S = g.systems.get('strays'), Tr = g.systems.get('trams'), P = g.systems.get('pigeons');
    const out = { city: g.cityId };
    const w = await T.at(31, 60);
    T.tick(30);
    out.trams = Tr.trams.length;
    out.edges = Tr.network().edges.length;
    out.spawnedTrams = Tr.stats.spawned;
    let n = 0;
    for (const rec of g.city.recs.values()) if (rec.state === 'loaded' && rec.tram?.length) n++;
    out.chunksWithTramRails = n;
    out.pigeons = P.flocks.map((f) => ({ name: f.spot.name, n: f.n, at: [Math.round(f.cx), Math.round(f.cz)] }));
    out.dogPacks = S.packs.length;
    out.people = g.systems.get('pedestrians').peds.length;
    return out;
  });
  check('Brasov has no trams: no tram rails in the data, no line, no tram', r.city === 'brasov' && r.trams === 0 && r.edges === 0 && r.spawnedTrams === 0 && r.chunksWithTramRails === 0, r);
  check('Brasov has people, stray dogs and a flock of pigeons on Piata Sfatului', r.people >= 40 && r.dogPacks >= 1 && r.pigeons.length === 1 && r.pigeons[0].name === 'Piata Sfatului' && Math.hypot(r.pigeons[0].at[0] - 31, r.pigeons[0].at[1] - 60) < 40, r);

  // 24. A bear in Brasov: it comes down to a bin, is scared by a papuc landing near, and chases her when hit.
  r = await bpage.evaluate(async () => {
    const g = window.__game, A = g.actors, T = window.__t, S = g.systems.get('strays');
    g.systems.get('pedestrians').peds.forEach((p) => p.a.remove());
    const z = S.zones()[1];
    await g.city.streamAround(z.x, z.z, 900);
    // A place 270 to 620 m from every bear street, so that nothing appears in front of her.
    let spot = null;
    for (let a = 0; a < 6.28 && !spot; a += 0.4) {
      const w = A.randomWalkPoint({ x: z.x + Math.sin(a) * 320, z: z.z + Math.cos(a) * 320 }, 30);
      const dn = Math.min(...S.zones().map((q) => Math.hypot(q.x - w.x, q.z - w.z)));
      if (dn >= 270 && dn <= 620) spot = w;
    }
    if (!spot) return { skipped: 'no spot' };
    g.player.reset();
    g.player.pos.set(spot.x, 0, spot.z);
    g.player.groundBox = null;
    g.player.mode = 'ground';
    const health = [], roars = [], voice = [];
    g.health = { damage: (n, by) => health.push([n, by]) };
    g.voice.say = (k) => voice.push(k);
    g.events.on('bear:roar', () => roars.push(1));
    const out = { zones: S.zones().length };
    let waited = 0;
    while (!S.bears.length && waited < 40) (T.tick(1), waited++);
    const b = S.bears[0];
    out.bears = S.bears.length;
    out.waited = waited;
    if (!b) return out;
    const a = b.a;
    out.kind = a.kind;
    out.spawnedAt = Math.round(Math.min(...S.zones().map((q) => Math.hypot(q.x - a.pos.x, q.z - a.pos.z))));
    // She walks up (a bear far from her stands still), and it goes to a bin and eats.
    const near = A.randomWalkPoint({ x: a.pos.x + 60, z: a.pos.z }, 15);
    g.player.pos.set(near.x, 0, near.z);
    let s = 0;
    while (b.mode !== 'eat' && s < 80) (T.tick(1), s++);
    out.eating = { mode: b.mode, seconds: s, atBin: Math.round(Math.hypot(a.pos.x - b.bin.x, a.pos.z - b.bin.z)) };
    // A papuc comes down six metres from it: scared, runs off.
    const x0 = a.pos.x, z0 = a.pos.z;
    g.events.emit('papuc:land', { x: x0 + 6, z: z0 });
    out.scared = { mode: b.mode };
    T.tick(4);
    out.ranOff = { mode: b.mode, moved: Math.round(Math.hypot(a.pos.x - x0, a.pos.z - z0)), health: health.length };
    // Hit it directly: angry, and it comes for her.
    g.events.emit('hit', { target: a, dmg: 5, by: 'papuc' });
    const p2 = A.randomWalkPoint({ x: a.pos.x + 25, z: a.pos.z }, 8);
    g.player.pos.set(p2.x, 0, p2.z);
    out.angryMode = b.mode;
    const d0 = Math.hypot(g.player.pos.x - a.pos.x, g.player.pos.z - a.pos.z);
    T.tick(6);
    out.angry = { mode: b.mode, distance: [Math.round(d0), Math.round(Math.hypot(g.player.pos.x - a.pos.x, g.player.pos.z - a.pos.z))], swipes: health.length, roars: roars.length, voice: voice.slice() };
    g.aerial(a.pos.x + 8, 3, a.pos.z + 8, a.pos.x, a.pos.z);
    g.advance(0.05);
    return out;
  });
  check(
    'in Brasov a bear comes down to the bins, is scared by a papuc that lands near, and chases her once it is hit',
    !r.skipped && r.zones === 5 && r.bears === 1 && r.kind === 'bear' && r.spawnedAt < 10 && r.eating.mode === 'eat' && r.eating.atBin < 8 && r.scared.mode === 'scared' && r.ranOff.moved > 12 && r.angryMode === 'angry' && r.angry.distance[1] < 6 && r.angry.swipes >= 1 && r.angry.roars === 1 && r.angry.voice.includes('bear'),
    r,
  );
  await bpage.waitForTimeout(300);
  await bpage.screenshot({ path: 'shots/living-bear.png' });

  // 25. Far from the bear streets there is no bear; Brasov's church bell is the Black Church.
  r = await bpage.evaluate(async () => {
    const g = window.__game, T = window.__t, S = g.systems.get('strays'), A = g.systems.get('ambience');
    for (const b of S.bears) b.a.remove();
    await T.at(1936, -2044); // the station, 2.6 km from the nearest bear street
    T.tick(1);
    const out = { churches: A.churchesNear(g.player.pos.x, g.player.pos.z).length };
    T.tick(30);
    out.farBears = S.bears.length;
    await T.at(-42, 187);
    g.env = { hours: 8.9 };
    T.tick(0.3);
    const s0 = A.stats.strikes;
    g.env.hours = 9.05;
    T.tick(0.3);
    out.near = A.churchesNear(g.player.pos.x, g.player.pos.z).map((c) => c.name);
    out.nine = A.stats.strikes - s0;
    delete g.env;
    return out;
  });
  check('no bear away from the bear streets, and at nine the Black Church strikes nine', r.farBears === 0 && r.near.join() === 'Biserica Neagra' && r.nine === 9, r);

  const errs = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
  check('no page errors', errs.length === 0, errs);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
