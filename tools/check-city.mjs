// Loads a built city folder with node only and checks it. Usage: node tools/check-city.mjs <city or folder>
// Prints counts, heights and terrain checks; exits 1 when a hard check fails.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { loadDem } from './dem-lib.mjs';
import { CITIES } from './city-config.mjs';

const arg = process.argv[2];
if (!arg) throw new Error('usage: node tools/check-city.mjs <city or folder>');
const dir = existsSync(arg) ? arg : `public/city/${arg}`;
const fails = [];
const fail = (m) => fails.push(m);
const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
const dem = index.dem ? loadDem(dir, index.dem) : null;

// ---------- chunks ----------
const N = { buildings: 0, trees: 0, pois: 0, water: 0, rails: 0, tram: 0 };
const roads = {}, greens = {};
let y0min = Infinity, y1max = -Infinity, nan = 0, inverted = 0, lodExpect = 0;
const roadPts = [];
const buildings = [];
for (const c of index.chunks) {
  const f = `${dir}/${c.k}.json`;
  if (!existsSync(f)) { fail(`missing chunk ${c.k}`); continue; }
  const d = { r: [], w: [], g: [], t: [], rl: [], p: [], ...JSON.parse(readFileSync(f, 'utf8')) };
  if (d.b.length !== c.nb) fail(`chunk ${c.k}: index says ${c.nb} buildings, file has ${d.b.length}`);
  lodExpect += c.nb;
  N.buildings += d.b.length;
  N.trees += d.t.length / 2;
  N.pois += d.p.length;
  N.water += d.w.length;
  N.rails += d.rl.length;
  N.tram += d.rl.filter((r) => r.tram).length;
  for (const r of d.r) {
    const k = r.cls === 'road' ? (r.major ? 'road (major)' : 'road (minor)') : r.cls;
    roads[k] = (roads[k] || 0) + 1;
    if (r.cls === 'road') roadPts.push(r.pts);
  }
  for (const g of d.g) greens[g[0]] = (greens[g[0]] || 0) + 1;
  for (const b of d.b) {
    const [, , y0, y1, , , outer, holes] = b;
    if (![y0, y1].every(Number.isFinite)) { nan++; continue; }
    if (!(y1 > y0)) inverted++; // a min_height at or above the height in the OSM tags
    y0min = Math.min(y0min, y0);
    y1max = Math.max(y1max, y1);
    buildings.push({ y0, y1, outer, holes });
  }
}
const sum = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`${dir}: ${index.chunks.length} chunks, origin ${index.origin.lat}, ${index.origin.lon}`);
console.log(`buildings ${N.buildings}, trees ${N.trees}, drinking places ${N.pois}, water polygons ${N.water}, rails ${N.rails} (tram ${N.tram})`);
console.log(`roads: ${sum(roads)}`);
console.log(`greens: ${sum(greens)}`);
console.log(`buildings y0 min ${y0min}, y1 max ${y1max}, non finite ${nan}, y1 not above y0 ${inverted}`);
if (nan) fail(`${nan} buildings with a non finite y0/y1`);
if (dem && inverted) fail(`${inverted} buildings with y1 not above y0`);
if (existsSync(`${dir}/lod.bin`)) {
  const bytes = statSync(`${dir}/lod.bin`).size;
  if (bytes !== lodExpect * 44) fail(`lod.bin is ${bytes} bytes, ${lodExpect} boxes need ${lodExpect * 44}`);
}
if (index.map && !existsSync(`${dir}/${index.map.file}`)) fail(`missing ${index.map.file}`);

// ---------- terrain ----------
if (!dem) {
  console.log('no dem: flat city (every height is relative to ground 0)');
} else {
  const { meta, data, groundAt } = dem;
  let mn = Infinity, mx = -Infinity, bad = 0;
  for (const v of data) { if (!Number.isFinite(v)) bad++; else { mn = Math.min(mn, v); mx = Math.max(mx, v); } }
  console.log(`dem ${meta.w} x ${meta.h}, step ${meta.step} m, origin corner (${meta.x0}, ${meta.z0}), file range ${mn.toFixed(2)} to ${mx.toFixed(2)} m, index says ${meta.min} to ${meta.max}, origin at ${meta.base} m above sea level`);
  if (bad) fail(`${bad} non finite dem samples`);
  if (Math.abs(mn - meta.min) > 0.01 || Math.abs(mx - meta.max) > 0.01) fail('dem min/max in index.json do not match dem.bin');
  const [bx0, bz0, bx1, bz1] = index.map ? [index.map.x0, index.map.z0, index.map.x1, index.map.z1] : [meta.x0, meta.z0, meta.x0 + (meta.w - 1) * meta.step, meta.z0 + (meta.h - 1) * meta.step];
  if (bx0 < meta.x0 || bz0 < meta.z0 || bx1 > meta.x0 + (meta.w - 1) * meta.step || bz1 > meta.z0 + (meta.h - 1) * meta.step) fail('the dem does not cover the city box');
  const at = (v) => { const k = data.indexOf(v); return `(${meta.x0 + (k % meta.w) * meta.step}, ${meta.z0 + Math.floor(k / meta.w) * meta.step})`; };
  console.log(`lowest point ${at(mn)}, highest point ${at(mx)}; origin height ${groundAt(0, 0).toFixed(2)} (must be 0)`);
  if (Math.abs(groundAt(0, 0)) > 0.05) fail('ground at the origin is not 0');
  // Places with a surveyed elevation in OSM must sit at that height above sea level, within the tolerance.
  for (const [key, ele, tol] of CITIES[basename(dir)]?.elevations || []) {
    const l = index.landmarks.find((l) => l.key === key);
    if (!l) { fail(`place ${key} missing from index.json`); continue; }
    const got = l.y + meta.base;
    console.log(`  ${key}: dem ${got.toFixed(0)} m above sea level, OSM ${ele} (tolerance ${tol})`);
    if (Math.abs(got - ele) > tol) fail(`${key} is at ${got.toFixed(0)} m, OSM says ${ele}`);
  }

  // Every building must stand on the terrain: y0 is the lowest ground under the footprint.
  // The reference is independent of the builder: vertices, edges every 1 m and a 1 m lattice inside.
  const inside = (x, z, r) => {
    let c = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    }
    return c;
  };
  let exact = 0, raised = 0, high = 0, worstHigh = 0, worstLow = 0;
  const highs = [];
  let uMin = Infinity, uMax = -Infinity;
  for (const b of buildings) {
    const r = b.outer;
    let lo = Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length, dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], n = Math.max(1, Math.ceil(Math.hypot(dx, dz)));
      for (let k = 0; k < n; k++) lo = Math.min(lo, groundAt(r[i] + (dx * k) / n, r[i + 1] + (dz * k) / n));
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
    }
    for (let x = Math.ceil(x0); x <= x1; x++) {
      for (let z = Math.ceil(z0); z <= z1; z++) {
        if (inside(x, z, r) && !b.holes.some((h) => inside(x, z, h))) lo = Math.min(lo, groundAt(x, z));
      }
    }
    uMin = Math.min(uMin, lo);
    uMax = Math.max(uMax, lo);
    const d = b.y0 - lo; // > 0: the base is above the lowest ground, < 0: buried
    if (Math.abs(d) <= 0.05) exact++;
    else if (d > 0.5) raised++; // a min_height part, held up by the rest of its building
    else if (d > 0.05) { high++; worstHigh = Math.max(worstHigh, d); if (highs.length < 5) highs.push(d.toFixed(2)); }
    else worstLow = Math.min(worstLow, d);
  }
  console.log(`ground under buildings: ${uMin.toFixed(1)} to ${uMax.toFixed(1)} m; y0 within 0.05 m of the lowest ground: ${exact} of ${buildings.length}, raised parts (min_height): ${raised}, base above ground by 0.05 to 0.5 m: ${high} (worst ${worstHigh.toFixed(2)}), buried by more than 0.05 m: worst ${worstLow.toFixed(2)}`);
  if (high) fail(`${high} buildings float above their lowest ground by more than 0.05 m (${highs.join(', ')} ...)`);
  if (worstLow < -0.3) fail(`a building is buried by ${worstLow.toFixed(2)} m`);

  // Streets: how bumpy and how steep the terrain is along them.
  const bump = [], grade = [];
  for (const pts of roadPts) {
    let prev = null, prev2 = null;
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 5));
      for (let k = 0; k < n; k++) {
        const g = groundAt(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
        if (prev !== null) grade.push(Math.abs(g - prev) / (L / n));
        if (prev2 !== null) bump.push(Math.abs(prev2 - 2 * prev + g));
        prev2 = prev;
        prev = g;
      }
    }
  }
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  console.log(`streets: grade p50 ${(pct(grade, 0.5) * 100).toFixed(1)}%, p95 ${(pct(grade, 0.95) * 100).toFixed(1)}%, p99.9 ${(pct(grade, 0.999) * 100).toFixed(1)}%; bump (second difference over 5 m) p50 ${pct(bump, 0.5).toFixed(3)} m, p95 ${pct(bump, 0.95).toFixed(3)} m, p99.9 ${pct(bump, 0.999).toFixed(3)} m`);
}

// ---------- landmarks ----------
const named = (index.landmarks || []).filter((l) => l.key);
if (named.length) {
  console.log('places:');
  for (const l of named) console.log(`  ${l.key.padEnd(24)} x ${String(l.x).padStart(8)}  z ${String(l.z).padStart(8)}  ground ${l.y !== undefined ? l.y : '-'}`);
}
if (fails.length) {
  for (const f of fails) console.log('FAIL:', f);
  process.exit(1);
}
console.log('OK');
