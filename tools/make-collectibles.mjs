// Places the collectibles of a city: 50 jars of zacusca on roofs and monuments, and about 20 PET
// bottles on roofs, in front of the kiosks and bars, behind the missions and on monuments. Writes
// public/city/<id>/collect.json. Usage: node tools/make-collectibles.mjs <city>
//
// Deterministic: the same city data gives the same file (a seeded generator, candidates visited in a
// fixed order). The ids in it are what a player's save remembers, so they must not shift between
// runs, which is why the positions are made here from the built data and not at run time from
// game.rng, whose sequence depends on what the other systems drew before. Every roof candidate
// stands on the ground, is flat (no pitched roof), keeps 2 m clear of the parapet and of the roof
// props the city adds on top (mirrored from OsmCity.roofProps), has no taller building over it,
// and has a wall with open ground in front to climb. Ground candidates are out of every footprint
// and the water and within a few metres of a street or footway.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadCityData, pointInRing, ringDistance } from './city-data.mjs';
import { mulberry32 } from '../src/config.js';
import { MISSIONS } from '../src/missions-data.js';
import { CITIES } from '../src/cities.js';

export const SEED = 20260929;
const JARS = 50;
const PET_TYPES = ['beer', 'beer', 'beer', 'beer', 'beer', 'beer', 'wine', 'wine', 'wine', 'wine', 'wine', 'cola', 'cola', 'cola', 'water', 'water', 'juice', 'juice', 'tuica', 'tuica'];
const CITY = {
  // radius: how far from the origin the free roofs may be. Brasov's landmarks include Poiana, 5.7 km out.
  bucharest: { radius: 6500, spacing: 380, extra: /Palatul Universul|Palatul de Justiție|Palatul Voievodal Curtea Veche|Unirii View|Turnul Bursei|Turnul de Parașutism/ },
  brasov: { radius: 3200, spacing: 300, extra: null },
};

const r1 = (v) => Math.round(v * 10) / 10;

// The props OsmCity.roofProps puts on a flat roof, as rectangles.
function roofProps(building) {
  // The city keeps footprints as float32, and the props are drawn from a seed made of their bounds.
  const f = Float32Array.from(building.outer);
  const b = { outer: f, holes: building.holes, y1: building.y1, minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity };
  for (let i = 0; i < f.length; i += 2) {
    b.minx = Math.min(b.minx, f[i]);
    b.maxx = Math.max(b.maxx, f[i]);
    b.minz = Math.min(b.minz, f[i + 1]);
    b.maxz = Math.max(b.maxz, f[i + 1]);
  }
  const w = b.maxx - b.minx, d = b.maxz - b.minz;
  if (w * d < 150) return [];
  const seed = Math.abs(Math.sin(b.minx * 12.9898 + b.minz * 78.233)) * 43758.5453;
  let k = seed;
  const r = () => ((k = (k * 16807 + 11) % 2147483647) / 2147483647);
  const n = 1 + Math.floor(r() * (w * d > 800 ? 5 : 3));
  const out = [];
  for (let i = 0; i < n; i++) {
    const big = i === 0 && b.y1 > 18;
    const sx = big ? 4 + r() * 3 : 1.2 + r() * 2.2, sz = big ? 3 + r() * 3 : 1.2 + r() * 2;
    r(); // the height draw
    for (let tries = 0; tries < 8; tries++) {
      const x = b.minx + sx / 2 + 1 + r() * Math.max(0.1, w - sx - 2), z = b.minz + sz / 2 + 1 + r() * Math.max(0.1, d - sz - 2);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      if (!corners.every(([a, c]) => inside(b, x + (a * sx) / 2 + a, z + (c * sz) / 2 + c))) continue;
      out.push({ minx: x - sx / 2, maxx: x + sx / 2, minz: z - sz / 2, maxz: z + sz / 2 });
      break;
    }
  }
  return out;
}
const inside = (b, x, z) => x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz && pointInRing(x, z, b.outer) && !b.holes.some((h) => pointInRing(x, z, h));

function closestOnRing(x, z, r) {
  let best = { d: Infinity, x: 0, z: 0 };
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, x: px, z: pz };
  }
  return best;
}

export function makeCollectibles(city) {
  const cfg = CITY[city];
  if (!cfg) throw new Error(`no collectible plan for "${city}" (add it to CITY in tools/make-collectibles.mjs)`);
  const D = loadCityData(city);
  let hash = 0;
  for (const c of city) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const rng = mulberry32(SEED ^ hash);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // ---------- roofs ----------
  const groundMin = (b) => {
    let g = Infinity;
    for (let i = 0; i < b.outer.length; i += 2) g = Math.min(g, D.groundAt(b.outer[i], b.outer[i + 1]));
    return g;
  };
  const hipped = (b) => b.roof && b.holes.length === 0 && b.outer.length === 8;
  const eligible = (b) => {
    const h = b.y1 - b.y0;
    return h >= 12 && h <= 140 && b.area >= 90 && b.area <= 9000 && !hipped(b) && b.y0 - groundMin(b) < 1.2;
  };

  // A wall of the building with open ground a step out from it, where she can start a climb.
  const climbable = (b) => {
    const o = b.outer;
    let a2 = 0;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) a2 += o[j] * o[i + 1] - o[i] * o[j + 1];
    const sg = Math.sign(a2) || 1;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
      const ex = o[i] - o[j], ez = o[i + 1] - o[j + 1], L = Math.hypot(ex, ez);
      if (L < 4) continue;
      const nx = (sg * ez) / L, nz = (-sg * ex) / L, mx = (o[i] + o[j]) / 2 + nx * 2, mz = (o[i + 1] + o[j + 1]) / 2 + nz * 2;
      if (D.free(mx, mz, 0.6)) return true;
    }
    return false;
  };

  // The best spot on a roof: furthest from the parapet and the props. Null if nothing has 2 m to spare.
  const roofSpot = (b) => {
    const props = !b.roof && b.y1 - b.y0 > 9 && b.y0 < 0.5 ? roofProps(b) : [];
    const step = Math.max(1, Math.min(3, Math.sqrt(b.area) / 14));
    let best = null;
    for (let x = b.minx; x <= b.maxx; x += step) {
      for (let z = b.minz; z <= b.maxz; z += step) {
        if (!inside(b, x, z)) continue;
        let c = ringDistance(x, z, b.outer);
        for (const h of b.holes) c = Math.min(c, ringDistance(x, z, h));
        for (const p of props) {
          const dx = Math.max(p.minx - x, 0, x - p.maxx), dz = Math.max(p.minz - z, 0, z - p.maxz);
          c = Math.min(c, Math.hypot(dx, dz) - 0.9);
        }
        if (c >= 2 && (!best || c > best.c)) best = { x, z, c };
      }
    }
    if (!best) return null;
    // No taller building over it (a roof in a courtyard under another wall).
    if (D.buildingsNear(best.x, best.z, 2).some((o) => o !== b && inside(o, best.x, best.z) && o.y1 > b.y1 - 0.1)) return null;
    return { x: r1(best.x), z: r1(best.z), y: r1(b.y1) };
  };

  // ---------- ground ----------
  const groundSpot = (x, z, { near = 8, margin = 0.9, R = 40 } = {}) => {
    for (let r = 0; r <= R; r += 1.5) {
      for (let a = 0; a < (r ? 16 : 1); a++) {
        const th = (a / 16) * 2 * Math.PI + r;
        const px = x + Math.cos(th) * r, pz = z + Math.sin(th) * r;
        if (!D.free(px, pz, margin) || D.roadDistance(px, pz, near).d > near) continue;
        return { x: r1(px), z: r1(pz), y: r1(D.groundAt(px, pz)) };
      }
    }
    return null;
  };

  // ---------- anchors: monuments ----------
  let anchors;
  if (city === 'bucharest') {
    anchors = CITIES.bucharest.spots.map(([name, x, z]) => ({ name, x, z }));
    for (const b of D.buildings) if (cfg.extra?.test(b.name)) anchors.push({ name: b.name, x: b.cx, z: b.cz, exact: b });
  } else {
    anchors = (D.index.landmarks || []).map((l) => ({ name: l.name, x: l.x, z: l.z }));
  }

  const chosen = []; // { x, y, z, on, name }
  const used = new Set();
  const far = (x, z, min) => chosen.every((c) => Math.hypot(c.x - x, c.z - z) >= min);
  const takeRoof = (b) => {
    const s = roofSpot(b);
    if (!s || !climbable(b)) return null;
    used.add(b);
    return { ...s, on: 'roof' };
  };

  const monuments = [];
  for (const a of anchors) {
    // The best roof within reach of the landmark: tall, named, near.
    let cand = null;
    if (a.exact && eligible(a.exact)) cand = takeRoof(a.exact);
    if (!cand) {
      const list = D.buildingsNear(a.x, a.z, 100)
        .filter((b) => !used.has(b) && eligible(b) && Math.hypot(b.cx - a.x, b.cz - a.z) < 100)
        .map((b) => ({ b, score: (b.y1 - b.y0) + (b.name ? 25 : 0) - Math.hypot(b.cx - a.x, b.cz - a.z) * 0.25 }))
        .sort((p, q) => q.score - p.score || p.b.cx - q.b.cx);
      for (const { b } of list.slice(0, 8)) if ((cand = takeRoof(b))) break;
    }
    if (!cand) {
      const g = groundSpot(a.x, a.z, { near: 14, R: 60 });
      if (g) cand = { ...g, on: 'ground' };
    }
    if (cand) monuments.push({ ...cand, name: a.name });
  }

  // ---------- the jars ----------
  const jars = [];
  for (const m of monuments.slice(0, 14)) {
    jars.push(m);
    chosen.push(m);
  }
  const pool = shuffle(
    D.buildings
      .filter((b) => !used.has(b) && Math.hypot(b.cx, b.cz) < cfg.radius && eligible(b))
      .sort((a, b) => a.cx - b.cx || a.cz - b.cz),
  );
  for (let spacing = cfg.spacing; jars.length < JARS && spacing >= 40; spacing = Math.floor(spacing * 0.7)) {
    for (const b of pool) {
      if (jars.length >= JARS) break;
      if (used.has(b) || !far(b.cx, b.cz, spacing)) continue;
      const c = takeRoof(b);
      if (!c) continue;
      const j = { ...c, name: b.name || '' };
      jars.push(j);
      chosen.push(j);
    }
  }
  if (jars.length < JARS) throw new Error(`only ${jars.length} jar spots for ${city}`);
  jars.forEach((j, i) => (j.id = 'j' + String(i).padStart(2, '0')));

  // ---------- the PET bottles ----------
  const pets = [];
  const petAt = (spot, where) => pets.push({ ...spot, where });
  // 1. beside three landmarks, on the ground a few steps from where the jar is.
  for (const m of shuffle(monuments.slice())) {
    if (pets.length >= 3) break;
    const g = groundSpot(m.x + 6, m.z + 6, { near: 14, R: 30 });
    if (g && far(g.x, g.z, 8) && pets.every((p) => Math.hypot(p.x - g.x, p.z - g.z) > 300)) petAt(g, 'monument');
  }
  // 2. behind the missions: 10 to 14 m from a start marker, on open ground.
  const starts = MISSIONS[city]?.missions.map((m) => m.start) ?? [];
  for (const s of shuffle(starts.slice()).slice(0, 3)) {
    for (let a = 0; a < 24; a++) {
      const th = rng() * Math.PI * 2, d = 10 + rng() * 4;
      const g = groundSpot(s.x + Math.cos(th) * d, s.z + Math.sin(th) * d, { near: 12, R: 6 });
      if (g) {
        petAt(g, 'mission');
        break;
      }
    }
  }
  // 3. kiosks and bars: outside the door, a step along the shop front from the drinks the place already offers.
  const shops = shuffle(D.pois.filter((p) => Math.hypot(p.x, p.z) < cfg.radius).sort((a, b) => a.x - b.x || a.z - b.z));
  for (const kind of [1, 0]) {
    for (const p of shops) {
      if (pets.filter((q) => q.where === 'kiosk').length >= (kind === 1 ? 4 : 6)) break;
      if (p.kind !== kind || pets.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 500)) continue;
      const spot = pavementBeside(D, p);
      if (spot) petAt(spot, 'kiosk');
    }
  }
  // 4. roofs for the rest.
  for (let spacing = 900; pets.length < 20 && spacing >= 60; spacing = Math.floor(spacing * 0.7)) {
    for (const b of pool) {
      if (pets.length >= 20) break;
      if (used.has(b) || !far(b.cx, b.cz, 60) || pets.some((q) => Math.hypot(q.x - b.cx, q.z - b.cz) < spacing)) continue;
      const c = takeRoof(b);
      if (c) {
        petAt(c, 'roof');
        chosen.push(c);
      }
    }
  }
  if (pets.length < 20) throw new Error(`only ${pets.length} PET spots for ${city}`);
  pets.length = 20;
  // Types: the rare țuică on the highest places, the rest dealt out in a fixed shuffle.
  const order = pets.map((p, i) => i).sort((a, b) => (pets[b].on === 'roof' ? pets[b].y : -1) - (pets[a].on === 'roof' ? pets[a].y : -1) || a - b);
  const types = shuffle(PET_TYPES.filter((t) => t !== 'tuica'));
  const tuicaAt = new Set(order.slice(0, 2));
  let ti = 0;
  pets.forEach((p, i) => (p.type = tuicaAt.has(i) ? 'tuica' : types[ti++]));
  pets.forEach((p, i) => (p.id = 'p' + String(i).padStart(2, '0')));

  const out = { v: 1, city, seed: SEED, jars: jars.map(clean), pets: pets.map(clean) };
  return out;
}

const clean = (o) => ({ id: o.id, ...(o.type ? { type: o.type } : {}), x: o.x, y: o.y, z: o.z, on: o.on ?? 'ground', where: o.where, name: o.name || undefined });

// The pavement just outside a kiosk or bar, a step along the shop front from the drinks it offers.
function pavementBeside(D, poi) {
  let x = poi.x, z = poi.z, nx = 0, nz = 0;
  for (let pass = 0; pass < 3; pass++) {
    const b = D.buildingAt(x, z);
    if (!b) break;
    const c = closestOnRing(x, z, b.outer);
    const d = Math.hypot(c.x - x, c.z - z) || 1;
    nx = (c.x - x) / d;
    nz = (c.z - z) / d;
    x = c.x + nx * 1.8;
    z = c.z + nz * 1.8;
  }
  const tx = nx || nz ? -nz : 1, tz = nx || nz ? nx : 0;
  for (const s of [2.8, -2.8, 4, -4]) {
    const px = x + tx * s, pz = z + tz * s;
    if (D.free(px, pz, 0.8) && D.roadDistance(px, pz, 12).d <= 12) return { x: r1(px), z: r1(pz), y: r1(D.groundAt(px, pz)) };
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const city = process.argv[2];
  if (!city) throw new Error('usage: node tools/make-collectibles.mjs <city>');
  const out = makeCollectibles(city);
  writeFileSync(`public/city/${city}/collect.json`, JSON.stringify(out) + '\n');
  const count = (a, f) => a.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  console.log(`${city}: ${out.jars.length} jars ${JSON.stringify(count(out.jars, (j) => j.on))}, ${out.pets.length} PET ${JSON.stringify(count(out.pets, (p) => p.type))} ${JSON.stringify(count(out.pets, (p) => p.where))}`);
}
