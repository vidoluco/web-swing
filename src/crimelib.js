import { roadKey, pointInPrism2D } from './osmcity.js';
import { clamp } from './config.js';

// Helpers shared by crimes.js and police.js: the drivable roads round a point, a route over them,
// a car driven along that route, line of sight between two points, and paying Respect.

const _near = [];

// The loaded drivable roads within about R of (x, z), read chunk by chunk.
export function roadsAround(city, x, z, R) {
  const C = city.index.chunk, out = [];
  for (let cx = Math.floor((x - R) / C); cx <= Math.floor((x + R) / C); cx++) {
    for (let cz = Math.floor((z - R) / C); cz <= Math.floor((z + R) / C); cz++) {
      const rec = city.recs.get(`${cx}_${cz}`);
      if (rec?.roads) for (const r of rec.roads) out.push(r);
    }
  }
  return out;
}

// The road segment closest to (x, z) within maxD: its two ends and the distance, or null.
function nearestSegment(city, x, z, maxD) {
  let best = null, bd = maxD;
  for (const r of roadsAround(city, x, z, maxD)) {
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ex = p[i + 2] - p[i], ez = p[i + 3] - p[i + 1];
      const t = clamp(((x - p[i]) * ex + (z - p[i + 1]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      const d = Math.hypot(x - p[i] - ex * t, z - p[i + 1] - ez * t);
      if (d < bd) (bd = d), (best = { ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3] });
    }
  }
  return best && { ...best, d: bd };
}

// Binary min-heap of [priority, key] pairs.
class Heap {
  constructor() {
    this.a = [];
  }
  push(f, k) {
    const a = this.a;
    let i = a.push([f, k]) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        let m = i;
        for (const c of [2 * i + 1, 2 * i + 2]) if (c < a.length && a[c][0] < a[m][0]) m = c;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// A route over the loaded roads from `from` to `to` ({x, z} each) as flat [x, z, ...] starting at
// `from`, or null when no road is near either end. A* over the road vertices that traffic uses
// (city.roadNodes). One way streets are respected unless opts.anyWay. Gives up after opts.limit
// expansions and returns the way to the closest vertex it reached.
export function planRoute(city, from, to, opts = {}) {
  const s = nearestSegment(city, from.x, from.z, 90), e = nearestSegment(city, to.x, to.z, 180);
  if (!s || !e) return null;
  const goals = new Set([roadKey(e.ax, e.az), roadKey(e.bx, e.bz)]);
  const nodes = new Map(), heap = new Heap();
  const h = (x, z) => Math.hypot(x - to.x, z - to.z);
  const put = (x, z, g, prev) => {
    const key = roadKey(x, z), n = nodes.get(key);
    if (n && n.g <= g) return;
    nodes.set(key, { x, z, g, prev, done: false });
    heap.push(g + h(x, z), key);
  };
  put(s.ax, s.az, Math.hypot(from.x - s.ax, from.z - s.az), null);
  put(s.bx, s.bz, Math.hypot(from.x - s.bx, from.z - s.bz), null);
  let end = null, near = null, nearD = Infinity;
  for (let n = 0; heap.a.length && n < (opts.limit ?? 6000); n++) {
    const [, key] = heap.pop();
    const node = nodes.get(key);
    if (node.done) continue;
    node.done = true;
    const d = h(node.x, node.z);
    if (d < nearD) (nearD = d), (near = key);
    if (goals.has(key)) {
      end = key;
      break;
    }
    for (const [road, i] of city.roadNodes.get(key) || []) {
      const m = road.pts.length / 2;
      for (const dir of road.oneway && !opts.anyWay ? [1] : [1, -1]) {
        const j = i + dir;
        if (j < 0 || j >= m) continue;
        const x = road.pts[2 * j], z = road.pts[2 * j + 1];
        put(x, z, node.g + Math.hypot(x - node.x, z - node.z), key);
      }
    }
  }
  end ??= near;
  if (end === null) return null;
  const pts = [];
  for (let k = end; k !== null; k = nodes.get(k).prev) pts.push(nodes.get(k).x, nodes.get(k).z);
  const out = [from.x, from.z];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

// Drives a traffic car (mode set by the caller, so traffic leaves it alone) along a route: keeps
// to the right of the centre line, slows in bends and for a car ahead, brakes to a stop at the end.
export class RoadDriver {
  constructor(traffic, car) {
    this.traffic = traffic;
    this.car = car;
    this.pts = null;
    this.seg = 0;
    this.cum = [];
    this.done = true;
  }

  follow(pts) {
    this.pts = pts;
    this.seg = 0;
    this.done = !pts || pts.length < 4;
    this.cum = [0];
    for (let i = 2; pts && i < pts.length; i += 2) this.cum.push(this.cum[i / 2 - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  }

  // Metres of route left.
  get left() {
    if (this.done || !this.pts) return 0;
    const p = this.pts, k = this.seg, c = this.car;
    return this.cum[this.cum.length - 1] - this.cum[k] - Math.min(Math.hypot(c.x - p[2 * k], c.z - p[2 * k + 1]), this.cum[k + 1] - this.cum[k]);
  }

  // Moves the car for dt seconds at up to `cruise` m/s (0 to brake to a stop).
  update(dt, cruise, laneShift = 1.7) {
    const c = this.car, p = this.pts, tr = this.traffic;
    let want = cruise, yawTo = c.yaw;
    if (p && !this.done) {
      const n = p.length / 2;
      while (this.seg < n - 2) {
        const k = this.seg, ex = p[2 * k + 2] - p[2 * k], ez = p[2 * k + 3] - p[2 * k + 1];
        if (((c.x - p[2 * k]) * ex + (c.z - p[2 * k + 1]) * ez) / (ex * ex + ez * ez || 1) < 1 && Math.hypot(c.x - p[2 * k + 2], c.z - p[2 * k + 3]) > 3) break;
        this.seg++;
      }
      // Look ahead along the route, further when faster, and aim a lane's width to the right of it.
      let k = this.seg, ax = c.x, az = c.z, look = clamp(5 + Math.abs(c.speed) * 0.45, 6, 20), tx = ax, tz = az, hx = 0, hz = 1;
      for (; k < n - 1; k++) {
        const bx = p[2 * k + 2], bz = p[2 * k + 3], L = Math.hypot(bx - ax, bz - az);
        hx = (bx - ax) / (L || 1);
        hz = (bz - az) / (L || 1);
        if (L >= look || k === n - 2) {
          const f = L ? Math.min(look, L) / L : 1;
          (tx = ax + (bx - ax) * f), (tz = az + (bz - az) * f);
          break;
        }
        look -= L;
        (ax = bx), (az = bz);
      }
      tx += -hz * laneShift;
      tz += hx * laneShift;
      yawTo = Math.atan2(tx - c.x, tz - c.z);
      if (this.left < 4) {
        want = Math.min(want, 2 + this.left * 1.5);
        if (this.left < 2.5 && Math.abs(c.speed) < 2.5) this.done = true;
      }
    } else want = 0;
    const turn = Math.atan2(Math.sin(yawTo - c.yaw), Math.cos(yawTo - c.yaw));
    want *= clamp(1 - Math.abs(turn) * 0.6, 0.3, 1);
    // Ease off for a car in front going the same way.
    const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
    for (const o of tr.cars) {
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z, f = dx * hx + dz * hz;
      if (f <= 0 || f > 9 + c.speed * 0.5 || Math.abs(-dx * hz + dz * hx) > 1.5 || Math.cos(o.yaw - c.yaw) < 0.5) continue;
      want = Math.min(want, Math.max(0, (f - (c.len + o.len) / 2 - 1.5) * 1.2));
    }
    c.speed += clamp(want - c.speed, -14 * dt, 5 * dt);
    const rate = clamp(7 / Math.max(Math.abs(c.speed), 3), 0.5, 2.6) * dt;
    const oy = c.yaw;
    c.yaw += clamp(turn, -rate, rate);
    c.vx = Math.sin(c.yaw) * c.speed;
    c.vz = Math.cos(c.yaw) * c.speed;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    const yawRate = Math.atan2(Math.sin(c.yaw - oy), Math.cos(c.yaw - oy)) / dt;
    c.steer = c.speed > 1 ? clamp((-yawRate * c.len * 0.6) / c.speed, -0.5, 0.5) : 0;
    tr.poseObj(c, dt);
  }
}

// Can a viewer at (ax, ay, az) see (bx, by, bz)? Samples the line every 2.5 m against the building
// footprints and heights (roof props and the first sample, right at the viewer, do not count).
export function sees(city, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, n = Math.ceil(Math.hypot(dx, dz) / 2.5);
  for (let k = 1; k < n; k++) {
    const t = k / n, x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
    for (const b of city.nearby(x, z, 0.3, _near)) {
      if (b.kind === 'prop' || y < b.y0 || y > b.y1) continue;
      if (pointInPrism2D(x, z, b)) return false;
    }
  }
  return true;
}

// Announces Respect on the event bus, and adds it to game.respect if nothing listening has (the
// owner of game.respect may add on the event itself, in which case its value has already moved).
export function payRespect(game, amount, why) {
  const r = game.respect, before = r?.value;
  game.events.emit('respect', { amount, why });
  if (r && r.value === before) r.add(amount, why);
}
