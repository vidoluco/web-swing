import * as THREE from 'three';
import { h32, rnd01 } from './buildings.js';

// Road, pavement, path, plaza and tram geometry of a chunk, draped on city.groundAt, with the per-vertex data
// the ground shaders in ground.js read: aRoad = (road width, flags or ribbon width, length, seed), aDir = direction.
// Flags: bit0 major, bit1 one way, bit2 bridge.

class Strip {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.road = [];
    this.dir = [];
    this.idx = [];
    this.n = 0;
  }
  geometry() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(this.road, 4));
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(this.dir, 2));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Resample a polyline to at most `step` metres between points (flat cities keep their own vertices).
function resample(pts, step) {
  if (!step) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
  }
  return out;
}

// A ribbon of total width `w` along pts. flags/road4 are copied to every vertex.
function ribbon(strip, city, pts, w, yOff, a0, a1, seed, offset = 0, step = 0) {
  pts = resample(pts, step);
  const n = pts.length / 2;
  if (n < 2) return;
  const flat = !step;
  const g = flat ? () => 0 : (x, z) => city.groundAt(x, z);
  let u = 0, len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  const base = strip.n;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
    const nx = pts[Math.min(n - 1, i + 1) * 2], nz = pts[Math.min(n - 1, i + 1) * 2 + 1];
    let dx = nx - px, dz = nz - pz;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    let miter = 1;
    if (i > 0 && i < n - 1) {
      const ax = x - px, az = z - pz, al = Math.hypot(ax, az) || 1;
      const bx = nx - x, bz = nz - z, bl = Math.hypot(bx, bz) || 1;
      const cos = (ax * bx + az * bz) / (al * bl);
      miter = Math.min(2, 1 / Math.sqrt(Math.max(0.2, (1 + cos) / 2)));
    }
    const ox = -dz, oz = dx, hw = (w / 2) * miter;
    if (i > 0) u += Math.hypot(x - pts[(i - 1) * 2], z - pts[(i - 1) * 2 + 1]);
    const lx = x + ox * (hw + offset), lz = z + oz * (hw + offset), rx = x - ox * (hw - offset), rz = z - oz * (hw - offset);
    let ny = 1, nxx = 0, nzz = 0;
    if (!flat) {
      const e = 2;
      const gx = (city.groundAt(x + e, z) - city.groundAt(x - e, z)) / (2 * e), gz = (city.groundAt(x, z + e) - city.groundAt(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      nxx = -gx / l; ny = 1 / l; nzz = -gz / l;
    }
    for (const [vx, vz, v] of [[lx, lz, 0], [rx, rz, 1]]) {
      strip.pos.push(vx, g(vx, vz) + yOff, vz);
      strip.nor.push(nxx, ny, nzz);
      strip.uv.push(u, v);
      strip.road.push(a0, a1, len, seed);
      strip.dir.push(dx, dz);
    }
    strip.n += 2;
  }
  // The strip runs L, R per sample. (L_i, L_i+1, R_i) faces up.
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    strip.idx.push(a, c, b, b, c, d);
  }
}

export class Streets {
  constructor(city) {
    this.city = city;
    this.step = city.index.dem ? 4 : 0;
  }

  // Replaces OsmCity.buildLines. Returns { sidewalk, road, path, plaza, river } geometries.
  build(list) {
    const city = this.city;
    const S = { sidewalk: new Strip(), road: new Strip(), path: new Strip(), plaza: new Strip(), river: new Strip() };
    for (const r of list) {
      const pts = r.pts;
      if (pts.length < 4) continue;
      const seed = (h32(Math.round(pts[0] * 10) ^ (Math.round(pts[1] * 10) << 8)) & 1023) / 1023;
      if (r.cls === 'river') ribbon(S.river, city, pts, r.w, 0, r.w, r.w, seed, 0, this.step);
      else if (r.cls === 'foot') ribbon(S.path, city, pts, r.w + 0.7, 0.02, r.w, r.w + 0.7, seed, 0, this.step);
      else if (r.cls === 'ped') ribbon(S.plaza, city, pts, r.w, 0.02, r.w, r.w, 2, 0, this.step);
      else {
        const flags = (r.major ? 1 : 0) | (r.oneway ? 2 : 0) | (r.bridge ? 4 : 0);
        const W = r.w + (r.major ? 7 : 4.5);
        ribbon(S.sidewalk, city, pts, W, 0.015, r.w, W, seed, 0, this.step);
        ribbon(S.road, city, pts, r.w + 0.36, 0.03, r.w, flags, seed, 0, this.step);
      }
      city.mmPut(pts[0], pts[1], 'r', r);
    }
    const res = {};
    for (const k in S) res[k] = S[k].geometry();
    return res;
  }

  // Tram track: a ballast bed and two steel rails. Returns { bed, rails } geometries or null.
  buildRails(list) {
    if (!list || !list.length) return null;
    const bed = new Strip(), rails = new Strip();
    for (const r of list) {
      if (r.pts.length < 4) continue;
      ribbon(bed, this.city, r.pts, 3.1, 0.035, 0, 3.1, 0, 0, this.step);
      for (const o of [-0.72, 0.72]) ribbon(rails, this.city, r.pts, 0.13, 0.05, 0, 0.13, 1, o, this.step);
    }
    return { bed: bed.geometry(), rails: rails.geometry() };
  }
}
