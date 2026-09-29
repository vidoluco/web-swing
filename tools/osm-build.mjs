// Turns cached Overpass JSON into game chunks: building prisms with estimated heights,
// road ribbons, water, green areas, trees. Usage: node tools/osm-build.mjs <out> <raw1> [raw2 ...]
// The city origin, box, landmarks and terrain come from tools/city-config.mjs (ORIGIN="lat,lon" and
// BBOX="south,west,north,east" in the environment override them); terrain from data/dem/<out>/ if built.
import { readFileSync, writeFileSync, mkdirSync, rmSync, createReadStream, existsSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { groundMap } from './ground-map.mjs';
import { cityParams } from './city-config.mjs';
import { loadDem } from './dem-lib.mjs';

const [outName, ...raws] = process.argv.slice(2);
const CITY = cityParams(outName);
const ORIGIN = CITY.origin;
const DEM_DIR = process.env.DEM_DIR || `data/dem/${outName}`;
const dem = existsSync(`${DEM_DIR}/dem.json`) ? loadDem(DEM_DIR, JSON.parse(readFileSync(`${DEM_DIR}/dem.json`, 'utf8'))) : null;
const CHUNK = 400;
const KX = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111320;
const KZ = 110574;
const proj = (p) => [Math.round((p.lon - ORIGIN.lon) * KX * 10) / 10, Math.round(-(p.lat - ORIGIN.lat) * KZ * 10) / 10];

// ---------- load ----------
// Files are processed one by one and reduced to projected coordinates and the tags we use,
// so the whole city fits in memory.
const KEEP = /^(building|building:part|height|min_height|building:levels|building:min_level|roof:levels|roof:shape|building:material|building:colour|building:color|name|highway|lanes|oneway|bridge|tunnel|layer|area|railway|natural|waterway|leisure|landuse|location|amenity|shop)$/;
// Same feature set as the Overpass query in osm-fetch.mjs, so both inputs build the same city.
const wanted = (t) =>
  t.building || t['building:part'] || t.highway || /^(rail|tram|light_rail)$/.test(t.railway || '') ||
  /^(water|wood|scrub|grassland|tree|tree_row)$/.test(t.natural || '') || /^(riverbank|river|canal)$/.test(t.waterway || '') ||
  /^(park|garden|pitch|playground|stadium)$/.test(t.leisure || '') ||
  /^(grass|forest|cemetery|recreation_ground|village_green|meadow)$/.test(t.landuse || '') || MAP_ONLY.test(t.landuse || '') || poiKind(t) >= 0;
// Places to drink: 0 bar or pub (beer and tuica), 1 kiosk or non-stop shop (beer).
const poiKind = (t) => (/^(bar|pub|biergarten|nightclub)$/.test(t.amenity || '') ? 0 : /^(alcohol|beverages|kiosk|convenience)$/.test(t.shop || '') ? 1 : -1);
// Land use that only colours the far ground map, never becomes 3D.
const MAP_ONLY = /^(farmland|farmyard|orchard|vineyard|allotments|plant_nursery|greenfield|brownfield|industrial|railway|commercial|retail|construction|residential)$/;
const mapAreas = [];
// Everything outside the city box is dropped or clipped (extracts carry whole rivers and forests).
const [S, W, N, E] = CITY.bbox;
const [BX0, BZ1] = proj({ lat: S, lon: W }), [BX1, BZ0] = proj({ lat: N, lon: E });
const inBox = (x, z) => x >= BX0 && x <= BX1 && z >= BZ0 && z <= BZ1;
const seen = new Set();
const els = [];
// Named places of the city config (any OSM element, by id), kept even though they are not drawn.
const placeByRef = new Map((CITY.places || []).map((p) => [p.ref, p]));
const placeEls = new Map();
const projGeom = (g) => (g ? g.map((p) => [Math.round((p.lon - ORIGIN.lon) * KX * 10) / 10, Math.round(-(p.lat - ORIGIN.lat) * KZ * 10) / 10]) : null);
// A .geojsonseq file (osmium export of a Geofabrik extract) is read as Overpass-like elements:
// points become nodes, lines and single-ring way areas become ways, relation areas become
// multipolygon relations with closed outer and inner rings.
const ll = (c) => ({ lon: c[0], lat: c[1] });
async function* geojsonElements(f) {
  for await (const line of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) {
    if (!line) continue;
    const ft = JSON.parse(line);
    const pr = ft.properties, g = ft.geometry;
    const tags = {};
    for (const k in pr) if (k[0] !== '@') tags[k] = pr[k];
    const type = pr['@type'], id = pr['@id'];
    if (g.type === 'Point') yield { type: 'node', id, tags, lon: g.coordinates[0], lat: g.coordinates[1] };
    else if (g.type === 'LineString') yield { type: 'way', id, tags, geometry: g.coordinates.map(ll) };
    else {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      if (type === 'way' && polys.length === 1 && polys[0].length === 1) yield { type: 'way', id, tags, geometry: polys[0][0].map(ll) };
      else yield { type: 'relation', id, tags, members: polys.flatMap((rings) => rings.map((r, i) => ({ type: 'way', role: i ? 'inner' : 'outer', geometry: r.map(ll) }))) };
    }
  }
}
function* overpassElements(f) {
  yield* JSON.parse(readFileSync(f, 'utf8')).elements;
}
for (const f of raws) {
  for await (const e of f.endsWith('.geojsonseq') ? geojsonElements(f) : overpassElements(f)) {
    const k = e.type[0] + e.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const place = placeByRef.get(k);
    if (place) placeEls.set(place.key, e.type === 'node' ? { xz: projGeom([e])[0] } : e.type === 'way' ? { g: projGeom(e.geometry) } : { members: e.members.filter((m) => m.type === 'way').map((m) => ({ role: m.role, g: projGeom(m.geometry) })) });
    const tags = {};
    for (const t in e.tags || {}) if (KEEP.test(t)) tags[t] = e.tags[t];
    if (!wanted(tags)) continue;
    if (e.type === 'node' && tags.natural !== 'tree' && poiKind(tags) < 0) continue;
    const o = { type: e.type, tags };
    if (e.type === 'node') o.xz = projGeom([e])[0];
    else if (e.type === 'way') o.g = projGeom(e.geometry);
    else if (e.members) o.members = e.members.filter((m) => m.type === 'way').map((m) => ({ role: m.role, g: projGeom(m.geometry) }));
    els.push(o);
  }
  process.stdout.write(`\r${f}: ${els.length} elements`);
}
console.log();
// ---------- geometry helpers ----------
const ringOf = (g) => g;
const closed = (r) => r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
const area = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
};
const centroid = (r) => {
  let x = 0, z = 0;
  for (const p of r) { x += p[0]; z += p[1]; }
  return [x / r.length, z / r.length];
};
const inside = (pt, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > pt[1]) !== (r[j][1] > pt[1]) && pt[0] < ((r[j][0] - r[i][0]) * (pt[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};
// Drop the duplicated closing vertex and near-duplicate points.
function clean(r) {
  const out = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.3) out.pop();
  return out;
}
// Join multipolygon member ways into closed rings.
function assemble(members) {
  const segs = members.filter((m) => m.g && m.g.length > 1).map((m) => ({ role: m.role || 'outer', pts: m.g }));
  const rings = [];
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  for (const role of ['outer', 'inner']) {
    const pool = segs.filter((s) => (role === 'outer' ? s.role !== 'inner' : s.role === 'inner')).map((s) => s.pts);
    while (pool.length) {
      let cur = pool.shift().slice();
      let guard = 0;
      while (!eq(cur[0], cur[cur.length - 1]) && guard++ < 500) {
        const i = pool.findIndex((p) => eq(p[0], cur[cur.length - 1]) || eq(p[p.length - 1], cur[cur.length - 1]));
        if (i < 0) break;
        const p = pool.splice(i, 1)[0];
        cur = cur.concat(eq(p[0], cur[cur.length - 1]) ? p.slice(1) : p.slice().reverse().slice(1));
      }
      if (eq(cur[0], cur[cur.length - 1]) && cur.length > 3) rings.push({ role, pts: cur });
    }
  }
  const outers = rings.filter((r) => r.role === 'outer').map((r) => ({ outer: r.pts, holes: [] }));
  for (const r of rings.filter((r) => r.role === 'inner')) {
    const o = outers.find((o) => inside(r.pts[0], o.outer));
    if (o) o.holes.push(r.pts);
  }
  return outers;
}
function polygonsOf(e) {
  if (e.type === 'way' && e.g) {
    const r = e.g;
    return closed(r) ? [{ outer: r, holes: [] }] : [];
  }
  if (e.type === 'relation' && e.members) return assemble(e.members);
  return [];
}
const num = (v) => {
  if (v === undefined) return undefined;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : undefined;
};

// Lowest and highest terrain under a footprint: its vertices, points along the edges every metre, the
// centroid and every terrain grid node inside (the bilinear surface has no other extremes).
function footprintGround(b) {
  let lo = Infinity, hi = -Infinity;
  const put = (x, z) => {
    const v = dem.groundAt(x, z);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  const r = b.outer;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 0; k < n; k++) put(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); z0 = Math.min(z0, az); z1 = Math.max(z1, az);
  }
  const inFootprint = (p) => inside(p, r) && !b.holes.some((h) => inside(p, h));
  if (inFootprint(b.c)) put(b.c[0], b.c[1]);
  const { x0: gx, z0: gz, step } = dem.meta;
  for (let x = gx + Math.ceil((x0 - gx) / step) * step; x <= x1; x += step) {
    for (let z = gz + Math.ceil((z0 - gz) / step) * step; z <= z1; z += step) if (inFootprint([x, z])) put(x, z);
  }
  return [lo, hi];
}

// The point that stands for a place: the node, the middle of a line, or the centre of an area.
function placePoint(o) {
  if (o.xz) return o.xz;
  const rings = o.members ? assemble(o.members).map((p) => p.outer) : closed(o.g) ? [o.g] : [];
  let A = 0, cx = 0, cz = 0;
  for (const r of rings) {
    let a = 0, x = 0, z = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f;
      x += (r[j][0] + r[i][0]) * f;
      z += (r[j][1] + r[i][1]) * f;
    }
    const s = Math.sign(a);
    A += a * s; cx += x * s; cz += z * s;
  }
  if (A > 1e-6) return [cx / (3 * A), cz / (3 * A)];
  const g = o.g, len = [0];
  for (let i = 1; i < g.length; i++) len.push(len[i - 1] + Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]));
  const i = Math.max(1, len.findIndex((l) => l >= len[len.length - 1] / 2)), t = (len[len.length - 1] / 2 - len[i - 1]) / (len[i] - len[i - 1] || 1);
  return [g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t];
}

// ---------- buildings ----------
const parts = [];
const outlines = [];
for (const e of els) {
  const t = e.tags || {};
  if (!t.building && !t['building:part']) continue;
  if (t.building === 'no' || t['building:part'] === 'no') continue;
  if (t.location === 'underground' || num(t.layer) < 0) continue;
  for (const poly of polygonsOf(e)) {
    const outer = clean(poly.outer);
    if (outer.length < 3 || Math.abs(area(outer)) < 6) continue;
    const item = { outer, holes: poly.holes.map(clean).filter((h) => h.length >= 3), t, isPart: !!t['building:part'] && !t.building };
    (item.isPart ? parts : outlines).push(item);
  }
}
// Outlines that contain parts are replaced by the parts (Simple 3D Buildings).
const partCentroids = parts.map((p) => centroid(p.outer));
const buildings = parts.slice();
for (const o of outlines) {
  const minx = Math.min(...o.outer.map((p) => p[0])), maxx = Math.max(...o.outer.map((p) => p[0]));
  const minz = Math.min(...o.outer.map((p) => p[1])), maxz = Math.max(...o.outer.map((p) => p[1]));
  const inner = [];
  partCentroids.forEach((pc, i) => {
    if (pc[0] > minx && pc[0] < maxx && pc[1] > minz && pc[1] < maxz && inside(pc, o.outer)) inner.push(parts[i]);
  });
  if (!inner.length) buildings.push(o);
  else o.parts = inner;
}
// Parts that start above the ground with nothing under them would float: extend them down,
// unless another part of the same building already reaches their base.
for (const o of outlines) {
  if (!o.parts) continue;
  for (const p of o.parts) {
    const minH = num(p.t.min_height) ?? (num(p.t['building:min_level']) !== undefined ? num(p.t['building:min_level']) * 3.2 : 0);
    if (!minH) continue;
    const pc = centroid(p.outer);
    const supported = o.parts.some((q) => q !== p && inside(pc, q.outer) && (num(q.t.height) ?? (num(q.t['building:levels']) || 0) * 3.2) >= minH - 1.5);
    if (!supported) p.t = { ...p.t, min_height: '0', 'building:min_level': undefined };
  }
}

// Heights: explicit tags first, then the median of tagged neighbours, then footprint size.
const LEVEL = 3.2;
function tagged(b) {
  const t = b.t;
  let h = num(t.height);
  const lv = num(t['building:levels']);
  const rl = num(t['roof:levels']) || 0;
  if (h === undefined && lv !== undefined) h = (lv + rl * 0.6) * LEVEL + 0.6;
  // A height far above what the level count allows is a tagging error ("cca. 95" on a car wash).
  else if (h !== undefined && lv !== undefined && h > (Math.max(lv, 1) + rl) * 5 + 12) h = (Math.max(lv, 1) + rl * 0.6) * LEVEL + 0.6;
  let minH = num(t.min_height);
  const minLv = num(t['building:min_level']);
  if (minH === undefined && minLv !== undefined) minH = minLv * LEVEL;
  if (h !== undefined) h = Math.round(h * 10) / 10;
  return { h, minH: minH || 0 };
}
const G = 60;
const grid = new Map();
for (const b of buildings) {
  const { h, minH } = tagged(b);
  b.c = centroid(b.outer);
  b.area = Math.abs(area(b.outer));
  b.h = h;
  b.minH = minH;
  if (h !== undefined && !b.isPart) {
    const k = Math.floor(b.c[0] / G) + ',' + Math.floor(b.c[1] / G);
    (grid.get(k) || grid.set(k, []).get(k)).push(h);
  }
}
let hash = 1;
const rnd = () => ((hash = (hash * 16807) % 2147483647) / 2147483647);
let estimated = 0;
for (const b of buildings) {
  if (b.h !== undefined) continue;
  estimated++;
  const t = b.t.building || b.t['building:part'];
  const gx = Math.floor(b.c[0] / G), gz = Math.floor(b.c[1] / G);
  const near = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) near.push(...(grid.get(gx + dx + ',' + (gz + dz)) || []));
  near.sort((a, b) => a - b);
  let h;
  if (['garage', 'garages', 'shed', 'roof', 'kiosk', 'carport', 'service', 'hut', 'toilets', 'container'].includes(t)) h = 3 + rnd() * 1.5;
  else if (['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(t)) h = 6.5 + rnd() * 4;
  else if (t === 'church' || t === 'cathedral' || t === 'chapel') h = 12 + Math.min(20, Math.sqrt(b.area) * 0.8);
  else if (near.length >= 3) {
    const med = near[Math.floor(near.length / 2)];
    // Small footprints next to tall ones are usually annexes: keep them lower.
    const small = b.area < 120 ? 0.45 : b.area < 300 ? 0.75 : 1;
    h = Math.max(4, med * small * (0.8 + rnd() * 0.4));
  } else {
    const a = b.area;
    h = a < 80 ? 4 + rnd() * 3 : a < 250 ? 7 + rnd() * 5 : a < 800 ? 10 + rnd() * 8 : 14 + rnd() * 14;
  }
  b.h = Math.round(h * 10) / 10;
}

// Style per building: 0 glass, 1 brick, 2 stone, 3 ribbon, 4 panel block, 5 plaster.
const PAL = {
  0: ['#8c96a0', '#5a6470', '#9fb3c8', '#3e4a56', '#6f7f8c'],
  1: ['#8a3b2a', '#7a3322', '#9b5a3c', '#6e2f25'],
  2: ['#d8d0bf', '#c9bfa8', '#e2dccd', '#bfb6a3', '#ece6d8'],
  3: ['#d0d0cc', '#a6a8a8', '#8e9294', '#c4b8a2'],
  4: ['#d9cfb8', '#cfc7b2', '#e3dac4', '#c9bca1', '#d6d3cb', '#e4d2b0', '#cbd3cf', '#dcc1a8', '#e6d9a8'],
  5: ['#e8d9b5', '#e6c8a0', '#f0e2c4', '#d9b99b', '#e7d6d0', '#d8cfb4', '#f1e7cf', '#e2c4a9', '#cfd6c6', '#f0d890'],
};
function styleOf(b) {
  const t = b.t;
  const type = t.building || t['building:part'];
  const mat = (t['building:material'] || '').toLowerCase();
  const col = t['building:colour'] || t['building:color'];
  let s;
  if (/^(Palatul|Catedrala|Biserica|Muzeul|Teatrul|Ateneul|Universitatea|Arcul|Casa Presei|Gara)/i.test(t.name || '') || type === 'triumphal_arch') s = 2;
  else if (mat === 'glass' || ((['office', 'commercial', 'hotel'].includes(type) || /tower|center|centre|plaza|business|park/i.test(t.name || '')) && b.h > 28)) s = 0;
  else if (mat === 'brick' || type === 'industrial' || type === 'warehouse') s = 1;
  else if (['church', 'cathedral', 'public', 'government', 'university', 'civic', 'museum', 'palace'].includes(type) || mat === 'stone') s = 2;
  else if (['apartments', 'residential', 'yes', 'dormitory'].includes(type) && b.h >= 16) s = 4;
  else if (b.h > 40) s = rnd() < 0.5 ? 0 : 3;
  else s = 5;
  const pal = PAL[s];
  const colour = col && /^#?[0-9a-f]{6}$/i.test(col) ? (col[0] === '#' ? col : '#' + col) : pal[Math.floor(rnd() * pal.length)];
  const roof = ['house', 'detached', 'semidetached_house', 'terrace', 'villa', 'church'].includes(type) || ['hipped', 'gabled', 'pyramidal'].includes(t['roof:shape']) ? 1 : 0;
  return { s, colour, roof };
}

// ---------- lines and areas ----------
const ROAD_W = { motorway: 16, trunk: 16, primary: 15, secondary: 12, tertiary: 10, motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7, residential: 7, unclassified: 7, living_street: 6, service: 4.5, pedestrian: 7, footway: 2.5, path: 2, cycleway: 2, track: 3, corridor: 0, steps: 2 };
const roads = [];
const rails = [];
const waters = [];
const greens = [];
const trees = [];
const pois = [];
for (const e of els) {
  const t = e.tags || {};
  const pk = poiKind(t);
  if (pk >= 0) {
    const pts = e.type === 'node' ? [e.xz] : e.g || e.members?.find((m) => m.role !== 'inner' && m.g)?.g;
    if (pts?.length) pois.push([...centroid(pts), pk, t.name || '']);
    if (e.type === 'node') continue;
  }
  if (e.type === 'node' && t.natural === 'tree') {
    trees.push([e.xz[0], e.xz[1], 0]);
    continue;
  }
  if (t.highway && e.type === 'way' && e.g && !t.building) {
    if (t.tunnel && t.tunnel !== 'no') continue;
    if (num(t.layer) < 0) continue;
    if (t.area === 'yes' && t.highway === 'pedestrian') {
      const r = e.g;
      if (closed(r)) greens.push({ kind: 'plaza', outer: clean(r), holes: [] });
      continue;
    }
    let w = ROAD_W[t.highway];
    if (!w) continue;
    const lanes = num(t.lanes);
    if (lanes && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified'].includes(t.highway)) w = Math.max(w * 0.6, lanes * 3.3 + 1);
    const cls = ['footway', 'path', 'cycleway', 'steps', 'track'].includes(t.highway) ? 'foot' : t.highway === 'pedestrian' ? 'ped' : 'road';
    roads.push({ cls, w: Math.round(w * 10) / 10, pts: e.g, oneway: t.oneway === 'yes', major: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(t.highway), bridge: t.bridge === 'yes' });
    continue;
  }
  if (t.railway && e.type === 'way' && e.g && !(t.tunnel && t.tunnel !== 'no')) {
    rails.push({ tram: t.railway === 'tram', pts: e.g });
    continue;
  }
  if (t.natural === 'water' || t.waterway === 'riverbank') {
    for (const p of polygonsOf(e)) waters.push({ outer: clean(p.outer), holes: p.holes.map(clean) });
    continue;
  }
  if (t.waterway === 'river' || t.waterway === 'canal') {
    if (e.g) roads.push({ cls: 'river', w: 22, pts: e.g });
    continue;
  }
  if (t.natural === 'tree_row' && e.g) {
    const r = e.g;
    for (let i = 1; i < r.length; i++) {
      const [ax, az] = r[i - 1], [bx, bz] = r[i];
      const L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 8) trees.push([ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L, 0]);
    }
    continue;
  }
  if (MAP_ONLY.test(t.landuse || '')) {
    for (const p of polygonsOf(e)) mapAreas.push({ use: t.landuse, outer: p.outer, holes: p.holes });
    continue;
  }
  const kind =
    t.natural === 'wood' || t.landuse === 'forest' ? 'wood'
      : t.leisure === 'pitch' || t.leisure === 'stadium' ? 'pitch'
        : t.leisure === 'playground' ? 'sand'
          : t.landuse === 'cemetery' ? 'cemetery'
            : t.leisure || t.landuse || t.natural === 'scrub' || t.natural === 'grassland' ? 'grass' : null;
  if (kind) for (const p of polygonsOf(e)) greens.push({ kind, outer: clean(p.outer), holes: p.holes.map(clean) });
}
// Fill woods, parks and cemeteries with trees where OSM has none mapped.
const treeGrid = new Set(trees.map(([x, z]) => Math.floor(x / 12) + ',' + Math.floor(z / 12)));
for (const g of greens) {
  const dens = g.kind === 'wood' ? 70 : g.kind === 'cemetery' ? 90 : g.kind === 'grass' ? 420 : 0;
  if (!dens) continue;
  const a = Math.abs(area(g.outer));
  const xs = g.outer.map((p) => p[0]), zs = g.outer.map((p) => p[1]);
  const x0 = Math.max(BX0, Math.min(...xs)), x1 = Math.min(BX1, Math.max(...xs)), z0 = Math.max(BZ0, Math.min(...zs)), z1 = Math.min(BZ1, Math.max(...zs));
  if (x0 >= x1 || z0 >= z1) continue;
  const n = Math.min(Math.max(4000, ((x1 - x0) * (z1 - z0)) / 40000), Math.floor(Math.min(a, (x1 - x0) * (z1 - z0)) / dens));
  let placed = 0, tries = 0;
  while (placed < n && tries++ < n * 6) {
    const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
    if (!inside(p, g.outer) || g.holes.some((h) => inside(p, h))) continue;
    if (treeGrid.has(Math.floor(p[0] / 12) + ',' + Math.floor(p[1] / 12))) continue;
    trees.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, 1]);
    placed++;
  }
}

// ---------- chunking ----------
const chunks = new Map();
const chunkOf = (x, z) => {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const k = cx + '_' + cz;
  let c = chunks.get(k);
  if (!c) chunks.set(k, (c = { k, cx, cz, b: [], r: [], w: [], g: [], t: [], rl: [], p: [] }));
  return c;
};
const flat = (r) => r.flat().map((v) => Math.round(v * 10) / 10);
let bi = 0;
for (const b of buildings) {
  if (!inBox(b.c[0], b.c[1])) continue;
  const st = styleOf(b);
  // With terrain the prism runs from the lowest ground under the footprint (plus min_height) to the
  // highest ground plus the height, so the walls always reach the ground.
  const [gLo, gHi] = dem ? footprintGround(b) : [0, 0];
  chunkOf(b.c[0], b.c[1]).b.push([st.s, st.colour, dem ? Math.round((gLo + b.minH) * 100) / 100 : Math.round(b.minH * 10) / 10, dem ? Math.round((gHi + b.h) * 100) / 100 : b.h, st.roof, (bi++ * 7919) % 1000, flat(b.outer), b.holes.map(flat), b.t.name || '']);
}
// Lines are split per chunk by their first vertex; long lines are cut into pieces so culling works.
function pushLine(list, item) {
  const pts = item.pts;
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[start], p = pts[i];
    if (Math.floor(a[0] / CHUNK) !== Math.floor(p[0] / CHUNK) || Math.floor(a[1] / CHUNK) !== Math.floor(p[1] / CHUNK) || i === pts.length - 1) {
      const seg = pts.slice(start, i + 1);
      if (seg.length > 1 && inBox(seg[0][0], seg[0][1])) list(chunkOf(seg[0][0], seg[0][1])).push({ ...item, pts: flat(seg) });
      start = i;
    }
  }
}
for (const r of roads) pushLine((c) => c.r, r);
for (const r of rails) pushLine((c) => c.rl, r);
// Clip a ring to an axis-aligned rectangle (Sutherland-Hodgman).
function clipRect(r, x0, z0, x1, z1) {
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]], [(p) => p[1] >= z0, (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0]], [(p) => p[1] <= z1, (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1]]];
  let out = r;
  for (const [ins, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (ins(b)) {
        if (!ins(a)) out.push(cut(a, b));
        out.push(b);
      } else if (ins(a)) out.push(cut(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}
// Polygons larger than a chunk are cut into chunk tiles so each piece streams with its chunk.
function tilePolygon(outer, holes, put) {
  const xs = outer.map((p) => p[0]), zs = outer.map((p) => p[1]);
  const cx0 = Math.floor(Math.max(BX0, Math.min(...xs)) / CHUNK), cx1 = Math.floor(Math.min(BX1, Math.max(...xs)) / CHUNK);
  const cz0 = Math.floor(Math.max(BZ0, Math.min(...zs)) / CHUNK), cz1 = Math.floor(Math.min(BZ1, Math.max(...zs)) / CHUNK);
  if (cx0 === cx1 && cz0 === cz1) {
    const c = centroid(outer);
    if (inBox(c[0], c[1])) put(chunkOf(c[0], c[1]), outer, holes);
    return;
  }
  for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) {
    const x0 = i * CHUNK, z0 = j * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
    const o = clipRect(outer, x0, z0, x1, z1);
    if (o.length < 3 || Math.abs(area(o)) < 4) continue;
    const hs = holes.map((h) => clipRect(h, x0, z0, x1, z1)).filter((h) => h.length >= 3);
    put(chunkOf(x0 + 1, z0 + 1), o, hs);
  }
}
for (const w of waters) tilePolygon(w.outer, w.holes, (c, o, hs) => c.w.push([flat(o), hs.map(flat)]));
for (const g of greens) tilePolygon(g.outer, g.holes, (c, o, hs) => c.g.push([g.kind, flat(o), hs.map(flat)]));
for (const [x, z, kind, name] of pois) if (inBox(x, z)) chunkOf(x, z).p.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, kind, name]);
for (const t of trees) if (inBox(t[0], t[1])) chunkOf(t[0], t[1]).t.push(Math.round(t[0] * 10) / 10, Math.round(t[1] * 10) / 10);

const dir = `public/city/${outName}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const index = { origin: ORIGIN, chunk: CHUNK, chunks: [] };
if (dem) {
  copyFileSync(`${DEM_DIR}/dem.bin`, `${dir}/dem.bin`);
  index.dem = dem.meta;
}
let bytes = 0;
for (const c of chunks.values()) {
  const body = JSON.stringify({ b: c.b, r: c.r, w: c.w, g: c.g, t: c.t, rl: c.rl, p: c.p });
  writeFileSync(`${dir}/${c.k}.json`, body);
  bytes += body.length;
  index.chunks.push({ k: c.k, cx: c.cx, cz: c.cz, nb: c.b.length });
}
// Far LOD: one oriented box per building, grouped by chunk so loaded chunks can hide theirs.
{
  const recs = [];
  for (const c of chunks.values()) {
    const start = recs.length / 11;
    for (const b of c.b) {
      const [, hex, y0, y1, , , outer] = b;
      let best = 0, ang = 0;
      for (let i = 0; i < outer.length; i += 2) {
        const j = (i + 2) % outer.length;
        const L = Math.hypot(outer[j] - outer[i], outer[j + 1] - outer[i + 1]);
        if (L > best) { best = L; ang = Math.atan2(outer[j + 1] - outer[i + 1], outer[j] - outer[i]); }
      }
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        const u = outer[i] * ca + outer[i + 1] * sa, v = -outer[i] * sa + outer[i + 1] * ca;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      }
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const col = parseInt(hex.slice(1), 16);
      recs.push(cu * ca - cv * sa, cu * sa + cv * ca, (u1 - u0) / 2, (v1 - v0) / 2, ang, y0, y1, ((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255, 0);
    }
    c.lod = [start, recs.length / 11 - start];
  }
  writeFileSync(`${dir}/lod.bin`, Buffer.from(new Float32Array(recs).buffer));
  for (const e of index.chunks) e.lod = chunks.get(e.k).lod;
}
// Far ground map over the whole city box.
{
  const MAPCOL = { farmland: '#8e9160', farmyard: '#8a8466', orchard: '#6f8446', vineyard: '#7a8750', allotments: '#6f8a4a', plant_nursery: '#6f8a4a', greenfield: '#8a9063', brownfield: '#8a8272', construction: '#8a8272', industrial: '#77777a', railway: '#76736f', commercial: '#7f7c79', retail: '#7f7c79', residential: '#86827b' };
  const GCOL = { grass: '#5f8a3e', wood: '#3c5a28', cemetery: '#56703c', pitch: '#5d8a44', sand: '#a89a78', plaza: '#a19b90' };
  const by = (list, keyOf, col) => {
    const m = new Map();
    for (const it of list) {
      const c = col[keyOf(it)];
      if (c) (m.get(c) || m.set(c, []).get(c)).push(it);
    }
    return [...m];
  };
  // Order matters: land use, then greens, water, streets on top.
  const areas = [
    ...by(mapAreas.filter((a) => a.use === 'residential'), (a) => a.use, MAPCOL),
    ...by(mapAreas.filter((a) => a.use !== 'residential'), (a) => a.use, MAPCOL),
    ...by(greens, (g) => g.kind, GCOL),
    ['#3c6c6c', waters],
  ];
  const minor = roads.filter((r) => r.cls === 'road' && !r.major).map((r) => r.pts);
  const major = roads.filter((r) => r.cls === 'road' && r.major).map((r) => r.pts);
  const rivers = roads.filter((r) => r.cls === 'river').map((r) => r.pts);
  const box = { x0: BX0, z0: BZ0, x1: BX1, z1: BZ1 };
  const gm = groundMap(`${dir}/ground.png`, box, {
    background: '#8a877f',
    areas,
    lines: [['#3c6c6c', () => 18, rivers], ['#66666a', () => 8, minor], ['#57575b', () => 16, major]],
  });
  index.map = { file: 'ground.png', ...box, w: gm.w, h: gm.h };
  console.log(`ground map ${gm.w}x${gm.h}, ${(gm.bytes / 1e6).toFixed(1)} MB`);
}
// Landmarks by name for spawn points and the minimap.
const landmarks = [];
for (const b of buildings) {
  if (!b.t.name || !CITY.landmarks) continue;
  if (CITY.landmarks(b)) landmarks.push({ name: b.t.name, x: Math.round(b.c[0]), z: Math.round(b.c[1]), h: b.h });
}
index.landmarks = landmarks.sort((a, b) => b.h - a.h).slice(0, 60);
// Named places of the city config: a point in game space (and the ground height there with terrain).
for (const p of CITY.places || []) {
  const o = placeEls.get(p.key);
  if (!o) {
    console.warn(`place ${p.key} (${p.ref}) not in the input`);
    continue;
  }
  const [x, z] = placePoint(o);
  const at = { key: p.key, name: p.name, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  if (dem) at.y = Math.round(dem.groundAt(x, z) * 10) / 10;
  index.landmarks.push(at);
}
writeFileSync(`${dir}/index.json`, JSON.stringify(index));
console.log(`${pois.length} places to drink (${pois.filter((p) => p[2] === 0).length} bars)`);
console.log(`${buildings.length} buildings (${estimated} heights estimated), ${roads.length} roads, ${waters.length} water, ${greens.length} green, ${trees.length} trees, ${chunks.size} chunks, ${(bytes / 1e6).toFixed(1)} MB`);
if (landmarks.length) console.log('tallest:', landmarks.slice(0, 12).map((l) => `${l.name} ${l.h}m`).join(' | '));
