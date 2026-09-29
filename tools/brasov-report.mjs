// Numbers behind docs/brasov-landmarks.md, read from the built city and the OSM extract.
// Usage: node tools/brasov-report.mjs [data/pbf/brasov.geojsonseq]
import { readFileSync } from 'node:fs';
import { cityParams, projection } from './city-config.mjs';
import { loadDem } from './dem-lib.mjs';

const raw = process.argv[2] || 'data/pbf/brasov.geojsonseq';
const dir = 'public/city/brasov';
const P = cityParams('brasov'), pr = projection(P.origin);
const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8'));
const { groundAt } = loadDem(dir, index.dem);
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const xz = (c) => pr.toXZ(c[0], c[1]);

const buildings = [], woods = [];
for (const c of index.chunks) {
  const d = JSON.parse(readFileSync(`${dir}/${c.k}.json`, 'utf8'));
  for (const b of d.b) buildings.push({ y1: b[3], name: b[8], outer: b[6] });
  for (const g of d.g) if (g[0] === 'wood') woods.push(g[1]);
}
const inRing = (x, z, r) => {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  return c;
};

// ---------- places ----------
console.log('| Place | x | z | ground y | roof y |\n|---|---:|---:|---:|---:|');
for (const l of index.landmarks.filter((l) => l.key)) {
  const b = buildings.find((b) => inRing(l.x, l.z, b.outer));
  console.log(`| ${l.name} | ${f1(l.x)} | ${f1(l.z)} | ${f1(groundAt(l.x, l.z))} | ${b ? f1(b.y1) : '-'} |`);
}

// ---------- the BRASOV sign ----------
const sign = index.landmarks.find((l) => l.key === 'scritta-brasov');
const h = 15, gx = (groundAt(sign.x + h, sign.z) - groundAt(sign.x - h, sign.z)) / (2 * h), gz = (groundAt(sign.x, sign.z + h) - groundAt(sign.x, sign.z - h)) / (2 * h);
const down = [-gx, -gz], dl = Math.hypot(...down); // downhill direction in game space (x east, z south)
const compass = (dx, dz) => (((Math.atan2(dx, -dz) * 180) / Math.PI) + 360) % 360; // 0 north, 90 east
const toTown = [-sign.x, -sign.z], contour = [-down[1] / dl, down[0] / dl];
console.log(`\nsign at (${f1(sign.x)}, ${f1(sign.z)}), ground ${f1(groundAt(sign.x, sign.z))}, slope ${(Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI).toFixed(1)} deg`);
console.log(`downhill faces compass ${compass(down[0] / dl, down[1] / dl).toFixed(0)} deg, the origin lies at compass ${compass(...toTown).toFixed(0)} deg, ${Math.hypot(...toTown).toFixed(0)} m away`);
console.log(`contour runs along compass ${compass(...contour).toFixed(0)} deg; ground along it every 20 m from -100 to 100 m:`);
console.log([-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100].map((t) => f1(groundAt(sign.x + contour[0] * t, sign.z + contour[1] * t))).join(' '));
console.log(`downhill unit vector (x east, z south) ${(down[0] / dl).toFixed(3)}, ${(down[1] / dl).toFixed(3)}; contour unit vector ${contour[0].toFixed(3)}, ${contour[1].toFixed(3)}`);
const mid = [sign.x + contour[0] * 35, sign.z + contour[1] * 35];
console.log(`level bench centre 35 m along the contour: (${f1(mid[0])}, ${f1(mid[1])}), ground ${f1(groundAt(...mid))}`);

// ---------- steep residential streets near Racadau and Schei ----------
// Centres picked on the map: Schei is the old quarter below the Warthe, Racadau the blocks and villas up the Racadau valley.
const RADIUS = 900; // metres from the district centre to the middle of a street
const districts = { Schei: [25.5815, 45.6385], 'Răcădău': [25.603, 45.63] };
const streets = new Map();
for (const line of readFileSync(raw, 'utf8').split('\n')) {
  if (!line.includes('"highway"')) continue;
  const ft = JSON.parse(line), t = ft.properties;
  if (ft.geometry.type !== 'LineString' || !t.name || !/^(residential|living_street|unclassified)$/.test(t.highway)) continue;
  const pts = ft.geometry.coordinates.map(xz);
  for (const [dn, dc] of Object.entries(districts)) {
    const [cx, cz] = xz(dc), m = pts[Math.floor(pts.length / 2)];
    if (Math.hypot(m[0] - cx, m[1] - cz) > RADIUS) continue;
    const key = `${t.name}|${dn}`;
    const s = streets.get(key) || streets.set(key, { name: t.name, district: dn, len: 0, drop: 0, max: 0, lo: Infinity, hi: -Infinity, ids: [], mid: [], forest: Infinity }).get(key);
    s.ids.push('w' + t['@id']);
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]), n = Math.max(1, Math.round(L / 10));
      let prev = groundAt(...pts[i - 1]);
      for (let k = 1; k <= n; k++) {
        const x = pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / n, z = pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / n, g = groundAt(x, z);
        s.len += L / n;
        s.drop += Math.abs(g - prev);
        s.max = Math.max(s.max, Math.abs(g - prev) / (L / n));
        s.lo = Math.min(s.lo, g);
        s.hi = Math.max(s.hi, g);
        prev = g;
        s.mid.push([x, z]);
      }
    }
  }
}
// distance from a point to the nearest wood polygon (0 inside)
const woodBox = woods.map((r) => r.reduce((b, v, i) => (i % 2 ? [b[0], Math.min(b[1], v), b[2], Math.max(b[3], v)] : [Math.min(b[0], v), b[1], Math.max(b[2], v), b[3]]), [Infinity, Infinity, -Infinity, -Infinity]));
const woodDist = (x, z) => {
  let best = Infinity;
  for (const [k, r] of woods.entries()) {
    const b = woodBox[k];
    if (x < b[0] - best || x > b[2] + best || z < b[1] - best || z > b[3] + best) continue;
    if (inRing(x, z, r)) return 0;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length, ax = r[i], az = r[i + 1], ex = r[j] - ax, ez = r[j + 1] - az, L2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / L2));
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
  }
  return best;
};
const rows = [];
for (const s of streets.values()) {
  if (s.len < 120) continue;
  s.grade = s.drop / s.len;
  rows.push(s);
}
rows.sort((a, b) => b.grade - a.grade);
// The bear enters where the street comes closest to the wood.
for (const s of rows.slice(0, 40)) {
  s.forest = Infinity;
  for (const p of s.mid) {
    const d = woodDist(...p);
    if (d < s.forest) { s.forest = d; s.c = p; }
  }
}
console.log('\n| Street | District | length m | mean grade | max grade (10 m) | ground y | wood distance m | entry x | entry z | entry ground y | ways |\n|---|---|---:|---:|---:|---|---:|---:|---:|---:|---|');
for (const s of rows.slice(0, 40).filter((s) => s.forest < 100)) {
  console.log(`| ${s.name} | ${s.district} | ${Math.round(s.len)} | ${(s.grade * 100).toFixed(0)}% | ${(s.max * 100).toFixed(0)}% | ${f1(s.lo)} to ${f1(s.hi)} | ${Math.round(s.forest)} | ${Math.round(s.c[0])} | ${Math.round(s.c[1])} | ${f1(groundAt(...s.c))} | ${s.ids.slice(0, 3).join(' ')} |`);
}
