import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roadKey, pointInPrism2D, closestOnPrism } from './osmcity.js';
import { clamp, damp } from './config.js';

// Kenney Car Kit models (CC0): real length in metres and how common each is on Bucharest streets.
const TYPES = [
  ['taxi', 4.6, 24],
  ['sedan', 4.6, 24],
  ['suv', 4.7, 14],
  ['suv-luxury', 4.9, 7],
  ['sedan-sports', 4.5, 6],
  ['van', 5.2, 10],
  ['truck', 6.2, 5],
  ['police', 4.8, 4],
  ['garbage-truck', 8, 2],
  ['firetruck', 8.5, 1],
];
const WHEEL_R = 0.34;
const _near = [];
const _cp = {};

// Cars that drive the OSM streets around the player, turn where roads meet, queue behind each
// other and stop for you. Any of them can be stolen and driven.
export class Traffic {
  static async load(base, scene, city) {
    const loader = new GLTFLoader();
    const models = {};
    await Promise.all(
      TYPES.map(async ([name, len]) => {
        const g = await loader.loadAsync(`${base}/${name}.glb`);
        const root = g.scene;
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const k = len / size.z;
        root.scale.setScalar(k);
        root.position.set((-(box.min.x + box.max.x) / 2) * k, -box.min.y * k, (-(box.min.z + box.max.z) / 2) * k);
        const holder = new THREE.Group();
        holder.add(root);
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = o.receiveShadow = true;
          o.material.roughness = 0.42;
          o.material.metalness = 0.15;
        });
        models[name] = { holder, len, wid: size.x * k, h: size.y * k };
      }),
    );
    return new Traffic(scene, city, models);
  }

  constructor(scene, city, models) {
    this.scene = scene;
    this.city = city;
    this.models = models;
    this.cars = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.max = 60;
    this.spawnT = 0;
    this.roadsT = 0;
    this.roads = [];
    this.events = [];
    this.weight = TYPES.reduce((s, t) => s + t[2], 0);
  }

  pickType() {
    let r = Math.random() * this.weight;
    for (const t of TYPES) if ((r -= t[2]) < 0) return t[0];
    return 'sedan';
  }

  make(type) {
    const m = this.models[type];
    const obj = m.holder.clone(true);
    const wheels = [];
    obj.traverse((o) => {
      if (/^wheel/.test(o.name)) {
        o.rotation.order = 'YXZ';
        wheels.push({ o, front: /front/.test(o.name) });
      }
    });
    this.group.add(obj);
    return { type, obj, wheels, len: m.len, wid: m.wid, h: m.h, x: 0, z: 0, yaw: 0, speed: 0, cruise: 0, spin: 0, steer: 0, vx: 0, vz: 0, mode: 'traffic', wait: 0 };
  }

  remove(car) {
    this.group.remove(car.obj);
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  // ---------- following the streets ----------

  seg(car) {
    const p = car.road.pts, a = car.a, b = a + car.dir;
    return [p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1]];
  }

  setRoad(car, road, a, dir) {
    car.road = road;
    car.a = a;
    car.dir = dir;
    // Romania drives on the right: half a carriageway to the right of the centre line.
    car.lane = road.oneway ? (((car.laneSeed ?? 0.5) - 0.5) * road.w) / 2.5 : road.w * 0.25;
    car.cruise = (road.major ? 14 : 8.5) * (0.85 + (car.laneSeed ?? 0.5) * 0.3);
  }

  // Move `dist` metres along the route; at each vertex keep going or turn onto a road that meets
  // there. Returns false at a dead end with nowhere to go.
  advance(car, dist) {
    car.s += dist;
    for (let guard = 0; guard < 12; guard++) {
      const [ax, az, bx, bz] = this.seg(car);
      const L = Math.hypot(bx - ax, bz - az) || 0.01;
      if (car.s < L) return true;
      car.s -= L;
      const b = car.a + car.dir;
      const n = car.road.pts.length / 2;
      const hx = (bx - ax) / L, hz = (bz - az) / L;
      const hasNext = b + car.dir >= 0 && b + car.dir < n;
      const opts = [];
      for (const [road, i] of this.city.roadNodes.get(roadKey(bx, bz)) || []) {
        const m = road.pts.length / 2;
        for (const d of road.oneway ? [1] : [1, -1]) {
          const j = i + d;
          if (j < 0 || j >= m || (road === car.road && i === b)) continue;
          const dx = road.pts[2 * j] - road.pts[2 * i], dz = road.pts[2 * j + 1] - road.pts[2 * i + 1];
          const turn = (dx * hx + dz * hz) / (Math.hypot(dx, dz) || 1);
          if (turn > -0.4) opts.push([road, i, d, turn]);
        }
      }
      if (hasNext && (!opts.length || Math.random() < 0.65)) {
        car.a = b;
        continue;
      }
      if (opts.length) {
        // Straighter continuations are more likely than sharp turns.
        let tot = 0;
        for (const o of opts) tot += o[3] + 0.6;
        let r = Math.random() * tot;
        let pick = opts[0];
        for (const o of opts) if ((r -= o[3] + 0.6) < 0) (pick = o), (r = Infinity);
        this.setRoad(car, pick[0], pick[1], pick[2]);
        continue;
      }
      if (car.road.oneway) return false;
      car.a = b;
      car.dir = -car.dir;
    }
    return true;
  }

  target(car) {
    const [ax, az, bx, bz] = this.seg(car);
    const L = Math.hypot(bx - ax, bz - az) || 0.01;
    const hx = (bx - ax) / L, hz = (bz - az) / L, t = car.s / L;
    return [ax + (bx - ax) * t - hz * car.lane, az + (bz - az) * t + hx * car.lane, Math.atan2(hx, hz)];
  }

  // ---------- spawning ----------

  nearRoads(px, pz) {
    const out = [];
    const C = this.city.index.chunk;
    for (const rec of this.city.recs.values()) {
      if (rec.state !== 'loaded' || !rec.roads) continue;
      if (Math.hypot((rec.info.cx + 0.5) * C - px, (rec.info.cz + 0.5) * C - pz) > 650) continue;
      for (const r of rec.roads) out.push(r);
    }
    return out;
  }

  trySpawn(px, pz) {
    const roads = this.roads;
    if (!roads.length) return;
    const road = roads[(Math.random() * roads.length) | 0];
    const n = road.pts.length / 2;
    const dir = road.oneway || Math.random() < 0.5 ? 1 : -1;
    const a = dir > 0 ? (Math.random() * (n - 1)) | 0 : 1 + ((Math.random() * (n - 1)) | 0);
    const car = { road, a, dir, s: 0, laneSeed: Math.random() };
    this.setRoad(car, road, a, dir);
    const [ax, az, bx, bz] = this.seg(car);
    car.s = Math.random() * Math.hypot(bx - ax, bz - az);
    const [x, z, yaw] = this.target(car);
    const d = Math.hypot(x - px, z - pz);
    if (d < 50 || d > 320 || this.city.isWater(x, z)) return;
    if (this.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) return;
    const c = Object.assign(this.make(this.pickType()), car, { x, z, yaw });
    c.speed = c.cruise * 0.7;
    this.cars.push(c);
    this.poseObj(c);
  }

  // ---------- per frame ----------

  update(dt, player, driving) {
    const px = player.pos.x, pz = player.pos.z;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c !== driving && Math.hypot(c.x - px, c.z - pz) > 400) this.remove(c);
    }
    if ((this.roadsT -= dt) <= 0) {
      this.roadsT = 1;
      this.roads = this.nearRoads(px, pz);
    }
    if ((this.spawnT -= dt) <= 0 && this.cars.length < this.max) {
      this.spawnT = 0.05;
      this.trySpawn(px, pz);
    }
    const onFoot = !driving && player.pos.y < 2.5;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.mode !== 'traffic') continue;
      const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
      let gap = Infinity, blockedByPlayer = false;
      const look = (x, z, half) => {
        const dx = x - c.x, dz = z - c.z;
        const f = dx * hx + dz * hz;
        if (f <= 0 || f > 30) return Infinity;
        return Math.abs(-dx * hz + dz * hx) < 2.3 ? f - c.len / 2 - half : Infinity;
      };
      for (const o of this.cars) if (o !== c) gap = Math.min(gap, look(o.x, o.z, o.len / 2));
      if (onFoot) {
        const g = look(px, pz, 0.4);
        if (g < gap) (gap = g), (blockedByPlayer = g < 12);
      }
      const want = gap < 30 ? Math.min(c.cruise, Math.max(0, (gap - 2.5) * 0.8)) : c.cruise;
      c.speed += clamp(want - c.speed, -10 * dt, 3 * dt);
      if (blockedByPlayer && c.speed < 1) {
        c.wait += dt;
        if (c.wait > 1.2) {
          c.wait = -2.5;
          this.events.push('horn');
        }
      } else if (!blockedByPlayer) c.wait = Math.min(c.wait, 0);
      if (!this.advance(c, c.speed * dt)) {
        this.remove(c);
        continue;
      }
      const [tx, tz, tyaw] = this.target(c);
      const k = damp(9, dt);
      const ox = c.x, oz = c.z, oyaw = c.yaw;
      c.x += (tx - c.x) * k;
      c.z += (tz - c.z) * k;
      let dy = tyaw - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.yaw += dy * damp(6, dt);
      c.vx = (c.x - ox) / dt;
      c.vz = (c.z - oz) / dt;
      const yawRate = Math.atan2(Math.sin(c.yaw - oyaw), Math.cos(c.yaw - oyaw)) / dt;
      c.steer = c.speed > 1 ? clamp((-yawRate * c.len * 0.6) / c.speed, -0.5, 0.5) : 0;
      this.poseObj(c, dt);
    }
  }

  poseObj(c, dt = 0) {
    c.obj.position.set(c.x, 0, c.z);
    c.obj.rotation.y = c.yaw;
    c.spin += (c.speed * dt) / WHEEL_R;
    for (const w of c.wheels) {
      w.o.rotation.x = c.spin;
      w.o.rotation.y = w.front ? -c.steer : 0;
    }
  }

  // ---------- the player's car ----------

  nearest(pos, maxD) {
    let best = null, bd = maxD;
    for (const c of this.cars) {
      const d = Math.hypot(c.x - pos.x, c.z - pos.z) - c.len * 0.3;
      if (d < bd && pos.y < c.h + 2.5) (bd = d), (best = c);
    }
    return best;
  }

  steal(c) {
    c.mode = 'driven';
    c.speed *= 0.3;
  }

  leave(c) {
    c.mode = 'parked';
    c.speed = 0;
    c.vx = c.vz = 0;
    c.steer = 0;
    this.poseObj(c);
  }

  // Arcade driving: throttle and steering from WASD, Space is the handbrake. `wobble` is how
  // drunk the driver is. Returns 'sunk' if the car went into the water.
  drive(c, dt, inp, wobble, time) {
    const acc = inp.moveY;
    if (acc > 0) c.speed += (c.speed < 0 ? 24 : 11 * Math.max(0.05, 1 - c.speed / 50)) * acc * dt;
    else if (acc < 0) c.speed -= (c.speed > 0 ? 24 : 7 * Math.max(0, 1 + c.speed / 12)) * -acc * dt;
    else c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), (1.5 + 0.015 * c.speed * c.speed) * dt);
    if (inp.jump) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 14 * dt);
    const drunkSteer = wobble * (Math.sin(time * 1.7) * 0.5 + Math.sin(time * 3.1 + 1) * 0.3);
    const steerMax = 0.55 / (1 + Math.abs(c.speed) / 16);
    const turn = clamp(inp.moveX + drunkSteer, -1, 1) * (inp.jump ? 1.6 : 1);
    c.steer += (turn * steerMax - c.steer) * damp(7, dt);
    c.yaw -= ((c.speed / (c.len * 0.6)) * Math.tan(c.steer)) * dt;
    const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
    c.vx = hx * c.speed;
    c.vz = hz * c.speed;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    // Buildings: three circles along the car, pushed out of any footprint they overlap.
    const r = c.wid / 2;
    let hit = 0;
    for (const off of [-(c.len / 2 - r), 0, c.len / 2 - r]) {
      const cx = c.x + hx * off, cz = c.z + hz * off;
      for (const b of this.city.nearby(cx, cz, r + 2, _near)) {
        if (b.kind === 'prop' || b.y0 > 1.5) continue;
        const inside = pointInPrism2D(cx, cz, b);
        closestOnPrism(cx, cz, b, _cp);
        if (!inside && _cp.d >= r) continue;
        let nx = inside ? _cp.x - cx : cx - _cp.x, nz = inside ? _cp.z - cz : cz - _cp.z;
        const nl = Math.hypot(nx, nz);
        if (nl < 1e-4) (nx = _cp.nx), (nz = _cp.nz);
        else (nx /= nl), (nz /= nl);
        const push = inside ? _cp.d + r : r - _cp.d;
        c.x += nx * push;
        c.z += nz * push;
        hit = Math.max(hit, Math.abs(c.vx * nx + c.vz * nz));
      }
    }
    // Other cars: shove the one we hit out of traffic, lose most of our speed.
    for (const o of this.cars) {
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz);
      const min = (c.len + o.len) / 4 + 0.9;
      if (d >= min || d < 1e-3) continue;
      const nx = dx / d, nz = dz / d;
      c.x -= nx * (min - d) * 0.6;
      c.z -= nz * (min - d) * 0.6;
      o.x += nx * (min - d) * 0.4;
      o.z += nz * (min - d) * 0.4;
      hit = Math.max(hit, Math.abs(c.vx * nx + c.vz * nz));
      if (o.mode === 'traffic') this.leave(o);
      else this.poseObj(o);
    }
    if (hit > 0.5) {
      c.speed *= hit > 8 ? 0.25 : 0.6;
      if (hit > 6) this.events.push('crash');
    }
    this.poseObj(c, dt);
    if (this.city.isWater(c.x, c.z)) return 'sunk';
    return null;
  }
}
