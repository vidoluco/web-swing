// Scripted gameplay checks on the whole-Bucharest city in headless Chromium. Exit code 1 on any failure.
import { startServer, launch, open } from './harness.mjs';

const srv = await startServer();
const browser = await launch();
const errors = [];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
try {
  const page = await open(browser, 'shot=perch&lowq', errors, 800, 450);

  // 1. Spawn on the roof of the start tower.
  let r = await page.evaluate(() => {
    const g = window.__game;
    const s = g.simulate(0.5);
    return { ...s, roof: g.city.spawnBox.y1 };
  });
  check('spawn stands on the tower roof', r.mode === 'ground' && Math.abs(r.pos[1] - r.roof) < 0.2, r);

  // 2. Leap off towards the Parliament and keep swinging for 12 s.
  r = await page.evaluate(() => {
    const g = window.__game;
    g.look(g.city.spawnYaw, -0.2);
    g.setInput({ moveY: 1 });
    g.simulate(0.4);
    g.setInput({ moveY: 1, jumpPressed: true });
    g.simulate(1 / 60);
    g.setInput({ moveY: 1 });
    g.simulate(0.8);
    g.setInput({ moveY: 1, swing: true });
    const s = g.simulate(12);
    g.setInput(null);
    return s;
  });
  check('swinging reaches speed and never clips into buildings', r.modes.includes('swing') && r.maxSpeed > 25 && r.worstPenetration < 0.3 && !r.nan, r);

  // A mid-rise near the start with a long wall that opens onto free ground.
  const findWall = () => {
    const g = window.__game, P = g.pointIn;
    for (const b of g.city.prisms) {
      if (b.kind === 'prop' || b.y0 > 0.5 || b.y1 < 25 || b.y1 > 60 || b.holes.length) continue;
      if (Math.hypot((b.minx + b.maxx) / 2 - 300, (b.minz + b.maxz) / 2 + 300) > 900) continue;
      const o = b.outer;
      for (let i = 0; i < o.length; i += 2) {
        const ax = o[i], az = o[i + 1], bx = o[(i + 2) % o.length], bz = o[(i + 3) % o.length];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 18) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        for (const s of [1, -1]) {
          const nx = (s * (bz - az)) / L, nz = (-s * (bx - ax)) / L;
          if (!P(mx - nx, mz - nz, b) || P(mx + nx, mz + nz, b)) continue;
          // 30 m of open ground in front of the wall.
          let clear = true;
          for (let d = 1; d <= 30 && clear; d += 1) {
            const px = mx + nx * d, pz = mz + nz * d;
            if (g.city.isWater(px, pz) || g.city.nearby(px, pz, 2, []).some((q) => q !== b && P(px, pz, q))) clear = false;
          }
          if (clear) return { mx, mz, nx, nz, top: b.y1 };
        }
      }
    }
    return null;
  };

  // 3. Run into the wall, climb it and vault onto the roof.
  r = await page.evaluate((fw) => {
    const g = window.__game;
    const w = new Function(`return (${fw})()`)();
    if (!w) return { none: true };
    g.player.reset();
    g.player.pos.set(w.mx + w.nx * 4, 0, w.mz + w.nz * 4);
    g.player.groundBox = null;
    g.look(Math.atan2(w.nx, w.nz), -0.1);
    g.setInput({ moveY: 1 });
    // Keep pushing forward until standing on the roof (or give up after 10 s).
    const modes = new Set();
    let s, t = 0;
    for (; t < 10; t += 0.1) {
      s = g.simulate(0.1);
      s.modes.forEach((m) => modes.add(m));
      if (s.mode === 'ground' && Math.abs(s.pos[1] - w.top) < 0.6) break;
    }
    g.setInput(null);
    return { ...s, modes: [...modes], top: w.top, seconds: Math.round(t * 10) / 10 };
  }, findWall.toString());
  check('wall run climbs to the roof and vaults over', !r.none && r.modes.includes('wall') && Math.abs(r.pos[1] - r.top) < 0.6, r);

  // 4. Zip to an aimed point on the same facade from 25 m out.
  r = await page.evaluate((fw) => {
    const g = window.__game;
    const w = new Function(`return (${fw})()`)();
    g.player.reset();
    g.player.pos.set(w.mx + w.nx * 25, 0, w.mz + w.nz * 25);
    g.player.groundBox = null;
    g.look(Math.atan2(w.nx, w.nz), 0.35);
    g.advance(0.05);
    const before = g.player.pos.clone();
    g.setInput({ zipPressed: true });
    g.simulate(1 / 60);
    g.setInput({});
    const s = g.simulate(2.5);
    g.setInput(null);
    return { ...s, moved: Math.round(before.distanceTo(g.player.pos)) };
  }, findWall.toString());
  check('zip pulls the player to the aimed point', r.modes.includes('zip') && r.moved > 10, r);

  // 5. Travel to Herastrau: detailed chunks stream in there and the old ones stream out.
  r = await page.evaluate(async () => {
    const g = window.__game;
    await g.goTo(5);
    g.simulate(1.5);
    const recs = [...g.city.recs.values()];
    const loaded = recs.filter((x) => x.state === 'loaded');
    const far = loaded.filter((x) => x.dist > 2600).length;
    const home = g.city.recs.get('0_0').state;
    const here = g.city.recs.get(`${Math.floor(-1049 / 400)}_${Math.floor(-5167 / 400)}`).state;
    return { ...g.state(), loadedChunks: loaded.length, farLoaded: far, home, here };
  });
  check('streaming loads Herastrau and unloads Piata Unirii', r.here === 'loaded' && r.home === 'idle' && r.farLoaded === 0 && r.mode === 'ground', r);

  // 6. Falling into Herastrau lake puts you back where you last stood.
  r = await page.evaluate(() => {
    const g = window.__game;
    let wx = null, wz = null;
    for (let rad = 0; rad < 600 && wx === null; rad += 20)
      for (let a = 0; a < 6.28; a += 0.2) {
        const x = -1049 + Math.cos(a) * rad, z = -5167 + Math.sin(a) * rad;
        if (g.city.isWater(x, z) && g.city.isWater(x + 15, z) && g.city.isWater(x - 15, z) && g.city.isWater(x, z + 15) && g.city.isWater(x, z - 15)) {
          wx = x;
          wz = z;
          break;
        }
      }
    const safe = g.player.lastSafe.clone();
    g.player.pos.set(wx, 20, wz);
    g.player.vel.set(0, 0, 0);
    g.player.mode = 'air';
    g.player.groundBox = null;
    const s = g.simulate(4);
    return { ...s, lake: [Math.round(wx), Math.round(wz)], backAt: Math.round(safe.distanceTo(g.player.pos)), inWater: g.city.isWater(g.player.pos.x, g.player.pos.z) };
  });
  check('lake fall returns to the last safe spot', r.lake[0] !== null && r.backAt < 3 && !r.inWater && r.minY < 0, r);

  // 7. Touring all ten places keeps memory bounded and never errors.
  r = await page.evaluate(async () => {
    const g = window.__game;
    const seen = [];
    for (let i = 0; i < 10; i++) {
      await g.goTo(i);
      g.simulate(1.5);
      seen.push([i, g.state().loaded, g.city.prisms.length, g.player.mode]);
    }
    return { seen, maxPrisms: Math.max(...seen.map((x) => x[2])), maxLoaded: Math.max(...seen.map((x) => x[1])) };
  });
  check('tour of ten places keeps the city bounded', r.maxLoaded < 120 && r.maxPrisms < 40000 && r.seen.every((x) => x[3] === 'ground'), r);
  // 9-11. Traffic, stealing and driving a car, drinking at a real bar.
  const street = await open(browser, 'shot=street&lowq', errors, 800, 450);
  r = await street.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 8; i++) g.advance(1, 1 / 30);
    const cars = g.traffic.cars.filter((c) => c.mode === 'traffic');
    // Every car sits on its road: distance to the polyline within half the road plus a lane.
    let off = 0;
    for (const c of cars) {
      const p = c.road.pts;
      let best = Infinity;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], ex = p[i + 2] - ax, ez = p[i + 3] - az;
        const t = Math.max(0, Math.min(1, ((c.x - ax) * ex + (c.z - az) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(c.x - ax - ex * t, c.z - az - ez * t));
      }
      off = Math.max(off, best - c.road.w / 2);
    }
    return { cars: cars.length, moving: cars.filter((c) => c.speed > 1).length, worstOffRoad: Math.round(off * 10) / 10 };
  });
  check('traffic fills the streets and stays on its roads', r.cars >= 12 && r.moving >= r.cars / 3 && r.worstOffRoad < 2.5, r);

  r = await street.evaluate(() => {
    const g = window.__game, P = g.pointIn;
    const c = g.traffic.nearest(g.player.pos, 400);
    g.player.pos.set(c.x + Math.cos(c.yaw) * 2, 0, c.z - Math.sin(c.yaw) * 2);
    g.setInput({ carPressed: true });
    g.simulate(1 / 30, 1 / 30);
    const stolen = g.driving()?.type;
    g.setInput({ moveY: 1, moveX: 0.3 });
    let inside = 0, maxSpeed = 0;
    for (let t = 0; t < 8; t += 1 / 30) {
      g.simulate(1 / 30, 1 / 30);
      const d = g.driving();
      maxSpeed = Math.max(maxSpeed, d.speed);
      for (const b of g.city.nearby(d.x, d.z, 1, [])) if (b.kind !== 'prop' && b.y0 < 1.5 && P(d.x, d.z, b)) inside++;
    }
    g.setInput({ carPressed: true });
    g.simulate(1 / 30, 1 / 30);
    g.setInput(null);
    const s = g.simulate(0.5, 1 / 30);
    return { stolen, said: g.voice.lastLine, maxSpeed: Math.round(maxSpeed), framesInsideBuildings: inside, after: s.mode, heroVisible: g.hero.root.visible };
  });
  check('steal a car, drive it without entering buildings, get out', !!r.stolen && !!r.said && r.maxSpeed > 15 && r.framesInsideBuildings === 0 && r.after === 'ground' && r.heroVisible, r);

  r = await street.evaluate(() => {
    const g = window.__game;
    g.drinks.scanT = 0;
    g.simulate(0.1, 1 / 30);
    const it = g.drinks.list.find((x) => x.obj.visible && x.kind === 'tuica') || g.drinks.list.find((x) => x.obj.visible);
    const before = g.drunk.level;
    g.player.pos.set(it.x, 0, it.z);
    g.player.groundBox = null;
    g.simulate(0.2, 1 / 30);
    return { kind: it.kind, place: it.poi.name, before, after: g.drunk.level, said: g.voice.lastLine };
  });
  check('drinking at a bar makes you drunk and he says something', r.after > r.before && !!r.said, r);

  // 8. The demo autopilot keeps travelling: never circles in place, reaches several waypoints.
  const demo = await open(browser, 'demo&lowq', errors, 800, 450);
  const track = [];
  for (let t = 0; t < 70; t++) {
    track.push(await demo.evaluate(() => {
      const g = window.__game;
      g.advance(1, 1 / 30);
      return [g.player.pos.x, g.player.pos.z, g.pilot().wp];
    }));
    await new Promise((ok) => setTimeout(ok, 30));
  }
  let still = 0, worst = 0, hops = 0, path = 0;
  for (let i = 1; i < track.length; i++) {
    const step = Math.hypot(track[i][0] - track[i - 1][0], track[i][1] - track[i - 1][1]);
    path += step;
    still = step < 4 ? still + 1 : 0;
    worst = Math.max(worst, still);
    if (track[i][2] !== track[i - 1][2]) hops++;
  }
  check('demo autopilot never stalls and keeps travelling', worst <= 4 && hops >= 1 && path > 1500, { worstStillSeconds: worst, waypointsReached: hops, metres: Math.round(path), end: track.at(-1).map((v) => Math.round(v)) });
} finally {
  await browser.close();
  srv.kill();
}
check('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
process.exit(results.every((x) => x.ok) ? 0 : 1);
