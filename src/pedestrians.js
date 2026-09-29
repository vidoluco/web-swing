import * as THREE from 'three';
import { clamp, mulberry32 } from './config.js';

// People on the pavements, footways and squares: up to about a hundred around Bunica, thicker in the
// centre, the Old Town and near bars. They walk between pavement points (game.actors does the
// steering), cross a street only at a crossing and only when no car is coming, look at Bunica when
// she swings close and sometimes film her, clap a good landing, run from fights and fall when a
// car hits them. Everything is chosen at a rate that follows the distance, and past the actor
// manager's own cull distance nothing here runs.

const MAX = 100; // people around Bunica at the busiest
const RESERVE = 24; // actor slots left for crimes, police and animals
const RING = [24, 140]; // people appear inside this ring around her
const DESPAWN = 170;
const HIDE = 160; // the manager freezes and hides actors beyond this
const NEAR = 55; // think every frame inside, 8 Hz to MID, 2 Hz beyond
const MID = 115;
const TAU = Math.PI * 2;
const ARM_RANGE = 45; // the gestures with arms are only drawn this close

// Busy places: [x, z, radius, weight]. The Old Town of Bucharest is Lipscani, west of Piata Unirii.
const HOT = {
  bucharest: [[0, 0, 420, 1], [-230, -530, 380, 1.15], [-25, -950, 320, 0.95]],
  brasov: [[31, 60, 380, 1.2], [-42, 187, 260, 0.8], [253, -375, 260, 0.5]],
};

// Right arm and left arm bone indexes in the actor rig (mixamo order of src/actors.js).
const BONE = { lArm: 7, lFore: 8, lHand: 9, rArm: 11, rFore: 12, rHand: 13 };

// Arm poses as rotations away from the T-pose (radians, x y z), found by searching the rig for the hand
// position: the phone is held in front of the face, and both hands meet in front of the chest to clap.
// The left arm is the mirror of the right one (y and z negated).
const ARM = {
  film: { arm: [0, 1.3, 0.444], fore: [0, 1.067, -1.233] },
  clap: { arm: [0, 1.333, 1], fore: [0, 2, -1.2], swing: 0.35 },
};

const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

export function create(game) {
  // ?living=0 switches the living city off, for tests of the layers below it.
  if (game.params.get('living') === '0') return { name: 'pedestrians' };
  const peds = [];
  const stats = { spawned: 0, removed: 0, roadFixes: 0, crossings: 0, waits: 0, watchers: 0, films: 0, cheers: 0, fled: 0, carHits: 0 };
  const bars = [];
  const phones = { free: [], geo: null, mats: null };
  let A = null;
  let hot = [];
  // Own random stream, so the shared game.rng stays as it is for the tests (and the other systems).
  const rng = mulberry32((+game.params.get('seed') || 20260929) + 101);
  let cap = MAX;
  let barsT = 0;
  let spawnT = 0;
  let airT = 0;
  let prevAir = false;
  let lastX = 0;
  let lastZ = 0;
  let fillT = 2; // seconds in which people may appear in view: the start and after a jump across the city
  let off = [];
  const v = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const e1 = new THREE.Euler();

  // ---------- where people are ----------

  function density(x, z) {
    let d = 0.2;
    for (const [hx, hz, r, w] of hot) {
      const k = Math.hypot(x - hx, z - hz) / r;
      if (k < 2.5) d += w * Math.exp(-k * k);
    }
    let b = 0;
    for (const p of bars) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 3600) b += 0.15;
    return d + Math.min(b, 0.6);
  }

  function refreshBars(px, pz) {
    bars.length = 0;
    for (let cx = Math.floor((px - 400) / 200); cx <= Math.floor((px + 400) / 200); cx++) {
      for (let cz = Math.floor((pz - 400) / 200); cz <= Math.floor((pz + 400) / 200); cz++) {
        const c = game.city.mmCells.get(cx * 1000 + cz);
        if (c) for (const p of c.p) bars.push(p);
      }
    }
  }

  function target(px, pz) {
    return Math.round(cap * clamp(0.3 + 0.7 * density(px, pz), 0.3, 1));
  }

  // ---------- walking rules ----------

  // Is the straight line from a to b free of buildings, water and carriageway? Sampled every 1.5 m.
  function legClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 1.5);
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (A.blocked(x, z, 0.4) || A.paths.onRoad(x, z)) return false;
    }
    return true;
  }

  // Footways that lie on a carriageway are the crossings. Runs of pieces are joined, and both ends
  // are moved out past the kerb so nobody waits or finishes on the road.
  function buildCrossings(e) {
    const s = e.segs, out = [];
    // Metres from (x, z) along (sx, sz) to the first spot off the carriageway, plus a step clear of the kerb; -1 if none within 8 m.
    const past = (x, z, sx, sz) => {
      let k = 0;
      while (A.paths.onRoad(x + sx * k, z + sz * k) && k < 8) k += 0.5;
      return k < 8 ? k + 0.9 : -1;
    };
    const finish = (r) => {
      const dx = r.x1 - r.x0, dz = r.z1 - r.z0, L = Math.hypot(dx, dz);
      if (L < 2) return;
      const ux = dx / L, uz = dz / L, ka = past(r.x0, r.z0, -ux, -uz), kb = past(r.x1, r.z1, ux, uz);
      if (ka < 0 || kb < 0) return;
      const c = { ax: r.x0 - ux * ka, az: r.z0 - uz * ka, bx: r.x1 + ux * kb, bz: r.z1 + uz * kb };
      c.len = Math.hypot(c.bx - c.ax, c.bz - c.az);
      c.mx = (c.ax + c.bx) / 2;
      c.mz = (c.az + c.bz) / 2;
      if (c.len > 40 || A.blocked(c.ax, c.az, 0.4) || A.blocked(c.bx, c.bz, 0.4)) return;
      out.push(c);
    };
    let run = null;
    for (let i = 0; i < s.length; i += 8) {
      const on = s[i + 4] === 1 && A.paths.onRoad((s[i] + s[i + 2]) / 2, (s[i + 1] + s[i + 3]) / 2);
      if (on && run && Math.hypot(s[i] - run.x1, s[i + 1] - run.z1) < 0.3) {
        run.x1 = s[i + 2];
        run.z1 = s[i + 3];
        continue;
      }
      if (run) finish(run);
      run = on ? { x0: s[i], z0: s[i + 1], x1: s[i + 2], z1: s[i + 3] } : null;
    }
    if (run) finish(run);
    return out;
  }

  function crossingsNear(x, z, r) {
    const out = [];
    for (let cx = Math.floor((x - r) / 200); cx <= Math.floor((x + r) / 200); cx++) {
      for (let cz = Math.floor((z - r) / 200); cz <= Math.floor((z + r) / 200); cz++) {
        const e = A.paths.entry(cx * 1000 + cz);
        if (!e.cross) e.cross = buildCrossings(e);
        for (const c of e.cross) if (Math.hypot(c.mx - x, c.mz - z) < r) out.push(c);
      }
    }
    return out;
  }

  // Is a moving car near enough to the crossing to reach it while someone walks over?
  function carsComing(c) {
    for (const car of game.traffic.cars) {
      if (car.mode === 'parked' && Math.abs(car.speed) < 0.5) continue;
      if (Math.abs(car.speed) < 0.5 && car.mode !== 'driven') continue;
      if ((car.x - c.mx) ** 2 + (car.z - c.mz) ** 2 < 55 * 55) return true;
    }
    return false;
  }

  // ---------- people ----------

  function trySpawn(px, pz, anywhere) {
    const ang = rng() * TAU, dist = RING[0] + Math.sqrt(rng()) * (RING[1] - RING[0]);
    const at = A.randomWalkPoint({ x: px + Math.sin(ang) * dist, z: pz + Math.cos(ang) * dist }, 26);
    if (A.blocked(at.x, at.z, 0.4) || A.paths.onRoad(at.x, at.z)) return null;
    const d = Math.hypot(at.x - px, at.z - pz);
    if (d < RING[0] || d > RING[1] + 26) return null;
    if (rng() > clamp(density(at.x, at.z) / 1.2, 0.08, 1)) return null;
    if (!anywhere && d < 80) {
      v.set(at.x, game.city.groundAt(at.x, at.z) + 1, at.z).project(game.camera);
      if (Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 && v.z < 1) return null;
    }
    return add(at.x, at.z);
  }

  function add(x, z, opts = {}) {
    const kid = rng() < 0.05;
    const scale = opts.scale ?? (kid ? 0.62 + rng() * 0.08 : 0.86 + rng() * 0.2);
    const a = A.spawn('civilian', { x, z }, { exact: true, scale, yaw: rng() * TAU, variant: opts.variant });
    if (!a) return null;
    const p = { a, mode: 'idle', t: 0, until: rng() * 4, acc: rng() * 0.2, pace: (kid ? 1.05 : 1.15) + rng() * 0.45, react: 0, guard: rng(), cross: null, wantFilm: false, phone: null, heading: rng() * TAU };
    a.speedWalk = p.pace;
    peds.push(p);
    stats.spawned++;
    return p;
  }

  function drop(p) {
    endGesture(p);
    const i = peds.indexOf(p);
    if (i >= 0) peds.splice(i, 1);
  }

  function goTo(p, x, z, speed) {
    p.mode = 'walk';
    p.t = 0;
    p.heading = Math.atan2(x - p.a.pos.x, z - p.a.pos.z);
    return A.walkTo(p.a, x, z, speed ?? p.pace);
  }

  function rest(p, lo = 0.6, hi = 5) {
    p.mode = 'idle';
    p.t = 0;
    p.until = lo + rng() * (hi - lo);
    p.cross = null;
  }

  // Walk to one end of a crossing (`near` 1: to its b end), to wait there for the cars and cross to the other.
  function beginCross(p, c, near) {
    p.cross = near ? { fx: c.bx, fz: c.bz, tx: c.ax, tz: c.az, mx: c.mx, mz: c.mz } : { fx: c.ax, fz: c.az, tx: c.bx, tz: c.bz, mx: c.mx, mz: c.mz };
    goTo(p, p.cross.fx, p.cross.fz);
  }

  // A new leg: sometimes to a crossing, else to a pavement point ahead that the line reaches
  // without touching a road or a building.
  function startLeg(p) {
    const a = p.a, pos = a.pos;
    if (rng() < 0.2) {
      let best = null, bd = Infinity;
      for (const c of crossingsNear(pos.x, pos.z, 45)) {
        const da = Math.hypot(c.ax - pos.x, c.az - pos.z), db = Math.hypot(c.bx - pos.x, c.bz - pos.z);
        const near = da < db ? 0 : 1, d = Math.min(da, db);
        if (d < bd && legClear(pos.x, pos.z, near ? c.bx : c.ax, near ? c.bz : c.az)) (bd = d), (best = { c, near });
      }
      if (best) {
        beginCross(p, best.c, best.near);
        return;
      }
    }
    let pick = null, score = -2;
    for (let k = 0; k < 6; k++) {
      const s = A.randomWalkPoint(pos, 38);
      const d = Math.hypot(s.x - pos.x, s.z - pos.z);
      if (d < 8 || d > 45 || !legClear(pos.x, pos.z, s.x, s.z)) continue;
      const sc = ((s.x - pos.x) * Math.sin(p.heading) + (s.z - pos.z) * Math.cos(p.heading)) / d;
      if (sc > score) (score = sc), (pick = s);
      if (sc > 0.3) break;
    }
    if (pick) goTo(p, pick.x, pick.z);
    else rest(p, 1, 3);
  }

  function face(a, x, z, dt) {
    a.yaw = wrap(a.yaw + wrap(Math.atan2(x - a.pos.x, z - a.pos.z) - a.yaw) * Math.min(1, dt * 8));
  }

  function stopWalking(p) {
    p.a.hasGoal = false;
    p.a.state = 'idle';
  }

  // ---------- reactions ----------

  function beginWatch(p) {
    stopWalking(p);
    p.mode = 'watch';
    p.t = 0;
    p.until = 2 + rng() * 2.5;
    p.wantFilm = rng() < 0.4;
    stats.watchers++;
  }

  function beginFilm(p) {
    p.mode = 'film';
    p.t = 0;
    p.until = 4 + rng() * 4;
    if (!p.phone) p.phone = takePhone(p.a);
    stats.films++;
  }

  function beginCheer(p) {
    stopWalking(p);
    endGesture(p);
    p.mode = 'cheer';
    p.t = 0;
    p.until = 2.4 + rng() * 1.2;
    stats.cheers++;
  }

  function flee(p, fromX, fromZ) {
    if (p.a.state === 'down' || p.a.tied || p.a.stunT > 0) return;
    endGesture(p);
    const pos = p.a.pos;
    const away = Math.atan2(pos.x - fromX, pos.z - fromZ);
    for (let k = 0; k < 6; k++) {
      const ang = away + (rng() - 0.5) * 1.6, r = 30 + rng() * 20;
      const s = A.randomWalkPoint({ x: pos.x + Math.sin(ang) * r, z: pos.z + Math.cos(ang) * r }, 14);
      if (!legClear(pos.x, pos.z, s.x, s.z)) continue;
      A.walkTo(p.a, s.x, s.z, 4.4);
      p.mode = 'flee';
      p.t = 0;
      p.until = 6 + rng() * 4;
      p.cross = null;
      stats.fled++;
      return;
    }
    // Nowhere clear to run: stand still, frozen.
    stopWalking(p);
    p.mode = 'flee';
    p.t = 0;
    p.until = 3;
  }

  // ---------- gestures with the arms and the phone ----------

  function phoneParts() {
    if (phones.geo) return phones;
    // Sizes are in the hand bone's own units, 1 cm each.
    phones.geo = [new THREE.BoxGeometry(7.4, 15, 0.9), new THREE.PlaneGeometry(6.4, 13.4)];
    phones.mats = [new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.35, metalness: 0.6 }), new THREE.MeshBasicMaterial({ color: 0x9fd4ff })];
    game.actors?.onMaterial?.(phones.mats[0]);
    return phones;
  }

  function takePhone(a) {
    const P = phoneParts();
    let m = P.free.pop();
    if (!m) {
      m = new THREE.Group();
      m.add(new THREE.Mesh(P.geo[0], P.mats[0]));
      const s = new THREE.Mesh(P.geo[1], P.mats[1]);
      s.position.z = 0.47;
      m.add(s);
    }
    // Upright in the fist, screen towards her face: rotation found from the hand's axes in the film pose.
    m.position.set(-8, 0, 0);
    m.rotation.set(-0.415, 0.825, 1.219);
    a.rig.bones[BONE.rHand].add(m);
    return m;
  }

  function endGesture(p) {
    if (p.phone) {
      p.phone.removeFromParent();
      phones.free.push(p.phone);
      p.phone = null;
    }
    p.arms = false;
  }

  // Rotate a bone away from its T-pose rotation.
  function setBone(a, i, x, y, z) {
    a.rig.bones[i].quaternion.copy(A.tpl.bones[i].q).multiply(q1.setFromEuler(e1.set(x, y, z)));
  }

  // Written over what the animation just set, every frame, then the rig matrices are redone.
  function poseArms(p, t) {
    const a = p.a;
    if (p.mode === 'film') {
      setBone(a, BONE.rArm, ...ARM.film.arm);
      setBone(a, BONE.rFore, ...ARM.film.fore);
    } else {
      const c = ARM.clap, k = 0.5 + 0.5 * Math.sin(t * 15 + a.id);
      setBone(a, BONE.rArm, c.arm[0], c.arm[1] - c.swing * k, c.arm[2]);
      setBone(a, BONE.rFore, ...c.fore);
      setBone(a, BONE.lArm, c.arm[0], -(c.arm[1] - c.swing * k), -c.arm[2]);
      setBone(a, BONE.lFore, c.fore[0], -c.fore[1], -c.fore[2]);
    }
    A._pose(a);
  }

  // ---------- per person ----------

  function think(p, dt, dist, time) {
    const a = p.a, pl = game.player;
    if (a.state === 'down') {
      p.mode = 'down';
      endGesture(p);
      return;
    }
    if (a.tied || a.state === 'stunned') {
      endGesture(p);
      if (p.mode !== 'stunned') p.mode = 'stunned';
      return;
    }
    if (p.mode === 'stunned') rest(p, 0.5, 1.5);
    p.t += dt;

    // A carriageway is only for crossings.
    if (p.mode !== 'cross' && (p.guard -= dt) <= 0) {
      p.guard = 0.35;
      if (A.paths.onRoad(a.pos.x, a.pos.z)) {
        stats.roadFixes++;
        const s = A.randomWalkPoint(a.pos, 14);
        goTo(p, s.x, s.z, 1.7);
      }
    }

    // Bunica swinging close: look, and some film.
    if (dist < 18 && time > p.react && (p.mode === 'walk' || p.mode === 'idle') && pl.speed > 6 && pl.pos.y < 50) {
      p.react = time + 25;
      if (rng() < 0.55) beginWatch(p);
    }

    switch (p.mode) {
      case 'idle':
        if (p.t >= p.until) startLeg(p);
        break;
      case 'walk':
        if (!a.hasGoal) {
          if (p.cross) beginWait(p);
          else rest(p);
        }
        break;
      case 'wait':
        face(a, p.cross.mx, p.cross.mz, dt);
        if (p.t > 0.5 && !carsComing(p.cross)) {
          stats.crossings++;
          p.mode = 'cross';
          p.t = 0;
          A.walkTo(a, p.cross.tx, p.cross.tz, 1.6);
        } else if (p.t > 30) rest(p);
        break;
      case 'cross':
        if (!a.hasGoal || p.t > 25) rest(p, 0.2, 1.5);
        break;
      case 'watch':
        face(a, pl.pos.x, pl.pos.z, dt);
        if (p.t >= p.until || dist > 40) {
          if (p.wantFilm && dist < 22) beginFilm(p);
          else rest(p, 0.2, 1.5);
        }
        break;
      case 'film':
        face(a, pl.pos.x, pl.pos.z, dt);
        if (p.t >= p.until || dist > 40) {
          endGesture(p);
          rest(p, 0.2, 1.5);
        }
        break;
      case 'cheer':
        face(a, pl.pos.x, pl.pos.z, dt);
        if (p.t >= p.until) {
          endGesture(p);
          rest(p, 0.2, 1.5);
        }
        break;
      case 'flee':
        if (p.t >= p.until || (!a.hasGoal && p.t > 1.5)) {
          stopWalking(p);
          rest(p, 1, 3);
        }
        break;
    }
  }

  function beginWait(p) {
    p.mode = 'wait';
    p.t = 0;
    stats.waits++;
  }

  function carHits() {
    const cars = game.traffic.cars, pl = game.player;
    for (const c of cars) {
      if (Math.abs(c.speed) < 2.5) continue;
      if ((c.x - pl.pos.x) ** 2 + (c.z - pl.pos.z) ** 2 > 130 * 130) continue;
      const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw), reach = c.len / 2 + 1.5;
      for (const p of peds) {
        const a = p.a;
        if (a.state === 'down' || a.removed) continue;
        const dx = a.pos.x - c.x, dz = a.pos.z - c.z;
        if (dx * dx + dz * dz > reach * reach * 1.6) continue;
        if (Math.abs(dx * hx + dz * hz) > c.len / 2 + 0.3 || Math.abs(dx * hz - dz * hx) > c.wid / 2 + 0.3) continue;
        endGesture(p);
        a.hit(a.hp, 'car');
        p.mode = 'down';
        stats.carHits++;
        if (c.mode === 'driven') game.events.emit('heat', { amount: 1, why: 'pedestrian run over', pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z } });
      }
    }
  }

  // ---------- the system ----------

  function init() {
    A = game.actors;
    if (!A) return;
    cap = Math.min(MAX, game.params.has('lowq') ? 36 : 100);
    // The manager holds 120 (60 low quality): raise it so people never crowd out the police and the animals.
    if (!game.params.has('lowq')) A.max = Math.max(A.max, MAX + RESERVE + 20);
    off.push(
      game.events.on('hit', ({ target }) => {
        if (!target || !['civilian', 'thug', 'cop'].includes(target.kind)) return;
        const c = target.pos;
        for (const p of peds) {
          if (p.a === target || p.a.state === 'down') continue;
          if ((p.a.pos.x - c.x) ** 2 + (p.a.pos.z - c.z) ** 2 < 30 * 30) flee(p, c.x, c.z);
        }
        const own = peds.find((p) => p.a === target);
        if (own && target.state !== 'down') flee(own, c.x + (rng() - 0.5), c.z + (rng() - 0.5));
      }),
    );
  }

  function onCityChange(id) {
    hot = HOT[id] || [];
    for (const p of [...peds]) {
      p.a.remove();
      drop(p);
    }
    barsT = 0;
    spawnT = 0;
  }

  function update(dt) {
    if (!A) return;
    const pl = game.player, px = pl.pos.x, pz = pl.pos.z, time = game.time;
    if ((px - lastX) ** 2 + (pz - lastZ) ** 2 > 150 * 150) fillT = 2;
    (lastX = px), (lastZ = pz), (fillT -= dt);
    if ((barsT -= dt) <= 0) {
      barsT = 1;
      refreshBars(px, pz);
    }

    // Landing after a long flight: a round of applause.
    const air = pl.mode === 'air' || pl.mode === 'swing' || pl.mode === 'zip';
    if (air) airT += dt;
    else {
      if (prevAir && pl.mode === 'ground' && airT > 1.1) {
        for (const p of peds) {
          const a = p.a;
          if (a.state === 'down' || a.tied || a.removed || a.stunT > 0 || (a.pos.x - px) ** 2 + (a.pos.z - pz) ** 2 > 20 * 20) continue;
          if (['walk', 'idle', 'watch', 'film'].includes(p.mode) && rng() < 0.6) beginCheer(p);
        }
      }
      airT = 0;
    }
    prevAir = air;

    // Population: fill up to the target for this place, and let go of what has drifted too far.
    const want = target(px, pz);
    if (peds.length < want) {
      if ((spawnT -= dt) <= 0) {
        const burst = peds.length < want * 0.5 ? 6 : 1;
        for (let k = 0; k < burst && peds.length < want; k++) trySpawn(px, pz, fillT > 0);
        spawnT = 0.04;
      }
    }

    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i], a = p.a;
      if (a.removed) {
        drop(p);
        continue;
      }
      const dx = a.pos.x - px, dz = a.pos.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > DESPAWN * DESPAWN || (peds.length > want + 10 && d2 > 130 * 130)) {
        a.remove();
        stats.removed++;
        drop(p);
        continue;
      }
      if (d2 > HIDE * HIDE) continue;
      const dist = Math.sqrt(d2);
      // The animation rewrites the arms at its own pace; the gestures put them back every frame.
      if (dist < ARM_RANGE && (p.mode === 'film' || p.mode === 'cheer')) poseArms(p, time);
      p.acc += dt;
      if (p.acc < (dist < NEAR ? 0 : dist < MID ? 0.12 : 0.5)) continue;
      const h = Math.min(p.acc, 0.5);
      p.acc = 0;
      think(p, h, dist, time);
    }

    if (peds.length && game.traffic) carHits();
  }

  function dispose() {
    for (const f of off) f();
    off = [];
    for (const p of [...peds]) {
      p.a.remove();
      drop(p);
    }
  }

  return { name: 'pedestrians', init, onCityChange, update, dispose, peds, stats, density, target, crossingsNear, legClear, add, beginCross, flee, beginCheer, beginWatch, beginFilm };
}
