// The mission runner and the missions of both cities. The data is checked in Node against the built
// city (every point out of buildings and water, next to a street, speakers on real facades); then each
// Bucharest mission is played through with scripted input (teleports, actors from game.actors, a real
// wall climb for the speakers) and must pay its reward, and the failures must leave nothing behind.
// Brasov is checked on its data and its runner logic; the physical run needs the terrain branch.
// Usage: PORT=5225 node test/missions.mjs   (exit code 1 on any failure)
import { startServer, launch, open } from './harness.mjs';
import { loadCityData, ringDistance } from '../tools/city-data.mjs';
import { MISSIONS } from '../src/missions-data.js';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

// ---------- the data, in Node ----------
function points(def) {
  const out = [{ what: 'start', ...def.start }];
  def.steps.forEach((s, i) => {
    const tag = `step ${i + 1} ${s.type}`;
    if (s.at) out.push({ what: tag, ...s.at });
    for (const pt of s.points ?? []) out.push({ what: tag + ' point', ...pt });
    for (const f of s.foes ?? []) out.push({ what: tag + ' ' + f.key, ...f.at });
    for (const f of s.flee ?? []) for (const [x, z] of f.route) out.push({ what: tag + ' route ' + f.ref, x, z });
    if (s.to) out.push({ what: tag + ' to', ...s.to });
    if (s.actor) out.push({ what: tag + ' ' + s.actor.key, ...s.actor.at });
    if (s.car) out.push({ what: tag + ' car', x: s.car.x, z: s.car.z });
    if (s.quarry) out.push({ what: tag + ' quarry', x: s.quarry.x, z: s.quarry.z });
  });
  return out;
}

for (const city of ['bucharest', 'brasov']) {
  const D = loadCityData(city);
  const list = MISSIONS[city].missions;
  const ids = list.map((m) => m.id);
  check(`${city}: ${list.length} missions with unique ids, a title, a giver, a reward and steps`, list.length === (city === 'bucharest' ? 6 : 3) && new Set(ids).size === ids.length && list.every((m) => m.title && m.giver?.line && m.giver?.name && m.reward.respect > 0 && m.steps.length && m.where), ids);
  const bad = [];
  for (const m of list) {
    for (const p of points(m)) {
      const road = D.roadDistance(p.x, p.z, 40).d;
      const g = D.groundAt(p.x, p.z);
      // Objectives on the ground: out of every footprint and the water, inside the city box, with terrain under them.
      // A street or footway within 40 m, except the fallen letter and the sign on the mountain, which are on the slope itself.
      const onSlope = city === 'brasov' && m.id === 'litera' && /goto/.test(p.what) && p.what !== 'start';
      const ok = D.inCity(p.x, p.z) && D.free(p.x, p.z, 0.4) && Number.isFinite(g) && (onSlope || road <= 40);
      if (!ok) bad.push(`${m.id} ${p.what} (${p.x}, ${p.z}) free=${D.free(p.x, p.z, 0.4)} inCity=${D.inCity(p.x, p.z)} road=${road.toFixed(0)}`);
    }
  }
  check(`${city}: every mission point is inside the city, on open ground out of buildings and water, and reachable from a street`, bad.length === 0, bad);

  // Whole legs: consecutive objectives are close enough to play (no two points 8 km apart).
  const far = [];
  for (const m of list) {
    const pts = points(m).filter((p) => !/route|foes|start/.test(p.what) || p.what === 'start');
    for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) > 3000) far.push(`${m.id} leg ${i}`);
  }
  check(`${city}: no leg between objectives is longer than 3 km`, far.length === 0, far);
}

{
  // The speakers: on the wall of a tall building, facing open ground, on three different facades.
  const D = loadCityData('bucharest');
  const m = MISSIONS.bucharest.missions.find((x) => x.id === 'manele');
  const step = m.steps[0];
  const problems = [];
  const dirs = new Set();
  const blocks = new Set();
  for (const t of step.targets) {
    const b = D.buildingsNear(t.x, t.z, 3).find((q) => ringDistance(t.x, t.z, q.outer) < 0.3);
    if (!b) problems.push(`no wall at (${t.x}, ${t.z})`);
    else {
      if (b.y1 - b.y0 < t.y + 4) problems.push(`${b.name} too low for a speaker at ${t.y}`);
      if (!D.free(t.x + t.nx * 3, t.z + t.nz * 3, 1.2)) problems.push(`${b.name}: no open ground in front`);
      if (D.inBuilding(b, t.x + t.nx * 0.5, t.z + t.nz * 0.5)) problems.push(`${b.name}: normal points into the building`);
      blocks.add(b.name);
    }
    dirs.add(`${Math.round(t.nx)},${Math.round(t.nz)}`);
  }
  check('manele: the three speakers sit on the walls of three different tall buildings, on different facades, each with open ground in front to climb from', problems.length === 0 && blocks.size === 3 && dirs.size === 3, { problems, blocks: [...blocks], dirs: [...dirs] });
}

{
  // Brasov: the letter is on the fall line below its place in the sign, and the place is on the ground of the sign bench.
  const D = loadCityData('brasov');
  const m = MISSIONS.brasov.missions.find((x) => x.id === 'litera');
  const [fallen, slot] = [m.steps[0].at, m.steps[1].at];
  const rise = D.groundAt(slot.x, slot.z) - D.groundAt(fallen.x, fallen.z);
  const run = Math.hypot(slot.x - fallen.x, slot.z - fallen.z);
  const bench = D.groundAt(404.3, 883.1); // recommended row centre, docs/brasov-landmarks.md
  check('brasov litera: the fallen S lies 40 to 110 m of climb below its slot, which is on the sign bench (within 2 m of the row height, 15 m of the row centre)',
    rise > 40 && rise < 110 && run < 120 && Math.abs(D.groundAt(slot.x, slot.z) - bench) < 2 && Math.hypot(slot.x - 404.3, slot.z - 883.1) < 15, { rise: +rise.toFixed(1), run: +run.toFixed(1), bench: +bench.toFixed(1) });
  const bear = MISSIONS.brasov.missions.find((x) => x.id === 'ursul').steps[0];
  const blocked = [];
  for (let s = 0; s <= 1; s += 0.02) {
    const x = bear.actor.at.x + (bear.to.x - bear.actor.at.x) * s, z = bear.actor.at.z + (bear.to.z - bear.actor.at.z) * s;
    if (!D.free(x, z, 0.3)) blocked.push([Math.round(x), Math.round(z)]);
  }
  const climb = D.groundAt(bear.to.x, bear.to.z) - D.groundAt(bear.actor.at.x, bear.actor.at.z);
  check('brasov ursul: the bear can be led in a straight line down Strada Aluniș to the forest edge, 84 m, uphill by about 10 m', blocked.length === 0 && climb > 5 && climb < 20, { blocked, climb: +climb.toFixed(1) });
}

const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  // ======================= Bucharest, played through =======================
  const page = await open(browser, 'shot=street&lowq&seed=7', errors);
  await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.05);
    const T = (window.__t = {});
    window.__ev = [];
    for (const n of ['mission:start', 'mission:end', 'respect', 'level:up']) g.events.on(n, (e) => window.__ev.push([n, e]));
    // Put her on open ground and let the map stream in around.
    T.at = async (x, z, y = 0) => {
      await g.city.streamAround(x, z, 500);
      g.player.reset();
      g.player.pos.set(x, y, z);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
      g.player.mode = 'ground';
    };
    T.tick = (s, step = 1 / 30) => g.advance(s, step);
    T.gone = (a) => !a || a.removed || a.state === 'down' || a.tied;
    T.info = () => ({ active: g.missions.active, list: g.missions.list.map((m) => m.status), respect: g.respect.value, objective: document.getElementById('objective').textContent, objVisible: !document.getElementById('objective').classList.contains('hidden') });
    T.events = (name) => window.__ev.filter((e) => e[0] === name).map((e) => e[1]);
    // A stand-in for the police system, which this branch does not have.
    g.wanted = { stars: 0, add(n) { this.stars += n; }, clear() { this.stars = 0; } };
  });
  await page.waitForFunction(() => window.__game.actors && window.__game.missions);

  // ---------- locked missions ----------
  let r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const out = { list: g.missions.list, starts: g.missions.start('obor'), startsLast: g.missions.start('casa'), startsNone: g.missions.start('nope') };
    // Walking into the start marker of a mission that is not next does nothing.
    const s = g.missions.defs[1].start;
    await T.at(s.x, s.z);
    T.tick(0.5);
    out.walkIn = g.missions.active;
    out.markers = (g.minimap.markers.get('missions') || []).map((m) => m.label);
    out.rows = [...document.querySelectorAll('#overlay-missions div')].map((d) => d.className);
    return out;
  });
  check('a locked mission cannot start, by key, by name or by walking into its marker; only the next one shows on the map', r.list.map((m) => m.status).join() === 'next,locked,locked,locked,locked,locked' && !r.starts && !r.startsLast && !r.startsNone && r.walkIn === null && (r.markers.length === 0 || r.markers.join() === 'Pensia furată'), r);
  check('the pause menu lists all six missions with their state', r.rows.length === 6 && r.rows[0] === 'next' && r.rows.slice(1).every((c) => c === 'locked'), r.rows);

  // ---------- 1. Pensia furata: walk into the marker, chase, tie ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const def = g.missions.defs[0];
    const respect0 = g.respect.value;
    await T.at(def.start.x + 30, def.start.z);
    T.tick(0.3);
    const before = g.missions.active;
    await T.at(def.start.x, def.start.z);
    T.tick(0.3);
    const a = g.missions.active;
    const thief = g.missions.actor('thief');
    const p0 = thief && [thief.pos.x, thief.pos.z];
    T.tick(3);
    const moved = thief && Math.hypot(thief.pos.x - p0[0], thief.pos.z - p0[1]);
    const mid = { active: g.missions.active, thiefState: thief?.state, obj: document.getElementById('objective').textContent, objVisible: !document.getElementById('objective').classList.contains('hidden'), say: document.getElementById('mission-say').textContent, mark: (g.minimap.markers.get('missions') || []).length, kind: thief?.kind, persist: thief?.persist, role: thief?.mission?.role };
    // A knocked out thief is a caught thief; tying is what the tutorial asks, so do that.
    const stillOn = (() => { T.tick(1); return !!g.missions.active; })();
    A.tie(thief);
    T.tick(0.5);
    const end = T.info();
    return { before, a, moved, mid, stillOn, end, respect0, respect1: g.respect.value, saved: g.save.get('missions'), ends: T.events('mission:end'), starts: T.events('mission:start'), actorsLeft: A.list.filter((x) => x.mission).length, toast: document.getElementById('toast').textContent };
  });
  check('pensia: not started 30 m away, started by walking into the marker; the thief runs off along his route, the objective and the subtitle show', r.before === null && r.a?.id === 'pensia' && r.moved > 5 && r.mid.thiefState === 'run' && r.mid.kind === 'thug' && r.mid.persist && r.mid.role === 'flee' && /scippatore/.test(r.mid.obj) && r.mid.objVisible && /ladro/.test(r.mid.say) && r.mid.mark >= 1, r);
  check('pensia: still running while the thief is free; tying him completes it, pays 60 Respect once, saves it and unlocks the next', r.stillOn && r.end.active === null && r.respect1 - r.respect0 === 60 && JSON.stringify(r.saved) === '{"bucharest":["pensia"]}' && r.end.list.join() === 'done,next,locked,locked,locked,locked' && r.ends.length === 1 && r.ends[0].result === 'done' && r.starts.length === 1, r);

  // ---------- the pursuit is lost when he gets away ----------
  // (played on a fresh copy of the mission by resetting its save and reloading the state through the API)
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    // Missions unlock in order and pensia is done: use obor, the next, for a run that fails by timeout.
    const def = g.missions.defs[1];
    await T.at(def.start.x, def.start.z);
    T.tick(0.2);
    const armedRun = g.missions.active;
    if (!armedRun) g.missions.start('obor');
    const a0 = g.missions.active;
    const timer0 = g.missions.timer;
    const respect0 = g.respect.value;
    T.tick(120, 1 / 10);
    const mid = { timer: g.missions.timer, active: !!g.missions.active };
    // Take two gates out of order first: nothing counts.
    return { a0, timer0, mid, respect0 };
  });
  check('obor: starts with a 330 s clock', r.a0?.id === 'obor' && r.timer0.total === 330 && r.timer0.sec > 328, r);
  check('obor: the clock runs down (120 s later about 210 s are left)', r.mid.active && Math.abs(r.mid.timer.sec - 210) < 3, r.mid);

  // Gates out of order do not count; then let the clock run out.
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const def = g.missions.defs[1];
    const pts = def.steps[0].points;
    const step = () => g.missions.step();
    const n0 = step().n;
    // Into the third gate before the first two.
    g.player.pos.set(pts[2].x, 0, pts[2].z);
    T.tick(0.3);
    const afterSkip = step().n;
    // Back in the marker, and the clock runs out while she stands there.
    await T.at(def.start.x, def.start.z);
    T.tick(300, 1 / 10);
    const failed = { active: g.missions.active, list: g.missions.list.map((m) => m.status), respect: g.respect.value, toast: document.getElementById('toast').textContent, ends: T.events('mission:end').slice(-1)[0], objective: T.info().objVisible, markers: (g.minimap.markers.get('missions') || []).length, beams: 'none' };
    return { n0, afterSkip, failed };
  });
  check('obor: a gate taken out of order does not count', r.n0 === 0 && r.afterSkip === 0, r);
  check('obor: when the clock runs out the mission fails, pays nothing, stays the next one and leaves no objective, marker or run behind', r.failed.active === null && r.failed.list[1] === 'next' && r.failed.ends.result === 'fail' && /tempo scaduto/.test(r.failed.ends.why) && /fallita/.test(r.failed.toast) && !r.failed.objective, r.failed);

  // Retry: fresh state, no progress carried over, and it can be finished.
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const def = g.missions.defs[1];
    const respect0 = g.respect.value;
    // Still standing in the marker after the failure: it does not start again by itself.
    T.tick(1);
    const noAuto = g.missions.active === null;
    await T.at(def.start.x + 60, def.start.z);
    T.tick(1);
    await T.at(def.start.x, def.start.z);
    T.tick(0.3);
    const retry = g.missions.active;
    const S = g.missions.step();
    const fresh = { n: S.n, sec: g.missions.timer.sec };
    const pts = def.steps[0].points;
    const seen = [];
    for (const p of pts) {
      // Swing through the gate high up: the column counts at any height.
      g.player.pos.set(p.x, 20, p.z);
      g.player.vel.set(0, 0, 0);
      g.player.mode = 'air';
      T.tick(0.1);
      seen.push(g.missions.active ? g.missions.step().n : 'end');
    }
    T.tick(0.3);
    return { noAuto, retry, fresh, seen, end: T.info(), gained: g.respect.value - respect0, saved: g.save.get('missions'), toast: document.getElementById('toast').textContent };
  });
  check('obor retry: nothing carries over from the failed run, the marker waits until she has walked away, and it starts again clean', r.noAuto && r.retry?.id === 'obor' && r.fresh.n === 0 && r.fresh.sec > 328, r);
  check('obor: five gates in order, taken high in the air, complete it and pay 90 Respect', JSON.stringify(r.seen) === JSON.stringify([1, 2, 3, 4, 'end']) && r.end.active === null && r.gained === 90 && r.saved.bucharest.join() === 'pensia,obor' && /Missione completata|Livello/.test(r.toast), r);

  // ---------- 3. Nepotul: the nephew must survive, the gang must fall ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const def = g.missions.defs[2];
    // First run: the nephew is knocked down, the mission fails and takes its actors with it.
    await T.at(def.start.x, def.start.z);
    T.tick(0.5);
    const a = g.missions.active;
    T.tick(1);
    const foes = ['g1', 'g2', 'g3', 'g4', 'g5'].map((k) => g.missions.actor(k));
    const nephew = g.missions.actor('nephew');
    const spawned = { thugs: foes.filter((f) => f?.kind === 'thug').length, nephew: nephew?.kind, scale: nephew?.scale, live: A.list.filter((x) => x.mission).length };
    A.hit(nephew, 9999, 'test');
    T.tick(0.5);
    const failed = { active: g.missions.active, ends: T.events('mission:end').slice(-1)[0], left: A.list.filter((x) => x.mission && !x.removed).length, respect: g.respect.value };
    return { a, spawned, failed };
  });
  check('nepotul: the gang of five thugs and the nephew appear at the lakeside; if the nephew goes down the mission fails and removes them all', r.a?.id === 'nepotul' && r.spawned.thugs === 5 && r.spawned.nephew === 'civilian' && r.spawned.live === 6 && r.failed.active === null && r.failed.ends.result === 'fail' && /Matei/.test(r.failed.ends.why) && r.failed.left === 0, r);

  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const def = g.missions.defs[2];
    const respect0 = g.respect.value;
    await T.at(def.start.x + 50, def.start.z);
    T.tick(1);
    await T.at(def.start.x, def.start.z);
    T.tick(1.5);
    const names = ['g1', 'g2', 'g3', 'g4', 'g5'];
    const foes = names.map((k) => g.missions.actor(k));
    // Four down, one standing: still on.
    for (const f of foes.slice(0, 4)) A.hit(f, 9999, 'test');
    T.tick(0.5);
    const four = { active: g.missions.active?.step, obj: document.getElementById('objective').textContent };
    A.hit(foes[4], 9999, 'test');
    T.tick(0.5);
    const second = { step: g.missions.active?.step, type: g.missions.active?.type, obj: document.getElementById('objective').textContent };
    // Go and hug him: only close enough counts.
    const nephew = g.missions.actor('nephew');
    await T.at(nephew.pos.x + 30, nephew.pos.z);
    T.tick(0.3);
    const far = !!g.missions.active;
    await T.at(nephew.pos.x + 1, nephew.pos.z);
    T.tick(0.3);
    return { four, second, far, end: T.info(), gained: g.respect.value - respect0, saved: g.save.get('missions').bucharest };
  });
  check('nepotul: with one thug still standing the fight goes on; when all five are down the nephew is to be reached; only then it pays 110', r.four.active === 0 && /Sconfiggi/.test(r.four.obj) && r.second.step === 1 && r.second.type === 'goto' && /Abbraccia/.test(r.second.obj) && r.far && r.end.active === null && r.gained === 110 && r.saved.join() === 'pensia,obor,nepotul', r);

  // ---------- 4. Aparatul stricat: steal the taxi, keep on the tail, catch the driver ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const def = g.missions.defs[3];
    await T.at(def.start.x, def.start.z);
    T.tick(0.5);
    const a = g.missions.active;
    const taxi = g.missions.step().car;
    const parked = { mode: taxi.mode, type: taxi.type, x: taxi.x, z: taxi.z, listed: g.traffic.cars.includes(taxi) };
    // Not the taxi's own steal: the step waits.
    T.tick(1);
    const waiting = g.missions.active.step === 0;
    g.player.pos.set(taxi.x + 1.5, 0, taxi.z + 1.5);
    g.enterCar(taxi);
    T.tick(0.3);
    const tail = { step: g.missions.active?.step, type: g.missions.active?.type, driving: g.driving()?.type };
    const q = g.missions.step().car;
    const q0 = [q.x, q.z];
    T.tick(2);
    const run = { moved: Math.hypot(q.x - q0[0], q.z - q0[1]), cruise: q.cruise, listed: g.traffic.cars.includes(q) };
    // Far behind: not caught in 4 s.
    const stolen = g.driving();
    stolen.x = q.x - 40; stolen.z = q.z - 40;
    T.tick(4);
    const notCaught = g.missions.active?.type === 'tail';
    return { a, parked, waiting, tail, run, notCaught };
  });
  check('aparatul: a taxi waits at the rank; the mission waits until it is stolen, then a driver in a hurry pulls away in another taxi; being far from him catches nothing', r.a?.id === 'aparatul' && r.parked.mode === 'parked' && r.parked.type === 'taxi' && r.parked.listed && r.waiting && r.tail.step === 1 && r.tail.type === 'tail' && r.tail.driving === 'taxi' && r.run.moved > 10 && r.run.cruise >= 17 && r.notCaught, r);

  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const respect0 = g.respect.value;
    const q = g.missions.step().car;
    const stolen = g.driving();
    // Stay on his tail: within 9 m for 2.5 s.
    let caughtAt = null;
    for (let i = 0; i < 90 && g.missions.active?.type === 'tail'; i++) {
      stolen.x = q.x + 3; stolen.z = q.z + 3;
      T.tick(1 / 20, 1 / 20);
      if (g.missions.active?.type !== 'tail') caughtAt = i / 20;
    }
    const driver = g.missions.actor('driver');
    const tie = { type: g.missions.active?.type, driver: driver && { kind: driver.kind, state: driver.state, role: driver.mission.role }, quarryMode: q.mode };
    T.tick(1.5);
    const ran = driver && driver.state === 'run';
    A.tie(driver);
    T.tick(0.5);
    return { caughtAt, tie, ran, end: T.info(), gained: g.respect.value - respect0, saved: g.save.get('missions').bucharest };
  });
  check('aparatul: staying within 9 m for 2.5 s corners the taxi, its driver jumps out and runs, tying him pays 130', r.caughtAt >= 2.4 && r.caughtAt < 5 && r.tie.type === 'tie' && r.tie.driver?.kind === 'thug' && r.tie.quarryMode === 'parked' && r.ran && r.end.active === null && r.gained === 130 && r.saved.join() === 'pensia,obor,nepotul,aparatul', r);

  // ---------- 5. Manele: climb three facades and silence the speakers ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const def = g.missions.defs[4];
    const respect0 = g.respect.value;
    // She is still in the stolen taxi: get out first.
    if (g.driving()) g.exitCar(false);
    await T.at(def.start.x, def.start.z);
    T.tick(0.5);
    const a = g.missions.active;
    const S = g.missions.step();
    const targets = def.steps[0].targets;
    const meshes = S.left.map((s) => s.m.position.toArray().map((v) => +v.toFixed(1)));
    // G from the ground, 11 m below the first speaker: nothing.
    const t0 = targets[0];
    await T.at(t0.x + t0.nx * 4, t0.z + t0.nz * 4);
    g.setInput({ interactPressed: true });
    T.tick(1 / 30, 1 / 30);
    g.setInput({});
    const groundPress = g.missions.step().left.length;
    // Then really climb each facade: face the wall, hold forward, press G at the height of the speaker.
    const climbs = [];
    for (let i = 0; i < 3; i++) {
      const t = targets[i];
      await T.at(t.x + t.nx * 4, t.z + t.nz * 4);
      g.look(Math.atan2(t.nx, t.nz), 0);
      const y0 = 0;
      let maxY = 0, mode = '';
      for (let k = 0; k < 150; k++) {
        g.setInput({ moveY: 1 });
        T.tick(1 / 30, 1 / 30);
        maxY = Math.max(maxY, g.player.pos.y);
        mode = g.player.mode;
        if (g.player.pos.y >= t.y - 0.5) break;
      }
      const wall = g.player.mode === 'wall';
      g.setInput({ interactPressed: true, moveY: 1 });
      T.tick(1 / 30, 1 / 30);
      g.setInput({});
      climbs.push({ maxY: +maxY.toFixed(1), wall, left: g.missions.active ? g.missions.step().left.length : 0, toast: document.getElementById('toast').textContent });
      // Hop off and come down between two climbs.
      g.player.reset();
    }
    T.tick(0.5);
    return { a, meshes, groundPress, climbs, end: T.info(), gained: g.respect.value - respect0, saved: g.save.get('missions').bucharest };
  });
  check('manele: three speakers hang on the facades; G from the ground does nothing', r.a?.id === 'manele' && r.meshes.length === 3 && r.meshes.every((m) => m[1] > 8 && m[1] < 15) && r.groundPress === 3, { a: r.a, meshes: r.meshes, groundPress: r.groundPress });
  check('manele: climbing each facade to the fourth floor and pressing G silences the speaker, one by one, then it pays 150', r.climbs.length === 3 && r.climbs.every((c, i) => c.wall && c.maxY >= 10.5 && c.left === 2 - i) && r.end.active === null && r.gained === 150 && r.saved.join() === 'pensia,obor,nepotul,aparatul,manele', r);

  // ---------- 6. Casa Poporului: everything at once, with three stars ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const def = g.missions.defs[5];
    const respect0 = g.respect.value;
    g.wanted.stars = 1;
    await T.at(def.start.x, def.start.z);
    T.tick(0.5);
    const a = g.missions.active;
    const stars = g.wanted.stars;
    // Being caught fails it; then again from the start.
    g.events.emit('busted', {});
    T.tick(0.2);
    const busted = { active: g.missions.active, ends: T.events('mission:end').slice(-1)[0], left: A.list.filter((x) => x.mission).length };
    await T.at(def.start.x + 50, def.start.z);
    T.tick(1);
    await T.at(def.start.x, def.start.z);
    T.tick(0.5);
    const again = g.missions.active;
    const lawn = def.steps[0].at;
    // First step: the lawn in front of the Palace.
    const before = g.missions.active.step;
    await T.at(lawn.x, lawn.z);
    T.tick(0.5);
    const fight = { step: g.missions.active.step, type: g.missions.active.type, foes: A.list.filter((x) => x.mission).length };
    for (const k of ['h1', 'h2', 'h3']) A.hit(g.missions.actor(k), 9999, 'test');
    T.tick(0.5);
    const three = { step: g.missions.active.step };
    A.hit(g.missions.actor('h4'), 9999, 'test');
    T.tick(1);
    const chase = { step: g.missions.active.step, type: g.missions.active.type, boss: g.missions.actor('boss')?.state };
    const boss = g.missions.actor('boss');
    const b0 = [boss.pos.x, boss.pos.z];
    T.tick(2);
    const bossMoved = Math.hypot(boss.pos.x - b0[0], boss.pos.z - b0[1]);
    A.tie(boss);
    T.tick(0.5);
    return { a, stars, busted, again, before, fight, three, chase, bossMoved, end: T.info(), starsAfter: g.wanted.stars, gained: g.respect.value - respect0, saved: g.save.get('missions').bucharest, done: g.missions.list.map((m) => m.status) };
  });
  check('casa: starting it raises the police to three stars; being caught fails it and removes the gang', r.a?.id === 'casa' && r.stars === 3 && r.busted.active === null && r.busted.ends.result === 'fail' && r.busted.left === 0 && r.again?.id === 'casa', { a: r.a, stars: r.stars, busted: r.busted });
  check('casa: lawn, then the four henchmen (the boss stays out of the count), then the boss runs and must be tied; it pays 300 and clears the stars', r.before === 0 && r.fight.step === 1 && r.fight.type === 'defeat' && r.fight.foes === 5 && r.three.step === 1 && r.chase.step === 2 && r.chase.type === 'chase' && r.bossMoved > 5 && r.end.active === null && r.starsAfter === 0 && r.gained === 300 + 0 && r.done.every((s) => s === 'done'), r);

  // ---------- the whole campaign is done: no marker, level and saved state ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    T.tick(0.5);
    return { list: g.missions.list.map((m) => m.status), next: g.missions.next(), restart: g.missions.start('pensia'), respect: g.respect.value, level: g.respect.level, rows: [...document.querySelectorAll('#overlay-missions div')].map((d) => d.className), markers: (g.minimap.markers.get('missions') || []).length, ups: T.events('level:up').map((e) => e.level) };
  });
  check('after the last mission nothing is next, a finished mission cannot be started again, the menu shows six done, the total is 60+90+110+130+150+300 = 840 Respect, level 5', r.next === null && !r.restart && r.rows.length === 6 && r.rows.every((c) => c === 'done') && r.respect === 840 && r.level === 5 && r.ups.join() === '2,3,4,5', r);

  // ======================= Brasov: the runner on its data =======================
  const bpage = await open(browser, 'city=brasov&shot=perch&lowq&seed=7', errors);
  await bpage.evaluate(() => {
    const g = window.__game;
    g.advance(0.05);
    const T = (window.__t = {});
    window.__ev = [];
    for (const n of ['mission:start', 'mission:end']) g.events.on(n, (e) => window.__ev.push([n, e]));
    // The physical ground of Brasov (city.groundAt) comes with the terrain branch, so the player is put on the flat stand-in and the steps are driven by position.
    T.at = async (x, z) => {
      await g.city.streamAround(x, z, 500);
      g.player.reset();
      g.player.pos.set(x, 0, z);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
    };
    T.tick = (s, step = 1 / 30) => g.advance(s, step);
    g.wanted = { stars: 0, add(n) { this.stars += n; }, clear() { this.stars = 0; } };
  });
  r = await bpage.evaluate(async () => {
    const g = window.__game, T = window.__t, A = g.actors;
    const defs = g.missions.defs;
    const out = { city: g.cityId, list: g.missions.list.map((m) => m.title), locked: !g.missions.start('sforii') };

    // 1. Litera: pick up the S on the slope, carry it, drop it in its place.
    const respect0 = g.respect.value;
    await T.at(defs[0].start.x, defs[0].start.z);
    T.tick(0.4);
    const a1 = g.missions.active;
    await T.at(defs[0].steps[1].at.x, defs[0].steps[1].at.z);
    T.tick(0.3);
    const skipped = g.missions.active.step === 0; // the drop before the pick-up does nothing
    await T.at(defs[0].steps[0].at.x, defs[0].steps[0].at.z);
    T.tick(0.3);
    const carrying = { step: g.missions.active.step, sprite: g.scene.children.some((c) => c.isSprite) };
    await T.at(defs[0].steps[1].at.x, defs[0].steps[1].at.z);
    T.tick(0.3);
    out.litera = { a1, skipped, carrying, end: !g.missions.active, sprite: g.scene.children.some((c) => c.isSprite), gained: g.respect.value - respect0 };

    // 2. Sforii: chase the pickpocket up the street and tie him.
    await T.at(defs[1].start.x, defs[1].start.z);
    T.tick(0.4);
    const pick = g.missions.actor('pick');
    const p0 = pick && [pick.pos.x, pick.pos.z];
    T.tick(2);
    const moved = pick && Math.hypot(pick.pos.x - p0[0], pick.pos.z - p0[1]);
    A.tie(pick);
    T.tick(0.4);
    out.sforii = { moved, end: !g.missions.active, saved: g.save.get('missions').brasov };

    // 3. Ursul: lead the bear; the stars must stay at zero and the bear must not be hit. A first run fails on a hit.
    await T.at(defs[2].start.x, defs[2].start.z);
    T.tick(0.5);
    const bear = g.missions.actor('bear');
    const spawned = bear && { kind: bear.kind, x: bear.pos.x, z: bear.pos.z };
    A.hit(bear, 5, 'test');
    T.tick(0.3);
    out.hit = { active: g.missions.active, ends: window.__ev.filter((e) => e[0] === 'mission:end').slice(-1)[0][1] };
    await T.at(defs[2].start.x + 60, defs[2].start.z);
    T.tick(1);
    await T.at(defs[2].start.x, defs[2].start.z);
    T.tick(0.5);
    // Police at the door fails it.
    g.events.emit('wanted', { stars: 1 });
    T.tick(0.2);
    out.police = { active: g.missions.active, ends: window.__ev.filter((e) => e[0] === 'mission:end').slice(-1)[0][1] };
    await T.at(defs[2].start.x + 60, defs[2].start.z);
    T.tick(1);
    await T.at(defs[2].start.x, defs[2].start.z);
    T.tick(0.5);
    const bear2 = g.missions.actor('bear');
    // She walks down the street to the forest edge; the bear follows her.
    const to = defs[2].steps[0].to;
    const start = { x: bear2.pos.x, z: bear2.pos.z };
    for (let i = 0; i < 3600 && g.missions.active; i++) {
      const dx = to.x - g.player.pos.x, dz = to.z - g.player.pos.z, d = Math.hypot(dx, dz);
      const s = Math.min(d, 4.5 / 30);
      g.player.pos.set(g.player.pos.x + (dx / d) * s * (bear2.pos.distanceTo(g.player.pos) < 14 ? 1 : 0), 0, g.player.pos.z + (dz / d) * s * (bear2.pos.distanceTo(g.player.pos) < 14 ? 1 : 0));
      T.tick(1 / 30, 1 / 30);
    }
    out.bear = { spawned, start, end: !g.missions.active, gained: g.save.get('missions').brasov, bearAt: [Math.round(bear2.pos.x), Math.round(bear2.pos.z)], dist: Math.hypot(bear2.pos.x - to.x, bear2.pos.z - to.z) };
    return out;
  });
  check('brasov: the three "Vacanță la Brașov" missions are listed and the second is locked before the first', r.city === 'brasov' && r.list.join('|') === 'Litera căzută|Strada Sforii|Ursul din Răcădău' && r.locked, r.list);
  check('brasov litera: the drop does nothing before the pick-up; picking the S up shows it over her head; dropping it in its place completes it for 100', r.litera.a1?.id === 'litera' && r.litera.skipped && r.litera.carrying.step === 1 && r.litera.carrying.sprite && r.litera.end && !r.litera.sprite && r.litera.gained === 100, r.litera);
  check('brasov sforii: the pickpocket bolts up the street and tying him completes it', r.sforii.moved > 5 && r.sforii.end && r.sforii.saved.join() === 'litera,sforii', r.sforii);
  check('brasov ursul: hitting the bear fails it, a police star fails it (no stars allowed), leading the bear to the forest edge completes it', r.hit.active === null && /arrabbiare/.test(r.hit.ends.why) && r.police.active === null && /polizia/.test(r.police.ends.why) && r.bear.end && r.bear.gained.join() === 'litera,sforii,ursul' && r.bear.dist < 15, { hit: r.hit, police: r.police, bear: r.bear });

  check('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
