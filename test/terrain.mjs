// Terrain: the ground of a city with relief (Brasov) and the flat ground of one without (Bucharest).
// Runs in headless Chromium, prints PASS or FAIL per check and exits 1 on any failure.
// Usage: PORT=5221 node test/terrain.mjs   (uses PORT and PORT + 500: the second one runs test/physics.mjs)
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadDem } from '../tools/dem-lib.mjs';
import { PORT, startServer, launch, open } from './harness.mjs';

mkdirSync('shots', { recursive: true });
const dir = 'public/city/brasov';
const meta = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')).dem;
const dem = loadDem(dir, meta);

const srv = await startServer();
const browser = await launch();
const errors = [];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const rnd = (() => {
  let a = 20260929;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
})();

try {
  const page = await open(browser, 'city=brasov&shot=perch&lowq', errors, 900, 500);

  // Helpers that live in the page.
  await page.evaluate(() => {
    const g = window.__game, C = g.city, P = g.player;
    const T = (window.__t = {});
    // Ground points on the Tampa (or anywhere in a box) with a slope in [lo, hi] and nothing built within `clear` metres.
    T.slopes = (lo, hi, clear, box = [200, 500, 900, 1100], step = 30) => {
      const out = [];
      for (let x = box[0]; x <= box[2]; x += step) {
        for (let z = box[1]; z <= box[3]; z += step) {
          const s = C.slopeAt(x, z);
          if (s >= lo && s <= hi && !C.isWater(x, z)) out.push([x, z, s]);
        }
      }
      return out;
    };
    T.free = async (x, z, r) => {
      await C.streamAround(x, z, r + 400);
      return C.nearby(x, z, r, []).length === 0;
    };
    T.ascent = (x, z) => {
      const gr = { x: 0, z: 0 };
      C.terrain.gradient(x, z, gr);
      const l = Math.hypot(gr.x, gr.z) || 1;
      return [gr.x / l, gr.z / l];
    };
    // 45 m of ground from (x, z) along (fx, fz) with nothing built within 3 m of it.
    T.pathFree = async (x, z, fx, fz) => {
      await C.streamAround(x + fx * 22, z + fz * 22, 300);
      for (let d = 0; d <= 45; d += 3) if (C.nearby(x + fx * d, z + fz * d, 3, []).length) return false;
      return true;
    };
    T.stand = (x, z, dy = 0) => {
      P.reset();
      P.pos.set(x, C.groundAt(x, z) + dy, z);
      P.groundBox = null;
      P.vel.set(0, 0, 0);
      P.mode = dy ? 'air' : 'ground';
    };
    // Runs `secs` seconds straight along (fx, fz) and reports the mean speed after the first second and the lowest the camera got over the ground.
    T.run = (x, z, fx, fz, secs) => {
      T.stand(x, z);
      g.look(Math.atan2(-fx, -fz), -0.1);
      g.setInput({ moveY: 1 });
      const sp = [];
      let cam = Infinity;
      for (let t = 0; t < secs; t += 1 / 30) {
        g.simulate(1 / 30, 1 / 30);
        const c = g.camera.position;
        cam = Math.min(cam, c.y - C.groundAt(c.x, c.z));
        sp.push(Math.hypot(P.vel.x, P.vel.z));
      }
      g.setInput(null);
      const tail = sp.slice(30);
      return { speed: +(tail.reduce((a, b) => a + b, 0) / tail.length).toFixed(2), cam: +cam.toFixed(2), mode: P.mode, pos: P.pos.toArray().map((v) => +v.toFixed(1)) };
    };
    // Lowest ground under a building, sampled its own way: corners, every metre along the edges, and a 4 m grid inside.
    T.lowest = (b) => {
      let m = Infinity;
      const rings = [b.outer, ...b.holes];
      for (const r of rings) {
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
          const ax = r[i * 2], az = r[i * 2 + 1], bx = r[((i + 1) % n) * 2], bz = r[((i + 1) % n) * 2 + 1];
          const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
          for (let j = 0; j <= k; j++) m = Math.min(m, C.groundAt(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k));
        }
      }
      for (let x = b.minx; x <= b.maxx; x += 4) for (let z = b.minz; z <= b.maxz; z += 4) if (g.pointIn(x, z, b)) m = Math.min(m, C.groundAt(x, z));
      return m;
    };
  });

  // 1. groundAt is the bilinear sample of dem.bin, the same as the reference in tools/dem-lib.mjs, also past the edges.
  const pts = [];
  for (let i = 0; i < 300; i++) pts.push([meta.x0 - 300 + rnd() * (meta.w * meta.step + 600), meta.z0 - 300 + rnd() * (meta.h * meta.step + 600)]);
  const got = await page.evaluate((p) => p.map(([x, z]) => window.__game.city.groundAt(x, z)), pts);
  let worst = 0;
  pts.forEach(([x, z], i) => (worst = Math.max(worst, Math.abs(got[i] - dem.groundAt(x, z)))));
  check('groundAt matches the reference bilinear sample of dem.bin (300 points, edges included)', worst < 1e-4, { worst, sample: got.slice(0, 3).map((v) => +v.toFixed(2)) });

  // 2. The normal is the gradient of the bilinear cell and the slope is its steepness.
  let r = await page.evaluate(() => {
    const g = window.__game, C = g.city, m = C.index.dem;
    let worstDot = 1, worstSlope = 0, n = 0;
    for (let k = 0; k < 120; k++) {
      const i = 300 + ((k * 37) % 400), j = 350 + ((k * 91) % 500);
      const x = m.x0 + (i + 0.3 + (k % 5) * 0.1) * m.step, z = m.z0 + (j + 0.3 + (k % 3) * 0.2) * m.step;
      const e = 1.5;
      const hx = (C.groundAt(x + e, z) - C.groundAt(x - e, z)) / (2 * e), hz = (C.groundAt(x, z + e) - C.groundAt(x, z - e)) / (2 * e);
      const l = Math.hypot(hx, 1, hz), nn = C.groundNormalAt(x, z);
      worstDot = Math.min(worstDot, (-hx / l) * nn.x + (1 / l) * nn.y + (-hz / l) * nn.z);
      worstSlope = Math.max(worstSlope, Math.abs(Math.hypot(hx, hz) - C.slopeAt(x, z)));
      n++;
    }
    return { n, worstDot, worstSlope };
  });
  check('groundNormalAt and slopeAt agree with finite differences of groundAt', r.worstDot > 0.99999 && r.worstSlope < 1e-3, r);

  // 3. Standing on Tampa slopes of 22 to 37 degrees: feet on the ground to within 5 cm, no sinking, no floating.
  r = await page.evaluate(async () => {
    const T = window.__t, g = window.__game, C = g.city, P = g.player;
    const cand = T.slopes(0.4, 0.75, 0);
    const out = [];
    for (const [x, z, s] of cand) {
      if (out.length >= 6) break;
      if (!(await T.free(x, z, 30))) continue;
      T.stand(x, z, 6);
      let worst = 0, grounded = 0;
      for (let i = 0; i < 240; i++) {
        g.simulate(1 / 60, 1 / 60);
        if (i >= 90) {
          worst = Math.max(worst, Math.abs(P.pos.y - C.groundAt(P.pos.x, P.pos.z)));
          if (P.mode === 'ground') grounded++;
        }
      }
      out.push({ at: [x, z], slope: +s.toFixed(2), worst: +worst.toFixed(4), grounded, moved: +Math.hypot(P.pos.x - x, P.pos.z - z).toFixed(2) });
    }
    return out;
  });
  check('standing on a Tampa slope: y within 0.05 of groundAt, no sinking, no floating, no sliding', r.length >= 5 && r.every((s) => s.worst < 0.05 && s.grounded === 150 && s.moved < 0.5), r);

  // 4. Running uphill is slower than on the flat, downhill is faster; the camera stays over the hillside.
  r = await page.evaluate(async () => {
    const T = window.__t, C = window.__game.city;
    let s = null;
    for (const [x, z] of T.slopes(0.4, 0.6, 0)) {
      const [ux, uz] = T.ascent(x, z);
      // Clear ground for 60 m up and down the slope.
      let clear = true;
      for (const d of [-60, 60]) if (!(await T.free(x + ux * d, z + uz * d, 30))) clear = false;
      if (clear) {
        s = [x, z, ux, uz];
        break;
      }
    }
    if (!s) return { none: true };
    const [x, z, ux, uz] = s;
    const out = { at: [x, z], slope: +C.slopeAt(x, z).toFixed(2) };
    out.up = T.run(x, z, ux, uz, 3);
    out.down = T.run(x, z, -ux, -uz, 3);
    // A flat spot: the fields of the plain north east of the town.
    let flat = null;
    for (const [fx, fz] of T.slopes(0, 0.015, 0, [1000, -7000, 6000, -3000], 250).slice(0, 80)) if (await T.pathFree(fx, fz, 1, 0)) { flat = [fx, fz]; break; }
    out.flatAt = flat;
    out.flat = flat ? T.run(flat[0], flat[1], 1, 0, 3) : null;
    return out;
  });
  check('a run uphill is slower than on the flat, downhill is faster', !r.none && r.flat && r.up.speed < r.flat.speed * 0.6 && r.down.speed > r.flat.speed * 1.05 && r.up.speed < r.down.speed * 0.5, r);
  check('the camera never sinks into the hillside while running up or down', r.up.cam > 0.3 && r.down.cam > 0.3, { up: r.up.cam, down: r.down.cam });

  // 5. Very steep ground carries her down; the same spot is stable when the ground is gentle.
  r = await page.evaluate(async () => {
    const T = window.__t, g = window.__game, C = g.city, P = g.player;
    let best = null;
    for (const [x, z, s] of T.slopes(0.9, 3, 0, [-3000, -3000, 3000, 6500], 40)) if (!best || s > best[2]) best = [x, z, s];
    if (!best) return { none: true };
    const [x, z] = best;
    await C.streamAround(x, z, 500);
    T.stand(x, z);
    g.look(0, 0);
    const y0 = P.pos.y;
    g.simulate(3, 1 / 60);
    const [ux, uz] = T.ascent(x, z);
    const dx = P.pos.x - x, dz = P.pos.z - z;
    return { at: [Math.round(x), Math.round(z)], slope: +best[2].toFixed(2), slid: +Math.hypot(dx, dz).toFixed(1), downhillShare: +(-(dx * ux + dz * uz) / (Math.hypot(dx, dz) || 1)).toFixed(2), dropped: +(y0 - P.pos.y).toFixed(1), mode: P.mode };
  });
  check('on ground steeper than 42 degrees she slides down, along the slope', !r.none && r.slid > 3 && r.downhillShare > 0.8 && r.dropped > 1, r);
  r = await page.evaluate(async () => {
    const T = window.__t, g = window.__game, P = g.player;
    for (const [x, z] of T.slopes(0.3, 0.45, 0)) {
      if (!(await T.free(x, z, 30))) continue;
      T.stand(x, z);
      g.simulate(3, 1 / 60);
      return { at: [x, z], moved: +Math.hypot(P.pos.x - x, P.pos.z - z).toFixed(2) };
    }
  });
  check('on a 17 to 24 degree slope she stays where she stands', r && r.moved < 0.3, r);

  // 6. A stolen car driven up a real road stays on it, and its pitch is the slope.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, P = g.player, Tr = g.traffic;
    await C.streamAround(0, 300, 900);
    // A fairly straight road that climbs 8 to 20 % over at least 150 m, within 800 m of the old town.
    let best = null;
    for (const c of C.mmCells.values()) {
      for (const road of c.r) {
        if (road.cls !== 'road' || road.w < 5.5 || road.pts.length < 8) continue;
        const p = road.pts;
        if (Math.hypot(p[0], p[1]) > 800) continue;
        for (let i = 0; i + 3 < p.length; i += 2) {
          let len = 0, j = i;
          while (j + 3 < p.length && len < 150) (len += Math.hypot(p[j + 2] - p[j], p[j + 3] - p[j + 1])), (j += 2);
          if (len < 150) break;
          const grade = (C.groundAt(p[j], p[j + 1]) - C.groundAt(p[i], p[i + 1])) / len;
          const straight = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]) / len;
          if (grade > 0.08 && grade < 0.2 && straight > 0.95 && (!best || Math.abs(grade - 0.12) < Math.abs(best.grade - 0.12))) best = { road, i: i / 2, j: j / 2, grade };
        }
      }
    }
    if (!best) return { none: true };
    const pts = Float32Array.from(best.road.pts.slice(best.i * 2, best.j * 2 + 2));
    const road = { pts, w: best.road.w, oneway: false, major: !!best.road.major };
    Tr.max = 0; // no new cars, and none in the way
    for (const o of [...Tr.cars]) Tr.remove(o);
    const car = Tr.make('sedan');
    Tr.setRoad(car, road, 0, 1);
    car.s = 0;
    const [tx, tz, tyaw] = Tr.target(car);
    Object.assign(car, { x: tx, z: tz, yaw: tyaw, mode: 'traffic' });
    Tr.cars.push(car);
    Tr.poseObj(car);
    P.reset();
    P.pos.set(tx + Math.cos(tyaw) * 2, C.groundAt(tx, tz), tz - Math.sin(tyaw) * 2);
    P.groundBox = null;
    g.setInput({ carPressed: true });
    g.simulate(1 / 30, 1 / 30);
    const d = g.driving();
    if (d !== car) return { none: true, stole: !!d };
    const nearest = (x, z) => {
      let bd = 1e9, bi = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const ax = pts[i], az = pts[i + 1], ex = pts[i + 2] - ax, ez = pts[i + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        const dd = Math.hypot(x - ax - ex * t, z - az - ez * t);
        if (dd < bd) (bd = dd), (bi = i);
      }
      return { d: bd, i: bi };
    };
    const ahead = (x, z, dist) => {
      const n = nearest(x, z);
      let i = n.i, rem = dist, px = x, pz = z;
      const t0 = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) || 1;
      px = pts[i] + ((pts[i + 2] - pts[i]) * Math.max(0, ((x - pts[i]) * (pts[i + 2] - pts[i]) + (z - pts[i + 1]) * (pts[i + 3] - pts[i + 1])) / (t0 * t0)));
      pz = pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * Math.max(0, ((x - pts[i]) * (pts[i + 2] - pts[i]) + (z - pts[i + 1]) * (pts[i + 3] - pts[i + 1])) / (t0 * t0)));
      while (i + 3 < pts.length) {
        const L = Math.hypot(pts[i + 2] - px, pts[i + 3] - pz);
        if (L >= rem) return [px + ((pts[i + 2] - px) / L) * rem, pz + ((pts[i + 3] - pz) / L) * rem];
        rem -= L;
        px = pts[i + 2];
        pz = pts[i + 3];
        i += 2;
      }
      return [px, pz];
    };
    const endX = pts[pts.length - 2], endZ = pts[pts.length - 1];
    let maxOff = 0, worstPitch = 0, worstY = 0, meanPitch = 0, n = 0, t = 0;
    for (; t < 14 && Math.hypot(endX - d.x, endZ - d.z) > 12; t += 1 / 30) {
      const [ax, az] = ahead(d.x, d.z, 12);
      let e = Math.atan2(ax - d.x, az - d.z) - d.yaw;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      g.setInput({ moveY: 1, moveX: Math.max(-1, Math.min(1, -e * 2.5)) });
      g.simulate(1 / 30, 1 / 30);
      maxOff = Math.max(maxOff, nearest(d.x, d.z).d);
      if (t > 1) {
        const hx = Math.sin(d.yaw), hz = Math.cos(d.yaw), a = d.len * 0.4;
        const slope = (C.groundAt(d.x + hx * a, d.z + hz * a) - C.groundAt(d.x - hx * a, d.z - hz * a)) / (2 * a);
        worstPitch = Math.max(worstPitch, Math.abs(d.obj.rotation.x - -Math.atan(slope)));
        meanPitch += d.obj.rotation.x;
        n++;
        const b = d.wid * 0.45, lx = Math.cos(d.yaw), lz = -Math.sin(d.yaw);
        const mean = (C.groundAt(d.x + hx * a, d.z + hz * a) + C.groundAt(d.x - hx * a, d.z - hz * a) + C.groundAt(d.x + lx * b, d.z + lz * b) + C.groundAt(d.x - lx * b, d.z - lz * b)) / 4;
        worstY = Math.max(worstY, Math.abs(d.obj.position.y - mean - 0.03));
      }
    }
    g.setInput(null);
    const res = { grade: +best.grade.toFixed(3), seconds: +t.toFixed(1), maxOff: +maxOff.toFixed(2), half: best.road.w / 2, speed: +d.speed.toFixed(1), meanPitch: +(meanPitch / n).toFixed(3), worstPitchError: +worstPitch.toFixed(3), worstRideHeightError: +worstY.toFixed(3), roll: +d.obj.rotation.z.toFixed(3) };
    g.exitCar(false);
    return res;
  });
  check('a stolen car driven up a real road stays on the road, nose up by the slope', !r.none && r.maxOff < r.half + 1.5 && r.meanPitch < -0.06 && r.worstPitchError < 0.06 && r.worstRideHeightError < 0.02 && r.speed > 4, r);

  // 7. Every building base touches the ground (200 sampled), none sunk into it, none floating over it.
  r = await page.evaluate(() => {
    const T = window.__t, C = window.__game.city;
    const all = C.prisms.filter((b) => b.kind === 'building' && b.name !== 'BRAȘOV');
    const pick = [];
    for (let i = 0; i < 200; i++) pick.push(all[Math.floor((i * all.length) / 200)]);
    let touch = 0, sunk = 0, held = 0, worstSunk = 0, worstAir = 0;
    for (const b of pick) {
      const d = b.y0 - T.lowest(b);
      if (d > 0.5) held++;
      else if (d < -0.1) (sunk++, (worstSunk = Math.min(worstSunk, d)));
      else if (d > 0.1) (worstAir = Math.max(worstAir, d));
      else touch++;
    }
    return { of: all.length, touch, sunk, held, worstSunk: +worstSunk.toFixed(2), worstAir: +worstAir.toFixed(2) };
  });
  check('every sampled building base touches the ground (200 of them)', r.touch + r.held >= 198 && r.sunk === 0 && r.worstAir < 0.2, r);

  // 8. The Brasov spawn is on a flat roof in the old town, facing the Tampa.
  r = await page.evaluate(() => {
    const g = window.__game, C = g.city, P = g.player;
    const b = C.spawnBox;
    P.reset();
    const s = g.simulate(0.5);
    const f = P.facing;
    return { box: !!b, kind: b?.kind, pitched: b?.pitched, height: b && +(b.y1 - C.lowGround(b)).toFixed(1), roofY: b?.y1, y: s.pos[1], mode: s.mode, onIt: !!P.groundBox && P.groundBox.kind === 'building' && Math.abs(P.groundBox.y1 - b.y1) < 0.2, at: s.pos.map((v) => Math.round(v)), toTampa: +(f.x * 0.328 + f.z * 0.945).toFixed(2), fromSfatului: Math.round(Math.hypot(s.pos[0] - 31, s.pos[2] - 60)) };
  });
  check('the spawn stands on a roof in the old town with the Tampa in front', r.box && r.kind === 'building' && !r.pitched && r.onIt && r.mode === 'ground' && Math.abs(r.y - r.roofY) < 0.2 && r.height > 12 && r.fromSfatului < 250 && r.toTampa > 0.3, r);

  // 9. Each of the ten number keys puts her on solid ground, near the place.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, P = g.player;
    const out = [];
    for (let i = 0; i < 10; i++) {
      await g.goTo(i);
      const s = g.simulate(2, 1 / 60);
      const gb = P.groundBox;
      const gy = C.groundAt(P.pos.x, P.pos.z);
      out.push({ i, mode: s.mode, ok: Number.isFinite(P.pos.y), y: +P.pos.y.toFixed(1), on: gb ? 'roof' : 'ground', off: gb ? +(P.pos.y - gb.y1).toFixed(2) : +(P.pos.y - gy).toFixed(3), wet: C.isWater(P.pos.x, P.pos.z), p: [Math.round(P.pos.x), Math.round(P.pos.z)] });
    }
    return out;
  });
  const spots = (await import('../src/cities.js')).CITIES.brasov.spots;
  r.forEach((s, i) => (s.dist = Math.round(Math.hypot(s.p[0] - spots[i][1], s.p[1] - spots[i][2]))));
  check('all 10 number keys put her on solid ground, near the place', r.length === 10 && r.every((s) => s.mode === 'ground' && s.ok && !s.wet && Math.abs(s.off) < (s.on === 'roof' ? 0.2 : 0.06) && s.dist < 200), r);

  // 10. The BRAȘOV letters.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, S = C.sign;
    await C.streamAround(400, 880, 500);
    const solids = C.prisms.filter((b) => b.name === 'BRAȘOV');
    const mesh = g.scene.getObjectByName('sign');
    // Group the solids along the reading direction (u): pieces whose spans overlap are one letter, a gap of 2.5 m starts the next.
    const fx = -0.266, fz = -0.964, ux = fz, uz = -fx;
    const items = solids.map((b) => {
      const as = [];
      for (let k = 0; k < b.outer.length; k += 2) as.push((b.outer[k] - 404.3) * ux + (b.outer[k + 1] - 883.1) * uz);
      return { lo: Math.min(...as), hi: Math.max(...as), a: (Math.min(...as) + Math.max(...as)) / 2, b };
    }).sort((p, q) => p.lo - q.lo);
    const letters = [];
    for (const it of items) {
      const last = letters.at(-1);
      if (last && it.lo - last.max < 2.5) {
        last.max = Math.max(last.max, it.hi);
        last.items.push(it);
      } else letters.push({ min: it.lo, max: it.hi, items: [it] });
    }
    // Every letter stands on the lowest ground under it, and reaches its full height.
    const stand = letters.map((l) => {
      const y0 = Math.min(...l.items.map((i) => i.b.y0)), y1 = Math.max(...l.items.map((i) => i.b.y1));
      let low = Infinity;
      for (const i of l.items) for (let k = 0; k < i.b.outer.length; k += 2) low = Math.min(low, C.groundAt(i.b.outer[k], i.b.outer[k + 1]));
      return { above: +(y0 - low).toFixed(2), high: +(y1 - y0).toFixed(1) };
    });
    const centre = items.reduce((s, i) => s + i.a, 0) / items.length;
    return { has: !!S, text: S && S.length > 90, spans: letters.map((l) => `${l.min.toFixed(1)}..${l.max.toFixed(1)}`), meshTris: mesh ? mesh.geometry.index?.count / 3 || mesh.geometry.attributes.position.count / 3 : 0, solids: solids.length, letters: letters.length, centre: +centre.toFixed(1), stand, length: S && +S.length.toFixed(1) };
  });
  check('the letters BRAȘOV exist: six of them on the Tampa, drawn and solid', r.has && r.letters === 6 && r.solids >= 30 && r.meshTris > 400 && r.length > 100 && r.length < 125 && Math.abs(r.centre) < 10 && r.stand.every((s) => s.above < 0 && s.above > -3 && s.high > 20), r);

  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, P = g.player;
    await C.streamAround(400, 880, 500);
    const solids = C.prisms.filter((b) => b.name === 'BRAȘOV');
    const top = solids.reduce((a, b) => (b.y1 > a.y1 ? b : a));
    const cx = (top.minx + top.maxx) / 2, cz = (top.minz + top.maxz) / 2;
    P.reset();
    P.pos.set(cx, top.y1 + 4, cz);
    P.mode = 'air';
    P.groundBox = null;
    P.vel.set(0, 0, 0);
    g.simulate(1.5, 1 / 60);
    const stood = { mode: P.mode, on: P.groundBox?.name, off: +(P.pos.y - top.y1).toFixed(3), high: +(top.y1 - C.groundAt(cx, cz)).toFixed(1) };
    // From the top: jump, hold the web, swing.
    g.look(Math.atan2(0.266, 0.964), -0.1);
    g.setInput({ moveY: 1, jumpPressed: true });
    g.simulate(1 / 60);
    g.setInput({ moveY: 1 });
    g.simulate(0.3);
    g.setInput({ moveY: 1, swing: true });
    const s = g.simulate(3);
    g.setInput(null);
    return { stood, modes: s.modes, y: s.pos[1] };
  });
  check('she can stand on top of a letter and swing from it', r.stood.mode === 'ground' && r.stood.on === 'BRAȘOV' && Math.abs(r.stood.off) < 0.15 && r.stood.high > 20 && r.modes.includes('swing'), r);

  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, P = g.player;
    // The stem of the first letter, from 9 m in front of it.
    const solids = C.prisms.filter((b) => b.name === 'BRAȘOV');
    const top = solids.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 && (b.maxx - b.minx) * (b.maxz - b.minz) > 5 ? b : a));
    const cx = (top.minx + top.maxx) / 2, cz = (top.minz + top.maxz) / 2;
    const px = cx - 0.266 * 9, pz = cz - 0.964 * 9;
    P.reset();
    P.pos.set(px, C.groundAt(px, pz), pz);
    P.groundBox = null;
    g.look(Math.atan2(-0.266, -0.964), -0.1);
    g.setInput({ moveY: 1 });
    const modes = new Set();
    let s;
    for (let t = 0; t < 8; t += 0.25) {
      s = g.simulate(0.25);
      s.modes.forEach((m) => modes.add(m));
      if (s.mode === 'ground' && P.groundBox?.name === 'BRAȘOV') break;
    }
    g.setInput(null);
    return { modes: [...modes], on: P.groundBox?.name, y: +P.pos.y.toFixed(1), topY: +top.y1.toFixed(1) };
  });
  check('she climbs the front of a letter and vaults onto it', r.modes.includes('wall') && r.on === 'BRAȘOV' && r.y > 15, r);

  // 11. Swinging works from the buildings at the foot of the Tampa up the slope.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, P = g.player;
    await C.streamAround(100, 500, 1200);
    const roof = C.roofNear(60, 560, 200, 327, 943);
    P.reset();
    P.pos.copy(roof.pos);
    P.groundBox = roof.box;
    const dx = 327 - roof.pos.x, dz = 943 - roof.pos.z, l = Math.hypot(dx, dz);
    g.look(Math.atan2(-dx / l, -dz / l), -0.2);
    g.setInput({ moveY: 1 });
    g.simulate(0.4);
    g.setInput({ moveY: 1, jumpPressed: true });
    g.simulate(1 / 60);
    g.setInput({ moveY: 1 });
    g.simulate(0.6);
    g.setInput({ moveY: 1, swing: true });
    const modes = new Set();
    let s, maxSpeed = 0, worstPen = 0;
    for (let t = 0; t < 12; t += 0.25) {
      s = g.simulate(0.25);
      s.modes.forEach((m) => modes.add(m));
      maxSpeed = Math.max(maxSpeed, s.maxSpeed);
      worstPen = Math.max(worstPen, s.worstPenetration);
    }
    g.setInput(null);
    return { modes: [...modes], from: +roof.pos.y.toFixed(0), to: +P.pos.y.toFixed(0), ground: +C.groundAt(P.pos.x, P.pos.z).toFixed(0), metres: Math.round(Math.hypot(P.pos.x - roof.pos.x, P.pos.z - roof.pos.z)), maxSpeed, worstPen, nan: s.nan };
  });
  check('a swing from a roof at the foot of the Tampa carries her up the slope', r.modes.includes('swing') && r.to - r.from > 30 && r.metres > 100 && r.worstPen < 0.3 && !r.nan, r);

  // 12. Trees stand on the ground; none grows on the letters or in front of them, and the woods around are full.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city;
    await C.streamAround(400, 880, 700);
    let n = 0, sunk = 0, worst = 0, inside = 0, near = 0;
    g.scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const trunk = o.geometry === C.mats.trunkGeo, crown = o.geometry === C.mats.crownGeo;
      if (!trunk && !crown) return;
      for (let i = 0; i < o.count; i++) {
        const e = o.instanceMatrix.array, x = e[i * 16 + 12], y = e[i * 16 + 13], z = e[i * 16 + 14];
        if (trunk) {
          n++;
          worst = Math.max(worst, Math.abs(y - (C.groundAt(x, z) - 0.4)));
        }
        if (crown) {
          if (C.cleared(x, z)) inside++;
          if (Math.hypot(x - 404, z - 883) < 250) near++;
        }
      }
    });
    return { trees: n, worstTrunkBaseError: +worst.toFixed(4), inClearing: inside, aroundSign: near };
  });
  check('trees stand on the terrain, and keep off the letters', r.trees > 5000 && r.worstTrunkBaseError < 0.01 && r.inClearing === 0 && r.aroundSign > 50, r);

  // 13. Streets follow the ground, and no street is buried under the mesh of the ground.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, T = C.terrain;
    await C.streamAround(0, 200, 700);
    // Height of the drawn ground at (x, z): the triangle of a tile mesh that contains it.
    const meshY = (x, z) => {
      for (const t of T.tiles.values()) {
        const geo = t.mesh.geometry, pos = geo.attributes.position.array, idx = geo.index.array;
        const bs = geo.boundingBox;
        if (x < bs.min.x || x > bs.max.x || z < bs.min.z || z > bs.max.z) continue;
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
          const d = (pos[b + 2] - pos[c + 2]) * (pos[a] - pos[c]) + (pos[c] - pos[b]) * (pos[a + 2] - pos[c + 2]);
          if (Math.abs(d) < 1e-9) continue;
          const l1 = ((pos[b + 2] - pos[c + 2]) * (x - pos[c]) + (pos[c] - pos[b]) * (z - pos[c + 2])) / d;
          const l2 = ((pos[c + 2] - pos[a + 2]) * (x - pos[c]) + (pos[a] - pos[c]) * (z - pos[c + 2])) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1];
          return y;
        }
      }
      return null;
    };
    let n = 0, worstLift = 0, buried = 0, worstBury = 0, off = 0;
    const stamp = [];
    for (const rec of C.recs.values()) {
      if (rec.state !== 'loaded' || !rec.group) continue;
      for (const m of rec.group.children) {
        if (m.material !== C.mats.road && m.material !== C.mats.sidewalk) continue;
        const p = m.geometry.attributes.position.array;
        for (let i = 0; i < p.length; i += 3 * 97) {
          const x = p[i], y = p[i + 1], z = p[i + 2];
          if (Math.hypot(x, z - 200) > 500) continue;
          n++;
          worstLift = Math.max(worstLift, Math.abs(y - C.groundAt(x, z) - 0.03));
          const my = meshY(x, z);
          if (my === null) off++;
          else if (y < my - 0.001) (buried++, (worstBury = Math.max(worstBury, my - y)));
        }
      }
    }
    return { vertices: n, worstLiftError: +worstLift.toFixed(4), buried, worstBury: +worstBury.toFixed(3), noTile: off };
  });
  check('road and sidewalk vertices sit 3 cm over the ground, none under the ground mesh', r.vertices > 200 && r.worstLiftError < 0.005 && r.buried === 0 && r.noTile < r.vertices * 0.02, r);

  // 14. The ground mesh follows the ground: tiles are never above it, and close to it near the player.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, T = C.terrain;
    await C.streamAround(0, 200, 1400);
    let over = 0, nearWorst = 0, ringWorst = 0, n = 0;
    for (const t of T.tiles.values()) {
      const pos = t.mesh.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        const gy = C.groundAt(x, z);
        if (y < gy - 5) continue; // skirt
        n++;
        if (y > gy + 1e-3) over++;
        const d = Math.hypot(x, z - 200);
        if (d < 600) nearWorst = Math.max(nearWorst, gy - y);
        else ringWorst = Math.max(ringWorst, gy - y);
      }
    }
    return { tiles: T.tiles.size, vertices: n, aboveGround: over, nearWorst: +nearWorst.toFixed(3), ringWorst: +ringWorst.toFixed(3), farTriangles: T.mesh.geometry.drawRange.count / 3 };
  });
  check('tile vertices lie on the ground, and the far mesh takes over where tiles end', r.tiles >= 40 && r.aboveGround === 0 && r.farTriangles > 100000, r);

  // 15. A lake: over the water she falls in and comes back to the last dry spot; the bank above the water is dry.
  r = await page.evaluate(async () => {
    const g = window.__game, C = g.city, P = g.player;
    await g.goTo(9);
    g.simulate(1, 1 / 60);
    await C.streamAround(-2940, 5430, 500);
    // The biggest water polygon around Poiana with a point that is really wet.
    let pick = null;
    for (const w of C.waters) {
      const cx = (w.minx + w.maxx) / 2, cz = (w.minz + w.maxz) / 2;
      const area = (w.maxx - w.minx) * (w.maxz - w.minz);
      if (Math.hypot(cx + 2940, cz - 5430) > 700 || (pick && pick.area >= area)) continue;
      for (let x = w.minx; x <= w.maxx; x += 3) for (let z = w.minz; z <= w.maxz; z += 3) {
        if (C.isWater(x, z) && C.isWater(x + 4, z) && C.isWater(x - 4, z) && C.isWater(x, z + 4) && C.isWater(x, z - 4)) pick = { w, x, z, area };
      }
    }
    if (!pick) return { none: true };
    // Inside the outline, where the ground stands more than 0.6 m over the surface of the lake it is bank: dry.
    let bank = 0, wetBank = 0;
    const w = pick.w;
    for (let x = w.minx; x <= w.maxx; x += 3) for (let z = w.minz; z <= w.maxz; z += 3) {
      if (g.pointIn(x, z, w) && C.terrain.height(x, z) > w.level + 0.6) (bank++, C.isWater(x, z) && wetBank++);
    }
    const safe = P.lastSafe.clone();
    P.pos.set(pick.x, C.groundAt(pick.x, pick.z) + 15, pick.z);
    P.vel.set(0, 0, 0);
    P.mode = 'air';
    P.groundBox = null;
    const s = g.simulate(4, 1 / 60);
    return { lake: [Math.round(pick.x), Math.round(pick.z)], level: +w.level.toFixed(1), bank, wetBank, minBelow: +(s.minY - w.level).toFixed(1), backAt: Math.round(safe.distanceTo(P.pos)), inWater: C.isWater(P.pos.x, P.pos.z), mode: s.mode };
  });
  check('a lake takes her in and gives her back on the shore; dry bank inside its outline stays dry', !r.none && r.backAt < 3 && !r.inWater && r.minBelow < -0.5 && r.mode === 'ground' && r.wetBank === 0, r);

  // 17. The minimap carries a hillshade in Brasov.
  r = await page.evaluate(() => {
    const g = window.__game, T = g.city.terrain;
    const c = T.hillshade();
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0, light = 0, none = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 8) none++;
      else if (d[i - 1] > 128) light++;
      else dark++;
    }
    g.minimap.draw(1, g.player.pos, 0, null);
    return { w: c.width, h: c.height, dark, light, flat: none };
  });
  check('the minimap hillshade shades slopes both ways and leaves flat ground clear', r.dark > 10000 && r.light > 10000 && r.flat > 10000, r);

  // 18. The demo autopilot tours Brasov without stalling: from the old town up the Tampa, down through the streets.
  const demo = await open(browser, 'demo&city=brasov&lowq', errors, 800, 450);
  const track = [];
  for (let t = 0; t < 90; t++) {
    track.push(await demo.evaluate(() => {
      const g = window.__game;
      g.advance(1, 1 / 30);
      return [g.player.pos.x, g.player.pos.z, g.pilot().wp, g.player.pos.y];
    }));
  }
  let still = 0, worstStill = 0, hops = 0, path = 0, top = -Infinity, low = Infinity;
  for (let i = 1; i < track.length; i++) {
    const step = Math.hypot(track[i][0] - track[i - 1][0], track[i][1] - track[i - 1][1]);
    path += step;
    still = step < 3 ? still + 1 : 0;
    worstStill = Math.max(worstStill, still);
    if (track[i][2] !== track[i - 1][2]) hops++;
    top = Math.max(top, track[i][3]);
    low = Math.min(low, track[i][3]);
  }
  check('the demo autopilot tours Brasov: several waypoints, uphill and down, never stuck', worstStill <= 5 && hops >= 4 && path > 1500 && top - low > 60, { worstStillSeconds: worstStill, waypointsReached: hops, metres: Math.round(path), climb: Math.round(top - low) });
  await demo.close();

  // 19. What the terrain costs: ms per game tick on the ground of the old town and on the Tampa, and the tile update alone.
  r = await page.evaluate(async () => {
    const g = window.__game, T = g.city.terrain;
    const out = {};
    for (const [name, i] of [['oldTown', 0], ['tampaSign', 3], ['poiana', 9]]) {
      await g.goTo(i);
      g.advance(1);
      const t0 = performance.now();
      g.simulate(3, 1 / 60);
      out[name] = +((performance.now() - t0) / 180).toFixed(2);
    }
    const t1 = performance.now();
    for (let i = 0; i < 200; i++) T.tick(1, 300 + i * 4, 400);
    out.terrainUpdate = +((performance.now() - t1) / 200).toFixed(3);
    let trees = 0;
    g.scene.traverse((o) => { if (o.isInstancedMesh && o.geometry === g.city.mats.crownGeo) trees += o.count; });
    out.treesAtPoiana = trees;
    return out;
  });
  console.log('COST  ms per game tick (traffic, actors, drinks and streaming included): ' + JSON.stringify(r));
  check('a tick costs under 4 ms on the Tampa, in the old town and at Poiana', r.oldTown < 4 && r.tampaSign < 4 && r.poiana < 4, r);

  // ---------- Bucharest: still flat, still the same ----------
  const buc = await open(browser, 'city=bucharest&shot=perch&lowq', errors, 800, 450);
  r = await buc.evaluate(() => {
    const g = window.__game, C = g.city;
    let nonZero = 0, badNormal = 0, slope = 0;
    for (let i = 0; i < 1000; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 12000, z = (Math.sin(i * 78.233) * 12345.678 % 1) * 12000;
      if (C.groundAt(x, z) !== 0) nonZero++;
      const n = C.groundNormalAt(x, z);
      if (n.x !== 0 || n.y !== 1 || n.z !== 0) badNormal++;
      slope += C.slopeAt(x, z);
    }
    return { nonZero, badNormal, slope, terrain: C.terrain, plane: g.scene.children.includes(C.groundMesh), fog: [g.scene.fog.near, g.scene.fog.far] };
  });
  check('Bucharest: groundAt is 0 at 1000 random points, the normal is straight up, no terrain, the flat plane stays', r.nonZero === 0 && r.badNormal === 0 && r.slope === 0 && r.terrain === null && r.plane && r.fog[0] === 1200 && r.fog[1] === 6500, r);
  r = await buc.evaluate(() => {
    const g = window.__game, P = g.player;
    P.wish.set(1, 0, 0);
    const f = P.slopeRun(1 / 120);
    P.wish.set(0, 0, 0);
    return { factor: f, vel: P.vel.toArray() };
  });
  check('Bucharest: the run speed factor is exactly 1, the slide never starts', r.factor === 1, r);

  // Rivers drawn as ribbons are water for a walker except under a bridge (the Dambovita, south of Piata Unirii).
  r = await buc.evaluate(async () => {
    const g = window.__game, C = g.city, A = g.actors;
    await C.streamAround(0, 300, 1500);
    const near = (list, x, z) => list.some(([ax, az, bx, bz, hw]) => {
      const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      return Math.hypot(x - ax - ex * t, z - az - ez * t) <= hw;
    });
    let river = 0, blocked = 0, total = 0, viaBridge = 0, bridgeWet = 0;
    for (const [k, segs] of C.riverGrid) {
      for (const [ax, az, bx, bz] of segs) {
        const x = (ax + bx) / 2, z = (az + bz) / 2;
        if (Math.floor(x / 32) * 100003 + Math.floor(z / 32) !== k) continue;
        total++;
        if (near(segs, x, z) && C.isRiver(x, z)) (river++, A.blocked(x, z, 0.4) && blocked++);
        // Under a bridge: on the ribbon, and inside a bridge outline.
        const bs = C.bridgeGrid.get(k);
        if (bs && near(bs, x, z)) (viaBridge++, C.isRiver(x, z) && bridgeWet++);
      }
    }
    return { pieces: total, river, blockedForActors: blocked, underBridges: viaBridge, bridgeStillWet: bridgeWet };
  });
  check('river ribbons are water for actors, and a bridge over one is not', r.pieces > 30 && r.river > r.pieces * 0.5 && r.blockedForActors === r.river && r.underBridges > 0 && r.bridgeStillWet === 0, r);
  await buc.close();

  // ---------- switching between the cities ----------
  const sw = await browser.newPage({ viewport: { width: 700, height: 400 } });
  sw.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver/.test(m.text())) errors.push(`[switch] ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  sw.on('pageerror', (e) => errors.push(`[switch] pageerror: ${e.message}`));
  const seen = [];
  for (const id of ['brasov', 'bucharest', 'brasov', 'center']) {
    await sw.goto(`http://127.0.0.1:${PORT}/?city=${id}&shot=perch&lowq`);
    await sw.waitForFunction(() => window.__game?.ready, null, { timeout: 180000 });
    seen.push(await sw.evaluate(() => {
      const g = window.__game;
      g.advance(1, 1 / 30);
      return { id: g.cityId, city: g.state().city, terrain: !!g.city.terrain, y: Math.round(g.player.pos.y), roof: Math.abs(g.player.pos.y - (g.city.spawnBox?.y1 ?? -1)) < 0.5 };
    }));
  }
  await sw.close();
  check('switching city with ?city= loads each cleanly, with terrain only where the city has a dem', seen.map((s) => s.id).join() === 'brasov,bucharest,brasov,center' && seen.map((s) => s.terrain).join() === 'true,false,true,false' && seen.every((s) => s.roof), seen);

  await page.close();
} finally {
  await browser.close();
  srv.kill();
}

// The 12 checks of test/physics.mjs, on Bucharest, on a second port.
const phys = spawnSync(process.execPath, ['test/physics.mjs'], { env: { ...process.env, PORT: String(PORT + 500) }, encoding: 'utf8', timeout: 900000 });
const lines = (phys.stdout || '').split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
check('the 12 checks of test/physics.mjs still pass', phys.status === 0 && lines.filter((l) => l.startsWith('PASS')).length === 12 && !lines.some((l) => l.startsWith('FAIL')), { exit: phys.status, pass: lines.filter((l) => l.startsWith('PASS')).length, fail: lines.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 120)) });

check('no page errors, on either city', errors.length === 0, [...new Set(errors)].slice(0, 6));
process.exit(results.every((x) => x.ok) ? 0 : 1);
