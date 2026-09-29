import * as THREE from 'three';
import { KIND, WALL_STRIDE, layout, balconyAt, h32, rnd01 } from './buildings.js';
import { box, merge, propMaterial, fillInstances } from './geom.js';

// Geometry that only pays off near the camera: balconies with their glazing, laundry, air conditioners, dishes,
// awnings and wall lanterns. Built per chunk when the camera comes within DETAIL_R of it and dropped when it
// leaves (see CityLook.update). Positions follow the bays the facade shader lays out (buildings.js layout()).

const PVC = [0xf2f2ee, 0xf2f2ee, 0xe9e6dc, 0x5b3a26, 0x2b2d30, 0xa9adb0, 0x8a5a3a, 0xdcdcd6];
const PANEL_TINT = [0xd0ccbf, 0xc8c2a8, 0xb9c4b0, 0xc9b9a0, 0xdadad4, 0xb7c2c9];
const CLOTH = [0xd94a4a, 0x3d6fb5, 0xf0e2b0, 0xe8e8e8, 0x4f9a5a, 0xe79a2e, 0x8b5aa8, 0xf2b5c0];
const AWNING = [0xb32626, 0x1f5e3d, 0x1e4b8a, 0xe0d2a8, 0x7a2b52, 0xc9791c];

// Templates are built at unit width (x from -0.5 to 0.5) and scaled to the bay; z points out of the wall.
function templates() {
  const slab = (d = 1.15) => box(1, 0.14, d, 0, -0.14, d / 2);
  const T = {};
  // open balcony: slab, solid front panel, top rail, side panels
  T.open = merge([
    { g: slab(), color: 0xb9b4a6, tint: 1 },
    { g: box(1, 0.78, 0.05, 0, 0, 1.13), color: 0xc9c5b8, tint: 1 },
    { g: box(1.02, 0.05, 0.09, 0, 0.78, 1.12), color: 0x8f8f8c },
    { g: box(0.05, 0.78, 1.1, -0.5, 0, 0.58), color: 0xc9c5b8, tint: 1 },
    { g: box(0.05, 0.78, 1.1, 0.5, 0, 0.58), color: 0xc9c5b8, tint: 1 },
  ]);
  // fully glazed with PVC frame: slab, corner posts, transoms, glass
  T.glazed = merge([
    { g: slab(), color: 0xb9b4a6, tint: 1 },
    { g: box(0.05, 2.1, 0.05, -0.5, 0, 1.13), color: 0xffffff, tint: 1 },
    { g: box(0.05, 2.1, 0.05, 0.5, 0, 1.13), color: 0xffffff, tint: 1 },
    { g: box(0.05, 2.1, 0.05, 0, 0, 1.13), color: 0xffffff, tint: 1 },
    { g: box(1.0, 0.05, 0.05, 0, 2.05, 1.13), color: 0xffffff, tint: 1 },
    { g: box(1.0, 0.05, 0.05, 0, 0.78, 1.13), color: 0xffffff, tint: 1 },
    { g: box(0.9, 1.3, 0.02, 0, 0.8, 1.13), color: 0x556b7a },
    { g: box(0.9, 0.7, 0.02, 0, 0.08, 1.13), color: 0x556b7a },
    { g: box(0.05, 2.1, 1.1, -0.5, 0, 0.58), color: 0x556b7a },
    { g: box(0.05, 2.1, 1.1, 0.5, 0, 0.58), color: 0x556b7a },
  ]);
  // half height wall with glazing above
  T.half = merge([
    { g: slab(), color: 0xb9b4a6, tint: 1 },
    { g: box(1, 0.9, 0.08, 0, 0, 1.12), color: 0xd0ccbf, tint: 1 },
    { g: box(1.02, 0.05, 0.1, 0, 0.9, 1.12), color: 0xffffff, tint: 1 },
    { g: box(0.05, 1.2, 0.05, -0.5, 0.9, 1.13), color: 0xffffff, tint: 1 },
    { g: box(0.05, 1.2, 0.05, 0.5, 0.9, 1.13), color: 0xffffff, tint: 1 },
    { g: box(1.0, 0.05, 0.05, 0, 2.1, 1.13), color: 0xffffff, tint: 1 },
    { g: box(0.9, 1.15, 0.02, 0, 0.95, 1.13), color: 0x556b7a },
    { g: box(0.05, 1.2, 1.1, -0.5, 0.9, 0.58), color: 0x556b7a },
    { g: box(0.05, 1.2, 1.1, 0.5, 0.9, 0.58), color: 0x556b7a },
  ]);
  // wrought iron balcony of the older houses: thin slab and a railing of bars
  const bars = [];
  for (let i = 0; i <= 10; i++) bars.push({ g: box(0.018, 0.95, 0.018, -0.48 + i * 0.096, 0, 0.6), color: 0x1d1d1f });
  T.iron = merge([
    { g: box(1.1, 0.1, 0.62, 0, -0.1, 0.31), color: 0xcfc8b8, tint: 1 },
    { g: box(1.1, 0.03, 0.03, 0, 0.95, 0.6), color: 0x1d1d1f },
    { g: box(1.1, 0.03, 0.03, 0, 0.1, 0.6), color: 0x1d1d1f },
    ...bars,
  ]);
  // air conditioner outdoor unit
  T.ac = merge([
    { g: box(0.78, 0.55, 0.3, 0, 0, 0.15), color: 0xe8e8e4 },
    { g: box(0.5, 0.42, 0.02, -0.1, 0.06, 0.31), color: 0x2e2e30 },
    { g: box(0.05, 0.3, 0.02, 0.28, 0.12, 0.31), color: 0x9a9a9a },
  ]);
  // satellite dish on a short arm
  const dish = new THREE.SphereGeometry(0.4, 10, 5, 0, 6.283, 0, 1.0);
  dish.rotateX(Math.PI / 2 - 0.3);
  dish.translate(0, 0.35, 0.6);
  T.dish = merge([
    { g: dish, color: 0xdcdcd8 },
    { g: box(0.04, 0.5, 0.04, 0, 0, 0.15), color: 0x808080 },
    { g: box(0.03, 0.03, 0.5, 0, 0.32, 0.55), color: 0x808080 },
  ]);
  // shop awning: slanted stripes
  const st = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.BoxGeometry(1 / 8, 0.04, 1.15);
    g.rotateX(0.42);
    g.translate(-0.5 + (i + 0.5) / 8, 0, 0.55);
    st.push({ g, color: i % 2 ? 0xf0ece0 : 0xffffff, tint: i % 2 ? 0 : 1 });
  }
  st.push({ g: box(1, 0.16, 0.03, 0, -0.5, 1.03), color: 0xffffff, tint: 1 });
  T.awning = merge(st);
  // laundry: a line with a few pieces of cloth
  const cl = [{ g: box(1, 0.01, 0.01, 0, 0.98, 1.05), color: 0x666666 }];
  const cols = [0xd94a4a, 0x3d6fb5, 0xf0e2b0, 0xe8e8e8, 0x4f9a5a];
  for (let i = 0; i < 5; i++) cl.push({ g: box(0.14 + 0.04 * (i % 3), 0.42 + 0.1 * (i % 2), 0.01, -0.4 + i * 0.2, 0.55, 1.05), color: cols[i] });
  T.laundry = merge(cl);
  return T;
}

export class Detail {
  constructor(look) {
    this.look = look;
    this.city = look.city;
    this.T = templates();
    this.mat = propMaterial();
  }

  // Builds the detail group of one chunk record, or null if it has nothing to show.
  build(rec) {
    const walls = rec.detail?.walls || [];
    const groups = { open: [], glazed: [], half: [], iron: [], ac: [], dish: [], awning: [], laundry: [] };
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const groundAt = (x, z) => this.city.groundAt(x, z);
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
      const sx = walls[i], sz = walls[i + 1], ex = walls[i + 2], ez = walls[i + 3];
      const base = walls[i + 4], y1 = walls[i + 5], kind = walls[i + 6], seed = walls[i + 7], edge = walls[i + 8], variant = walls[i + 9], L = walls[i + 10];
      const nx = walls[i + 12], nz = walls[i + 13];
      const H = y1 - base;
      const lay = layout(kind, L, H);
      const dx = (ex - sx) / L, dz = (ez - sz) / L;
      const yaw = Math.atan2(nx, nz); // rotates +z (out of the wall) onto the outward normal
      Q.setFromAxisAngle(Y, yaw);
      const at = (u, y, out = 0) => P.set(sx + dx * u + nx * out, base + y, sz + dz * u + nz * out);
      const put = (list, u, y, scaleX, color, out = 0, sy = 1) => {
        at(u, y, out);
        M.compose(P, Q, S.set(scaleX, sy, 1));
        list.push([M.toArray(), color]);
      };
      const balcStyle = (variant >> 8) & 3;
      for (let col = 0; col < lay.nc; col++) {
        const u = (col + 0.5) * lay.cw;
        for (let fi = 1; fi <= lay.nUp; fi++) {
          const yFloor = lay.gfH + (fi - 1) * lay.fh;
          const r = rnd01(seed * 977 + col * 31 + fi, edge);
          if (balconyAt(kind, col, fi, lay.nc, L, edge)) {
            if (kind === KIND.BELLE || kind === KIND.BAROQUE) {
              put(groups.iron, u, yFloor + 0.05, lay.cw * 0.72, 0xd8d0be, 0);
              continue;
            }
            const wide = kind === KIND.INTERWAR ? lay.cw * 0.92 : lay.cw * 0.86;
            const s = balcStyle === 3 ? Math.floor(r * 3) : balcStyle % 3;
            const list = s === 0 ? groups.open : s === 1 ? groups.glazed : groups.half;
            const c = s === 0 ? [0xcac5b6, 0xb0aca0, 0xd8cfae, 0xa9b7a4][Math.floor(r * 4)] : s === 2 ? PANEL_TINT[Math.floor(rnd01(seed + col, fi + 5) * PANEL_TINT.length)] : PVC[Math.floor(rnd01(seed + col, fi + 5) * PVC.length)];
            put(list, u, yFloor, wide, c);
            if (s === 0 && r > 0.72) put(groups.laundry, u, yFloor, wide, CLOTH[0]);
            if (r < 0.1) put(groups.dish, u + wide * 0.3, yFloor + 0.85, 1, 0xffffff, 1.1);
          } else if (kind === KIND.PANEL || kind === KIND.INTERWAR || kind === KIND.BELLE) {
            // an air conditioner beside some windows
            if (r > 0.9 && lay.nc > 3 && col > 0 && col < lay.nc - 1) put(groups.ac, u + lay.cw * 0.34, yFloor + 0.4, 1, 0xffffff, 0);
          }
        }
        // shop awning on some ground floor bays
        if ((kind === KIND.BELLE || kind === KIND.BAROQUE || kind === KIND.INTERWAR) && lay.nc > 2 && col > 0 && col < lay.nc - 1) {
          const r = rnd01(seed * 13 + col, edge + 7);
          if (r < 0.42) put(groups.awning, u, lay.gfH * 0.78, lay.cw * 0.9, AWNING[Math.floor(r * 100) % AWNING.length]);
        }
      }
    }
    const group = new THREE.Group();
    group.userData.detail = true;
    for (const m of this.look.props.near(rec)) group.add(m);
    for (const [name, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const mesh = fillInstances(new THREE.InstancedMesh(this.T[name], this.mat, list.length), list);
      mesh.castShadow = false; // thousands of small parts: the shadow passes cannot afford them
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group.children.length ? group : null;
  }
}
