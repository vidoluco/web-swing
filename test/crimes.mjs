// Random crimes (src/crimes.js): scippo, rapina and fuga spawn 300 to 600 m away on real ground and
// show on the minimap, each is solved in the way it is meant to be and pays once, and the ones
// nobody solves expire after 3 minutes. Usage: PORT=5224 node test/crimes.mjs   (exit code 1 on any failure)
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
  const cr = g.systems.get('crimes');
  cr.auto = false;
  const T = (window.__t = {});
  T.g = g;
  T.cr = cr;
  T.sim = (s) => g.simulate(s, 1 / 30);
  T.stand = (x, z) => {
    g.player.reset();
    g.player.pos.set(x, 0, z);
    g.player.groundBox = null;
    g.player.vel.set(0, 0, 0);
  };
  // Every event of these names, with the game time it came at.
  T.log = [];
  for (const n of ['crime:start', 'crime:end', 'crime:solved', 'respect']) g.events.on(n, (e) => T.log.push({ n, t: g.time, ...e }));
  T.count = (n, id) => T.log.filter((e) => e.n === n && (id === undefined || e.id === id)).length;
  T.respect = () => T.log.filter((e) => e.n === 'respect').reduce((s, e) => s + e.amount, 0);
  // Ends whatever is running and clears the people.
  T.reset = () => {
    for (const c of [...cr.list]) cr.end(c, 'failed', 'test');
    for (const e of cr.epilogues.splice(0)) e.dispose();
    for (const c of g.traffic.cars.filter((x) => x.mode === 'flee')) g.traffic.remove(c);
    g.actors.clear();
    T.log.length = 0;
    g.minimap.setMarkers('crimes', []);
  };
  // Places to drink in the loaded part of the city, nearest to the origin first.
  T.pois = [];
  for (const rec of g.city.recs.values()) if (rec.state === 'loaded' && rec.pois) T.pois.push(...rec.pois);
  T.pois = T.pois.filter((q) => Math.hypot(q.x, q.z) < 1000 && q.kind === 1).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  // A crime of `kind` built round the player: spawned 60 to 90 m off, then Bunica walks up to it.
  // A rapina needs a real place, so Bunica starts 75 m from the n-th kiosk.
  T.live = (kind, n = 0) => {
    if (kind === 'rapina') T.stand(T.pois[n].x + 75, T.pois[n].z);
    else T.stand(-300, 12);
    const c = cr.spawn(kind, { range: [60, 90] });
    T.stand(c.x - 8, c.z - 8);
    T.sim(0.5);
    return c;
  };
};

try {
  let page = await open(browser, 'shot=street&lowq&seed=11&cars=12', errors);
  await page.evaluate(SETUP);
  // The machine can be short of memory (other jobs share it) and drop the page: open it again once and redo the check.
  const run = async (fn, arg) => {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/crashed|closed/i.test(e.message)) throw e;
      console.log('page dropped, opening it again:', e.message.split('\n')[0]);
      await page.close().catch(() => {});
      page = await open(browser, 'shot=street&lowq&seed=11&cars=12', errors);
      await page.evaluate(SETUP);
      return page.evaluate(fn, arg);
    }
  };

  // 1. Each kind spawns 300 to 600 m from Bunica, on ground that is free, with a red marker.
  let r = await run(() => {
    const { g, cr, sim, stand } = window.__t;
    const T = window.__t, A = g.actors;
    const spots = [[-300, 12], [0, 0], [300, -300], [-600, -500], [500, 400], [100, 700]];
    const out = { made: 0, tries: 0, far: 0, blocked: 0, water: 0, noMarker: 0, notRed: 0, kinds: {}, offRoad: 0, offPoi: 0 };
    const pois = [];
    for (const rec of g.city.recs.values()) if (rec.state === 'loaded' && rec.pois) pois.push(...rec.pois);
    for (const kind of ['scippo', 'rapina', 'fuga']) {
      for (const [x, z] of spots) {
        stand(x, z);
        out.tries++;
        const c = cr.spawn(kind);
        if (!c) continue;
        out.made++;
        out.kinds[kind] = (out.kinds[kind] || 0) + 1;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < 300 || d > 600) out.far++;
        if (A.blocked(c.x, c.z, 0.4)) out.blocked++;
        if (g.city.isWater(c.x, c.z)) out.water++;
        const m = g.minimap.markers.get('crimes')?.find((k) => Math.abs(k.x - c.x) < 0.01 && Math.abs(k.z - c.z) < 0.01);
        if (!m) out.noMarker++;
        else if (m.color !== '#ff2b2b') out.notRed++;
        if (kind === 'rapina' && !pois.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 0.5)) out.offPoi++;
        if (kind === 'fuga') {
          // On a road: within 1 m of a segment of a loaded drivable road.
          let best = 9;
          for (const rec of g.city.recs.values()) for (const rd of rec.roads || []) for (let i = 0; i + 3 < rd.pts.length; i += 2) {
            const ex = rd.pts[i + 2] - rd.pts[i], ez = rd.pts[i + 3] - rd.pts[i + 1], t = Math.max(0, Math.min(1, ((c.x - rd.pts[i]) * ex + (c.z - rd.pts[i + 1]) * ez) / (ex * ex + ez * ez || 1)));
            best = Math.min(best, Math.hypot(c.x - rd.pts[i] - ex * t, c.z - rd.pts[i + 1] - ez * t));
          }
          if (best > 1) out.offRoad++;
        }
        T.reset();
      }
    }
    return out;
  });
  check('each kind spawns 300 to 600 m away on free ground with a red marker (rapina at a real place, fuga on a road)', r.made === r.tries && r.far === 0 && r.blocked === 0 && r.water === 0 && r.noMarker === 0 && r.notRed === 0 && r.offPoi === 0 && r.offRoad === 0, r);

  // 2. The events and the marker list of one crime, and its removal when it ends.
  r = await run(() => {
    const { g, cr, stand, reset, log, count } = window.__t;
    reset();
    stand(-300, 12);
    const c = cr.spawn('scippo');
    const start = log.find((e) => e.n === 'crime:start');
    const out = { id: c.id === start?.id, kind: start?.kind, pos: start && Math.hypot(start.pos.x - c.x, start.pos.z - c.z) < 0.01, markers: g.minimap.markers.get('crimes').length, listed: cr.list.length };
    cr.end(c, 'failed', 'test');
    out.after = { markers: g.minimap.markers.get('crimes'), list: cr.list.length, end: log.find((e) => e.n === 'crime:end')?.result };
    reset();
    return out;
  });
  check('crime:start carries id, kind and position; ending it removes the marker', r.id && r.kind === 'scippo' && r.pos && r.markers === 1 && r.listed === 1 && r.after.markers === undefined && r.after.list === 0 && r.after.end === 'failed', r);

  // 3. SCIPPO: the lady falls, the thief runs; tying him solves it, pays 15, and the bag goes back for 10 more.
  r = await run(() => {
    const { g, cr, sim, stand, live, reset, log, count, respect } = window.__t;
    reset();
    const c = live('scippo');
    const out = { live: c.live, thief: c.thief.kind, lady: c.lady.kind };
    sim(1);
    out.ladyDown = c.lady.fall > 0.9 && c.lady.state === 'stunned';
    const p0 = [c.thief.pos.x, c.thief.pos.z];
    sim(3);
    out.ran = +Math.hypot(c.thief.pos.x - p0[0], c.thief.pos.z - p0[1]).toFixed(1);
    out.runState = c.thief.state;
    out.pendingAfterRun = { solved: count('crime:solved'), respect: respect() };
    // Tie him: solved, once.
    c.thief.tie();
    sim(0.3);
    out.solved = log.find((e) => e.n === 'crime:solved');
    out.pay = respect();
    out.listed = cr.list.length;
    out.markersAfter = g.minimap.markers.get('crimes');
    // The bag lies where he fell. Walking to the lady without it pays nothing.
    const lady = c.lady;
    stand(lady.pos.x + 1, lady.pos.z);
    sim(0.5);
    out.noBagNoBonus = respect() === out.pay;
    const bag = cr.epilogues[0];
    out.bagMarker = !!g.minimap.markers.get('crimes.bag');
    stand(bag.bagAt.x, bag.bagAt.z);
    sim(0.3);
    out.carried = bag.carried;
    out.toLady = g.minimap.markers.get('crimes.bag')?.[0]?.label;
    stand(lady.pos.x + 1, lady.pos.z);
    sim(0.3);
    out.total = respect();
    out.bonus = log.filter((e) => e.n === 'respect').map((e) => e.why).join();
    out.epilogues = cr.epilogues.length;
    out.bagMarkerAfter = g.minimap.markers.get('crimes.bag');
    // Let the lady get up.
    sim(6);
    out.ladyUp = lady.fall === 0 && lady.state !== 'stunned';
    reset();
    return out;
  });
  check(
    'scippo: the lady goes down, the thief runs, nothing is paid until he is tied; tying pays 15',
    r.live && r.thief === 'thug' && r.lady === 'civilian' && r.ladyDown && r.ran > 10 && r.runState === 'run' && r.pendingAfterRun.solved === 0 && r.pendingAfterRun.respect === 0 && r.solved?.how === 'tied' && r.solved.reward === 15 && r.pay === 15 && r.listed === 0 && r.markersAfter === undefined,
    r,
  );
  check('scippo: the bag can be picked up on foot and returned to the lady for 10 more, not without it, and she gets up', r.noBagNoBonus && r.bagMarker && r.carried && r.toLady === 'Signora' && r.total === 25 && r.bonus === 'crime:scippo,crime:bag' && r.epilogues === 0 && r.bagMarkerAfter === undefined && r.ladyUp, r);

  // 3b. SCIPPO downed instead of tied.
  r = await run(() => {
    const { cr, sim, live, reset, log, respect } = window.__t;
    reset();
    const c = live('scippo');
    sim(1);
    c.thief.hit(999, 'test');
    sim(0.3);
    const out = { how: log.find((e) => e.n === 'crime:solved')?.how, pay: respect() };
    // Hitting him more, or tying him after he is down, pays nothing more.
    c.thief.tie();
    sim(1);
    out.stillPay = respect();
    out.solvedEvents = log.filter((e) => e.n === 'crime:solved').length;
    reset();
    return out;
  });
  check('scippo: a thief who is downed solves it too, and only once', r.how === 'down' && r.pay === 15 && r.stillPay === 15 && r.solvedEvents === 1, r);

  // 4. RAPINA: 3 to 5 thugs and a clerk at a real place; solved only when all are tied or down.
  r = await run(() => {
    const { g, cr, sim, live, reset, log, respect } = window.__t;
    reset();
    const c = live('rapina');
    const out = { live: c.live, thugs: c.thugs.length, clerk: c.clerk.kind, name: c.name };
    sim(1);
    out.calmAtFirst = c.thugs.every((t) => t.hp === t.maxHp);
    const [first, ...rest] = c.thugs;
    first.tie();
    for (const t of rest.slice(0, -1)) t.hit(999, 'test');
    sim(0.5);
    out.partial = { listed: cr.list.length, pay: respect(), solved: log.filter((e) => e.n === 'crime:solved').length };
    rest[rest.length - 1].tie();
    sim(0.3);
    out.solved = log.find((e) => e.n === 'crime:solved');
    out.pay = respect();
    out.markers = g.minimap.markers.get('crimes');
    out.clerkFree = c.clerk.stunT === 0;
    reset();
    return out;
  });
  check('rapina: 3 to 5 thugs round a clerk at a real place', r.live && r.thugs >= 3 && r.thugs <= 5 && r.clerk === 'civilian' && r.calmAtFirst && !!r.name, r);
  check('rapina: still open while one thug is up, solved (mixed tied and down) with the last, pays 30 once', r.partial.listed === 1 && r.partial.pay === 0 && r.partial.solved === 0 && r.solved?.how === 'mixed' && r.solved.reward === 30 && r.pay === 30 && r.markers === undefined && r.clerkFree, r);

  // 4b. RAPINA: the thugs get away (they leave the scene alive) and the crime is lost.
  r = await run(() => {
    const { g, cr, sim, live, reset, log, respect } = window.__t;
    reset();
    const c = live('rapina');
    sim(0.5);
    c.thugs.slice(1).forEach((t) => t.hit(999, 'test'));
    c.thugs[0].remove();
    sim(0.5);
    const out = { end: log.find((e) => e.n === 'crime:end'), solved: log.filter((e) => e.n === 'crime:solved').length, pay: respect(), listed: cr.list.length };
    reset();
    return out;
  });
  check('rapina: a thug who escapes alive fails the crime, no reward', r.end?.result === 'failed' && r.solved === 0 && r.pay === 0 && r.listed === 0, r);

  // 5. FUGA: the car flees along the roads; three ways to stop it.
  r = await run(() => {
    const { g, cr, sim, live, reset, log, respect } = window.__t;
    reset();
    const c = live('fuga');
    const out = { live: c.live, mode: c.car.mode, type: c.car.type, driver: c.driver.crime.role, passenger: c.passenger.crime.role };
    // Nothing done: it drives 100 m away within 12 s, keeping to the roads.
    const start = [c.car.x, c.car.z];
    let maxOff = 0, minSpeed = 99, moved = 0;
    const roads = [];
    for (const rec of g.city.recs.values()) roads.push(...(rec.roads || []));
    // How far the car is outside the asphalt of the nearest road (0 when on it).
    const off = (x, z) => {
      let best = 99;
      for (const rd of roads) for (let i = 0; i + 3 < rd.pts.length; i += 2) {
        const ex = rd.pts[i + 2] - rd.pts[i], ez = rd.pts[i + 3] - rd.pts[i + 1], t = Math.max(0, Math.min(1, ((x - rd.pts[i]) * ex + (z - rd.pts[i + 1]) * ez) / (ex * ex + ez * ez || 1)));
        best = Math.min(best, Math.hypot(x - rd.pts[i] - ex * t, z - rd.pts[i + 1] - ez * t) - rd.w / 2);
        if (best <= 0) return 0;
      }
      return best;
    };
    let topSpeed = 0;
    for (let i = 0; i < 24; i++) {
      sim(0.5);
      g.player.pos.set(c.car.x - 9, 0, c.car.z - 9); // keep her near so the scene stays live
      maxOff = Math.max(maxOff, off(c.car.x, c.car.z));
      topSpeed = Math.max(topSpeed, c.car.speed);
    }
    out.fled = +Math.hypot(c.car.x - start[0], c.car.z - start[1]).toFixed(0);
    out.maxOffRoad = +maxOff.toFixed(1);
    out.topSpeed = +topSpeed.toFixed(1);
    out.stillOpen = cr.list.length === 1 && log.filter((e) => e.n === 'crime:solved').length === 0;
    // A hit on the driver (a thrown papuc) stops it.
    c.driver.hit(10, 'papuc');
    sim(0.2);
    out.solved = log.find((e) => e.n === 'crime:solved');
    out.pay = respect();
    sim(4);
    out.stopped = Math.abs(c.car.speed) < 0.5 && c.car.mode === 'parked';
    out.passengerOut = Math.hypot(c.passenger.pos.x - c.car.x, c.passenger.pos.z - c.car.z) > 1.5;
    reset();
    return out;
  });
  check('fuga: a car with two thugs flees at speed along the roads and nothing solves it by itself', r.live && r.mode === 'flee' && r.driver === 'driver' && r.passenger === 'passenger' && r.fled > 100 && r.maxOffRoad < 1.2 && r.topSpeed > 10 && r.stillOpen, r);
  check('fuga: a papuc on the driver solves it, pays 40, and the car brakes to a stop', r.solved?.how === 'papuc' && r.solved.reward === 40 && r.pay === 40 && r.stopped && r.passengerOut, r);

  r = await run(() => {
    const { g, cr, sim, live, stand, reset, log, respect } = window.__t;
    reset();
    const c = live('fuga');
    sim(1);
    const out = {};
    // Far from the car, pressing C does nothing. On foot beside it and not pressing, nothing either.
    stand(c.car.x + 40, c.car.z + 40);
    g.setInput({ tiePressed: true });
    sim(1 / 30);
    g.setInput(null);
    out.farTie = c.driver.tied;
    out.farSolved = log.filter((e) => e.n === 'crime:solved').length;
    // On the roof and pressing C: the driver is tied.
    g.player.reset();
    g.player.pos.set(c.car.x, c.car.h + 0.3, c.car.z);
    g.player.mode = 'air';
    g.setInput({ tiePressed: true });
    sim(1 / 30);
    g.setInput(null);
    out.tied = c.driver.tied;
    sim(0.2);
    out.solved = log.find((e) => e.n === 'crime:solved');
    out.pay = respect();
    reset();
    return out;
  });
  check('fuga: C far from the car does nothing; from the roof it ties the driver, solving it for 40', !r.farTie && r.farSolved === 0 && r.tied && r.solved?.how === 'tied' && r.pay === 40, r);

  r = await run(() => {
    const { g, cr, sim, live, stand, reset, log, respect } = window.__t;
    reset();
    const c = live('fuga');
    // A car of her own, 6 m behind the getaway car and faster, driven straight at it.
    const car = g.traffic.make('sedan');
    const fx = Math.sin(c.car.yaw), fz = Math.cos(c.car.yaw);
    Object.assign(car, { x: c.car.x - fx * 6, z: c.car.z - fz * 6, yaw: c.car.yaw, speed: 25, mode: 'traffic' });
    g.traffic.cars.push(car);
    g.traffic.poseObj(car);
    g.enterCar(car);
    g.setInput({ moveY: 1 });
    const out = { driving: !!g.driving() };
    // Slow: a shove below 6 m/s does not count.
    for (let i = 0; i < 12 && !log.some((e) => e.n === 'crime:solved'); i++) sim(1 / 10);
    g.setInput(null);
    out.solved = log.find((e) => e.n === 'crime:solved');
    out.pay = respect();
    out.driverStunned = c.driver.stunT > 0 || c.driver.state === 'stunned';
    g.exitCar(false);
    reset();
    return out;
  });
  check('fuga: ramming the car with one she has stolen solves it', r.driving && r.solved?.how === 'rammed' && r.pay === 40 && r.driverStunned, r);

  r = await run(() => {
    const { g, cr, sim, live, stand, reset, log, respect } = window.__t;
    reset();
    const c = live('fuga');
    // A slow bump from a car she is driving (below 6 m/s) is not a ram.
    const car = g.traffic.make('sedan');
    const fx = Math.sin(c.car.yaw), fz = Math.cos(c.car.yaw);
    Object.assign(car, { x: c.car.x - fx * 5, z: c.car.z - fz * 5, yaw: c.car.yaw, speed: 2, mode: 'traffic' });
    g.traffic.cars.push(car);
    g.traffic.poseObj(car);
    g.enterCar(car);
    for (let i = 0; i < 20; i++) sim(1 / 10);
    const out = { solved: log.filter((e) => e.n === 'crime:solved').length, open: cr.list.length };
    g.exitCar(false);
    reset();
    return out;
  });
  check('fuga: driving alongside slowly, without a hit, does not solve it', r.solved === 0 && r.open === 1, r);

  // 6. Crime actors never end up in a building or the water.
  r = await run(() => {
    const { g, cr, sim, stand, reset } = window.__t, A = g.actors;
    const spots = [[-300, 12], [0, 0], [300, -300], [-500, -400], [400, 350], [100, 600], [-600, 300], [700, -100]];
    const out = { made: 0, actors: 0, inBuilding: 0, inWater: 0, cars: 0, carInWater: 0 };
    for (const kind of ['scippo', 'rapina', 'fuga']) {
      for (const [i, [x, z]] of spots.entries()) {
        reset();
        if (kind === 'rapina') stand(window.__t.pois[i].x + 75, window.__t.pois[i].z);
        else stand(x, z);
        const c = cr.spawn(kind, { range: [50, 110] });
        if (!c) continue;
        stand(c.x - 6, c.z - 6);
        sim(1.5);
        if (!c.live) continue;
        out.made++;
        for (const a of c.actors) {
          if (a.crime.role === 'driver' || a.crime.role === 'passenger') continue;
          out.actors++;
          if (A.blocked(a.pos.x, a.pos.z, 0.1)) out.inBuilding++;
          if (g.city.isWater(a.pos.x, a.pos.z)) out.inWater++;
        }
        if (c.car) {
          out.cars++;
          if (g.city.isWater(c.car.x, c.car.z)) out.carInWater++;
        }
      }
    }
    reset();
    return out;
  });
  check('crime actors and cars are never in a building or the water', r.made >= 20 && r.actors >= 50 && r.inBuilding === 0 && r.inWater === 0 && r.cars >= 6 && r.carInWater === 0, r);

  // 7. Left alone, a crime expires after 3 minutes: the marker goes, the crime ends, nothing is paid.
  r = await run(() => {
    const { g, cr, sim, stand, reset, log, respect } = window.__t;
    reset();
    stand(-300, 12);
    const kinds = ['scippo', 'rapina', 'fuga'];
    for (const k of kinds) cr.spawn(k);
    const out = { started: cr.list.length, markers: g.minimap.markers.get('crimes').length };
    sim(170);
    out.at170 = { listed: cr.list.length, markers: g.minimap.markers.get('crimes')?.length, ends: log.filter((e) => e.n === 'crime:end').length };
    sim(12);
    out.at182 = { listed: cr.list.length, markers: g.minimap.markers.get('crimes'), ends: log.filter((e) => e.n === 'crime:end').map((e) => e.result), solved: log.filter((e) => e.n === 'crime:solved').length, pay: respect() };
    out.endAge = log.filter((e) => e.n === 'crime:end').map((e) => +(e.t - log.find((s) => s.n === 'crime:start' && s.id === e.id).t).toFixed(1));
    reset();
    return out;
  });
  check(
    'an unsolved crime expires after 3 minutes, its marker disappears, nothing is paid',
    r.started === 3 && r.markers === 3 && r.at170.listed === 3 && r.at170.markers === 3 && r.at170.ends === 0 && r.at182.listed === 0 && r.at182.markers === undefined && r.at182.ends.join() === 'expired,expired,expired' && r.at182.solved === 0 && r.at182.pay === 0 && r.endAge.every((a) => a >= 179.9 && a <= 180.2),
    r,
  );

  // 8. A live crime that Bunica leaves behind for good is lost, not paid.
  r = await run(() => {
    const { g, cr, sim, live, stand, reset, log, respect } = window.__t;
    reset();
    const c = live('scippo');
    sim(1);
    stand(c.thief.pos.x + 520, c.thief.pos.z);
    sim(0.5);
    const out = { end: log.find((e) => e.n === 'crime:end'), solved: log.filter((e) => e.n === 'crime:solved').length, pay: respect() };
    reset();
    return out;
  });
  check('a thief who gets 450 m away fails the crime, no reward', r.end?.result === 'failed' && r.end.how === 'escaped' && r.solved === 0 && r.pay === 0, r);

  // 9. Solved crimes stay solved: solve() again pays nothing.
  r = await run(() => {
    const { g, cr, sim, live, reset, log, respect } = window.__t;
    reset();
    const c = live('rapina');
    c.thugs.forEach((t) => t.hit(999, 'test'));
    sim(0.3);
    const first = respect();
    const again = cr.solve(c, 'down');
    sim(0.3);
    const out = { first, again, after: respect(), events: log.filter((e) => e.n === 'crime:solved').length };
    reset();
    return out;
  });
  check('a solved crime cannot be solved twice for the reward', r.first === 30 && r.again === false && r.after === 30 && r.events === 1, r);

  // 10. The natural rhythm: the first crime at 30 s, then one every 45 to 90 s, three at most at a time.
  r = await run(() => {
    const { g, cr, sim, stand, reset, log } = window.__t;
    const run = (keep) => {
      reset();
      stand(-300, 12);
      const off = g.events.on('crime:start', (e) => !keep && cr.end(cr.list.find((c) => c.id === e.id), 'failed', 'test'));
      const t0 = g.time;
      cr.auto = true;
      let maxOpen = 0;
      for (let i = 0; i < 40; i++) {
        sim(10);
        maxOpen = Math.max(maxOpen, cr.list.length);
      }
      cr.auto = false;
      off();
      const starts = log.filter((e) => e.n === 'crime:start').map((e) => +(e.t - t0).toFixed(1));
      reset();
      return { starts, gaps: starts.slice(1).map((t, i) => +(t - starts[i]).toFixed(1)), maxOpen };
    };
    return { each: run(false), kept: run(true) };
  });
  check('crimes come by themselves: the first at 30 s, then every 45 to 90 s', r.each.starts.length >= 5 && r.each.starts[0] >= 29.9 && r.each.starts[0] <= 31 && r.each.gaps.every((d) => d >= 44.9 && d <= 90.5), r.each);
  check('and no more than 3 crimes are open at once when nobody solves them', r.kept.maxOpen === 3 && r.kept.gaps.every((d) => d >= 44.9), r.kept);

  // 11. Cost of the system with three crimes live at once.
  r = await run(() => {
    const { g, cr, sim, stand, reset } = window.__t;
    reset();
    stand(-300, 12);
    for (const k of ['scippo', 'rapina', 'fuga']) cr.spawn(k, { range: [40, 90] });
    stand(-300, 12);
    sim(3);
    const live = cr.list.filter((c) => c.live).length;
    let acc = 0, n = 0;
    const orig = cr.update;
    cr.update = (dt) => {
      const t0 = performance.now();
      orig.call(cr, dt);
      acc += performance.now() - t0;
      n++;
    };
    sim(10);
    cr.update = orig;
    const out = { live, ticks: n, msPerTick: +(acc / n).toFixed(4) };
    reset();
    return out;
  });
  console.log(`COST  crimes  ${r.live} crimes live, ${r.msPerTick} ms per tick over ${r.ticks} ticks`);
  check('the crimes system costs under 0.5 ms per tick with crimes live', r.live >= 1 && r.msPerTick < 0.5, r);

  // 12. Same on Brasov: distances, free ground, markers.
  const brasov = await open(browser, 'city=brasov&lowq&seed=11', errors);
  await brasov.evaluate(async () => {
    const g = window.__game;
    await g.city.streamAround(0, 0, 1300);
    g.systems.get('crimes').auto = false;
  });
  r = await brasov.evaluate(() => {
    const g = window.__game, cr = g.systems.get('crimes'), A = g.actors;
    const out = { made: 0, tries: 0, far: 0, blocked: 0, water: 0, noMarker: 0 };
    for (const kind of ['scippo', 'rapina', 'fuga']) {
      for (const [x, z] of [[0, 0], [-200, 300], [300, -100], [-500, 400]]) {
        g.player.reset();
        g.player.pos.set(x, 0, z);
        out.tries++;
        const c = cr.spawn(kind);
        if (!c) continue;
        out.made++;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < 300 || d > 600) out.far++;
        if (A.blocked(c.x, c.z, 0.4)) out.blocked++;
        if (g.city.isWater(c.x, c.z)) out.water++;
        if (!g.minimap.markers.get('crimes')?.some((m) => m.x === c.x && m.z === c.z)) out.noMarker++;
        cr.end(c, 'failed', 'test');
      }
    }
    return out;
  });
  check('Brasov: the same three kinds spawn 300 to 600 m away on free ground with a marker', r.made >= 9 && r.far === 0 && r.blocked === 0 && r.water === 0 && r.noMarker === 0, r);
  await brasov.close();
} finally {
  await browser.close();
  srv.kill();
}
check('no page errors', errors.length === 0, [...new Set(errors)].slice(0, 5));
process.exit(results.every((x) => x.ok) ? 0 : 1);
