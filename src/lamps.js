// Where the warm pools of street light go at night. The grade pass adds a pool of light around each of the
// nearest lamps, so the pavement and the foot of the facades glow without any real light in the scene.
//
// Lamp positions come from the city when it has them: `city.lamps` is a list of { x, y, z } (y is the height
// of the light in metres). A city without that list gets virtual lamps along its drivable roads, every SPACING
// metres of road on alternating sides, so the same lamp is always in the same place whichever chunk is loaded.

export const MAX_LAMPS = 16;
const SPACING = 34;
const HEIGHT = 7;
const REACH = 110; // lamps farther than this from the camera are left out

const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export class LampPools {
  constructor(city) {
    this.city = city;
    this.data = Array.from({ length: MAX_LAMPS }, () => [0, 0, 0, 0]);
    this.count = 0;
    this._d2 = new Float32Array(MAX_LAMPS);
  }

  // Keeps the MAX_LAMPS nearest candidates to (cx, cz) in this.data, nearest first.
  _offer(cx, cz, x, y, z) {
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > REACH * REACH) return;
    const n = this.count;
    if (n === MAX_LAMPS && d2 >= this._d2[n - 1]) return;
    let i = n < MAX_LAMPS ? n : n - 1;
    while (i > 0 && this._d2[i - 1] > d2) {
      this._d2[i] = this._d2[i - 1];
      const a = this.data[i], b = this.data[i - 1];
      a[0] = b[0]; a[1] = b[1]; a[2] = b[2];
      i--;
    }
    this._d2[i] = d2;
    const t = this.data[i];
    t[0] = x; t[1] = y; t[2] = z;
    if (n < MAX_LAMPS) this.count++;
  }

  update(cx, cz) {
    const city = this.city;
    this.count = 0;
    if (Array.isArray(city.lamps) && city.lamps.length) {
      for (const l of city.lamps) this._offer(cx, cz, l.x, l.y, l.z);
      return this.count;
    }
    const C = city.index?.chunk || 400;
    for (const rec of city.recs.values()) {
      if (rec.state !== 'loaded' || !rec.roads) continue;
      if (Math.hypot((rec.info.cx + 0.5) * C - cx, (rec.info.cz + 0.5) * C - cz) > C * 0.75 + REACH) continue;
      for (const r of rec.roads) {
        const p = r.pts;
        const seed = hash(p[0] * 0.013 + p[1] * 0.017);
        let s = 0; // arclength at the start of the segment
        let next = seed * SPACING; // arclength of the next lamp, shifted per road so they do not line up
        let k = Math.floor(seed * 1000);
        for (let i = 2; i < p.length; i += 2) {
          const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
          const L = Math.hypot(bx - ax, bz - az);
          if (!L) continue;
          const ux = (bx - ax) / L, uz = (bz - az) / L;
          while (next < s + L) {
            const t = next - s;
            const side = (k++ & 1 ? 1 : -1) * (r.w / 2 + 0.9);
            const x = ax + ux * t - uz * side, z = az + uz * t + ux * side;
            this._offer(cx, cz, x, (city.groundAt?.(x, z) ?? 0) + HEIGHT, z);
            next += SPACING;
          }
          s += L;
        }
      }
    }
    return this.count;
  }
}
