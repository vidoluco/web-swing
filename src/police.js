import * as THREE from 'three';
import { roadsAround, planRoute, RoadDriver, sees, payRespect } from './crimelib.js';
import { clamp } from './config.js';

// The police, from 0 to 5 stars, in game.wanted = { stars, level, add(n), clear() }.
// Stars go up with 'heat' events ({ amount, why, pos }, amount in stars, 0.5 is half a star) and
// this system raises the heat itself for what only it can see: a car stolen in front of an officer,
// a patrol car rammed, drunk driving near an officer. Stars go down when no officer has had a line
// of sight to Bunica for 20 to 40 s (a high roof helps: they need to see her, and cars and
// people on foot cannot get up there). From star 1 patrol cars drive the real roads to her; from
// star 3 officers on foot with nets and tasers, and roadblocks across the major roads ahead; star
// 5 has more of everything. A cop who reaches her busts her: the stars are cleared and she wakes
// up in front of the nearest police station, with less Respect.

// Units wanted at each star level.
const CARS = [0, 1, 2, 2, 3, 5];
const COPS = [0, 0, 0, 3, 5, 7];
const BLOCKS = [0, 0, 0, 1, 2, 2];
const hideTime = (stars) => 20 + 5 * (stars - 1); // seconds out of sight before a star goes
const BUST_PENALTY = 25;
const CRUISE = 19; // patrol car speed, m/s
const SIGHT = { car: 110, cop: 85 };
const NET_T = 2.2;

// Police stations from OpenStreetMap (amenity=police in the Geofabrik extract of 29/09/2026, cut with
// osmium tags-filter and projected on the origin of each city): the numbered sections and a few central
// offices. The city data itself has no police places, so the list lives here. [name, x, z].
const STATIONS = {
  bucharest: [
    ['Secția 10, Centrul Vechi', 320, -555], ['Poliția Centru Istoric', -153, -427], ['Secția 14', 248, 378], ['Secția 1', -713, -2449], ['Secția 2', -1030, -7086],
    ['Secția 3', -1133, -1615], ['Secția 4', -2346, -3208], ['Secția 5', -4777, -6115], ['Secția 6', 168, -2749], ['Secția 7', 2088, -3377],
    ['Secția 8', 2683, -1320], ['Secția 9', 4563, -2027], ['Secția 10', 1475, -336], ['Secția 11', 1838, 576], ['Secția 12', 3036, 92],
    ['Secția 13', 5853, 1217], ['Secția 15', 1320, 4364], ['Secția 16', -402, 3647], ['Secția 17', -2550, -757], ['Secția 18', -1212, 1160],
    ['Secția 19', -2982, 2401], ['Secția 20', -4139, -2866], ['Secția 21', -6448, -1101], ['Secția 22', -5251, 335], ['Secția 23', 7685, 21],
    ['Secția 24', -787, 3355], ['Secția 25', -6273, 1375], ['Secția 26', 2781, 6033],
  ],
  brasov: [
    ['Secția 1', 1103, -758], ['Secția 2', -527, -942], ['Secția 3', 1230, -1389], ['Secția 4', 2355, -30], ['Secția 5', 3211, -609],
    ['IJP Brașov', 1838, -655], ['Poliția Locală', 759, -101], ['Poliția Poiana Brașov', -2777, 5410],
  ],
};

// One pair of roof lights for every patrol car: red and blue, flashing in turn.
const LIGHT = new THREE.BoxGeometry(0.34, 0.12, 0.2);
const RED = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const BLUE = new THREE.MeshBasicMaterial({ color: 0x2a6bff });

export function create(game) {
  const { events, traffic, city } = game;
  let level = 0; // stars as a number 0 to 5; the whole part is game.wanted.stars
  let sightT = 0; // seconds since an officer last saw her
  let seen = false;
  let checkT = 0;
  let busting = false;
  let netT = 0;
  let spawnT = 3;
  let lastDrive = 0;
  let drunkHeatT = -99;
  let planBudget = 1;
  let time = 0;
  let stations = STATIONS[game.cityId] || STATIONS.bucharest;
  const pursuers = [], cops = [], blocks = [], shots = [];
  const offs = [];

  const rng = () => game.rng();
  const P = () => game.player.pos;
  const ground = (x, z) => city.groundAt?.(x, z) ?? 0;
  const say = (kind) => game.voice?.say?.(kind, game.drunk?.amount ?? 0);
  const roadCars = () => traffic.cars.filter((c) => c.type === 'police' && (c.mode === 'pursuit' || c.mode === 'block' || c.mode === 'traffic'));

  // ---------- the wanted level ----------

  const wanted = {
    get level() {
      return level;
    },
    get stars() {
      return Math.floor(level + 1e-6);
    },
    // Heat in stars, positive or negative.
    add(n) {
      if (busting || !Number.isFinite(n) || n === 0) return;
      if (n > 0) sightT = 0;
      setLevel(level + n);
    },
    clear() {
      setLevel(0, true);
    },
  };
  game.wanted = wanted;

  function setLevel(v, quiet) {
    const before = wanted.stars;
    level = clamp(v, 0, 5);
    const now = wanted.stars;
    if (now === before) return;
    events.emit('wanted', { stars: now });
    if (quiet) return;
    if (now > before) for (const n of [5, 3, 1]) if (before < n && now >= n) return say('wanted' + n);
    if (now === 0) {
      say('escaped');
      game.hud?.toast('Le hai seminate!', 2);
    }
  }

  // ---------- who can see her ----------

  // The officers that can see: patrol cars (also the ones in ordinary traffic) and cops on foot.
  function officers() {
    const out = [];
    for (const c of roadCars()) out.push({ x: c.x, y: c.obj.position.y + 1.5, z: c.z, r: SIGHT.car });
    for (const a of game.actors?.list || []) {
      if (a.kind === 'cop' && !a.removed && !a.tied && a.state !== 'down' && a.state !== 'stunned') out.push({ x: a.pos.x, y: a.pos.y + 1.7, z: a.pos.z, r: SIGHT.cop });
    }
    return out;
  }

  // Does an officer within range have a line of sight to (x, y + 1.2, z)?
  function witness(x, y, z, range) {
    const list = officers().filter((o) => Math.hypot(o.x - x, o.z - z) < Math.min(o.r, range ?? Infinity));
    list.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return list.slice(0, 6).some((o) => sees(city, o.x, o.y, o.z, x, y + 1.2, z));
  }

  // ---------- units ----------

  function lights(car) {
    const a = new THREE.Mesh(LIGHT, RED), b = new THREE.Mesh(LIGHT, BLUE);
    a.position.set(-0.3, car.h + 0.04, 0);
    b.position.set(0.3, car.h + 0.04, 0);
    car.obj.add(a, b);
    car.lights = [a, b];
  }

  // A patrol car on a road 120 to 260 m from Bunica, out of her sight when it can be.
  function spawnCar(mode, minD = 120, maxD = 260, major = false) {
    const p = P(), roads = roadsAround(city, p.x, p.z, maxD + 60).filter((r) => !major || r.major);
    for (let n = 0; n < 50 && roads.length; n++) {
      const r = roads[(rng() * roads.length) | 0], i = (rng() * (r.pts.length / 2 - 1)) | 0, t = rng();
      const ax = r.pts[2 * i], az = r.pts[2 * i + 1], ex = r.pts[2 * i + 2] - ax, ez = r.pts[2 * i + 3] - az;
      const x = ax + ex * t, z = az + ez * t, d = Math.hypot(x - p.x, z - p.z);
      if (d < minD || d > maxD || Math.hypot(ex, ez) < 8 || city.isWater(x, z) || traffic.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
      if (n < 35 && sees(city, x, 1.5, z, p.x, p.y + 1.2, p.z)) continue;
      const car = traffic.make('police');
      // Facing along the road towards her.
      Object.assign(car, { x, z, yaw: Math.atan2(ex, ez) + (ex * (p.x - x) + ez * (p.z - z) > 0 ? 0 : Math.PI), speed: 0, mode });
      traffic.cars.push(car);
      traffic.poseObj(car);
      lights(car);
      return car;
    }
    return null;
  }

  function spawnPursuer() {
    const car = spawnCar('pursuit');
    if (!car) return false;
    pursuers.push({ car, drv: new RoadDriver(traffic, car), state: 'chase', planT: 0, stopT: 0, boxedT: 0, born: time, goal: null });
    return true;
  }

  // Two cars across a major road, 150 to 280 m from Bunica and ahead of her if she is on the move.
  function spawnBlock() {
    const p = P(), v = game.player.vel;
    const moving = Math.hypot(v.x, v.z) > 4;
    let best = null, bs = -Infinity;
    const roads = roadsAround(city, p.x, p.z, 340).filter((r) => r.major);
    for (let n = 0; n < 40 && roads.length; n++) {
      const r = roads[(rng() * roads.length) | 0], i = (rng() * (r.pts.length / 2 - 1)) | 0;
      const ax = r.pts[2 * i], az = r.pts[2 * i + 1], ex = r.pts[2 * i + 2] - ax, ez = r.pts[2 * i + 3] - az, L = Math.hypot(ex, ez);
      if (L < 10) continue;
      const x = ax + ex / 2, z = az + ez / 2, d = Math.hypot(x - p.x, z - p.z);
      if (d < 150 || d > 280 || city.isWater(x, z) || blocks.some((b) => Math.hypot(b.x - x, b.z - z) < 120) || traffic.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 8)) continue;
      const score = (moving ? ((x - p.x) * v.x + (z - p.z) * v.z) / (d * Math.hypot(v.x, v.z)) : 0) + rng() * 0.3;
      if (score > bs) (bs = score), (best = { x, z, ex: ex / L, ez: ez / L, w: r.w });
    }
    if (!best) return false;
    const cars = [];
    for (const side of [-1, 1]) {
      const car = traffic.make('police');
      const off = side * best.w * 0.2;
      Object.assign(car, { x: best.x - best.ez * off, z: best.z + best.ex * off, yaw: Math.atan2(best.ex, best.ez) + Math.PI / 2, speed: 0, mode: 'block' });
      traffic.cars.push(car);
      traffic.poseObj(car);
      lights(car);
      cars.push(car);
    }
    blocks.push({ x: best.x, z: best.z, cars, state: 'hold', leftAt: 0 });
    return true;
  }

  // A cop on foot: from a pavement 70 to 130 m off, or from a patrol car that has just stopped.
  function spawnCop(at) {
    const A = game.actors;
    if (!A) return null;
    let spot = at;
    if (!spot) {
      const p = P(), ang = rng() * Math.PI * 2, d = 70 + rng() * 60;
      spot = A.randomWalkPoint({ x: p.x + Math.sin(ang) * d, z: p.z + Math.cos(ang) * d }, 25);
      const dd = Math.hypot(spot.x - p.x, spot.z - p.z);
      if (dd < 50 || dd > 170) return null;
    }
    const a = A.spawn('cop', spot, { persist: true });
    if (!a) return null;
    cops.push({ a, cool: 1.5 + rng() * 2, type: rng() < 0.5 ? 'taser' : 'net', leftAt: 0, goalT: 0 });
    return a;
  }

  // ---------- one tick ----------

  function update(dt) {
    time = game.time;
    planBudget = 1;
    const p = P(), stars = wanted.stars;
    const me = game.driving?.();

    if (!busting) {
      // Who sees her, four times a second. Being seen (or a fresh crime) restarts the wait.
      if ((checkT -= dt) <= 0) {
        checkT = 0.25;
        seen = level > 0 && witness(p.x, p.y, p.z);
      }
      if (level >= 1) {
        const high = p.y - ground(p.x, p.z) > 15;
        sightT = seen ? 0 : sightT + dt * (high ? 1.5 : 1);
        if (sightT > hideTime(stars)) {
          sightT = 0;
          setLevel(stars - 1);
        }
      } else if (level > 0 && !seen) level = Math.max(0, level - dt / 20);
      population(dt, stars);
      heatFromWorld(dt, me);
    }
    for (const u of [...pursuers]) tickPursuer(u, dt, p, me);
    for (const b of [...blocks]) tickBlock(b, p);
    for (const c of [...cops]) tickCop(c, dt, p);
    tickShots(dt, p);
    tickNet(dt, p, me);
    flash();
    siren(p);
    lastDrive = me ? me.speed : 0;
  }

  // ---------- what makes heat ----------

  function heatFromWorld(dt, me) {
    if (!me) return;
    // Drunk at the wheel with an officer looking.
    if (game.drunk?.amount > 0.35 && time - drunkHeatT > 8 && witness(me.x, 1, me.z, 45)) {
      drunkHeatT = time;
      events.emit('heat', { amount: 0.5, why: 'drunk-driving', pos: { x: me.x, z: me.z } });
    }
    // A patrol car hit at speed.
    if (Math.abs(lastDrive) > 5) {
      for (const o of roadCars()) {
        if (o === me || time - (o.rammedAt ?? -9) < 3 || Math.hypot(o.x - me.x, o.z - me.z) > (me.len + o.len) / 4 + 1.4) continue;
        o.rammedAt = time;
        events.emit('heat', { amount: 1, why: 'police-ram', pos: { x: o.x, z: o.z } });
      }
    }
  }

  // ---------- how many of each ----------

  function population(dt, stars) {
    const live = (l) => l.filter((u) => u.state !== 'leave' && !u.leftAt);
    const cars = live(pursuers), foot = live(cops), bl = live(blocks);
    // Fewer wanted than there are: the oldest ones go home.
    const extra = (list, n) => list.length > n && list[0];
    for (const [list, n] of [[cars, CARS[stars]], [foot, COPS[stars]], [bl, BLOCKS[stars]]]) {
      const u = extra(list, n);
      if (u) leave(u);
    }
    if ((spawnT -= dt) > 0) return;
    spawnT = 0.8;
    if (cars.length < CARS[stars]) spawnPursuer();
    else if (foot.length < COPS[stars]) spawnCop();
    else if (bl.length < BLOCKS[stars]) spawnBlock();
  }

  // A unit stands down: it drives or walks off and is removed once it is well away.
  function leave(u) {
    if (u.car) {
      u.state = 'leave';
      u.goal = null;
      u.leaveAt = time;
    } else if (u.cars) u.leftAt = time;
    else if (u.a) u.leftAt = time;
  }

  function standDown() {
    for (const u of pursuers) if (u.state !== 'leave') leave(u);
    for (const c of cops) if (!c.leftAt) leave(c);
    for (const b of blocks) if (!b.leftAt) leave(b);
  }

  // ---------- patrol cars ----------

  function tickPursuer(u, dt, p, me) {
    const car = u.car, d = Math.hypot(car.x - p.x, car.z - p.z);
    if (!traffic.cars.includes(car) || car.mode !== 'pursuit') return drop(u);
    if (u.state === 'leave') {
      if (!u.goal && planBudget > 0) {
        planBudget--;
        u.goal = { x: car.x + (car.x - p.x) * 3, z: car.z + (car.z - p.z) * 3 };
        const route = planRoute(city, car, u.goal, { anyWay: true });
        if (route) u.drv.follow(route);
      }
      u.drv.update(dt, CRUISE * 0.7);
      if (d > 90 || time - u.leaveAt > 20) return drop(u, true);
      return;
    }
    if (d > 380) return drop(u, true);
    const reachable = p.y - ground(p.x, p.z) < 4.5;
    if (u.state === 'stop') {
      u.drv.update(dt, 0);
      if (Math.abs(car.speed) < 1.5 && !u.unloaded) {
        u.unloaded = true;
        u.stopT = 6;
        const sx = Math.cos(car.yaw), sz = -Math.sin(car.yaw);
        for (const side of [2.3, -2.3]) if (cops.filter((c) => !c.leftAt).length < COPS[Math.max(3, wanted.stars)]) spawnCop({ x: car.x + sx * side, z: car.z + sz * side });
      }
      if (u.unloaded && (u.stopT -= dt) <= 0) (u.state = 'chase'), (u.unloaded = false);
      return;
    }
    // Boxed in: a car on top of hers while she drives and is slow.
    if (me && d < 5 && Math.abs(me.speed) < 4) {
      if ((u.boxedT += dt) > 1.4) return void bust('boxed');
    } else u.boxedT = 0;
    // Stops beside her, or where the road ends if she is off it.
    if (reachable && !me && (d < 9 || (u.drv.done && d < 40))) {
      u.state = 'stop';
      return;
    }
    // A new route to where she is every couple of seconds.
    if ((u.planT -= dt) <= 0 && planBudget > 0) {
      planBudget--;
      u.planT = 2 + (pursuers.indexOf(u) % 4) * 0.25;
      if (!u.goal || Math.hypot(u.goal.x - p.x, u.goal.z - p.z) > 20 || u.drv.done) {
        u.goal = { x: p.x, z: p.z };
        const route = planRoute(city, car, u.goal, { anyWay: true });
        if (route) u.drv.follow(route);
      }
    }
    u.drv.update(dt, CRUISE);
  }

  function drop(u, remove) {
    const i = pursuers.indexOf(u);
    if (i >= 0) pursuers.splice(i, 1);
    if (remove && traffic.cars.includes(u.car)) traffic.remove(u.car);
  }

  function tickBlock(b, p) {
    b.cars = b.cars.filter((c) => c.mode === 'block' && traffic.cars.includes(c));
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (!b.cars.length || d > 430 || (b.leftAt && (d > 80 || time - b.leftAt > 25))) {
      for (const c of b.cars) if (traffic.cars.includes(c)) traffic.remove(c);
      blocks.splice(blocks.indexOf(b), 1);
    }
  }

  // ---------- cops on foot ----------

  function tickCop(c, dt, p) {
    const a = c.a, A = game.actors;
    if (a.removed) return void cops.splice(cops.indexOf(c), 1);
    if (a.tied) {
      a.persist = false;
      return void cops.splice(cops.indexOf(c), 1);
    }
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.hypot(dx, dz);
    if (c.leftAt) {
      if ((c.goalT -= dt) <= 0) {
        c.goalT = 3;
        const q = A.randomWalkPoint({ x: a.pos.x - dx * 0.5, z: a.pos.z - dz * 0.5 }, 60);
        A.walkTo(a, q.x, q.z, a.speedWalk);
      }
      if (d > 70 || time - c.leftAt > 20) {
        a.remove();
        cops.splice(cops.indexOf(c), 1);
      }
      return;
    }
    if (d > 260) {
      a.remove();
      return void cops.splice(cops.indexOf(c), 1);
    }
    if (a.state === 'down' || a.state === 'stunned') return;
    if ((c.goalT -= dt) <= 0 || !a.hasGoal) {
      c.goalT = 0.6;
      A.walkTo(a, p.x, p.z, a.speedRun);
    }
    // Close enough to lay hands on her, on the same level.
    if (d < 1.9 && Math.abs(p.y - a.pos.y) < 2.4) return void bust('cop');
    if ((c.cool -= dt) <= 0 && d < 15 && d > 3 && Math.abs(p.y - a.pos.y) < 12 && sees(city, a.pos.x, a.pos.y + 1.5, a.pos.z, p.x, p.y + 1.2, p.z)) {
      c.cool = 3 + rng() * 2;
      fire(a, c.type, p);
    }
  }

  // ---------- nets and tasers ----------

  const shotMesh = { net: new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })), taser: new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe040 })) };
  const SHOT_SPEED = { net: 26, taser: 42 };

  function fire(a, type, p) {
    const v = game.player.vel, sx = a.pos.x, sy = a.pos.y + 1.3, sz = a.pos.z;
    const t0 = Math.hypot(p.x - sx, p.z - sz) / SHOT_SPEED[type];
    // Aim where she will be, with a little error.
    const tx = p.x + v.x * t0 * 0.8 + (rng() - 0.5) * 0.8, ty = p.y + 1.1 + v.y * t0 * 0.5, tz = p.z + v.z * t0 * 0.8 + (rng() - 0.5) * 0.8;
    const dx = tx - sx, dy = ty - sy, dz = tz - sz, L = Math.hypot(dx, dy, dz);
    const mesh = shotMesh[type].clone();
    mesh.position.set(sx, sy, sz);
    game.scene.add(mesh);
    shots.push({ type, mesh, vx: (dx / L) * SHOT_SPEED[type], vy: (dy / L) * SHOT_SPEED[type], vz: (dz / L) * SHOT_SPEED[type], life: 22 / SHOT_SPEED[type] });
    game.sfx?.play?.('door');
  }

  function tickShots(dt, p) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i], m = s.mesh;
      m.position.x += s.vx * dt;
      m.position.y += s.vy * dt;
      m.position.z += s.vz * dt;
      const hit = Math.hypot(m.position.x - p.x, m.position.y - (p.y + 1), m.position.z - p.z) < 1.1;
      if (hit && !busting) {
        if (s.type === 'net') {
          netT = NET_T;
          game.hud?.toast('Rete!', 1.2);
        } else {
          game.health?.damage?.(6, 'cop');
          netT = Math.max(netT, 0.6);
        }
      }
      if (hit || (s.life -= dt) <= 0) {
        game.scene.remove(m);
        shots.splice(i, 1);
      }
    }
  }

  // Tangled in a net: she loses her speed, and a wire ball shows it.
  const net = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.85 }));
  net.visible = false;
  game.scene.add(net);

  function tickNet(dt, p, me) {
    net.visible = netT > 0;
    if (netT <= 0) return;
    netT -= dt;
    const k = Math.exp(-5 * dt);
    if (me) me.speed *= k;
    else {
      game.player.vel.x *= k;
      game.player.vel.z *= k;
    }
    net.position.set(p.x, p.y + 1, p.z);
    net.rotation.y += dt * 2;
  }

  // ---------- flashing roof lights ----------

  function flash() {
    const on = Math.floor(time * 6) % 2 === 0;
    for (const c of traffic.cars) {
      if (!c.lights) continue;
      const lit = c.mode === 'pursuit' || c.mode === 'block';
      c.lights[0].visible = lit && on;
      c.lights[1].visible = lit && !on;
    }
  }

  // ---------- sirens ----------

  let sirenNodes = null;

  // A wailing tone through the sfx context: louder the nearer the closest patrol car, panned to its side.
  function siren(p) {
    const ctx = game.sfx?.ctx;
    if (!ctx) return;
    if (!sirenNodes) {
      const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), lp = ctx.createBiquadFilter(), gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 820;
      lfo.frequency.value = 0.6;
      depth.gain.value = 280;
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      gain.gain.value = 0;
      lfo.connect(depth).connect(osc.frequency);
      const pan = ctx.createStereoPanner?.();
      osc.connect(lp).connect(gain);
      if (pan) gain.connect(pan).connect(game.sfx.master);
      else gain.connect(game.sfx.master);
      osc.start();
      lfo.start();
      sirenNodes = { osc, lfo, gain, pan, level: 0 };
    }
    let near = null, nd = Infinity;
    for (const u of pursuers) {
      const d = Math.hypot(u.car.x - p.x, u.car.z - p.z);
      if (d < nd) (nd = d), (near = u.car);
    }
    sirenNodes.level = near ? Math.pow(clamp(1 - nd / 260, 0, 1), 2) * 0.12 : 0;
    sirenNodes.gain.gain.setTargetAtTime(sirenNodes.level, ctx.currentTime, 0.25);
    if (near && sirenNodes.pan) {
      // The camera looks along (-sin yaw, -cos yaw); its right is (cos yaw, -sin yaw).
      const cam = game.camera, rx = Math.cos(game.rig.yaw), rz = -Math.sin(game.rig.yaw);
      const dx = near.x - cam.position.x, dz = near.z - cam.position.z, L = Math.hypot(dx, dz) || 1;
      sirenNodes.pan.pan.setTargetAtTime(clamp((dx * rx + dz * rz) / L, -1, 1) * 0.8, ctx.currentTime, 0.1);
    }
  }

  // ---------- busted ----------

  function nearestStation(x, z) {
    let best = null, bd = Infinity;
    for (const s of stations) {
      const d = Math.hypot(s[1] - x, s[2] - z);
      if (d < bd) (bd = d), (best = { name: s[0], x: s[1], z: s[2], d });
    }
    return best;
  }

  // A free place in front of the station, on the pavement if there is one.
  function stationSpot(st) {
    const A = game.actors;
    const q = A.randomWalkPoint(st, 18);
    if (!A.blocked(q.x, q.z, 0.7)) return q;
    for (const r of [3, 5, 8, 12, 18, 26, 40]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, x = st.x + Math.sin(a) * r, z = st.z + Math.cos(a) * r;
        if (!A.blocked(x, z, 0.7)) return { x, z };
      }
    }
    return { x: st.x, z: st.z };
  }

  // A cop has her. Stars gone, less Respect, and she comes to in front of the nearest station.
  async function bust(by) {
    if (busting) return false;
    busting = true;
    try {
      const p = P(), st = nearestStation(p.x, p.z);
      events.emit('busted', { pos: { x: p.x, z: p.z }, station: st.name, by });
      say('busted');
      game.hud?.toast(`Ti hanno presa! Portata alla ${st.name}`, 3);
      payRespect(game, -BUST_PENALTY, 'busted');
      standDown();
      sightT = 0;
      seen = false;
      netT = 0;
      setLevel(0, true);
      const rec = city.recs.get(`${Math.floor(st.x / city.index.chunk)}_${Math.floor(st.z / city.index.chunk)}`);
      if (rec && rec.state !== 'loaded') await city.streamAround(st.x, st.z, 500);
      const spot = stationSpot(st);
      if (game.driving?.()) game.exitCar(false);
      const pl = game.player;
      pl.reset();
      pl.pos.set(spot.x, ground(spot.x, spot.z), spot.z);
      pl.lastSafe.copy(pl.pos);
      pl.groundBox = null;
      pl.idleTime = 2;
      game.look(Math.atan2(-(st.x - spot.x), -(st.z - spot.z)), -0.15);
      return true;
    } finally {
      busting = false;
    }
  }

  // ---------- system ----------

  const sys = {
    name: 'police',
    pursuers,
    cops,
    blocks,
    // Test hooks: the units wanted at each star level, and the same checks the system uses.
    caps: { cars: CARS, cops: COPS, blocks: BLOCKS },
    bust,
    nearestStation,
    spawnCop,
    witness,
    sees: (ax, ay, az, bx, by, bz) => sees(city, ax, ay, az, bx, by, bz),
    get stations() {
      return stations;
    },
    get netted() {
      return netT > 0;
    },
    get busting() {
      return busting;
    },
    get seen() {
      return seen;
    },
    get sightT() {
      return sightT;
    },
    get sirenLevel() {
      return sirenNodes ? sirenNodes.level : null;
    },

    init() {
      game.hud.add('wanted', {
        order: 30,
        render(el) {
          if (!el.firstChild) {
            const row = document.createElement('div'), note = document.createElement('div');
            row.style.cssText = 'font-size:26px;line-height:1;letter-spacing:0.08em';
            note.style.cssText = 'font-size:13px;font-weight:700;margin-top:3px;opacity:0.9';
            for (let i = 0; i < 5; i++) {
              const star = document.createElement('span');
              star.textContent = '★';
              row.append(star);
            }
            el.append(row, note);
          }
          const [row, note] = el.children, stars = wanted.stars, frac = level - stars;
          el.hidden = level <= 0.001;
          const flash = seen && Math.floor(game.time * 3) % 2 === 0;
          [...row.children].forEach((s, i) => {
            const on = i < stars, part = i === stars && frac > 0.05;
            s.style.color = part ? 'transparent' : on ? (seen ? (flash ? '#ff4d4d' : '#4d84ff') : '#ffd400') : 'rgba(255,255,255,0.3)';
            s.style.background = part ? `linear-gradient(90deg,#ffd400 ${Math.round(frac * 100)}%,rgba(255,255,255,0.3) ${Math.round(frac * 100)}%)` : '';
            s.style.webkitBackgroundClip = s.style.backgroundClip = part ? 'text' : '';
          });
          note.textContent = level < 1 ? 'Sospetta' : seen ? 'Ti vedono!' : `Nascosta: ${Math.max(0, Math.ceil(hideTime(stars) - sightT))} s`;
        },
      });
      offs.push(
        events.on('heat', (e) => wanted.add(e?.amount)),
        events.on('car:stolen', ({ car }) => {
          const isPolice = car.type === 'police';
          const seenBy = witness(car.x, car.obj?.position.y ?? 0, car.z, 70);
          const amount = isPolice ? (seenBy ? 1.5 : 1) : seenBy ? 1 : 0;
          if (amount) events.emit('heat', { amount, why: isPolice ? 'stolen-police-car' : 'stolen-car', pos: { x: car.x, z: car.z } });
        }),
      );
    },

    onCityChange(id) {
      stations = STATIONS[id] || STATIONS.bucharest;
      this.dispose(true);
    },

    update,

    dispose(keepHud) {
      for (const u of [...pursuers]) drop(u, true);
      for (const b of [...blocks]) {
        for (const c of b.cars) if (traffic.cars.includes(c)) traffic.remove(c);
        blocks.splice(blocks.indexOf(b), 1);
      }
      for (const c of [...cops]) c.a.removed || c.a.remove();
      cops.length = 0;
      for (const s of shots.splice(0)) game.scene.remove(s.mesh);
      level = sightT = netT = 0;
      net.visible = false;
      if (keepHud) return;
      for (const off of offs.splice(0)) off();
      game.hud?.remove('wanted');
      game.scene.remove(net);
      if (sirenNodes) {
        sirenNodes.osc.stop();
        sirenNodes.lfo.stop();
        sirenNodes = null;
      }
    },
  };
  return sys;
}
