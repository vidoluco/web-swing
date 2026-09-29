import * as THREE from 'three';

// Building geometry for the OSM chunks: walls, roofs and the data the facade shader and the detail
// layer (balconies, awnings, dormers) need. Called by OsmCity.buildBuildings with city._rec set.
//
// Vertex attributes (all float):
//   aInfo  kind, seed, base, top          per building, flat in the fragment shader
//   aGeo   u, edge length, edge id, variant   u runs to the viewer's right on every wall
//   aSurf  surface type (0 wall, 1 flat roof, 2 pitched roof, 3 parapet), v (slope coordinate of a pitched roof)
//   aTan   unit tangent in the direction of u
export const KIND = { GLASS: 0, BRICK: 1, MONUMENT: 2, RIBBON: 3, PANEL: 4, BELLE: 5, INTERWAR: 6, HOUSE: 7, BAROQUE: 8 };
export const WALL_STRIDE = 14; // detail.walls record: sx sz ex ez base y1 kind seed edge variant L onGround nx nz
// Facade layout per kind: target bay width, storey height, ground floor height. The fragment shader gets the same
// table, and the detail layer uses layout() so 3D balconies sit exactly on the bays the shader draws.
export const PARAMS = [
  [1.6, 3.9, 5.6], // glass
  [3.4, 4.0, 4.2], // brick
  [4.2, 5.0, 6.2], // monument
  [6.0, 3.6, 4.6], // ribbon
  [3.0, 2.78, 2.78], // panel
  [3.6, 3.9, 4.8], // belle epoque
  [3.2, 3.15, 3.9], // interwar
  [3.4, 3.1, 3.2], // house
  [3.3, 3.7, 4.4], // baroque
];
export function layout(kind, L, H) {
  const [cwT, fhT, gf0] = PARAMS[kind];
  let gfH = Math.min(gf0, H);
  const upH = H - gfH;
  const nUp = upH < fhT * 0.55 ? 0 : Math.max(1, Math.floor(upH / fhT + 0.5));
  if (nUp < 0.5) gfH = H;
  const nc = Math.max(1, Math.floor(L / cwT + 0.5));
  return { gfH, nUp, fh: nUp > 0 ? upH / nUp : H, nc, cw: L / nc };
}
// Which bays carry a balcony. Mirrors wallShade() in facade.js (edge is the integer edge id).
export function balconyAt(kind, col, fi, nc, L, edge) {
  if (fi < 1) return false;
  if (kind === KIND.PANEL) {
    if (L < 15 || nc < 5.5) return false;
    if (nc > 4.5 && (col < 0.5 || col > nc - 1.5) && ((edge >> 3) & 1) === 0) return false;
    const pat = edge % 3;
    if (pat === 0) return col % 2 === 0;
    if (pat === 1) return Math.floor(col / 2) % 2 === 0;
    return col !== Math.floor(nc * 0.5);
  }
  if (kind === KIND.INTERWAR) {
    if (nc > 2.5 && (col < 0.5 || col > nc - 1.5)) return false;
    return (col + edge) % 4 < 1.5 && ((edge >> 4) & 7) < 5;
  }
  if (kind === KIND.BELLE || kind === KIND.BAROQUE) {
    if (fi !== 1 || (nc > 2.5 && (col < 0.5 || col > nc - 1.5))) return false;
    return (col + (edge >> 2)) % 3 === 0;
  }
  return false;
}

export const SURF = { WALL: 0, FLAT: 1, PITCHED: 2, PARAPET: 3 };
const PARAPET = 0.8;
const SKIRT = 1.2;

export const h32 = (n) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};
export const rnd01 = (seed, salt) => (h32(Math.imul(seed | 0, 7919) + Math.imul(salt | 0, 104729) + 12345) & 0xffffff) / 0x1000000;

// Prefab block colours: worn originals, and the pastel insulation coats.
const PANEL_WORN = ['#b8b3a4', '#aba79b', '#c1bcae', '#a8a498', '#b4afa0', '#bdb7a5'];
const PANEL_COAT = ['#f0d78a', '#eeb287', '#e39a88', '#a3cca4', '#a8c9de', '#f3e2b3', '#d9b6a0', '#c9d8a0'];
const BAROQUE = ['#e8c46a', '#e6ad8c', '#d9a08c', '#b7d2ae', '#f0e2be', '#c7d8e0', '#e5b3a3', '#eed49a', '#d8c7a0', '#cfa88a'];
const BELLE = ['#e9dcc0', '#dcc9a3', '#e8cfb0', '#d5c3a6', '#ede4d0', '#d9b99b', '#cfd0bc', '#e6d1a4'];
const INTERWAR = ['#efe9dc', '#e6dfd0', '#f3eee4', '#e3d8c2', '#d9d4c6', '#eadfc8'];

function ringArea(r) {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (r[j * 2] - r[i * 2]) * (r[j * 2 + 1] + r[i * 2 + 1]);
  return a / 2;
}

// Oriented extents from the longest edge: [long, short, angle].
function obb(r) {
  const n = r.length / 2;
  let best = 0, bl = -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, l = Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]);
    if (l > bl) (bl = l), (best = i);
  }
  const j = (best + 1) % n, ang = Math.atan2(r[j * 2 + 1] - r[best * 2 + 1], r[j * 2] - r[best * 2]);
  const c = Math.cos(ang), s = Math.sin(ang);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = r[i * 2] * c + r[i * 2 + 1] * s, z = -r[i * 2] * s + r[i * 2 + 1] * c;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { len: x1 - x0, wid: z1 - z0, ang, x0, x1, z0, z1, c, s };
}

// Buildings that OSM knows only as a footprint but that the game has to show as what they are. Matched by the
// centre of the footprint; bits go into the variant (4096 palace, 8192 blackened stone, 16384 white tower).
const MARKS = {
  bucharest: [
    { x: -1190, z: -70, r: 140, minArea: 3000, kind: KIND.MONUMENT, colour: '#e6dcc4', bits: 4096 }, // Palace of the Parliament
    { x: -1148, z: -67, r: 60, minArea: 2000, kind: KIND.MONUMENT, colour: '#e6dcc4', bits: 4096 },
  ],
  brasov: [
    { x: -42, z: 187, r: 45, minArea: 300, kind: KIND.MONUMENT, colour: '#5b5854', bits: 8192 }, // Black Church
    { x: -173, z: -18, r: 25, minArea: 20, kind: KIND.MONUMENT, colour: '#ebe6da', bits: 16384 }, // White Tower
    { x: 20, z: 641, r: 30, minArea: 60, kind: KIND.MONUMENT, colour: '#c9bfa8', bits: 0 }, // Weavers' Bastion
  ],
};

// Picks the architectural kind, wall colour and the variant bits from the OSM style and shape.
export function classify(ctx, s, hex, h, sd, outer, name, rf) {
  const o = obb(outer);
  const area = Math.abs(ringArea(outer));
  const aspect = o.len / Math.max(1, o.wid);
  const cx = (o.x0 + o.x1) / 2 * o.c - (o.z0 + o.z1) / 2 * o.s, cz = (o.x0 + o.x1) / 2 * o.s + (o.z0 + o.z1) / 2 * o.c;
  const centre = Math.hypot(cx, cz);
  const r = (k) => rnd01(sd, k);
  let kind, colour = hex;
  if (s === 0) kind = KIND.GLASS;
  else if (s === 1) kind = KIND.BRICK;
  else if (s === 3) kind = KIND.RIBBON;
  else if (s === 2) kind = /^(Palatul|Catedrala|Muzeul|Teatrul|Ateneul|Universitatea|Arcul|Gara|Biserica)/i.test(name || '') ? KIND.MONUMENT : ctx.brasov ? KIND.BAROQUE : KIND.BELLE;
  else if (s === 4) kind = KIND.PANEL;
  else if (ctx.brasov) kind = h < 6.5 && !rf ? KIND.HOUSE : KIND.BAROQUE;
  else if (area > 350 && aspect > 2.6 && h > 11 && h < 17.5) kind = KIND.PANEL; // P+4 blocks that the tool left as plaster
  else if (h < 7 || (h < 10.5 && area < 260)) kind = KIND.HOUSE;
  else if (centre < 1700 && r(1) < 0.55 && h > 11) kind = KIND.BELLE;
  else if (h > 9) kind = r(2) < 0.7 ? KIND.INTERWAR : KIND.BELLE;
  else kind = KIND.HOUSE;
  if (ctx.brasov && kind === KIND.GLASS && h < 30) kind = KIND.BAROQUE;
  let bits = 0;
  for (const m of ctx.marks || []) {
    if (Math.hypot(cx - m.x, cz - m.z) < m.r && area >= m.minArea) {
      kind = m.kind;
      colour = m.colour;
      bits = m.bits;
      break;
    }
  }
  // variant bits: 0 renovated, 1-3 main colour index, 4-7 accent, 8-9 balcony glazing, 10-11 spare
  let variant = 0;
  const ci = Math.floor(r(3) * 8), acc = Math.floor(r(4) * 16), bal = Math.floor(r(5) * 4);
  if (kind === KIND.PANEL) {
    const coat = r(6) < 0.45;
    variant = (coat ? 1 : 0) | (ci << 1) | (acc << 4) | (bal << 8);
    colour = coat ? PANEL_COAT[ci] : PANEL_WORN[ci % PANEL_WORN.length];
  } else if (kind === KIND.BAROQUE) {
    colour = BAROQUE[Math.floor(r(7) * BAROQUE.length)];
    variant = (ci << 1) | (acc << 4) | (bal << 8);
  } else if (kind === KIND.BELLE) {
    if (!(name && hex)) colour = BELLE[Math.floor(r(8) * BELLE.length)];
    variant = (ci << 1) | (acc << 4) | (bal << 8);
  } else if (kind === KIND.INTERWAR) {
    colour = INTERWAR[Math.floor(r(9) * INTERWAR.length)];
    variant = (ci << 1) | (acc << 4) | (bal << 8);
  } else variant = (ci << 1) | (acc << 4) | (bal << 8);
  variant |= bits;
  return { kind, colour, variant, o, area, pitched: kind === KIND.BAROQUE ? h < 30 : kind === KIND.HOUSE ? !!rf || r(10) < 0.7 : !!rf };
}

// The building meshes of one chunk. Returns { geometry, props, detail }.
export function buildBuildingGeometry(city, list) {
  const pos = [], nor = [], col = [], info = [], geo = [], surf = [], tan = [], idx = [];
  const props = [];
  const detail = { walls: [], roofs: [], flat: [] };
  const color = new THREE.Color();
  const ctx = { brasov: !!city.brasov, marks: MARKS[city.cityId] };
  const groundAt = city.groundAt ? (x, z) => city.groundAt(x, z) : () => 0;
  let vcount = 0;

  const vert = (x, y, z, nx, ny, nz, kind, seed, base, top, u, L, edge, variant, type, v, tx, ty, tz) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    col.push(color.r, color.g, color.b);
    info.push(kind, seed, base, top);
    geo.push(u, L, edge, variant);
    surf.push(type, v);
    tan.push(tx, ty, tz);
    return vcount++;
  };

  for (const [s, hex, y0, y1, rf, sd, outerArr, holesArr, name] of list) {
    if (y1 - y0 < 0.5) continue;
    const outer = Float32Array.from(outerArr);
    const holes = holesArr.map((h) => Float32Array.from(h));
    const rings = [outer, ...holes];
    const signs = rings.map((r, i) => (i === 0 ? Math.sign(ringArea(r)) || 1 : -(Math.sign(ringArea(r)) || 1)));
    const prism = { outer, holes, signs, y0, y1, minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity, kind: 'building', name, style: s };
    for (let i = 0; i < outer.length; i += 2) {
      prism.minx = Math.min(prism.minx, outer[i]);
      prism.maxx = Math.max(prism.maxx, outer[i]);
      prism.minz = Math.min(prism.minz, outer[i + 1]);
      prism.maxz = Math.max(prism.maxz, outer[i + 1]);
    }
    city.addPrism(prism);
    const b = city.bounds;
    b.minx = Math.min(b.minx, prism.minx); b.maxx = Math.max(b.maxx, prism.maxx);
    b.minz = Math.min(b.minz, prism.minz); b.maxz = Math.max(b.maxz, prism.maxz);
    city.mmPut((prism.minx + prism.maxx) / 2, (prism.minz + prism.maxz) / 2, 'b', outer);

    const H = y1 - y0;
    const cl = classify(ctx, s, hex, H, sd, outer, name, rf);
    prism.look = cl.kind;
    color.set(cl.colour);
    // Lowest ground under the footprint corners: decides if the walls need a skirt and if this stands on the ground.
    let lowG = Infinity;
    for (let i = 0; i < outer.length; i += 2) lowG = Math.min(lowG, groundAt(outer[i], outer[i + 1]));
    const onGround = y0 - lowG < 1.0;
    const pitchedWanted = cl.pitched && H < 32;
    const hasHole = holes.length > 0;
    // A roof shape for this footprint, or null for a flat roof.
    const roofPlan = pitchedWanted && !hasHole ? planRoof(outer, cl, H) : null;
    const parapet = !roofPlan && !rf && H > 9;
    if (parapet && onGround) city.roofProps(prism, props);
    const base = onGround ? y0 - SKIRT : y0;
    const yt = parapet ? y1 + PARAPET : y1;
    const kind = cl.kind, variant = cl.variant;

    // Walls.
    for (let ri = 0; ri < rings.length; ri++) {
      const r = rings[ri], sg = signs[ri], n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
        if (L < 0.05) continue;
        const nx = (sg * ez) / L, nz = (-sg * ex) / L;
        // u must grow to the viewer's right (right = cross(up, normal) = (nz, 0, -nx)).
        const flipU = (ex / L) * nz - (ez / L) * nx < 0;
        const tx = flipU ? -ex / L : ex / L, tz = flipU ? -ez / L : ez / L;
        const edge = (h32(Math.round(ax * 10) * 73856093 ^ Math.round(az * 10) * 19349663 ^ sd) & 0xffff);
        // floors are laid out from the ground at this edge, so terrain steps the storeys instead of shearing them
        const eb = onGround ? Math.max(y0, Math.min(groundAt(ax, az), groundAt(bx, bz))) : y0;
        const ua = flipU ? L : 0, ub = flipU ? 0 : L;
        const va = vert(ax, base, az, nx, 0, nz, kind, sd, eb, y1, ua, L, edge, variant, SURF.WALL, 0, tx, 0, tz);
        const vb = vert(bx, base, bz, nx, 0, nz, kind, sd, eb, y1, ub, L, edge, variant, SURF.WALL, 0, tx, 0, tz);
        const vc = vert(bx, yt, bz, nx, 0, nz, kind, sd, eb, y1, ub, L, edge, variant, SURF.WALL, 0, tx, 0, tz);
        const vd = vert(ax, yt, az, nx, 0, nz, kind, sd, eb, y1, ua, L, edge, variant, SURF.WALL, 0, tx, 0, tz);
        // Counter-clockwise from outside: the quad a,b,c,d is CCW seen from outside when cross(b-a, up) points along the normal.
        const cx = -(ez) * 1, cz = ex * 1; // cross((ex,0,ez),(0,1,0)) = (-ez, 0, ex)
        if (cx * nx + cz * nz > 0) idx.push(va, vb, vc, va, vc, vd);
        else idx.push(va, vc, vb, va, vd, vc);
        if (parapet) {
          // Inner face and cap of the parapet.
          const ix0 = ax - nx * 0.3, iz0 = az - nz * 0.3, ix1 = bx - nx * 0.3, iz1 = bz - nz * 0.3;
          const pa = vert(ix0, y1, iz0, -nx, 0, -nz, kind, sd, y0, y1, ua, L, edge, variant, SURF.PARAPET, 0, -tx, 0, -tz);
          const pb = vert(ix1, y1, iz1, -nx, 0, -nz, kind, sd, y0, y1, ub, L, edge, variant, SURF.PARAPET, 0, -tx, 0, -tz);
          const pc = vert(ix1, yt, iz1, -nx, 0, -nz, kind, sd, y0, y1, ub, L, edge, variant, SURF.PARAPET, 0, -tx, 0, -tz);
          const pd = vert(ix0, yt, iz0, -nx, 0, -nz, kind, sd, y0, y1, ua, L, edge, variant, SURF.PARAPET, 0, -tx, 0, -tz);
          // facing inward: reverse of the outer winding
          if (cx * nx + cz * nz > 0) idx.push(pa, pc, pb, pa, pd, pc);
          else idx.push(pa, pb, pc, pa, pc, pd);
          const ca = vert(ax, yt, az, 0, 1, 0, kind, sd, y0, y1, 0, 0, edge, variant, SURF.PARAPET, 0, 1, 0, 0);
          const cb = vert(bx, yt, bz, 0, 1, 0, kind, sd, y0, y1, 0, 0, edge, variant, SURF.PARAPET, 0, 1, 0, 0);
          const cc = vert(ix1, yt, iz1, 0, 1, 0, kind, sd, y0, y1, 0, 0, edge, variant, SURF.PARAPET, 0, 1, 0, 0);
          const cd = vert(ix0, yt, iz0, 0, 1, 0, kind, sd, y0, y1, 0, 0, edge, variant, SURF.PARAPET, 0, 1, 0, 0);
          // top face must point up: winding a,b,c,d seen from above
          const cyy = (bx - ax) * (iz1 - az) - (bz - az) * (ix1 - ax);
          if (cyy > 0) idx.push(ca, cc, cb, ca, cd, cc);
          else idx.push(ca, cb, cc, ca, cc, cd);
        }
        // Start and end of the wall in reading order (u = 0 to L), for the detail layer.
        if (y1 - eb > 6 && L > 3) detail.walls.push(flipU ? bx : ax, flipU ? bz : az, flipU ? ax : bx, flipU ? az : bz, eb, y1, kind, sd, edge, variant, L, onGround ? 1 : 0, nx, nz);
      }
    }

    // Roof.
    if (roofPlan) {
      const faces = roofPlan.faces(y1);
      for (const f of faces) pushFace(f);
      detail.roofs.push(roofPlan.detail(y1, sd, kind, variant));
    } else {
      const contour = [];
      for (let i = 0; i < outer.length; i += 2) contour.push(new THREE.Vector2(outer[i], outer[i + 1]));
      const hv = holes.map((h) => {
        const a = [];
        for (let i = 0; i < h.length; i += 2) a.push(new THREE.Vector2(h[i], h[i + 1]));
        return a;
      });
      let tris;
      try {
        tris = THREE.ShapeUtils.triangulateShape(contour, hv);
      } catch {
        tris = [];
      }
      const all = contour.concat(...hv);
      const vmap = new Map();
      const get = (P) => {
        let v = vmap.get(P);
        if (v === undefined) vmap.set(P, (v = vert(P.x, y1, P.y, 0, 1, 0, kind, sd, y0, y1, P.x, 0, 0, variant, SURF.FLAT, P.y, 1, 0, 0)));
        return v;
      };
      for (const [a, bb, c] of tris) {
        const A = all[a], B = all[bb], C = all[c];
        const cy = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
        if (cy > 0) idx.push(get(A), get(B), get(C));
        else idx.push(get(A), get(C), get(B));
      }
      if (parapet) detail.flat.push({ prism, y: y1, sd, kind });
    }

    function pushFace(f) {
      // f: { pts: [[x,y,z]...], eave: [i, j] } eave is the lowest edge; uv are measured from it.
      const P = f.pts;
      let nxx = 0, nyy = 0, nzz = 0;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], c = P[(i + 1) % P.length];
        nxx += (a[1] - c[1]) * (a[2] + c[2]);
        nyy += (a[2] - c[2]) * (a[0] + c[0]);
        nzz += (a[0] - c[0]) * (a[1] + c[1]);
      }
      let l = Math.hypot(nxx, nyy, nzz) || 1;
      nxx /= l; nyy /= l; nzz /= l;
      const rev = nyy < 0;
      if (rev) (nxx = -nxx), (nyy = -nyy), (nzz = -nzz);
      const e0 = P[f.eave[0]], e1 = P[f.eave[1]];
      let tx = e1[0] - e0[0], ty = e1[1] - e0[1], tz = e1[2] - e0[2];
      l = Math.hypot(tx, ty, tz) || 1;
      tx /= l; ty /= l; tz /= l;
      // up-slope direction = cross(n, t), sign chosen to point up
      let sx = nyy * tz - nzz * ty, sy = nzz * tx - nxx * tz, sz = nxx * ty - nyy * tx;
      if (sy < 0) (sx = -sx), (sy = -sy), (sz = -sz);
      const ids = P.map((p) => {
        const dx = p[0] - e0[0], dy = p[1] - e0[1], dz = p[2] - e0[2];
        return vert(p[0], p[1], p[2], nxx, nyy, nzz, kind, sd, y0, y1, dx * tx + dy * ty + dz * tz, 0, 0, variant, SURF.PITCHED, dx * sx + dy * sy + dz * sz, tx, ty, tz);
      });
      for (let i = 1; i < ids.length - 1; i++) (rev ? idx.push(ids[0], ids[i + 1], ids[i]) : idx.push(ids[0], ids[i], ids[i + 1]));
    }
  }

  if (!pos.length) return { geometry: null, props, detail };
  const g = new THREE.BufferGeometry();
  const f32 = (a, n) => new THREE.BufferAttribute(new Float32Array(a), n);
  g.setAttribute('position', f32(pos, 3));
  g.setAttribute('normal', f32(nor, 3));
  g.setAttribute('color', f32(col, 3));
  g.setAttribute('aInfo', f32(info, 4));
  g.setAttribute('aGeo', f32(geo, 4));
  g.setAttribute('aSurf', f32(surf, 2));
  g.setAttribute('aTan', f32(tan, 3));
  g.setIndex(new THREE.BufferAttribute(vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return { geometry: g, props, detail };
}

// Roof shapes. Returns null (flat roof) or { faces(y1) -> [{ pts, eave }], detail(y1, seed, kind, variant) }.
function planRoof(outer, cl, H) {
  const n = outer.length / 2;
  const o = cl.o;
  const fill = cl.area / Math.max(1, o.len * o.wid);
  const P = [];
  for (let i = 0; i < n; i++) P.push([outer[i * 2], outer[i * 2 + 1]]);
  const brasov = cl.kind === KIND.BAROQUE;
  // Near-rectangular footprints get a hip or a gable over their oriented box, everything else a pyramid if star shaped.
  if (fill > 0.86 && o.wid > 3.5 && o.len > 4.5) {
    const c = o.c, s = o.s;
    const corner = (x, z) => [x * c - z * s, x * s + z * c];
    const ov = brasov ? 0.55 : 0.35;
    const A = corner(o.x0 - ov, o.z0 - ov), B = corner(o.x1 + ov, o.z0 - ov), C = corner(o.x1 + ov, o.z1 + ov), D = corner(o.x0 - ov, o.z1 + ov);
    const wid = o.wid + 2 * ov, len = o.len + 2 * ov;
    const pitch = brasov ? 0.95 : 0.62;
    const rh = Math.min(wid * 0.5 * pitch, brasov ? 7.5 : 5);
    const hip = Math.min(wid * 0.5 * (0.45 + 0.55 * rnd01(cl.variant, 3)), len * 0.4);
    const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    // ridge from the middle of the short sides, shortened by the hip run
    const t0 = hip / len, t1 = 1 - hip / len;
    const mAD = mid(A, D, 0.5), mBC = mid(B, C, 0.5);
    const R1 = mid(mAD, mBC, t0), R2 = mid(mAD, mBC, t1);
    return {
      faces: (y1) => {
        const e = y1 - 0.12, top = y1 + rh;
        const F = [
          { pts: [[A[0], e, A[1]], [B[0], e, B[1]], [R2[0], top, R2[1]], [R1[0], top, R1[1]]], eave: [0, 1] },
          { pts: [[C[0], e, C[1]], [D[0], e, D[1]], [R1[0], top, R1[1]], [R2[0], top, R2[1]]], eave: [0, 1] },
        ];
        F.push({ pts: [[D[0], e, D[1]], [A[0], e, A[1]], [R1[0], top, R1[1]]], eave: [0, 1] });
        F.push({ pts: [[B[0], e, B[1]], [C[0], e, C[1]], [R2[0], top, R2[1]]], eave: [0, 1] });
        return F;
      },
      detail: (y1, sd, kind, variant) => ({ ridge: [R1[0], R1[1], R2[0], R2[1]], y: y1, rh, wid, len, A, B, C, D, seed: sd, kind, variant, hip: true }),
    };
  }
  // Pyramid over a star-shaped footprint (visible from the centroid).
  let cx = 0, cz = 0;
  for (const p of P) (cx += p[0]), (cz += p[1]);
  cx /= n; cz /= n;
  let sign = 0, ok = n >= 3 && n <= 24;
  for (let i = 0; ok && i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const cr = (a[0] - cx) * (b[1] - cz) - (a[1] - cz) * (b[0] - cx);
    if (Math.abs(cr) < 1e-6) continue;
    if (!sign) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) ok = false;
  }
  if (!ok) return null;
  const rh = Math.min(cl.o.wid * 0.5 * (brasov ? 0.9 : 0.5), 6);
  return {
    faces: (y1) => P.map((a, i) => {
      const b = P[(i + 1) % n];
      return { pts: [[a[0], y1 - 0.05, a[1]], [b[0], y1 - 0.05, b[1]], [cx, y1 + rh, cz]], eave: [0, 1] };
    }),
    detail: () => null,
  };
}
