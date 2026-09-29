// Reads a built city (public/city/<id>/) with node only and answers placement questions: is this
// point inside a building or in the water, how far is the nearest street, what is the ground
// height. Used by make-collectibles.mjs and by the mission and challenge tests, so the data they
// place is checked against the same footprints the game collides with.
import { readFileSync, existsSync } from 'node:fs';
import { loadDem } from './dem-lib.mjs';

const CELL = 64;

export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Distance from (x, z) to the nearest segment of a closed ring.
export function ringDistance(x, z, r) {
  let best = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function loadCityData(city, root = 'public/city') {
  const dir = existsSync(city) ? city : `${root}/${city}`;
  const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
  const dem = index.dem ? loadDem(dir, index.dem) : null;
  const groundAt = (x, z) => (dem ? dem.groundAt(x, z) : 0);
  const D = { dir, index, groundAt, buildings: [], waters: [], roads: [], pois: [], greens: [], bounds: { minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity } };
  const bGrid = new Map(), wGrid = new Map(), rGrid = new Map();
  const put = (grid, minx, maxx, minz, maxz, item) => {
    for (let gx = Math.floor(minx / CELL); gx <= Math.floor(maxx / CELL); gx++) {
      for (let gz = Math.floor(minz / CELL); gz <= Math.floor(maxz / CELL); gz++) {
        const k = gx * 100003 + gz;
        const a = grid.get(k);
        if (a) a.push(item);
        else grid.set(k, [item]);
      }
    }
  };
  const box = (ring) => {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minx = Math.min(minx, ring[i]);
      maxx = Math.max(maxx, ring[i]);
      minz = Math.min(minz, ring[i + 1]);
      maxz = Math.max(maxz, ring[i + 1]);
    }
    return { minx, maxx, minz, maxz };
  };
  for (const c of index.chunks) {
    const d = { r: [], w: [], g: [], t: [], rl: [], p: [], ...JSON.parse(readFileSync(`${dir}/${c.k}.json`, 'utf8')) };
    for (const [style, colour, y0, y1, roof, seed, outer, holes, name] of d.b) {
      if (y1 - y0 < 0.5) continue;
      const bb = box(outer);
      let sx = 0, sz = 0;
      for (let i = 0; i < outer.length; i += 2) (sx += outer[i]), (sz += outer[i + 1]);
      let area = 0;
      for (let i = 0, j = outer.length - 2; i < outer.length; j = i, i += 2) area += outer[j] * outer[i + 1] - outer[i] * outer[j + 1];
      const b = { style, y0, y1, roof, seed, outer, holes, name: name || '', ...bb, cx: (2 * sx) / outer.length, cz: (2 * sz) / outer.length, area: Math.abs(area) / 2 };
      D.buildings.push(b);
      put(bGrid, b.minx, b.maxx, b.minz, b.maxz, b);
      const B = D.bounds;
      B.minx = Math.min(B.minx, b.minx); B.maxx = Math.max(B.maxx, b.maxx); B.minz = Math.min(B.minz, b.minz); B.maxz = Math.max(B.maxz, b.maxz);
    }
    for (const [outer, holes] of d.w) {
      const w = { outer, holes: holes || [], ...box(outer) };
      D.waters.push(w);
      put(wGrid, w.minx, w.maxx, w.minz, w.maxz, w);
    }
    for (const r of d.r) {
      const bb = box(r.pts);
      const road = { cls: r.cls, w: r.w, pts: r.pts, major: !!r.major, ...bb };
      D.roads.push(road);
      put(rGrid, bb.minx - r.w, bb.maxx + r.w, bb.minz - r.w, bb.maxz + r.w, road);
    }
    for (const p of d.p) D.pois.push({ x: p[0], z: p[1], kind: p[2], name: p[3] });
    for (const g of d.g) D.greens.push({ kind: g[0], outer: g[1], holes: g[2] || [], ...box(g[1]) });
  }
  const near = (grid, x, z, r) => {
    const out = new Set();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) {
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) for (const it of grid.get(gx * 100003 + gz) || []) out.add(it);
    }
    return [...out];
  };
  D.buildingsNear = (x, z, r) => near(bGrid, x, z, r);
  D.roadsNear = (x, z, r) => near(rGrid, x, z, r);
  D.inBuilding = (b, x, z) => x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz && pointInRing(x, z, b.outer) && !b.holes.some((h) => pointInRing(x, z, h));
  // The building whose footprint holds (x, z), or null.
  D.buildingAt = (x, z) => D.buildingsNear(x, z, 1).find((b) => D.inBuilding(b, x, z)) || null;
  D.inWater = (x, z) => near(wGrid, x, z, 1).some((w) => x > w.minx && x < w.maxx && z > w.minz && z < w.maxz && pointInRing(x, z, w.outer) && !w.holes.some((h) => pointInRing(x, z, h)));
  // Distance to the nearest building wall (0 inside), for buildings a walker meets: they start near the ground.
  D.wallDistance = (x, z, r = 12) => {
    let best = Infinity;
    for (const b of D.buildingsNear(x, z, r)) {
      if (b.y0 > D.groundAt(x, z) + 2.5) continue;
      if (D.inBuilding(b, x, z)) return 0;
      best = Math.min(best, ringDistance(x, z, b.outer));
    }
    return best;
  };
  // Standing on it: out of every building footprint by `margin` metres and out of the water.
  D.free = (x, z, margin = 0.6) => !D.inWater(x, z) && D.wallDistance(x, z, margin + 2) >= margin;
  D.inCity = (x, z) => x >= D.bounds.minx - 50 && x <= D.bounds.maxx + 50 && z >= D.bounds.minz - 50 && z <= D.bounds.maxz + 50;
  // Distance to the nearest street or footway piece, and its class.
  D.roadDistance = (x, z, r = 40, classes = null) => {
    let best = { d: Infinity, road: null };
    for (const road of D.roadsNear(x, z, r)) {
      if (classes && !classes.includes(road.cls)) continue;
      const p = road.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / L2));
        const d = Math.hypot(x - p[i] - dx * t, z - p[i + 1] - dz * t);
        if (d < best.d) best = { d, road };
      }
    }
    return best;
  };
  return D;
}
