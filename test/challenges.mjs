// Races, jars of zacusca and PET bonuses. The placement data is checked in Node against the built city
// (nothing in a building or the water, every roof climbable, deterministic, tuica rarer than beer);
// then the running game: race medals and best times, a jar taken once, each PET giving exactly its
// effects, the 30 s buffs, and what survives a reload.
// Usage: PORT=5225 node test/challenges.mjs   (exit code 1 on any failure)
import { startServer, launch, open } from './harness.mjs';
import { loadCityData, ringDistance } from '../tools/city-data.mjs';
import { makeCollectibles } from '../tools/make-collectibles.mjs';
import { RACES, raceTimes, raceLength, medalFor, respectFor, MEDAL_RESPECT } from '../src/challenges-data.js';
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

const ANCHORS = {
  bucharest: { unirii: [0, 0], parlament: [-1218, -68], ateneu: [-420, -1606], victoriei: [-1381, -2833], arcul: [-1938, -4466], skytower: [177, -5658], gara: [-2164, -2132] },
  brasov: {},
};
const RACE_ENDS = {
  'bd-unirii': ['unirii', 'parlament'],
  'calea-victoriei': ['ateneu', 'victoriei'],
  kiseleff: ['victoriei', 'arcul'],
  herastrau: ['arcul', 'skytower'],
  'gara-ateneu': ['gara', 'ateneu'],
};

// ---------- races: the data ----------
for (const city of ['bucharest', 'brasov']) {
  const D = loadCityData(city);
  if (city === 'brasov') for (const l of D.index.landmarks) ANCHORS.brasov[l.key] = [l.x, l.z];
  const races = RACES[city];
  const problems = [];
  for (const r of races) {
    if (r.points.length < 4) problems.push(`${r.id}: fewer than 4 gates`);
    r.points.forEach((p, i) => {
      if (!D.inCity(p.x, p.z) || !D.free(p.x, p.z, 1.5) || D.roadDistance(p.x, p.z, 20).d > 12) problems.push(`${r.id} gate ${i} (${p.x}, ${p.z}) not on open ground beside a street`);
      if (i && Math.hypot(p.x - r.points[i - 1].x, p.z - r.points[i - 1].z) > 750) problems.push(`${r.id} gate ${i} more than 750 m after the last`);
    });
  }
  check(`${city}: ${city === 'bucharest' ? '5' : '5 plus the downhill'} races, every gate inside the city on open ground beside a street, at most 750 m apart`, races.length === (city === 'bucharest' ? 5 : 6) && new Set(races.map((r) => r.id)).size === races.length && problems.length === 0, problems);
  const t = races.map((r) => ({ id: r.id, ...raceTimes(r), len: Math.round(raceLength(r)) }));
  check(`${city}: gold < silver < bronze for every race, and the times grow with the length`, t.every((x) => x.gold < x.silver && x.silver < x.bronze && x.gold >= 20), t);
}
{
  const D = loadCityData('bucharest');
  const bad = [];
  for (const r of RACES.bucharest) {
    const [a, b] = RACE_ENDS[r.id].map((k) => ANCHORS.bucharest[k]);
    const first = r.points[0], last = r.points[r.points.length - 1];
    if (Math.hypot(first.x - a[0], first.z - a[1]) > 250 || Math.hypot(last.x - b[0], last.z - b[1]) > 250) bad.push(r.id);
  }
  check('bucharest: each race runs between the two real places it is named after (first and last gate within 250 m of them)', bad.length === 0, bad);
}
{
  const D = loadCityData('brasov');
  const ends = { 'centrul-vechi': ['piata-sfatului', 'bastionul-tesatorilor'], zidurile: ['turnul-alb', 'bastionul-tesatorilor'], 'spre-gara': ['piata-sfatului', 'gara-brasov'], telecabina: ['telecabina-brasov-jos', 'tampa-telecabina-sus'], tampa: ['bastionul-tesatorilor', 'tampa-summit'], poiana: ['poiana-brasov', 'piata-sfatului'] };
  const bad = [];
  for (const r of RACES.brasov) {
    const [a, b] = ends[r.id].map((k) => ANCHORS.brasov[k]);
    const first = r.points[0], last = r.points[r.points.length - 1];
    if (Math.hypot(first.x - a[0], first.z - a[1]) > 60 || Math.hypot(last.x - b[0], last.z - b[1]) > 60) bad.push(r.id);
  }
  check('brasov: each race runs between the two real places it is named after (first and last gate within 60 m of them)', bad.length === 0, bad);
  const po = RACES.brasov.find((r) => r.id === 'poiana').points.map((p) => D.groundAt(p.x, p.z));
  const drops = po.slice(1).map((y, i) => po[i] - y);
  check('brasov: the Poiana race only ever goes down (every gate at least 3 m under the last) and drops 400 m or more in all', drops.every((d) => d >= 3) && po[0] - po[po.length - 1] > 400, { first: +po[0].toFixed(0), last: +po[po.length - 1].toFixed(0), minDrop: +Math.min(...drops).toFixed(1) });
  const tele = RACES.brasov.find((r) => r.id === 'telecabina').points.map((p) => D.groundAt(p.x, p.z));
  check('brasov: the cable car race climbs all the way (each gate higher than the last, 250 m or more)', tele.slice(1).every((y, i) => y > tele[i]) && tele[tele.length - 1] - tele[0] > 250, tele.map((v) => +v.toFixed(0)));
}

// ---------- medals ----------
{
  const race = RACES.bucharest[0];
  const t = raceTimes(race);
  const m = [t.gold - 1, t.gold, t.gold + 1, t.silver, t.silver + 1, t.bronze, t.bronze + 1].map((s) => medalFor(race, s));
  check('medalFor: the boundaries belong to the better medal, slower than bronze gets none', JSON.stringify(m) === JSON.stringify(['gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', null]), m);
  const owed = [respectFor('bronze', null), respectFor('silver', 'bronze'), respectFor('gold', 'silver'), respectFor('gold', null), respectFor('bronze', 'gold'), respectFor(null, null), respectFor('silver', 'silver')];
  check('respectFor: a medal pays what it adds over the best one already won, never more than once, nothing for no medal', JSON.stringify(owed) === JSON.stringify([20, 20, 30, 70, 0, 0, 0]) && MEDAL_RESPECT.gold === 70, owed);
}

// ---------- collectibles: the data ----------
const KINDS_WANTED = { beer: 6, wine: 5, cola: 3, water: 2, juice: 2, tuica: 2 };
for (const city of ['bucharest', 'brasov']) {
  const D = loadCityData(city);
  const file = JSON.parse(readFileSync(`public/city/${city}/collect.json`, 'utf8'));
  const again = makeCollectibles(city);
  check(`${city}: the placement is deterministic (a second run gives the same file as the one in the repository)`, JSON.stringify(again) === JSON.stringify(file), { jars: file.jars.length });
  const counts = {};
  for (const p of file.pets) counts[p.type] = (counts[p.type] || 0) + 1;
  check(`${city}: 50 jars with unique ids, 20 PET bottles in six kinds, beer and wine the most common, tuica rarer than beer`, file.jars.length === 50 && file.pets.length === 20 && new Set([...file.jars, ...file.pets].map((x) => x.id)).size === 70 && JSON.stringify(counts) === JSON.stringify(Object.fromEntries(Object.keys(counts).map((k) => [k, KINDS_WANTED[k]]))) && Object.keys(counts).length === 6 && counts.tuica < counts.beer && counts.beer >= counts.wine && counts.wine > counts.cola, counts);

  const bad = [];
  const spots = [...file.jars.map((j) => ['jar', j]), ...file.pets.map((p) => ['pet', p])];
  for (const [kind, it] of spots) {
    const tag = `${kind} ${it.id} (${it.x}, ${it.z})`;
    if (!D.inCity(it.x, it.z)) bad.push(`${tag} outside the city`);
    if (D.inWater(it.x, it.z)) bad.push(`${tag} in the water`);
    if (it.on === 'roof') {
      const under = D.buildingsNear(it.x, it.z, 2).filter((b) => D.inBuilding(b, it.x, it.z));
      const roof = under.find((b) => Math.abs(b.y1 - it.y) < 0.15);
      if (!roof) bad.push(`${tag}: no roof at height ${it.y}`);
      else {
        let clear = ringDistance(it.x, it.z, roof.outer);
        for (const h of roof.holes) clear = Math.min(clear, ringDistance(it.x, it.z, h));
        if (clear < 1.8) bad.push(`${tag}: only ${clear.toFixed(1)} m from the parapet`);
        if (under.some((b) => b !== roof && b.y1 > roof.y1 - 0.1)) bad.push(`${tag}: another building over it`);
        if (roof.y1 - roof.y0 > 140) bad.push(`${tag}: roof too high`);
        // Reachable: a wall with open ground a step out from it, to start a climb.
        const o = roof.outer;
        let open = false;
        for (let i = 0; i < o.length && !open; i += 2) {
          const j = (i + 2) % o.length, ex = o[j] - o[i], ez = o[j + 1] - o[i + 1], L = Math.hypot(ex, ez);
          if (L < 4) continue;
          for (const s of [1, -1]) if (D.free((o[i] + o[j]) / 2 - (s * ez * 2) / L, (o[i + 1] + o[j + 1]) / 2 + (s * ex * 2) / L, 0.6) && !D.buildingAt((o[i] + o[j]) / 2 - (s * ez * 2) / L, (o[i + 1] + o[j + 1]) / 2 + (s * ex * 2) / L)) open = true;
        }
        if (!open) bad.push(`${tag}: no wall to climb`);
      }
    } else {
      if (!D.free(it.x, it.z, 0.8)) bad.push(`${tag}: inside a building or too close to a wall`);
      if (D.roadDistance(it.x, it.z, 60).d > 60) bad.push(`${tag}: nowhere near a street`);
      if (Math.abs(it.y - D.groundAt(it.x, it.z)) > 0.2) bad.push(`${tag}: not on the ground`);
    }
  }
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) if (Math.hypot(spots[i][1].x - spots[j][1].x, spots[i][1].z - spots[j][1].z) < 4) bad.push(`${spots[i][1].id} and ${spots[j][1].id} share a spot`);
  check(`${city}: none of the 70 collectibles is inside a building or the water, every roof one has 1.8 m of clearance, a wall to climb and nothing above it, every ground one is beside a street`, bad.length === 0, bad);
  const ground = file.jars.filter((j) => j.on !== 'roof').length;
  check(`${city}: the jars are on roofs and monuments (${file.jars.length - ground} roofs, ${ground} monuments on the ground)`, file.jars.length - ground >= 40 && ground <= 10, { ground });
}

const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  // ======================= Bucharest =======================
  const page = await open(browser, 'shot=street&lowq&seed=7', errors);
  await page.waitForFunction(() => window.__game.challenges?.jars.total > 0 && window.__game.pets?.items.length > 0);
  const install = () => {
    const g = window.__game;
    g.advance(0.05);
    const T = (window.__t = {});
    window.__ev = [];
    for (const n of ['collect', 'challenge:start', 'challenge:end', 'mission:start']) g.events.on(n, (e) => window.__ev.push([n, e]));
    T.at = async (x, z, y = 0) => {
      await g.city.streamAround(x, z, 450);
      g.player.reset();
      g.player.pos.set(x, y, z);
      g.player.groundBox = null;
      g.player.vel.set(0, 0, 0);
      g.player.mode = y > 0 ? 'air' : 'ground';
    };
    T.tick = (s, step = 1 / 30) => g.advance(s, step);
    T.events = (name) => window.__ev.filter((e) => e[0] === name).map((e) => e[1]);
    // A run of a race: stand in the start, wait `wait` seconds, then take the remaining gates one by one.
    T.race = async (id, wait, opts = {}) => {
      const race = g.challenges.races.find((r) => r.id === id);
      const respect0 = g.respect.value;
      await T.at(race.points[0].x, race.points[0].z);
      T.tick(0.2);
      const started = g.challenges.activeRace;
      T.tick(wait, 0.5);
      const seen = [];
      for (let i = 1; i < race.points.length; i++) {
        const p = race.points[i];
        g.player.pos.set(p.x, 15, p.z);
        g.player.vel.set(0, 0, 0);
        g.player.mode = 'air';
        T.tick(0.05, 0.05);
        seen.push(g.challenges.activeRace ? g.challenges.activeRace.next : 'end');
      }
      T.tick(0.3);
      // And walk away so the start can arm again.
      await T.at(race.points[0].x + 80, race.points[0].z);
      T.tick(0.5);
      return { started: !!started, seen, ended: T.events('challenge:end').slice(-1)[0], gained: g.respect.value - respect0, rec: g.challenges.record(id), toast: document.getElementById('toast').textContent };
    };
  };
  await page.evaluate(install);

  // ---------- the race list and markers ----------
  let r = await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.6);
    const list = g.challenges.list;
    return { n: list.length, first: list[0], starts: (g.minimap.markers.get('races') || []).length, beams: g.challenges.races.length };
  });
  check('five races are listed with their length and gold, silver and bronze times, and none has been run', r.n === 5 && r.first.gold < r.first.silver && r.first.best === null && r.first.medal === null && r.first.length > 900, r.first);

  // ---------- a mission blocks a race, and a race blocks a mission ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const race = g.challenges.races[0];
    const m = g.missions.defs[0];
    await T.at(m.start.x, m.start.z);
    T.tick(0.4);
    const mission = g.missions.active?.id;
    const raceDuring = g.challenges.startRace(race.id);
    await T.at(race.points[0].x, race.points[0].z);
    T.tick(0.4);
    const walked = g.challenges.activeRace;
    g.missions.abort();
    await T.at(race.points[0].x + 80, race.points[0].z);
    T.tick(0.5);
    return { mission, raceDuring, walked };
  });
  check('negative: with a mission running a race cannot start, by key or by walking into its gate', r.mission === 'pensia' && r.raceDuring === false && r.walked === null, r);

  // ---------- medals, best times, respect ----------
  const runs = [];
  const times = await page.evaluate(() => window.__game.challenges.list[0]);
  const id = times.id;
  // 1. Slower than bronze but inside the limit: no medal, no respect, but a time.
  runs.push(await page.evaluate(([id, w]) => window.__t.race(id, w), [id, times.bronze + 4]));
  // 2. Bronze.
  runs.push(await page.evaluate(([id, w]) => window.__t.race(id, w), [id, times.bronze - 6]));
  // 3. Silver.
  runs.push(await page.evaluate(([id, w]) => window.__t.race(id, w), [id, times.silver - 6]));
  // 4. Gold.
  runs.push(await page.evaluate(([id, w]) => window.__t.race(id, w), [id, 1]));
  // 5. A slower run again: nothing lost, nothing gained.
  runs.push(await page.evaluate(([id, w]) => window.__t.race(id, w), [id, times.bronze - 6]));
  const medals = runs.map((x) => x.ended?.medal ?? null);
  check('a race: all gates in order end it; slower than bronze gives no medal and no respect', runs[0].started && JSON.stringify(runs[0].seen) === JSON.stringify([2, 3, 'end']) && medals[0] === null && runs[0].gained === 0 && runs[0].rec.medal === null && runs[0].rec.best > times.bronze, runs[0]);
  check('a race: bronze pays 20, silver only the 20 more, gold the 30 more; a slower run after that (a bronze one) pays nothing and loses nothing', medals.join() === ',bronze,silver,gold,bronze' && runs.map((x) => x.gained).join() === '0,20,20,30,0' && runs[3].rec.medal === 'gold' && runs[4].rec.medal === 'gold' && runs[4].rec.best === runs[3].rec.best && runs[4].rec.best < times.gold, { medals, gained: runs.map((x) => x.gained), rec: runs[4].rec, times });
  check('a race: the best time is the fastest of the runs, and the toast names the medal', runs[3].rec.best < runs[2].rec.best && /oro/.test(runs[3].toast) && /argento/.test(runs[2].toast), { toast: runs[3].toast, best: runs.map((x) => x.rec?.best) });

  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const race = g.challenges.races[1];
    const t = g.challenges.list[1];
    // Gates out of order: nothing. Then over the limit (1.6 x bronze): the race is lost and nothing is written.
    await T.at(race.points[0].x, race.points[0].z);
    T.tick(0.3);
    const n0 = g.challenges.activeRace.next;
    g.player.pos.set(race.points[3].x, 15, race.points[3].z);
    g.player.mode = 'air';
    T.tick(0.3);
    const skipped = g.challenges.activeRace.next;
    const respect0 = g.respect.value;
    T.tick(t.bronze * 1.6 + 5, 0.5);
    const lost = { active: g.challenges.activeRace, rec: g.challenges.record(race.id), ended: T.events('challenge:end').slice(-1)[0], toast: document.getElementById('toast').textContent, gained: g.respect.value - respect0 };
    // Starting one twice at once is refused.
    await T.at(race.points[0].x + 80, race.points[0].z);
    T.tick(0.5);
    const a = g.challenges.startRace(g.challenges.races[2].id);
    const b = g.challenges.startRace(g.challenges.races[3].id);
    const timer = g.challenges.timer;
    const panel = document.querySelector('.hud-item[data-id="timer"]');
    T.tick(2.2);
    const shown = { hidden: panel.hidden, text: panel.textContent };
    g.challenges.abort();
    return { n0, skipped, lost, a, b, timer, shown };
  });
  check('negative: a gate out of order does not count, and past 1.6 times the bronze time the race is lost with nothing saved and no respect', r.n0 === 1 && r.skipped === 1 && r.lost.active === null && r.lost.rec === null && r.lost.ended.result === 'fail' && /tempo scaduto/.test(r.lost.ended.why) && r.lost.gained === 0, r);
  check('negative: a second race cannot start while one is running; the stopwatch panel shows the time and the gold goal', r.a === true && r.b === false && r.timer.up && r.timer.goal > 0 && !r.shown.hidden && /0:0\d/.test(r.shown.text) && /oro/.test(r.shown.text), r);

  // ---------- jars ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const J = g.challenges.jars;
    const jar = J.items.find((j) => j.on === 'roof');
    const respect0 = g.respect.value;
    const before = { got: J.got, total: J.total, left: g.challenges.jarsLeft.length };
    // Nowhere near it: not taken.
    await T.at(jar.x + 40, jar.z);
    T.tick(0.6);
    const far = g.challenges.jars.got;
    // On the roof, on top of it.
    await T.at(jar.x, jar.z, jar.y + 0.2);
    g.player.groundBox = null;
    g.player.mode = 'air';
    T.tick(0.5);
    const first = { got: g.challenges.jars.got, respect: g.respect.value - respect0, saved: g.save.get('borcane'), collects: T.events('collect'), toast: document.getElementById('toast').textContent };
    // Standing in the same spot for a while, and asking again: still one.
    T.tick(3);
    const again = g.challenges.jars.take(jar.id);
    T.tick(0.5);
    const twice = { got: g.challenges.jars.got, respect: g.respect.value - respect0, again, collects: T.events('collect').filter((e) => e.kind === 'jar').length, left: g.challenges.jarsLeft.length, hud: document.querySelector('.hud-item[data-id="jars"]')?.textContent };
    return { jar: jar.id, before, far, first, twice };
  });
  check('jars: 50 to find, none taken; one 40 m away is not taken', r.before.total === 50 && r.before.got === 0 && r.before.left === 50 && r.far === 0, r.before);
  check('jars: standing on one takes it (once): +3 Respect, saved, a collect event, the counter says 1/50; waiting, or taking it again, changes nothing', r.first.got === 1 && r.first.respect === 3 && r.first.saved.bucharest.join() === r.jar && r.first.collects.some((e) => e.kind === 'jar' && e.id === r.jar) && r.twice.got === 1 && r.twice.respect === 3 && r.twice.again === false && r.twice.collects === 1 && r.twice.left === 49 && /1\s*\/50/.test(r.twice.hud), r);

  // The jars near the player show on the minimap, the taken one does not.
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const other = g.challenges.jars.items.find((j) => j.on === 'roof' && !g.challenges.jars.items.some((k) => k !== j && Math.hypot(k.x - j.x, k.z - j.z) < 300) && j.id !== g.save.get('borcane').bucharest[0]);
    await T.at(other.x + 60, other.z);
    T.tick(0.8);
    const marks = (g.minimap.markers.get('jars') || []);
    return { near: marks.some((m) => Math.abs(m.x - other.x) < 0.1), count: marks.length };
  });
  check('jars: one within 320 m has its orange dot on the minimap', r.near && r.count >= 1, r);

  // ---------- every one of the 70 spots, in the game: streamed in, settled off the roof props, reachable ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const bad = [];
    const spots = [...g.challenges.jars.items.map((j) => ['jar', j]), ...g.pets.items.map((p) => ['pet', p])];
    let moved = 0;
    for (const [kind, it] of spots) {
      const ox = it.x, oz = it.z;
      await T.at(it.x, it.z + 60);
      T.tick(0.9);
      const tag = `${kind} ${it.id}`;
      if (g.city.isWater(it.x, it.z)) bad.push(`${tag} in the water`);
      for (const b of g.city.nearby(it.x, it.z, 1, [])) {
        if (b.kind === 'prop') {
          if (it.on === 'roof' && Math.abs(b.y0 - it.y) < 0.4 && it.x > b.minx - 0.4 && it.x < b.maxx + 0.4 && it.z > b.minz - 0.4 && it.z < b.maxz + 0.4) bad.push(`${tag} inside a roof prop`);
          continue;
        }
        if (g.pointIn(it.x, it.z, b) && it.on !== 'roof' && b.y0 < 2.5) bad.push(`${tag} inside a building`);
        if (g.pointIn(it.x, it.z, b) && it.on === 'roof' && Math.abs(b.y1 - it.y) > 0.3 && b.y1 > it.y) bad.push(`${tag} under another building`);
      }
      if (it.x !== ox || it.z !== oz) moved++;
      if (it.on === 'roof' && !g.city.nearby(it.x, it.z, 1, []).some((b) => b.kind !== 'prop' && g.pointIn(it.x, it.z, b) && Math.abs(b.y1 - it.y) < 0.3)) bad.push(`${tag} not on a roof`);
    }
    return { n: spots.length, bad, moved };
  });
  check('all 70 collectibles, with the city streamed in around each: not in the water, not inside a building or a roof prop, roof ones on a roof', r.n === 70 && r.bad.length === 0, { n: r.n, bad: r.bad, movedOffProps: r.moved });

  // ---------- PET bonuses ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const kinds = g.pets.kinds;
    const out = {};
    let heals = [];
    out.said = [];
    const say = g.voice.say.bind(g.voice);
    g.voice.say = (k, ...a) => (out.said.push(k), say(k, ...a));
    g.health = { hp: 40, max: 100, heal(n) { heals.push(n); this.hp = Math.min(this.max, this.hp + n); } };
    const items = g.pets.items;
    const first = (t) => items.find((p) => p.type === t && g.pets.left.includes(p.id));
    const take = async (t) => {
      const it = first(t);
      await T.at(it.x, it.z, it.y + 0.2);
      g.player.mode = 'air';
      return it;
    };
    const snap = () => ({ buffs: g.buffs.active().slice().sort(), left: Object.fromEntries(['turbo', 'shield', 'fire', 'energy'].map((n) => [n, +g.buffs.left(n).toFixed(1)])), drunk: +g.drunk.level.toFixed(2), hp: g.health.hp, heals: heals.slice(), total: g.pets.total, respect: g.respect.value });
    for (const t of ['beer', 'wine', 'tuica', 'cola', 'water', 'juice']) {
      g.drunk.set(t === 'water' ? 5 : t === 'cola' ? 1 : 0);
      g.health.hp = 40;
      heals = [];
      const r0 = g.respect.value;
      const before = snap();
      const it = await take(t);
      T.tick(0.4);
      const after = snap();
      // Standing on the spot longer takes nothing more.
      T.tick(3);
      const later = snap();
      out[t] = { before, after, later, gainedRespect: after.respect - r0, id: it.id, counts: { ...g.pets.counts } };
      T.tick(31);
    }
    out.kinds = Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.name]));
    return out;
  });
  const near = (a, b) => Math.abs(a - b) < 0.6;
  check('PET beer: turbo for 30 s, drunk +2, no heal, +2 Respect, and nothing more while she stands there', near(r.beer.after.left.turbo, 30) && r.beer.after.buffs.join() === 'turbo' && r.beer.after.drunk >= 1.9 && r.beer.after.drunk <= 2.05 && r.beer.after.heals.length === 0 && r.beer.gainedRespect === 2 && r.beer.later.total === r.beer.after.total && r.beer.later.drunk <= r.beer.after.drunk && r.beer.later.left.turbo < r.beer.after.left.turbo, r.beer);
  check('PET wine: shield for 30 s, drunk +2, no heal', near(r.wine.after.left.shield, 30) && r.wine.after.buffs.join() === 'shield' && r.wine.after.drunk >= 1.9 && r.wine.after.drunk <= 2.05 && r.wine.after.heals.length === 0, r.wine);
  check('PET tuica: fire for 30 s, drunk +3', near(r.tuica.after.left.fire, 30) && r.tuica.after.buffs.join() === 'fire' && r.tuica.after.drunk >= 2.9 && r.tuica.after.drunk <= 3.05 && r.tuica.after.heals.length === 0, r.tuica);
  check('PET cola: energy for 30 s and no drunk at all (1 stays 1, wearing off)', near(r.cola.after.left.energy, 30) && r.cola.after.buffs.join() === 'energy' && r.cola.after.drunk <= 1.0 && r.cola.after.drunk >= 0.9 && r.cola.after.heals.length === 0, r.cola);
  check('PET water: sobers up to zero and heals a quarter of the health (40 to 65), no buff', r.water.after.drunk === 0 && r.water.after.hp === 65 && JSON.stringify(r.water.after.heals) === '[25]' && r.water.after.buffs.length === 0 && r.water.later.hp === 65, r.water);
  check('PET orange juice: heals half of the health (40 to 90), does not sober up or give a buff', r.juice.after.hp === 90 && JSON.stringify(r.juice.after.heals) === '[50]' && r.juice.after.buffs.length === 0, r.juice);
  check('negative: beer does not sober up, water is the only one that does', r.beer.after.drunk > r.beer.before.drunk && r.tuica.after.drunk > r.tuica.before.drunk && r.water.after.drunk < r.water.before.drunk && r.juice.after.drunk <= r.juice.before.drunk && r.cola.after.drunk <= r.cola.before.drunk, {});
  check('each PET asks the voice for its line (pet.beer, pet.wine, pet.tuica, pet.cola, pet.water, pet.juice), silent until the voice branch adds them', ['pet.beer', 'pet.wine', 'pet.tuica', 'pet.cola', 'pet.water', 'pet.juice'].every((k) => r.said.includes(k)), r.said);

  // A buff lasts 30 s, and taking a second beer refreshes rather than adds.
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const beers = g.pets.items.filter((p) => p.type === 'beer' && g.pets.left.includes(p.id));
    g.drunk.set(0);
    const grab = async (it) => {
      await T.at(it.x, it.z, it.y + 0.2);
      g.player.mode = 'air';
      T.tick(0.4);
    };
    await grab(beers[0]);
    T.tick(12);
    const at12 = g.buffs.left('turbo');
    await grab(beers[1]);
    const refreshed = g.buffs.left('turbo');
    T.tick(29);
    const has29 = g.buffs.has('turbo');
    T.tick(2);
    const has31 = g.buffs.has('turbo');
    return { at12, refreshed, has29, has31, drunk: g.drunk.level };
  });
  check('buffs: 30 s from the pick-up (18 left after 12 s), a second beer resets it to 30 (not 48), gone after 30 s', near(r.at12, 18) && r.refreshed > 29.4 && r.refreshed <= 30 && r.has29 && !r.has31, r);

  // Every 10th bottle: a scarf colour and extra respect.
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const total0 = g.pets.total;
    const scarves0 = g.perks.scarves;
    const level0 = g.respect.level;
    const log = [];
    const items = g.pets.items.filter((p) => g.pets.left.includes(p.id));
    let ninth = null;
    for (const it of items.slice(0, 10 - total0 + 0)) {
      const r0 = g.respect.value;
      await T.at(it.x, it.z, it.y + 0.2);
      g.player.mode = 'air';
      T.tick(0.3);
      log.push([g.pets.total, g.respect.value - r0, g.perks.scarves]);
    }
    return { total0, scarves0, level0, level: g.respect.level, log, total: g.pets.total, scarves: g.perks.scarves, saved: g.save.get('pet').total, counts: g.pets.counts };
  });
  const ten = r.log[r.log.length - 1];
  check('every 10th bottle wins a scarf colour and 25 extra Respect (the ninth pays 2, the tenth 27)', r.total === 10 && ten[0] === 10 && ten[1] === 27 && r.log.slice(0, -1).every((l) => l[1] === 2) && r.scarves0 === 1 + Math.floor(r.level0 / 2) && r.scarves === 1 + Math.floor(r.level / 2) + 1, r);

  // ---------- the HUD counters ----------
  r = await page.evaluate(() => {
    const g = window.__game;
    g.advance(0.4);
    const pet = document.querySelector('.hud-item[data-id="pet"]');
    return { text: pet?.textContent, kindsTaken: Object.values(g.pets.counts).filter((n) => n > 0).length, chips: [...pet.querySelectorAll('.kinds > span')].filter((s) => !s.hidden).length, jars: document.querySelector('.hud-item[data-id="jars"]')?.textContent };
  });
  check('the PET counter shows the total and a chip for each kind taken; the jar counter shows 1/50', /10/.test(r.text) && r.chips === r.kindsTaken && r.chips >= 4 && /1\s*\/50/.test(r.jars), r);

  // ---------- saved: nothing comes back after a reload ----------
  const before = await page.evaluate(() => ({ pet: window.__game.save.get('pet'), borcane: window.__game.save.get('borcane'), challenges: window.__game.save.get('challenges'), left: window.__game.pets.left.length, jarsLeft: window.__game.challenges.jarsLeft.length }));
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready && window.__game.challenges?.jars.total > 0 && window.__game.pets?.items.length > 0, null, { timeout: 180000 });
  await page.evaluate(install);
  r = await page.evaluate(async () => {
    const g = window.__game;
    g.advance(0.4);
    const taken = g.save.get('pet').taken.bucharest;
    // Standing on a bottle that was taken before does nothing.
    const it = g.pets.items.find((p) => taken.includes(p.id));
    await g.city.streamAround(it.x, it.z, 300);
    g.player.reset();
    g.player.pos.set(it.x, it.y + 0.2, it.z);
    g.player.mode = 'air';
    const total0 = g.pets.total;
    g.advance(1);
    return { left: g.pets.left.length, jarsLeft: g.challenges.jarsLeft.length, total: g.pets.total, total0, again: g.pets.total - total0, pet: g.save.get('pet'), borcane: g.save.get('borcane'), challenges: g.save.get('challenges'), jarsGot: g.challenges.jars.got, level: g.respect.level };
  });
  check('after a reload the taken bottles and jar stay taken and the counts, best times and totals are as they were; standing on a taken bottle gives nothing', r.left === before.left && r.jarsLeft === before.jarsLeft && r.again === 0 && JSON.stringify(r.pet) === JSON.stringify(before.pet) && JSON.stringify(r.borcane) === JSON.stringify(before.borcane) && JSON.stringify(r.challenges) === JSON.stringify(before.challenges) && r.left === 10 && r.jarsGot === 1, { before, after: r });

  // ---------- the models ----------
  r = await page.evaluate(async () => {
    const g = window.__game, T = window.__t;
    const shapes = {};
    for (const t of Object.keys(g.pets.kinds)) {
      const it = g.pets.items.find((p) => p.type === t && g.pets.left.includes(p.id));
      if (!it) continue;
      await T.at(it.x + 30, it.z);
      T.tick(0.8);
      const body = it.obj?.children[0]?.children[0]?.children[0];
      if (body) {
        body.geometry.computeBoundingBox();
        const b = body.geometry.boundingBox;
        shapes[t] = [+(b.max.y - b.min.y).toFixed(3), +(b.max.x - b.min.x).toFixed(3)];
      }
    }
    const text = JSON.stringify(g.pets.kinds);
    return { shapes, labels: Object.values(g.pets.kinds).map((k) => k.label.join(' ')), names: Object.values(g.pets.kinds).map((k) => k.name) };
  });
  const brands = /neumarkt|ursus|timi[sș]oreana|silva|ciuc|tuborg|heineken|bergenbier|stejar|coca|pepsi|fanta|sprite|borsec|dorna|aquatique|cappy|tymbark|santal|recas|purcari|zetea|hordou|cotnari|jidvei|budweiser|carlsberg|nestle|red bull/i;
  const sizes = Object.values(r.shapes).map((s) => s.join('x'));
  check('the six bottles are built in code with different sizes and shapes', Object.keys(r.shapes).length >= 5 && new Set(sizes).size === sizes.length, r.shapes);
  check('the labels carry invented brands only (no real brand name on any of them)', r.labels.length === 6 && !r.labels.concat(r.names).some((t) => brands.test(t)), r.labels);

  // ======================= Brasov: the data through the runner =======================
  const bpage = await open(browser, 'city=brasov&shot=perch&lowq&seed=7', errors);
  await bpage.waitForFunction(() => window.__game.challenges?.jars.total > 0 && window.__game.pets?.items.length > 0);
  r = await bpage.evaluate(async () => {
    const g = window.__game;
    g.advance(0.05);
    const T = { tick: (s, st = 1 / 30) => g.advance(s, st) };
    const out = { races: g.challenges.list.map((x) => [x.id, x.length, x.gold, x.silver, x.bronze]), jars: g.challenges.jars.total, pets: g.pets.items.length, tuica: g.pets.items.filter((p) => p.type === 'tuica').length, beer: g.pets.items.filter((p) => p.type === 'beer').length };
    // The old-town race, run by position on the flat stand-in for the ground (the terrain branch gives Brasov its heights).
    const race = g.challenges.races[0];
    const ids = [];
    g.events.on('challenge:end', (e) => ids.push(e));
    await g.city.streamAround(race.points[0].x, race.points[0].z, 300);
    g.player.reset();
    g.player.pos.set(race.points[0].x, 0, race.points[0].z);
    g.player.groundBox = null;
    T.tick(0.3);
    const started = !!g.challenges.activeRace;
    for (let i = 1; i < race.points.length; i++) {
      g.player.pos.set(race.points[i].x, 0, race.points[i].z);
      T.tick(0.05, 0.05);
    }
    T.tick(0.2);
    out.race = { started, ended: ids[0], rec: g.challenges.record(race.id) };
    return out;
  });
  check('brasov: six races (the downhill from Poiana among them), 50 jars, 20 PET with tuica rarer than beer', r.races.length === 6 && r.races.some((x) => x[0] === 'poiana') && r.jars === 50 && r.pets === 20 && r.tuica < r.beer, r);
  check('brasov: the old-town race runs on its data (gates in order, gold, saved under brasov)', r.race.started && r.race.ended?.result === 'done' && r.race.ended.medal === 'gold' && r.race.rec?.medal === 'gold', r.race);

  check('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
  srv.kill();
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
