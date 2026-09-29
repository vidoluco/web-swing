import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './config.js';

// Flocks of pigeons on the big squares (Piata Unirii and Universitate in Bucharest, Piata Sfatului
// in Brasov). On the ground they peck; when Bunica comes close they lift off in a swirl, circle above
// the square, and land again once she has gone. One instanced body mesh and one instanced wing mesh
// per flock, shared geometry, and nothing at all beyond 230 m.

const SPOTS = {
  bucharest: [
    { name: 'Piata Unirii', x: -15, z: 35 },
    { name: 'Universitate', x: -20, z: -950 },
  ],
  brasov: [{ name: 'Piata Sfatului', x: 31, z: 60 }],
};
const N = 36; // birds in a flock (24 on low quality)
const READY = 350; // a flock is placed when she comes this close
const SHOW = 230; // and drawn inside this
const TRIGGER = 9; // lifts off when she is nearer than this (15 m when she is fast)
const TAU = Math.PI * 2;
const UP = 0, RISING = 1, LANDING = 2; // per bird: on the ground, circling up, coming down

let GEO = null;

// Vertex colours in place of textures.
const col = (geo, hex) => {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};

// A pigeon 32 cm long, feet at y = 0, facing +z; the wings are separate so they can flap.
function geometry() {
  if (GEO) return GEO;
  const sph = (rx, ry, rz, x, y, z, hex) => col(new THREE.SphereGeometry(1, 8, 6).scale(rx, ry, rz).translate(x, y, z), hex);
  const box = (w, h, d, x, y, z, hex) => col(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
  const body = mergeGeometries([
    sph(0.052, 0.052, 0.125, 0, 0.125, 0, 0x8b919b),
    sph(0.03, 0.03, 0.03, 0, 0.19, 0.105, 0x767c86),
    sph(0.042, 0.036, 0.05, 0, 0.158, 0.085, 0x5f8577), // the green and purple neck
    col(new THREE.ConeGeometry(0.008, 0.03, 5).rotateX(Math.PI / 2).translate(0, 0.186, 0.14), 0xd8c9a2),
    box(0.06, 0.008, 0.13, 0, 0.125, -0.16, 0x4d5259),
    box(0.008, 0.075, 0.008, -0.022, 0.04, 0.01, 0xb8607a),
    box(0.008, 0.075, 0.008, 0.022, 0.04, 0.01, 0xb8607a),
  ]);
  // The right wing, out along +x from the shoulder; the left one is this mirrored.
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.07, 0.34, 0, 0.03, 0.3, 0, -0.12, 0, 0, 0.07, 0.3, 0, -0.12, 0, 0, -0.1], 3));
  wing.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const cc = [0x858b95, 0x40444b, 0x40444b, 0x858b95, 0x40444b, 0x858b95];
  wing.setAttribute('color', new THREE.Float32BufferAttribute(cc.flatMap((h) => new THREE.Color(h).toArray()), 3));
  return (GEO = { body, wing });
}

export function create(game) {
  // ?living=0 switches the living city off, for tests of the layers below it.
  if (game.params.get('living') === '0') return { name: 'pigeons' };
  const flocks = [];
  const stats = { lifts: 0, landings: 0, draws: 0 };
  const group = new THREE.Group();
  let A = null;
  // Own random stream, so the shared game.rng stays as it is for the tests (and the other systems).
  const rng = mulberry32((+game.params.get('seed') || 20260929) + 104);
  let voiceT = -99;
  let spots = [];
  const B = new THREE.Matrix4(), M = new THREE.Matrix4(), W = new THREE.Matrix4();
  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1), none = new THREE.Vector3(0, 0, 0), mirror = new THREE.Vector3(-1, 1, 1);
  const ground = (x, z) => game.city.groundAt?.(x, z) ?? 0;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // ---------- one flock ----------

  function place(spot) {
    const c = A.randomWalkPoint(spot, 20);
    const n = game.params.has('lowq') ? 24 : N;
    const geo = geometry();
    const std = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const bodyMat = std(), wingMat = std();
    A.onMaterial?.(bodyMat);
    A.onMaterial?.(wingMat);
    const bodies = new THREE.InstancedMesh(geo.body, bodyMat, n);
    const wings = new THREE.InstancedMesh(geo.wing, wingMat, n * 2);
    bodies.castShadow = true;
    bodies.frustumCulled = wings.frustumCulled = false;
    bodies.visible = wings.visible = false; // shown once she is within range
    const f32 = () => new Float32Array(n);
    const f = { spot, cx: c.x, cz: c.z, n, bodies, wings, state: 'calm', t: 0, airFor: 0, cool: 0, gt: 0, shown: false, dirn: rng() < 0.5 ? 1 : -1, hx: f32(), hz: f32(), rho0: f32(), R: f32(), H: f32(), om: f32(), ang: f32(), ph: f32(), yaw: f32(), tau: f32(), mode: new Uint8Array(n) };
    const tint = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const h = A.randomWalkPoint(c, 9);
      f.hx[i] = h.x - c.x;
      f.hz[i] = h.z - c.z;
      f.ph[i] = rng() * TAU;
      f.yaw[i] = rng() * TAU;
      // Most are grey; a few dark ones and a few white ones.
      const k = rng();
      bodies.setColorAt(i, tint.setScalar(k < 0.12 ? 0.55 : k < 0.2 ? 1.5 : 0.85 + rng() * 0.3));
      wings.setColorAt(i * 2, tint);
      wings.setColorAt(i * 2 + 1, tint);
    }
    group.add(bodies, wings);
    flocks.push(f);
    return f;
  }

  function lift(f) {
    f.state = 'up';
    f.t = 0;
    f.airFor = 7 + rng() * 3;
    stats.lifts++;
    for (let i = 0; i < f.n; i++) {
      f.mode[i] = RISING;
      f.tau[i] = -rng() * 0.7;
      f.rho0[i] = Math.hypot(f.hx[i], f.hz[i]);
      f.ang[i] = Math.atan2(f.hz[i], f.hx[i]);
      f.R[i] = 5 + rng() * 9;
      f.H[i] = 7 + rng() * 13;
      f.om[i] = f.dirn * (1.1 + rng() * 0.6);
    }
    game.events.emit('pigeons:lift', { x: f.cx, y: ground(f.cx, f.cz) + 1, z: f.cz, flock: f });
    if (game.time - voiceT > 30) {
      voiceT = game.time;
      game.voice?.say?.('pigeon');
    }
  }

  function land(f) {
    f.state = 'down';
    f.t = 0;
    for (let i = 0; i < f.n; i++) {
      if (f.mode[i] === UP) continue;
      f.mode[i] = LANDING;
      f.tau[i] = -rng() * 1.2;
    }
  }

  // Sets the body and the two wings of every bird that moves (and of the ones on the ground when `rest`).
  function draw(f, time, rest) {
    const g0 = ground(f.cx, f.cz);
    for (let i = 0; i < f.n; i++) {
      const m = f.mode[i];
      if (m === UP && !rest) continue;
      let x = f.cx + f.hx[i], z = f.cz + f.hz[i], y = g0, yaw = f.yaw[i], pitch = 0, roll = 0, flap = -1;
      const tau = f.tau[i], s = Math.sign(f.om[i]);
      if (m === UP) {
        // Head down, tail up, now and then.
        pitch = Math.pow(Math.max(0, Math.sin(time * 3.1 + f.ph[i])), 6) * 0.55;
      } else if (m === RISING && tau >= 0) {
        // A spiral out and over the square.
        const u = ease(tau / 2.4), rho = f.rho0[i] + (f.R[i] - f.rho0[i]) * ease(tau / 1.6);
        x = f.cx + Math.cos(f.ang[i]) * rho;
        z = f.cz + Math.sin(f.ang[i]) * rho;
        y = g0 + f.H[i] * u + Math.sin(time * 1.3 + f.ph[i]) * 0.6 * u;
        yaw = Math.atan2(-Math.sin(f.ang[i]) * s, Math.cos(f.ang[i]) * s);
        pitch = -(1 - u) * 0.6;
        roll = -s * 0.5;
        flap = tau < 2.4 ? 14 : 9;
      } else if (m === LANDING) {
        // The same circle drawn in, height given up, heading for its own spot.
        const u = 1 - ease(tau / 2.2), rho = f.R[i] * u;
        x = f.cx + Math.cos(f.ang[i]) * rho + f.hx[i] * (1 - u);
        z = f.cz + Math.sin(f.ang[i]) * rho + f.hz[i] * (1 - u);
        y = g0 + f.H[i] * u;
        yaw = Math.atan2(-Math.sin(f.ang[i]) * s, Math.cos(f.ang[i]) * s);
        pitch = (1 - u) * 0.35;
        roll = -s * 0.4 * u;
        flap = u > 0.08 ? 11 : 4;
      }
      q.setFromEuler(e.set(pitch, yaw, roll));
      B.compose(p.set(x, y, z), q, one);
      f.bodies.setMatrixAt(i, B);
      if (flap < 0) {
        f.wings.setMatrixAt(i * 2, W.compose(p.set(x, y, z), q, none));
        f.wings.setMatrixAt(i * 2 + 1, W);
      } else {
        const a = Math.sin(time * flap + f.ph[i]) * 0.9 + 0.1;
        M.compose(p.set(0.04, 0.14, 0.02), q.setFromEuler(e.set(0, 0, a)), one);
        f.wings.setMatrixAt(i * 2, W.multiplyMatrices(B, M));
        M.compose(p.set(-0.04, 0.14, 0.02), q.setFromEuler(e.set(0, 0, -a)), mirror);
        f.wings.setMatrixAt(i * 2 + 1, W.multiplyMatrices(B, M));
      }
    }
    f.bodies.instanceMatrix.needsUpdate = f.wings.instanceMatrix.needsUpdate = true;
    stats.draws++;
  }

  // ---------- system ----------

  function init() {
    A = game.actors;
    game.scene.add(group);
  }

  function onCityChange(id) {
    for (const f of flocks) {
      group.remove(f.bodies, f.wings);
      f.bodies.dispose();
      f.wings.dispose();
    }
    flocks.length = 0;
    spots = (SPOTS[id] || []).map((s) => ({ ...s, placed: false }));
  }

  function update(dt) {
    if (!A) return;
    const pl = game.player, px = pl.pos.x, pz = pl.pos.z, time = game.time;
    for (const s of spots) {
      if (!s.placed && Math.hypot(s.x - px, s.z - pz) < READY) {
        s.placed = true;
        place(s);
      }
    }
    for (const f of flocks) {
      const d = Math.hypot(f.cx - px, f.cz - pz);
      const show = d < SHOW;
      if (show !== f.shown) {
        f.shown = show;
        f.bodies.visible = f.wings.visible = show;
        if (!show) {
          // Out of sight they simply settle again.
          f.state = 'calm';
          f.mode.fill(UP);
          f.cool = 0;
        }
        f.gt = 0;
      }
      if (!show) continue;
      f.cool -= dt;
      if (f.state === 'calm' && f.cool <= 0 && d < TRIGGER + (pl.speed > 12 ? 6 : 0) && pl.pos.y - ground(px, pz) < 14) lift(f);
      let air = 0;
      if (f.state !== 'calm') {
        f.t += dt;
        for (let i = 0; i < f.n; i++) {
          const m = f.mode[i];
          if (m === UP) continue;
          f.tau[i] += dt;
          if (m === LANDING && f.tau[i] > 2.2) {
            f.mode[i] = UP;
            stats.landings++;
          } else {
            air++;
            // The circle goes on turning while the bird waits its turn to come down.
            if (m === RISING ? f.tau[i] > 0 : true) f.ang[i] += f.om[i] * dt;
          }
        }
        if (f.state === 'up' && f.t > f.airFor && d > 22) land(f);
        else if (f.state === 'down' && !air) {
          f.state = 'calm';
          f.cool = 5;
        }
      }
      // The birds on the ground only peck: ten times a second is plenty.
      f.gt -= dt;
      const rest = f.gt <= 0;
      if (rest) f.gt = 0.1;
      if (air || rest) draw(f, time, rest);
    }
  }

  function dispose() {
    onCityChange(null);
    group.removeFromParent();
  }

  return { name: 'pigeons', init, onCityChange, update, dispose, flocks, stats, lift, land, spots: () => spots };
}
