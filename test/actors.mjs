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

  // 3. A building in the way: the actor goes round it and never inside.
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    // A small isolated block: nothing else within 25 m of its outline, open ground on both sides.
    let pick = null;
    for (const b of g.city.prisms) {
      if (b.kind === 'prop' || b.y0 > 0.5 || b.holes.length) continue;
      const w = b.maxx - b.minx, d = b.maxz - b.minz;
      if (w < 8 || w > 30 || d < 8 || d > 30) continue;
      if (Math.hypot((b.minx + b.maxx) / 2, (b.minz + b.maxz) / 2) > 900) continue;
      const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2;
      const ax = b.minx - 8, bx = b.maxx + 8;
      if (A.blocked(ax, cz, 0.6) || A.blocked(bx, cz, 0.6)) continue;
      // The corridor round the block has to be free: 6 m out from each corner.
      if ([[b.minx - 6, b.minz - 6], [b.maxx + 6, b.minz - 6], [b.minx - 6, b.maxz + 6], [b.maxx + 6, b.maxz + 6]].some(([x, z]) => A.blocked(x, z, 0.6))) continue;
      if (!g.pointIn(cx, cz, b)) continue;
      pick = { b, cx, cz, ax, bx };
      break;
    }
    if (!pick) return { skipped: 'no isolated block' };
    T.stand(pick.ax, pick.cz - 6);
    T.tick(3);
    const a = A.spawn('civilian', { x: pick.ax, z: pick.cz }, { exact: true, yaw: Math.PI / 2 });
    A.walkTo(a, pick.bx, pick.cz, 1.6);
    let inside = 0, t = 0, maxDetour = 0;
    while (t < 90 && a.hasGoal) {
      T.tick(1);
      t += 1 / 30;
      if (T.inside(a) > 0) inside++;
      maxDetour = Math.max(maxDetour, Math.abs(a.pos.z - pick.cz));
    }
    const res = { seconds: +t.toFixed(1), left: +Math.hypot(a.pos.x - pick.bx, a.pos.z - pick.cz).toFixed(2), inside, detour: +maxDetour.toFixed(1), block: [+(pick.b.maxx - pick.b.minx).toFixed(0), +(pick.b.maxz - pick.b.minz).toFixed(0)] };
    a.remove();
    return res;
  });
  check('a block between the actor and its goal is walked round, never entered', r.skipped || (r.inside === 0 && r.detour > 3), r);

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

  // 7. The cost of 120 actors around the player, per game tick (no rendering).
  r = await page.evaluate(() => {
    const g = window.__game, A = g.actors, T = window.__t;
    const s = T.streets(0, 0, 900).find((x) => x.tight > 8) || T.streets(0, 0, 900)[0];
    T.stand((s.ax + s.bx) / 2, (s.az + s.bz) / 2);
    A.clear();
    T.tick(30);
    const time = (label, n) => {
      const t0 = performance.now();
      g.simulate(n / 60, 1 / 60);
      return +((performance.now() - t0) / n).toFixed(3);
    };
    const base = time('base', 240);
    // 120 actors: a third within 60 m, the rest out to 160 m, of every kind, all on the move.
    const c = g.player.pos;
    const mix = ['civilian', 'civilian', 'civilian', 'civilian', 'civilian', 'thug', 'cop', 'dog', 'civilian', 'bear'];
    let n = 0;
    for (let i = 0; i < 400 && n < 120; i++) {
      const d = i % 3 === 0 ? 50 : 150;
      const p = A.randomWalkPoint(c, d);
      if (Math.hypot(p.x - c.x, p.z - c.z) < 6) continue;
      if (A.spawn(mix[n % mix.length], p)) n++;
    }
    T.crowd();
    const stats = A.stats();
    // Update alone, to see what the actors cost inside the tick.
    const u0 = performance.now();
    for (let i = 0; i < 240; i++) {
      if (i % 30 === 0) T.crowd();
      A.update(1 / 60, g.player);
    }
    const updateOnly = +((performance.now() - u0) / 240).toFixed(3);
    const withActors = time('with', 240);
    return { actors: n, stats, tickWithoutActors: base, tickWithActors: withActors, actorsShare: +(withActors - base).toFixed(3), actorUpdateOnly: updateOnly };
  });
  console.log('COST', JSON.stringify(r));
  check('120 actors: cost per game tick reported, actors add under 3 ms', r.actors === 120 && r.tickWithActors - r.tickWithoutActors < 3, r);

  const errs = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
  check('no page errors', errs.length === 0, errs);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
