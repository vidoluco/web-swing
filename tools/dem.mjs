// Builds the terrain grid of a city from Copernicus GLO-30 tiles (public, no account).
// Usage: node tools/dem.mjs <city> [tile.tif ...]      (SIGMA=22 STEP=15 in the environment)
// Without tiles it downloads the 1x1 degree tiles the city box needs into data/dem/.
// Writes data/dem/<city>/dem.bin and dem.json, which osm-build.mjs picks up.
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fromFile } from 'geotiff';
import { cityParams, projection } from './city-config.mjs';
import { bilinear } from './dem-lib.mjs';

const [city, ...given] = process.argv.slice(2);
const P = cityParams(city);
const pr = projection(P.origin);
const STEP = +(process.env.STEP || 15); // grid spacing in game metres
const SIGMA = +(process.env.SIGMA || 22); // Gaussian smoothing in metres
const [S, W, N, E] = P.bbox;

// ---------- tiles ----------
const tileName = (lat, lon) => {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
  return `Copernicus_DSM_COG_10_${ns}${String(Math.abs(lat)).padStart(2, '0')}_00_${ew}${String(Math.abs(lon)).padStart(3, '0')}_00_DEM`;
};
let files = given;
if (!files.length) {
  mkdirSync('data/dem', { recursive: true });
  for (let lat = Math.floor(S - 0.01); lat <= Math.floor(N + 0.01); lat++) {
    for (let lon = Math.floor(W - 0.01); lon <= Math.floor(E + 0.01); lon++) {
      const name = tileName(lat, lon), f = `data/dem/${name}.tif`;
      if (!existsSync(f)) {
        console.log(`downloading ${name}`);
        const res = await fetch(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`);
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body), createWriteStream(f));
      }
      files.push(f);
    }
  }
}

// A tile is read whole (a 1 degree GLO-30 tile is 3600 x 3600 floats) and sampled bilinearly.
// GLO-30 tiles are PixelIsPoint: sample (i, j) sits exactly at lon0 + i * res, lat0 - j * res.
const tiles = [];
for (const f of files) {
  const img = await (await fromFile(f)).getImage();
  const [lon0, lat0] = img.getOrigin(), [rx, ry] = img.getResolution();
  const off = img.getGeoKeys().GTRasterTypeGeoKey === 2 ? 0 : 0.5;
  tiles.push({ f, lon0, lat0, rx, ry: -ry, off, w: img.getWidth(), h: img.getHeight(), data: (await img.readRasters({ interleave: false }))[0] });
}
function elevation(lon, lat) {
  for (const t of tiles) {
    const u = (lon - t.lon0) / t.rx - t.off, v = (t.lat0 - lat) / t.ry - t.off;
    if (u < -0.5 || v < -0.5 || u > t.w - 0.5 || v > t.h - 0.5) continue;
    return bilinear({ w: t.w, h: t.h, x0: 0, z0: 0, step: 1 }, t.data, u, v);
  }
  throw new Error(`no tile covers lon ${lon} lat ${lat}`);
}

// ---------- grid ----------
const [BX0, BZ1] = pr.toXZ(W, S), [BX1, BZ0] = pr.toXZ(E, N);
const x0 = Math.floor(BX0 / STEP) * STEP, z0 = Math.floor(BZ0 / STEP) * STEP;
const w = Math.ceil((BX1 - x0) / STEP) + 1, h = Math.ceil((BZ1 - z0) / STEP) + 1;
const sig = SIGMA / STEP, R = Math.ceil(sig * 3);
const pw = w + 2 * R, ph = h + 2 * R; // padded, so the blur has real data at the border
let g = new Float64Array(pw * ph);
for (let j = 0; j < ph; j++) {
  for (let i = 0; i < pw; i++) {
    const [lon, lat] = pr.toLonLat(x0 + (i - R) * STEP, z0 + (j - R) * STEP);
    g[j * pw + i] = elevation(lon, lat);
  }
}
if (sig > 0) {
  const k = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / (2 * sig * sig)));
  const ks = k.reduce((a, b) => a + b);
  const blur = (src, dx, dy) => {
    const out = new Float64Array(src.length);
    for (let j = 0; j < ph; j++) {
      for (let i = 0; i < pw; i++) {
        let s = 0;
        for (let t = -R; t <= R; t++) {
          const a = Math.min(Math.max(i + t * dx, 0), pw - 1), b = Math.min(Math.max(j + t * dy, 0), ph - 1);
          s += src[b * pw + a] * k[t + R];
        }
        out[j * pw + i] = s / ks;
      }
    }
    return out;
  };
  g = blur(blur(g, 1, 0), 0, 1);
}
const meta = { file: 'dem.bin', w, h, x0, z0, step: STEP };
const grid = new Float32Array(w * h);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) grid[j * w + i] = g[(j + R) * pw + i + R];
// Heights are relative to the (smoothed) elevation at the game origin.
const base = bilinear(meta, grid, 0, 0);
let min = Infinity, max = -Infinity;
const buf = Buffer.alloc(w * h * 4);
for (let i = 0; i < grid.length; i++) {
  const v = Math.fround(grid[i] - base);
  min = Math.min(min, v);
  max = Math.max(max, v);
  buf.writeFloatLE(v, i * 4);
}
const round = (v) => Math.round(v * 100) / 100;
Object.assign(meta, { min: round(min), max: round(max), base: round(base) });
const dir = `data/dem/${city}`;
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/dem.bin`, buf);
writeFileSync(`${dir}/dem.json`, JSON.stringify(meta));
console.log(`${city}: ${w} x ${h} grid, ${STEP} m step, sigma ${SIGMA} m, origin at ${base.toFixed(1)} m above sea level`);
console.log(`heights relative to the origin: ${meta.min} to ${meta.max} m, ${(buf.length / 1e6).toFixed(1)} MB`);
