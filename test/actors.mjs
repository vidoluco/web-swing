// People, cops, dogs and bears: the five kinds, walking a street without touching a building or
// the water, the state machine, pooling and culling, a crowd screenshot and the cost of 120 actors
// per game tick. Usage: PORT=5212 node test/actors.mjs   (exit code 1 on any failure)
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
  const page = await open(browser, 'shot=street', errors);

  // Helpers that live in the page.
  await page.evaluate(() => {
    const g = window.__game, A = g.actors;
    const T = (window.__t = {});
    T.tick = (n, step = 1 / 30) => {
      for (let i = 0; i < n; i++) g.simulate(step, step);
    };
    T.stand = (x, z) => {
      g.player.reset();
      g.player.pos.set(x, 0, z);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
    };
    // Streets a sidewalk walk of 40 m can follow: [start, goal] beside a road, clear of buildings,
    // the ones with walls close by first.
    T.streets = (cx, cz, R) => {
      const out = [];
      for (const c of g.city.mmCells.values()) {
        for (const r of c.r) {
          if (r.cls !== 'road' || r.w < 6 || r.w > 16) continue;
          const p = r.pts;
          for (let i = 0; i + 3 < p.length; i += 2) {
            const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
            if (L < 46 || Math.hypot((p[i] + p[i + 2]) / 2 - cx, (p[i + 1] + p[i + 3]) / 2 - cz) > R) continue;
            const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L;
            for (const side of [1, -1]) {
              const off = r.w / 2 + (r.major ? 2 : 1.3);
              const nx = -dz * side, nz = dx * side;
              const ax = p[i] + dx * 3 + nx * off, az = p[i + 1] + dz * 3 + nz * off;
              let free = true, tight = 0;
              for (let d = 0; d <= 40 && free; d++) {
                if (A.blocked(ax + dx * d, az + dz * d, 0.4)) free = false;
                else if (A.blocked(ax + dx * d, az + dz * d, 2.5)) tight++;
              }
              if (free) out.push({ ax, az, bx: ax + dx * 40, bz: az + dz * 40, tight, w: r.w });
            }
          }
        }
      }
      return out.sort((a, b) => b.tight - a.tight);
    };
    // Depth an actor is inside any ground-level footprint (m), and whether it stands in water.
    T.inside = (a) => {
      let worst = 0;
      for (const b of g.city.nearby(a.pos.x, a.pos.z, 2, [])) {
        if (b.kind === 'prop' || b.y0 > 2.5 || b.y1 < 0.9 || !g.pointIn(a.pos.x, a.pos.z, b)) continue;
        worst = Math.max(worst, 0.01);
      }
      return worst;
    };
  });

  // 1. The five kinds spawn, stand on the ground and have the contract's fields.
  let r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    const s = T.streets(0, 0, 900)[0];
    T.stand(s.ax, s.az);
    T.tick(3);
    const out = {};
    for (const k of ['thug', 'cop', 'civilian', 'dog', 'bear']) {
      const a = A.spawn(k, { x: s.ax + 2, z: s.az + 2 });
      out[k] = a && { id: a.id, hp: a.hp, maxHp: a.maxHp, state: a.state, y: a.pos.y, radius: a.radius, height: +a.height.toFixed(2), tied: a.tied, mesh: !!a.mesh, fields: ['pos', 'vel', 'yaw', 'stunT', 'hit', 'stun', 'tie', 'remove'].every((f) => f in a) };
    }
    A.clear();
    return out;
  });
  check(
    'each kind spawns with the contract fields',
    Object.values(r).every((a) => a && a.state === 'idle' && a.hp === a.maxHp && a.hp > 0 && a.y === 0 && a.mesh && a.fields && !a.tied),
    r,
  );

  // 1b. randomWalkPoint: pavements, footways and squares, never a carriageway, never a building.
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors;
    const roads = [];
    for (const c of g.city.mmCells.values()) for (const rd of c.r) if (rd.cls === 'road') roads.push(rd);
    const onRoad = (x, z) => {
      for (const rd of roads) {
        const p = rd.pts;
        for (let i = 0; i + 3 < p.length; i += 2) {
          const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / L2));
          if (Math.hypot(x - p[i] - dx * t, z - p[i + 1] - dz * t) < rd.w / 2 - 0.3) return true;
        }
      }
      return false;
    };
    let n = 0, on = 0, blocked = 0, far = 0;
    const t0 = performance.now();
    const pts = [];
    for (const c of [{ x: 0, z: 0 }, { x: -300, z: 12 }, { x: 400, z: -200 }, { x: -700, z: -500 }]) {
      for (let i = 0; i < 100; i++) {
        const p = A.randomWalkPoint(c, 60);
        pts.push(p);
        if (Math.hypot(p.x - c.x, p.z - c.z) > 60.01) far++;
      }
    }
    const ms = (performance.now() - t0) / pts.length;
    for (const p of pts) {
      n++;
      if (onRoad(p.x, p.z)) on++;
      if (A.blocked(p.x, p.z, 0.3)) blocked++;
    }
    return { n, onCarriageway: on, inBuildingOrWater: blocked, outsideRadius: far, msPerCall: +ms.toFixed(3) };
  });
  check('random walk points lie on pavements and footways, not on the road or in a building', r.n === 400 && r.onCarriageway === 0 && r.inBuildingOrWater === 0 && r.outsideRadius === 0, r);

  // 2. Walk 40 m along a street beside the buildings, every kind.
  const kinds = [['thug', 5.4], ['cop', 5.2], ['civilian', 1.35], ['dog', 6.8], ['bear', 1.5]];
  for (const [kind, speed] of kinds) {
    r = await page.evaluate(
      ([kind, speed]) => {
        const g = window.__game, A = g.actors, T = window.__t;
        const st = T.streets(0, 0, 900);
        const s = st[Math.min(st.length - 1, 0)];
        T.stand(s.ax, s.az - 4);
        T.tick(2);
        const a = A.spawn(kind, { x: s.ax, z: s.az }, { exact: true, yaw: Math.atan2(s.bx - s.ax, s.bz - s.az) });
        A.walkTo(a, s.bx, s.bz, speed);
        const states = new Set();
        let inside = 0, water = 0, path = 0, t = 0;
        let px = a.pos.x, pz = a.pos.z;
        while (t < 90 && a.hasGoal) {
          T.tick(1);
          t += 1 / 30;
          states.add(a.state);
          if (T.inside(a) > 0) inside++;
          if (g.city.isWater(a.pos.x, a.pos.z)) water++;
          path += Math.hypot(a.pos.x - px, a.pos.z - pz);
          (px = a.pos.x), (pz = a.pos.z);
        }
        T.tick(10);
        const res = { kind, speed, seconds: +t.toFixed(1), left: +Math.hypot(a.pos.x - s.bx, a.pos.z - s.bz).toFixed(2), path: +path.toFixed(1), inside, water, states: [...states], end: a.state, tight: s.tight, w: s.w };
        a.remove();
        return res;
      },
      [kind, speed],
    );
    check(
      `${kind} walks 40 m along a street without a building or the water`,
      r.left < 1.5 && r.inside === 0 && r.water === 0 && r.path > 38 && r.path < 60 && r.states.includes(speed > (kind === 'dog' ? 3 : kind === 'bear' ? 3.2 : 2.6) ? 'run' : 'walk') && r.end === 'idle',
      r,
    );
  }

  // 3. A building in the way: eight blocks across the city, each between the actor and its goal.
  // Every one is walked round without a step inside it; most are reached (a few sit in courtyards
  // the planner's window cannot get out of).
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    const picks = [];
    for (const b of g.city.prisms) {
      if (b.kind === 'prop' || b.y0 > 0.5 || b.holes.length) continue;
      const w = b.maxx - b.minx, d = b.maxz - b.minz;
      if (w < 8 || w > 60 || d < 8 || d > 60 || Math.hypot((b.minx + b.maxx) / 2, (b.minz + b.maxz) / 2) > 900) continue;
      const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2;
      if (A.blocked(b.minx - 8, cz, 0.6) || A.blocked(b.maxx + 8, cz, 0.6) || !g.pointIn(cx, cz, b)) continue;
      picks.push({ b, cx, cz, ax: b.minx - 8, bx: b.maxx + 8 });
    }
    picks.sort((p, q) => p.cx - q.cx || p.cz - q.cz);
    const out = [];
    for (const pick of picks.filter((_, i) => i % 15 === 0).slice(0, 8)) {
      T.stand(pick.ax, pick.cz - 6);
      T.tick(3);
      const a = A.spawn('civilian', { x: pick.ax, z: pick.cz }, { exact: true, yaw: Math.PI / 2 });
      A.walkTo(a, pick.bx, pick.cz, 1.6);
      let inside = 0, t = 0, detour = 0;
      while (t < 120 && a.hasGoal) {
        T.tick(1);
        t += 1 / 30;
        if (T.inside(a) > 0) inside++;
        detour = Math.max(detour, Math.abs(a.pos.z - pick.cz));
      }
      out.push({ size: [Math.round(pick.b.maxx - pick.b.minx), Math.round(pick.b.maxz - pick.b.minz)], seconds: +t.toFixed(0), left: +Math.hypot(a.pos.x - pick.bx, a.pos.z - pick.cz).toFixed(1), inside, detour: +detour.toFixed(0) });
      a.remove();
    }
    return { blocks: out, reached: out.filter((o) => o.left < 1.5).length, inside: out.reduce((n, o) => n + o.inside, 0) };
  });
  check('blocks in the way are walked round, never entered', r.blocks.length === 8 && r.inside === 0 && r.reached >= 6, r);

  // 4. The state machine: stun, tie, hit until down, then gone.
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    const s = T.streets(0, 0, 900)[0];
    T.stand(s.ax, s.az - 4);
    T.tick(2);
    const log = [];
    A.events = { emit: (n, p) => log.push([n, (p.actor || p.target).id, p.dmg]) };
    const head = (a) => a.rig.bones[5].matrixWorld.elements[13];
    const out = {};
    const a = A.spawn('civilian', { x: s.ax, z: s.az }, { exact: true });
    out.spawn = a.state;
    A.walkTo(a, s.bx, s.bz, 1.4);
    T.tick(6);
    out.walking = a.state;
    out.stunOk = a.stun(1.0);
    out.stunned = [a.state, +a.stunT.toFixed(2)];
    out.walkWhileStunned = A.walkTo(a, s.bx, s.bz, 1.4);
    T.tick(15);
    out.midStun = a.state;
    T.tick(20);
    out.afterStun = [a.state, a.speed];
    out.headStanding = +head(a).toFixed(2);
    out.tieOk = a.tie();
    out.tied = [a.state, a.tied];
    out.walkWhileTied = A.walkTo(a, s.bx, s.bz, 1.4);
    out.tieAgain = a.tie();
    T.tick(90);
    out.stillTied = a.state;
    out.stunTied = a.stun(1);
    a.remove();
    // A thug goes down in three hits.
    const t = A.spawn('thug', { x: s.ax, z: s.az }, { exact: true });
    out.hp = [t.hp];
    A.walkTo(t, s.bx, s.bz, 5.4);
    T.tick(15);
    out.runningState = t.state;
    for (let i = 0; i < 3; i++) {
      t.hit(25, 'test');
      out.hp.push(t.hp, t.state);
    }
    out.hitAfterDown = t.hit(10, 'test');
    T.tick(30);
    out.headDown = +head(t).toFixed(2);
    out.walkWhileDown = A.walkTo(t, s.bx, s.bz, 1);
    T.tick(30 * 6);
    out.removed = [t.removed, A.list.includes(t)];
    out.events = log.map((e) => e.join(':')).join(' ');
    A.events = null;
    return out;
  });
  check(
    'state machine: idle, walk, stunned, tied, down, removed',
    r.spawn === 'idle' && r.walking === 'walk' && r.stunOk && r.stunned[0] === 'stunned' && r.stunned[1] === 1 && !r.walkWhileStunned && r.midStun === 'stunned' && r.afterStun[0] === 'idle' && r.afterStun[1] === 0 &&
      r.tieOk && r.tied[0] === 'tied' && r.tied[1] && !r.walkWhileTied && !r.tieAgain && r.stillTied === 'tied' && !r.stunTied &&
      r.hp.join() === '60,35,run,10,run,0,down' && r.runningState === 'run' && !r.hitAfterDown && r.headStanding > 1.3 && r.headDown < 0.6 && !r.walkWhileDown && r.removed.join() === 'true,false',
    r,
  );
  check(
    'hit, actor:down and actor:tied reach the event bus',
    /^actor:tied:\d+: hit:\d+:25 hit:\d+:25 hit:\d+:25 actor:down:\d+:$/.test(r.events),
    r.events,
  );

  // 5. Pooling, the cap and the distance cull.
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    const s = T.streets(0, 0, 900)[0];
    T.stand(s.ax, s.az - 4);
    T.tick(2);
    A.clear();
    const out = {};
    const a = A.spawn('civilian', { x: s.ax, z: s.az });
    const rigs = A.stat.rigs;
    a.remove();
    A.spawn('cop', { x: s.ax, z: s.az });
    A.spawn('thug', { x: s.ax + 3, z: s.az });
    out.reusedRig = [rigs, A.stat.rigs];
    A.clear();
    // Cap: with max=4 the fifth spawn near the player fails while nobody is far away.
    const max = A.max;
    A.max = 4;
    for (let i = 0; i < 4; i++) A.spawn('civilian', { x: s.ax + i * 3, z: s.az }, { persist: false });
    out.capNear = A.spawn('civilian', { x: s.ax + 20, z: s.az }) === null;
    // A far one is evicted for a nearer newcomer.
    A.clear();
    const far = A.spawn('civilian', { x: s.ax + 300, z: s.az }, { exact: true });
    for (let i = 0; i < 3; i++) A.spawn('civilian', { x: s.ax + i * 3, z: s.az });
    const near = A.spawn('civilian', { x: s.ax + 12, z: s.az });
    out.evictedFar = far.removed && !!near;
    A.max = max;
    A.clear();
    // Cull beyond 420 m unless persistent.
    const c1 = A.spawn('civilian', { x: s.ax + 600, z: s.az }, { exact: true });
    const c2 = A.spawn('civilian', { x: s.ax + 600, z: s.az + 5 }, { exact: true, persist: true });
    T.tick(2);
    out.culled = [c1.removed, c2.removed];
    const h1 = A.spawn('civilian', { x: s.ax + 200, z: s.az }, { exact: true });
    T.tick(2);
    out.hiddenBeyond160 = [h1.mesh.parent === null, h1.removed];
    A.clear();
    return out;
  });
  check('pooled rigs are reused, the cap evicts the far, the cull spares the persistent', r.reusedRig[1] === r.reusedRig[0] && r.capNear && r.evictedFar && r.culled.join() === 'true,false' && r.hiddenBeyond160.join() === 'true,false', r);

  // 6. A crowd on a street, then a look at it.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, T = window.__t;
    const s = T.streets(0, 0, 900).find((x) => x.tight > 8) || T.streets(0, 0, 900)[0];
    const yaw = Math.atan2(s.bx - s.ax, s.bz - s.az);
    T.stand(s.ax - Math.sin(yaw) * 14, s.az - Math.cos(yaw) * 14);
    T.tick(2);
    A.clear();
    const mix = ['civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'thug', 'cop', 'civilian', 'dog', 'civilian'];
    const c = { x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2 };
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const p = A.randomWalkPoint(c, 26);
      const a = A.spawn(mix[i % mix.length], p);
      if (a) n++;
    }
    T.crowd = () => {
      for (const a of A.list) if (!a.hasGoal && a.state === 'idle') A.walkTo(a, ...Object.values(A.randomWalkPoint(a.pos, 30)), a.speedWalk);
    };
    for (let i = 0; i < 8; i++) {
      T.crowd();
      T.tick(30);
    }
    // Eye height on the pavement, a few metres behind the start of the street, looking along it.
    const ex = s.ax - Math.sin(yaw) * 5 + Math.cos(yaw) * 1.5, ez = s.az - Math.cos(yaw) * 5 - Math.sin(yaw) * 1.5;
    g.aerial(ex, 1.7, ez, ex + Math.sin(yaw) * 30, ez + Math.cos(yaw) * 30);
    return { spawned: n, stats: A.stats() };
  });
  check('a crowd of 60 spawns on the pavements and keeps walking', r.spawned >= 55 && r.stats.byState.walk + (r.stats.byState.run || 0) > 25, r);
  await page.evaluate(() => window.__game.advance(0.05));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/actors-crowd.png' });

  // 7. The cost of 120 actors around the player: per game tick (no rendering), then per rendered
  // frame. The baseline is the same scene with the actors switched off, three rounds each, median.
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    const s = T.streets(0, 0, 900).find((x) => x.tight > 8) || T.streets(0, 0, 900)[0];
    T.stand((s.ax + s.bx) / 2, (s.az + s.bz) / 2);
    A.clear();
    T.tick(30);
    // 120 actors: a third within 50 m, the rest out to 150 m, of every kind, all on the move.
    const c = g.player.pos;
    const mix = ['civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'thug', 'cop', 'dog', 'civilian', 'bear'];
    let n = 0;
    for (let i = 0; i < 400 && n < 120; i++) {
      const p = A.randomWalkPoint(c, i % 3 === 0 ? 50 : 150);
      if (Math.hypot(p.x - c.x, p.z - c.z) < 6) continue;
      if (A.spawn(mix[n % mix.length], p)) n++;
    }
    for (let i = 0; i < 6; i++) {
      T.crowd();
      T.tick(30);
    }
    const stats = A.stats();
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    const noop = () => {};
    const off = (on) => {
      if (on) delete A.update;
      else A.update = noop;
      for (const a of A.list) a.mesh.visible = on;
    };
    const tick = () => {
      T.crowd();
      const t0 = performance.now();
      g.simulate(4, 1 / 60);
      return (performance.now() - t0) / 240;
    };
    const frame = () => {
      T.crowd();
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) g.advance(1 / 60, 1 / 60);
      return (performance.now() - t0) / 30;
    };
    const res = { tick: { on: [], off: [] }, frame: { on: [], off: [] } };
    for (let round = 0; round < 3; round++) {
      for (const on of [false, true]) {
        off(on);
        res.tick[on ? 'on' : 'off'].push(tick());
        res.frame[on ? 'on' : 'off'].push(frame());
      }
    }
    off(true);
    const f = (v) => +med(v).toFixed(2);
    const out = { actors: n, stats, tickMsWithout: f(res.tick.off), tickMsWith: f(res.tick.on), frameMsWithout: f(res.frame.off), frameMsWith: f(res.frame.on) };
    out.tickMsActors = +(out.tickMsWith - out.tickMsWithout).toFixed(2);
    out.frameMsActors = +(out.frameMsWith - out.frameMsWithout).toFixed(2);
    return out;
  });
  console.log('COST per game tick (no render) and per rendered frame (tick + draw submit, GPU shared), ms:', JSON.stringify(r));
  check('120 actors: cost reported, the actors add under 3 ms to a game tick', r.actors === 120 && r.tickMsActors < 3, r);

  // 8. Water: a pond between the actor and its goal. Crossings 25 to 100 m of water wide are tried
  // until one has a way round inside the planner's window (checked with a flood fill on the real
  // outlines); the actor has to find it and never put a foot in the water.
  r = await page.evaluate(async () => {
    const g = window.__game, A = g.actors, T = window.__t;
    A.clear();
    // Cismigiu and its neighbours, loaded on purpose so the same water is there on every run.
    await g.city.streamAround(-900, -1200, 500);
    const reachable = (ax, az, bx, bz) => {
      const cx = (ax + bx) / 2, cz = (az + bz) / 2, seen = new Set(['0,0']), q = [[0, 0]];
      while (q.length) {
        const [i, j] = q.shift();
        if (Math.hypot(ax + i - bx, az + j - bz) < 1.5) return true;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const ni = i + di, nj = j + dj, k = ni + ',' + nj;
          if (seen.has(k) || Math.abs(ax + ni - cx) > 46 || Math.abs(az + nj - cz) > 46) continue;
          seen.add(k);
          if (!A.blocked(ax + ni, az + nj, 0.6)) q.push([ni, nj]);
        }
      }
      return false;
    };
    let best = null, tried = 0;
    const lakes = g.city.waters.filter((w) => Math.hypot((w.minx + w.maxx) / 2 + 900, (w.minz + w.maxz) / 2 + 1200) < 500);
    for (const w of lakes.sort((p, q) => p.minx - q.minx || p.minz - q.minz)) {
      if (best || w.maxx - w.minx < 25) continue;
      for (let z = w.minz + 15; z < w.maxz - 15 && !best; z += 8) {
        let run = 0, start = 0, top = { len: 0 };
        for (let x = w.minx - 10; x < w.maxx + 10; x++) {
          if (g.city.isWater(x, z)) (run || (start = x)), run++;
          else {
            if (run > top.len) top = { len: run, x0: start, x1: x };
            run = 0;
          }
        }
        if (top.len < 25 || top.len > 100 || A.blocked(top.x0 - 5, z, 0.6) || A.blocked(top.x1 + 5, z, 0.6)) continue;
        tried++;
        if (reachable(top.x0 - 5, z, top.x1 + 5, z)) best = { ...top, z };
      }
    }
    if (!best) return { skipped: 'no pond with a way round', tried };
    T.stand(best.x0 - 5, best.z);
    g.simulate(0.5, 1 / 30);
    const a = A.spawn('civilian', { x: best.x0 - 5, z: best.z }, { exact: true, yaw: Math.PI / 2 });
    A.walkTo(a, best.x1 + 5, best.z, 1.6);
    let water = 0, t = 0, inside = 0;
    const start = Math.hypot(a.pos.x - (best.x1 + 5), a.pos.z - best.z);
    while (t < 150 && a.hasGoal) {
      g.simulate(1 / 30, 1 / 30);
      t += 1 / 30;
      if (g.city.isWater(a.pos.x, a.pos.z)) water++;
      if (T.inside(a) > 0) inside++;
    }
    return { pond: Math.round(best.len), at: [Math.round(best.x0), Math.round(best.z)], tried, seconds: +t.toFixed(1), water, inside, startDistance: Math.round(start), left: +Math.hypot(a.pos.x - (best.x1 + 5), a.pos.z - best.z).toFixed(1), plans: a.plans, planWhy: a.planWhy, state: a.state };
  });
  check('a pond between the actor and its goal is walked round, never entered', !r.skipped && r.water === 0 && r.inside === 0 && r.left < 1.5, r);

  const errs = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
  check('no page errors', errs.length === 0, errs);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
