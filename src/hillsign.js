import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Big white letters standing on a hillside, like the BRAȘOV sign on the Tâmpa. Each letter is a few
// fat shapes (straight legs, bowls, rings) extruded into slabs. The same shapes make the solids the
// player can stand on, climb and swing from. The row is centred on (x, z), reads along `u` seen from
// the town and looks down the slope along `face`.
//   cfg = { text, x, z, face: [fx, fz], height }
// It also clears the trees and paints a meadow around the letters.

const DEPTH = 3.4; // how thick a letter is, along `face`
const CELL = 1.0; // resolution of the solids under a letter, metres

// ---------- letter shapes ----------
// A part is { pts: [[a, b], ...], hole?: [[a, b], ...] } in a box W wide and H high, a to the right, b up.

// The outline of a fat line along a path: the path pushed out by T/2 on each side. A closed path gives a ring.
function stroke(path, T, closed = false) {
  const n = path.length, h = T / 2;
  const nor = path.map((p, i) => {
    const a = closed ? path[(i + n - 1) % n] : path[Math.max(i - 1, 0)], b = closed ? path[(i + 1) % n] : path[Math.min(i + 1, n - 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  const left = path.map((p, i) => [p[0] + nor[i][0] * h, p[1] + nor[i][1] * h]);
  const right = path.map((p, i) => [p[0] - nor[i][0] * h, p[1] - nor[i][1] * h]);
  if (!closed) return { pts: [...left, ...right.reverse()] };
  // A ring: the bigger of the two outlines is the outside.
  const area = (r) => Math.abs(r.reduce((s, p, i) => s + (r[(i + 1) % r.length][0] - p[0]) * (r[(i + 1) % r.length][1] + p[1]), 0));
  return area(left) > area(right) ? { pts: left, hole: right } : { pts: right, hole: left };
}

function arcPts(cx, cy, rx, ry, from, to, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

const rect = (a0, b0, a1, b1) => ({ pts: [[a0, b0], [a1, b0], [a1, b1], [a0, b1]] });

// Each letter is drawn on a box W x H with strokes T thick.
const LETTERS = {
  B(W, H, T) {
    const s = T / 2, r = (H / 2 - s) / 2;
    return [
      rect(0, 0, T, H),
      stroke([[s, H - s], [W - s - r, H - s], ...arcPts(W - s - r, H / 2 + r, r, r, 90, -90, 14).slice(1), [s, H / 2]], T),
      stroke([[s, H / 2], [W - s - r, H / 2], ...arcPts(W - s - r, s + r, r, r, 90, -90, 14).slice(1), [s, s]], T),
    ];
  },
  R(W, H, T) {
    const s = T / 2, low = H * 0.42, r = (H - s - low) / 2;
    return [
      rect(0, 0, T, H),
      stroke([[s, H - s], [W - s - r, H - s], ...arcPts(W - s - r, low + r, r, r, 90, -90, 14).slice(1), [s, low]], T),
      { pts: [[W * 0.3, low + T * 0.35], [W * 0.3 + T * 1.15, low + T * 0.35], [W, 0], [W - T * 1.2, 0]] },
    ];
  },
  A(W, H, T) {
    const t1 = T * 1.15, t2 = T * 0.9, y = H * 0.2;
    return [
      { pts: [[0, 0], [t1, 0], [W / 2 + t2 / 2, H], [W / 2 - t2 / 2, H]] },
      { pts: [[W - t1, 0], [W, 0], [W / 2 + t2 / 2, H], [W / 2 - t2 / 2, H]] },
      rect(W * 0.2, y, W * 0.8, y + T * 0.8),
    ];
  },
  // S with a comma under it.
  Ș(W, H, T) {
    const s = T / 2, lo = H * 0.17, top = H - s, bot = lo + s, ry = (top - bot) / 4, rx = W / 2 - s;
    const path = [...arcPts(W / 2, top - ry, rx, ry, 25, 270, 22), ...arcPts(W / 2, bot + ry, rx, ry, 90, -155, 22).slice(1)];
    return [stroke(path, T), { pts: [[W * 0.42, lo * 0.75], [W * 0.42 + T * 0.55, lo * 0.75], [W * 0.42 + T * 0.55 - T * 0.3, 0], [W * 0.42 - T * 0.3, 0]] }];
  },
  O(W, H, T) {
    const s = T / 2;
    return [stroke(arcPts(W / 2, H / 2, W / 2 - s, H / 2 - s, 0, 360, 44).slice(0, -1), T, true)];
  },
  V(W, H, T) {
    const t1 = T * 1.15, t2 = T * 0.95;
    return [
      { pts: [[0, H], [t1, H], [W / 2 + t2 / 2, 0], [W / 2 - t2 / 2, 0]] },
      { pts: [[W - t1, H], [W, H], [W / 2 + t2 / 2, 0], [W / 2 - t2 / 2, 0]] },
    ];
  },
};

function inPoly(a, b, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, bi] = poly[i], [aj, bj] = poly[j];
    if (bi > b !== bj > b && a < ((aj - ai) * (b - bi)) / (bj - bi) + ai) c = !c;
  }
  return c;
}

export class HillSign {
  constructor(city, cfg) {
    this.city = city;
    const H = cfg.height, W = H * 0.62, T = H * 0.17, gap = H * 0.2;
    this.height = H;
    this.width = W;
    const text = [...cfg.text];
    const L = text.length * W + (text.length - 1) * gap;
    const [fx, fz] = cfg.face;
    // Reading direction seen from the town: the viewer looks along -face, her right hand is u.
    const ux = fz, uz = -fx;
    this.at = (a, c) => [cfg.x + ux * a + fx * c, cfg.z + uz * a + fz * c];
    // Letter space (a along u, b up, c along face) into the world.
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(fx, 0, fz));
    this.solids = [];
    const slabs = [];
    text.forEach((ch, k) => {
      const parts = LETTERS[ch](W, H, T);
      const a0 = -L / 2 + k * (W + gap);
      // The letter stands on the lowest ground under it, sunk a little, so no side floats over the slope.
      let low = Infinity;
      for (const [da, dc] of [[0, -DEPTH / 2], [W, -DEPTH / 2], [0, DEPTH / 2], [W, DEPTH / 2], [W / 2, 0]]) low = Math.min(low, city.groundAt(...this.at(a0 + da, dc)));
      const base = low - 0.6;
      for (const p of parts) {
        const shape = new THREE.Shape(p.pts.map(([a, b]) => new THREE.Vector2(a, b)));
        if (p.hole) shape.holes.push(new THREE.Path(p.hole.map(([a, b]) => new THREE.Vector2(a, b))));
        const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, curveSegments: 1 });
        g.translate(a0, base, -DEPTH / 2);
        g.applyMatrix4(basis);
        g.translate(cfg.x, 0, cfg.z);
        g.deleteAttribute('uv');
        slabs.push(g);
      }
      this.solidsFor(parts, a0, base);
    });
    const mesh = new THREE.Mesh(mergeGeometries(slabs), new THREE.MeshStandardMaterial({ color: 0xf3f1ea, emissive: 0xffffff, emissiveIntensity: 0.16, roughness: 0.88 }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'sign';
    city.scene.add(mesh);
    this.mesh = mesh;
    for (const g of slabs) g.dispose();
    // No trees in front of, on and behind the letters; a meadow instead, an oval a little longer than the row.
    const ra = L / 2 + 14, rc = 26, cc = 8;
    (city.clearings ||= []).push((x, z) => {
      const dx = x - cfg.x, dz = z - cfg.z;
      return (((dx * ux + dz * uz) / ra) ** 2) + ((((dx * fx + dz * fz) - cc) / rc) ** 2) < 1;
    });
    const ring = Array.from({ length: 36 }, (_, i) => this.at(Math.cos((i / 36) * Math.PI * 2) * ra, cc + Math.sin((i / 36) * Math.PI * 2) * rc)).flat();
    (city.extraGreens ||= []).push(['grass', ring, []]);
    this.length = L;
  }

  // The shapes of one letter as solids: 1 m columns cut into runs of material, neighbouring columns
  // with the same run joined. Every solid stands from the bottom to the top of a piece of the letter,
  // so the front of a letter is a wall she can climb and its top edges are edges she can vault onto.
  solidsFor(parts, a0, base) {
    const cols = Math.ceil(this.width / CELL) + 1, rows = Math.ceil(this.height / CELL);
    const inside = (a, b) => parts.some((p) => inPoly(a, b, p.pts) && !(p.hole && inPoly(a, b, p.hole)));
    const open = new Map(); // "j0,j1" -> solid being extended to the right
    const done = [];
    for (let i = 0; i <= cols; i++) {
      const runs = new Map();
      for (let j = 0, start = -1; i < cols && j <= rows; j++) {
        const on = j < rows && inside((i + 0.5) * CELL, (j + 0.5) * CELL);
        if (on && start < 0) start = j;
        if (!on && start >= 0) {
          runs.set(`${start},${j}`, [start, j]);
          start = -1;
        }
      }
      for (const [k, m] of open) {
        if (runs.has(k)) runs.delete(k), (m.i1 = i + 1);
        else (done.push(m), open.delete(k));
      }
      for (const [k, [j0, j1]] of runs) open.set(k, { i0: i, i1: i + 1, j0, j1 });
    }
    for (const m of [...done, ...open.values()]) {
      const outer = [[m.i0, -DEPTH / 2], [m.i1, -DEPTH / 2], [m.i1, DEPTH / 2], [m.i0, DEPTH / 2]].flatMap(([i, c]) => this.at(a0 + i * CELL, c));
      this.solids.push(this.city.addSolid(outer, base + m.j0 * CELL, base + m.j1 * CELL, 'BRAȘOV'));
    }
  }
}
