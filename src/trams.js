import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from './config.js';

// Trams on the real tram rails (the chunk data marks them `tram`; Brasov has none, so it has no
// trams). The pieces of the loaded chunks are joined into a network of lines. A tram is two
// articulated bodies built in code, red and yellow, that follows the line at 30 to 40 km/h, stops
// every 300 to 500 m with the doors open, rings its bell on leaving, and turns round at the end of
// the line. The bodies are solid, and Bunica can land on a roof and ride it: while she stands
// there she is carried with it, and she leaves with its speed.

const MAX = 4;
const UNIT = 9; // length of one body
const GAP = 1; // the bellows between the two bodies
const LEN = 2 * UNIT + GAP;
const WID = 2.4;
const ROOF = 3.3; // height of the roof above the rail
const TRAIL = 24; // metres of path kept behind the front, to lay the bodies on
const SPAWN = [140, 650]; // trams appear on rails this far from her
const GONE = 900;
const ACC = 0.9;
const DECEL = 1.1;

const rand = (x, z) => Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;

// ---------- the network ----------

// Joins the tram pieces of the loaded chunks into lines that run from one junction or end to the next.
function stitch(pieces) {
  const key = (x, z) => Math.round(x * 4) + ',' + Math.round(z * 4);
  const ends = new Map();
  pieces.forEach((p, i) => {
    for (const end of [0, 1]) {
      const k = end ? key(p[p.length - 2], p[p.length - 1]) : key(p[0], p[1]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ i, end });
    }
  });
  const used = pieces.map(() => false);
  // The other piece that meets this one at a node where exactly two piece ends touch.
  const partner = (k, i) => {
    const l = ends.get(k);
    if (l.length !== 2) return null;
    const o = l[0].i === i ? l[1] : l[0];
    return o.i === i || used[o.i] ? null : o;
  };
  const edges = [];
  for (let i0 = 0; i0 < pieces.length; i0++) {
    if (used[i0]) continue;
    used[i0] = true;
    let pts = Array.from(pieces[i0]);
    for (const side of [1, 0]) {
      let cur = i0;
      for (;;) {
        const k = side ? key(pts[pts.length - 2], pts[pts.length - 1]) : key(pts[0], pts[1]);
        const o = partner(k, cur);
        if (!o) break;
        used[o.i] = true;
        const q = Array.from(pieces[o.i]);
        // Orient the next piece so it leaves the shared node.
        const away = side ? o.end === 0 : o.end === 1;
        const list = away ? q : reverse(q);
        pts = side ? pts.concat(list.slice(2)) : list.slice(0, -2).concat(pts);
        cur = o.i;
      }
    }
    // Drop repeated points.
    const clean = [pts[0], pts[1]];
    for (let j = 2; j < pts.length; j += 2) if (Math.hypot(pts[j] - clean[clean.length - 2], pts[j + 1] - clean[clean.length - 1]) > 0.05) clean.push(pts[j], pts[j + 1]);
    if (clean.length < 4) continue;
    const cum = new Float32Array(clean.length / 2);
    for (let j = 1; j < cum.length; j++) cum[j] = cum[j - 1] + Math.hypot(clean[2 * j] - clean[2 * j - 2], clean[2 * j + 1] - clean[2 * j - 1]);
    edges.push({ pts: clean, cum, len: cum[cum.length - 1], n0: key(clean[0], clean[1]), n1: key(clean[clean.length - 2], clean[clean.length - 1]), stops: null });
  }
  const nodes = new Map();
  for (const e of edges) {
    for (const end of [0, 1]) {
      const k = end ? e.n1 : e.n0;
      if (!nodes.has(k)) nodes.set(k, []);
      nodes.get(k).push({ edge: e, end });
    }
  }
  return { edges, nodes };
}

function reverse(p) {
  const out = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

// Point at arc length u from the first vertex; also the unit direction of that piece (towards the end).
function pointAt(e, u, out) {
  const c = e.cum;
  u = clamp(u, 0, e.len);
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid] <= u) lo = mid;
    else hi = mid;
  }
  const p = e.pts, seg = c[hi] - c[lo] || 1, k = (u - c[lo]) / seg;
  out.x = p[2 * lo] + (p[2 * hi] - p[2 * lo]) * k;
  out.z = p[2 * lo + 1] + (p[2 * hi + 1] - p[2 * lo + 1]) * k;
  out.hx = (p[2 * hi] - p[2 * lo]) / seg;
  out.hz = (p[2 * hi + 1] - p[2 * lo + 1]) / seg;
  return out;
}

// Where the trams of a line stop: every 300 to 560 m, not near the ends. Arc lengths from the first vertex.
function stopsOf(e) {
  if (!e.stops) {
    e.stops = [];
    const gap = 300 + rand(e.pts[0], e.pts[1]) * 260;
    for (let s = 40 + rand(e.pts[1], e.pts[0]) * gap; s < e.len - 40; s += gap) e.stops.push(s);
  }
  return e.stops;
}

// ---------- the bodies ----------

const ringSign = (r) => {
  let a = 0;
  for (let i = 0, j = r.length / 2 - 1; i < r.length / 2; j = i++) a += (r[j * 2] - r[i * 2]) * (r[j * 2 + 1] + r[i * 2 + 1]);
  return Math.sign(a / 2) || 1;
};

// Vertex colours in place of textures; geometry is made non-indexed so all the pieces merge.
const paint = (geo, hex) => {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};
const box = (w, h, d, x, y, z, hex) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);

let PARTS = null;

// Shared geometry and materials: a body (paint), its lights, the door leaves and the bellows.
function buildParts(onMaterial) {
  if (PARTS) return PARTS;
  const RED = 0xb3252b, YEL = 0xf0b91d, GLASS = 0x141b24, GREY = 0x9aa0a6, DARK = 0x1c1d20, OPEN = 0x0d0c0b;
  const body = [paint(new RoundedBoxGeometry(WID, 2.7, UNIT, 3, 0.22).translate(0, 1.9, 0), RED)];
  body.push(box(WID - 0.2, 0.36, UNIT - 0.5, 0, 0.45, 0, DARK)); // skirt
  body.push(box(WID + 0.02, 0.26, UNIT + 0.02, 0, 1.4, 0, YEL)); // belt under the windows
  body.push(box(WID + 0.02, 0.24, UNIT + 0.02, 0, 3.1, 0, YEL)); // belt over the windows
  body.push(box(WID + 0.02, 1.15, UNIT - 0.7, 0, 2.2, 0, GLASS)); // window band
  for (const z of [-4.2, -2.8, -1.4, 0, 1.4, 2.8, 4.2]) body.push(box(WID + 0.03, 1.16, 0.13, 0, 2.2, z, YEL)); // pillars
  body.push(paint(new RoundedBoxGeometry(2.2, 0.16, UNIT - 0.3, 2, 0.06).translate(0, 3.36, 0), GREY)); // roof
  for (const z of [-1.9, 1.9]) body.push(box(1.3, 0.3, 2.4, 0, 3.6, z, 0x7d838a)); // air conditioning
  for (const z of [-2.1, 2.1]) for (const s of [-1, 1]) body.push(box(0.03, 2.05, 1.1, s * (WID / 2 + 0.02), 1.6, z, OPEN)); // door openings
  for (const s of [-1, 1]) body.push(box(WID - 0.3, 0.25, 0.06, 0, 1.0, s * (UNIT / 2 + 0.01), DARK)); // bumpers
  for (const s of [-1, 1]) body.push(box(2.0, 0.95, 0.06, 0, 2.15, s * (UNIT / 2 + 0.005), GLASS)); // cab glass, both ends
  for (const z of [-2.9, 2.9]) body.push(box(2.0, 0.4, 1.7, 0, 0.3, z, DARK)); // bogies
  // Pantograph on the roof: a base, two arms and the contact bar.
  body.push(box(1.1, 0.08, 0.8, 0, 3.5, -3.1, DARK));
  for (const z of [-0.6, 0.6]) body.push(paint(new THREE.BoxGeometry(0.06, 0.06, 1.7).rotateX(z * 0.9).translate(0.35, 3.9, -3.1 + z * 0.55), DARK), paint(new THREE.BoxGeometry(0.06, 0.06, 1.7).rotateX(z * 0.9).translate(-0.35, 3.9, -3.1 + z * 0.55), DARK));
  body.push(box(1.5, 0.05, 0.08, 0, 4.3, -3.1, DARK));
  const bodyGeo = mergeGeometries(body);
  bodyGeo.computeBoundingSphere();
  // White lights and the destination board at the far end of the first body, red lights at the far end of the second.
  const lightsFront = mergeGeometries([box(0.28, 0.2, 0.05, -0.8, 1.05, UNIT / 2 + 0.03, 0xfff3c8), box(0.28, 0.2, 0.05, 0.8, 1.05, UNIT / 2 + 0.03, 0xfff3c8), box(1.0, 0.24, 0.05, 0, 2.95, UNIT / 2 + 0.03, 0xffab30)]);
  const lightsRear = mergeGeometries([box(0.26, 0.18, 0.05, -0.8, 1.05, -UNIT / 2 - 0.03, 0xff2a20), box(0.26, 0.18, 0.05, 0.8, 1.05, -UNIT / 2 - 0.03, 0xff2a20)]);
  // Doors: two leaves on each side, one mesh per side; a leaf slides along the body to open.
  const doorL = mergeGeometries([-2.1, 2.1].map((z) => box(0.05, 2.05, 1.05, -(WID / 2 + 0.03), 1.6, z, 0xe0a51a)));
  const doorR = mergeGeometries([-2.1, 2.1].map((z) => box(0.05, 2.05, 1.05, WID / 2 + 0.03, 1.6, z, 0xe0a51a)));
  // Bellows: pleats, unit long in z.
  const pleats = [];
  for (let i = 0; i < 6; i++) pleats.push(box(i % 2 ? 2.22 : 2.34, i % 2 ? 2.5 : 2.62, 0.2, 0, 1.9, -0.5 + i * 0.2, 0x26282c));
  const bellows = mergeGeometries(pleats);
  const std = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.3 });
  const mats = { body: std(), door: std(), bellows: std(), lights: new THREE.MeshBasicMaterial({ vertexColors: true }) };
  for (const m of [mats.body, mats.door, mats.bellows]) onMaterial?.(m);
  return (PARTS = { bodyGeo, lightsFront, lightsRear, doorL, doorR, bellowsGeo: bellows, mats });
}

// ---------- the system ----------

export function create(game) {
  const trams = [];
  const stats = { spawned: 0, stops: 0, bells: 0, reversals: 0, rides: 0 };
  const scene = new THREE.Group();
  let net = { edges: [], nodes: new Map() };
  let sig = '';
  let netT = 0;
  let spawnT = 0;
  let riding = null;
  let boardT = -99;
  let cap = MAX;
  let rng = Math.random;
  let nextId = 1;
  const P = {};

  // ---------- network ----------

  function refreshNet() {
    const pieces = [], keys = [];
    for (const rec of game.city.recs.values()) {
      if (rec.state !== 'loaded' || !rec.tram?.length) continue;
      keys.push(rec.info.k);
      for (const r of rec.tram) if (r.pts.length >= 4) pieces.push(r.pts);
    }
    const s = keys.join('|');
    if (s === sig) return;
    sig = s;
    net = stitch(pieces);
    for (const t of [...trams]) if (!relocate(t)) removeTram(t);
  }

  // After the lines were joined again, put a tram on the new line under its nose.
  function relocate(t) {
    let best = null, bd = 2;
    for (const e of net.edges) {
      const p = e.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], L2 = dx * dx + dz * dz || 1;
        const k = clamp(((t.fx - p[i]) * dx + (t.fz - p[i + 1]) * dz) / L2, 0, 1);
        const d = Math.hypot(t.fx - p[i] - dx * k, t.fz - p[i + 1] - dz * k);
        if (d < bd) (bd = d), (best = { e, u: e.cum[i / 2] + k * Math.sqrt(L2), hx: dx, hz: dz });
      }
    }
    if (!best) return false;
    const fwd = t.hx * best.hx + t.hz * best.hz >= 0;
    t.edge = best.e;
    t.dir = fwd ? 1 : -1;
    t.s = fwd ? best.u : best.e.len - best.u;
    t.cont = undefined;
    return true;
  }

  // The line a tram takes at the end of its own: the one that leaves the junction most nearly straight on.
  function nextEdge(t) {
    const e = t.edge, endKey = t.dir > 0 ? e.n1 : e.n0, endIdx = t.dir > 0 ? 1 : 0;
    const q = pointAt(e, t.dir > 0 ? e.len : 0, {});
    const hx = q.hx * t.dir, hz = q.hz * t.dir;
    let best = null, bc = 0.55;
    for (const { edge, end } of net.nodes.get(endKey) || []) {
      if (edge === e && end === endIdx) continue;
      const dir = end === 0 ? 1 : -1;
      const o = pointAt(edge, end === 0 ? 0 : edge.len, {});
      const c = hx * o.hx * dir + hz * o.hz * dir;
      if (c > bc) (bc = c), (best = { edge, dir });
    }
    return best;
  }

  // ---------- making and removing trams ----------

  function makeUnit(parts, first) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(parts.bodyGeo, parts.mats.body);
    body.castShadow = body.receiveShadow = true;
    const lights = new THREE.Mesh(first ? parts.lightsFront : parts.lightsRear, parts.mats.lights);
    const dl = new THREE.Mesh(parts.doorL, parts.mats.door);
    const dr = new THREE.Mesh(parts.doorR, parts.mats.door);
    dl.castShadow = dr.castShadow = true;
    g.add(body, lights, dl, dr);
    const prism = { outer: new Float32Array(8), holes: [], signs: [1], y0: 0.4, y1: ROOF, minx: 0, maxx: 0, minz: 0, maxz: 0, kind: 'prop' };
    const unit = { g, prism, dl, dr, first, cx: 0, cz: 0, yaw: 0, pcx: 0, pcz: 0, dyaw: 0, vx: 0, vz: 0 };
    prism.tramUnit = unit;
    return unit;
  }

  function spawnOn(edge, u, dir) {
    if (trams.length >= 12) return null;
    const parts = buildParts(game.actors?.onMaterial);
    if (!scene.parent) game.scene.add(scene);
    const t = { id: nextId++, edge, dir, s: dir > 0 ? u : edge.len - u, v: 0, cruise: 8 + rng() * 3, mode: 'run', timer: 0, dwellFor: 0, doors: 0, doorsWant: 0, fx: 0, fz: 0, hx: 0, hz: 1, tx: [], tz: [], trailLen: 0, cont: undefined, terminal: false, bells: 0, bellT: 0, units: [], gone: false, near: true, ringT: 0 };
    const q = pointAt(edge, u, {});
    t.fx = q.x;
    t.fz = q.z;
    t.hx = q.hx * dir;
    t.hz = q.hz * dir;
    // The path behind the front, from the line itself.
    for (let d = 0.4; d <= TRAIL + 0.4; d += 0.4) {
      const b = pointAt(edge, clamp(u - dir * d, 0, edge.len), {});
      t.tx.push(b.x);
      t.tz.push(b.z);
    }
    t.trailLen = TRAIL + 0.4;
    for (const first of [true, false]) {
      const unit = makeUnit(parts, first);
      t.units.push(unit);
      scene.add(unit.g);
      unit.g.userData.tram = t;
      game.city.dynamic.push(unit.prism);
    }
    t.bellows = new THREE.Mesh(parts.bellowsGeo, parts.mats.bellows);
    t.bellows.castShadow = true;
    scene.add(t.bellows);
    ringSignSet(t);
    place(t, 0);
    for (const un of t.units) (un.pcx = un.cx), (un.pcz = un.cz);
    trams.push(t);
    stats.spawned++;
    return t;
  }

  function ringSignSet(t) {
    for (const un of t.units) {
      // Corners front-left, front-right, rear-right, rear-left at yaw 0.
      un.prism.outer.set([-WID / 2, UNIT / 2, WID / 2, UNIT / 2, WID / 2, -UNIT / 2, -WID / 2, -UNIT / 2]);
      un.prism.signs[0] = ringSign(un.prism.outer);
    }
  }

  function removeTram(t) {
    t.gone = true;
    for (const un of t.units) {
      scene.remove(un.g);
      const i = game.city.dynamic.indexOf(un.prism);
      if (i >= 0) game.city.dynamic.splice(i, 1);
    }
    scene.remove(t.bellows);
    const i = trams.indexOf(t);
    if (i >= 0) trams.splice(i, 1);
    if (riding?.tram === t) riding = null;
  }

  // A place on the lines for a new tram: away from her, out of sight, with room behind the front and no tram close.
  function trySpawn(px, pz, anywhere) {
    if (!net.edges.length) return;
    const e = net.edges[(rng() * net.edges.length) | 0];
    if (e.len < TRAIL + 30) return;
    const dir = rng() < 0.5 ? 1 : -1;
    const u = e.len * (0.1 + rng() * 0.8);
    if (dir > 0 ? u < TRAIL + 2 : e.len - u < TRAIL + 2) return;
    const q = pointAt(e, u, {});
    const d = Math.hypot(q.x - px, q.z - pz);
    if (d < SPAWN[0] || d > SPAWN[1]) return;
    for (const o of trams) if (Math.hypot(o.fx - q.x, o.fz - q.z) < 80) return;
    if (!anywhere && d < 260) {
      const v = new THREE.Vector3(q.x, 2, q.z).project(game.camera);
      if (Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3 && v.z < 1) return;
    }
    spawnOn(e, u, dir);
  }

  // ---------- driving ----------

  const _p = {};

  // The point `d` metres behind the front along the path the tram has taken.
  function behind(t, d, out) {
    let px = t.fx, pz = t.fz, acc = 0;
    for (let i = 0; i < t.tx.length; i++) {
      const x = t.tx[i], z = t.tz[i], seg = Math.hypot(x - px, z - pz);
      if (acc + seg >= d) {
        const k = seg > 1e-6 ? (d - acc) / seg : 0;
        out.x = px + (x - px) * k;
        out.z = pz + (z - pz) * k;
        return out;
      }
      acc += seg;
      px = x;
      pz = z;
    }
    out.x = px;
    out.z = pz;
    return out;
  }

  const a1 = {}, a2 = {};

  function place(t, dt) {
    const g = (x, z) => game.city.groundAt?.(x, z) ?? 0;
    const lay = (un, d0, d1) => {
      behind(t, d0, a1);
      behind(t, d1, a2);
      un.pcx = un.cx;
      un.pcz = un.cz;
      const po = un.yaw;
      un.cx = (a1.x + a2.x) / 2;
      un.cz = (a1.z + a2.z) / 2;
      if (Math.hypot(a1.x - a2.x, a1.z - a2.z) > 1) un.yaw = Math.atan2(a1.x - a2.x, a1.z - a2.z);
      un.dyaw = Math.atan2(Math.sin(un.yaw - po), Math.cos(un.yaw - po));
      if (dt > 0) {
        un.vx = (un.cx - un.pcx) / dt;
        un.vz = (un.cz - un.pcz) / dt;
      }
      const y = g(un.cx, un.cz);
      un.g.position.set(un.cx, y, un.cz);
      un.g.rotation.y = un.yaw;
      const hx = Math.sin(un.yaw), hz = Math.cos(un.yaw), rx = hz, rz = -hx, hl = UNIT / 2, hw = WID / 2;
      const o = un.prism.outer;
      o[0] = un.cx + hx * hl - rx * hw; o[1] = un.cz + hz * hl - rz * hw;
      o[2] = un.cx + hx * hl + rx * hw; o[3] = un.cz + hz * hl + rz * hw;
      o[4] = un.cx - hx * hl + rx * hw; o[5] = un.cz - hz * hl + rz * hw;
      o[6] = un.cx - hx * hl - rx * hw; o[7] = un.cz - hz * hl - rz * hw;
      const pr = un.prism;
      pr.minx = Math.min(o[0], o[2], o[4], o[6]);
      pr.maxx = Math.max(o[0], o[2], o[4], o[6]);
      pr.minz = Math.min(o[1], o[3], o[5], o[7]);
      pr.maxz = Math.max(o[1], o[3], o[5], o[7]);
      pr.y0 = y + 0.4;
      pr.y1 = y + ROOF;
      // The doors slide along the body: the whole side moves by the same amount.
      un.dl.position.z = t.doors * 1.15;
      un.dr.position.z = -t.doors * 1.15;
    };
    lay(t.units[0], 0.2, UNIT + 0.2);
    lay(t.units[1], UNIT + GAP + 0.2, LEN + 0.2);
    // Bellows between the two bodies, along the chord from the rear of the first to the front of the second.
    behind(t, UNIT + 0.2, a1);
    behind(t, UNIT + GAP + 0.2, a2);
    const L = Math.hypot(a1.x - a2.x, a1.z - a2.z);
    t.bellows.position.set((a1.x + a2.x) / 2, g((a1.x + a2.x) / 2, (a1.z + a2.z) / 2), (a1.z + a2.z) / 2);
    t.bellows.rotation.y = Math.atan2(a1.x - a2.x, a1.z - a2.z);
    t.bellows.scale.set(1, 1, Math.max(0.6, L + 0.5) / 1.0);
  }

  const ring = (t, why, n = 2) => {
    t.bells = Math.max(t.bells, n);
    t.bellT = 0;
    t.bellWhy = why;
  };

  function bellNow(t, why) {
    stats.bells++;
    game.events.emit('tram:bell', { x: t.fx, y: 2, z: t.fz, tram: t, why });
  }

  function step(t, dt) {
    const e = t.edge;
    const pl = game.player;
    // Bell: two rings on leaving a stop, and while someone stands on the track ahead.
    if (t.bells > 0 && (t.bellT -= dt) <= 0) {
      t.bells--;
      t.bellT = 0.42;
      bellNow(t, t.bellWhy);
    }
    if (t.mode === 'dwell') {
      t.timer += dt;
      const open = t.timer > 1.2 && t.timer < t.dwellFor - 1.8;
      t.doorsWant = open ? 1 : 0;
      t.doors += clamp(t.doorsWant - t.doors, -dt / 0.9, dt / 0.9);
      if (t.timer >= t.dwellFor) {
        if (t.terminal) turnRound(t);
        else ring(t, 'depart', 2);
        t.mode = 'run';
        t.terminal = false;
        t.timer = 0;
      }
      return;
    }
    t.doors = Math.max(0, t.doors - dt / 0.9);
    const toEnd = e.len - t.s;
    if (t.cont === undefined && toEnd < 140) t.cont = nextEdge(t);
    // The next place to stand still: a stop on this line, or the end of the line where nothing continues.
    let target = Infinity, terminal = false;
    if (t.served && (t.served.edge !== e || Math.abs(t.served.p - (t.dir > 0 ? t.s : e.len - t.s)) > 3)) t.served = null;
    for (const p of stopsOf(e)) {
      const sp = t.dir > 0 ? p : e.len - p;
      if (sp >= t.s - 0.05 && sp < target && !(t.served && Math.abs(t.served.p - p) < 0.5)) target = sp;
    }
    if (t.cont === null && e.len < target) (target = e.len), (terminal = true);
    let vmax = t.cruise;
    if (Number.isFinite(target)) vmax = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, target - t.s - 0.3)) + 0.5);
    // Slower through a bend at a junction.
    if (t.cont && toEnd < 25) vmax = Math.min(vmax, 5.5);
    // A tram ahead on the same line.
    for (const o of trams) {
      if (o === t || o.edge !== e || o.dir !== t.dir || o.s <= t.s) continue;
      vmax = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, o.s - t.s - LEN - 8)));
    }
    // Someone on foot on the rails ahead: ring, and stop short of her.
    const dx = pl.pos.x - t.fx, dz = pl.pos.z - t.fz, f = dx * t.hx + dz * t.hz, side = Math.abs(dx * t.hz - dz * t.hx);
    if (f > 0 && f < 30 && side < 2.2 && pl.pos.y < 2.5 && t.v > 1) {
      if (t.ringT <= 0) (t.ringT = 2.5), ring(t, 'warn', 3);
      vmax = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, f - 6)));
    }
    if (t.ringT > 0) t.ringT -= dt;
    t.v += clamp(vmax - t.v, -DECEL * 1.6 * dt, ACC * dt);
    t.s += t.v * dt;
    if (Number.isFinite(target) && (t.s >= target - 0.08 || (target - t.s < 0.4 && t.v < 0.8))) {
      // Arrived at a stop: stand, open the doors, wait.
      t.s = target;
      t.v = 0;
      t.served = { edge: e, p: t.dir > 0 ? target : e.len - target };
      t.mode = 'dwell';
      t.timer = 0;
      t.terminal = terminal;
      t.dwellFor = terminal ? 7 + rng() * 3 : 8 + rng() * 5;
      stats.stops++;
      game.events.emit('tram:stop', { x: t.fx, z: t.fz, tram: t, terminal });
    } else if (t.s >= e.len) {
      // Onto the next line at the junction.
      if (t.cont) {
        const over = t.s - e.len;
        t.edge = t.cont.edge;
        t.dir = t.cont.dir;
        t.s = over;
        t.cont = undefined;
      } else t.s = e.len;
    }
  }

  // At the end of a line the tram runs back the way it came: its rear becomes its front.
  function turnRound(t) {
    const e = t.edge;
    const pts = [t.fx, t.fz];
    let acc = 0, px = t.fx, pz = t.fz;
    for (let i = 0; i < t.tx.length && acc < TRAIL - 1; i++) {
      const d = Math.hypot(t.tx[i] - px, t.tz[i] - pz);
      if (acc + d > TRAIL - 1) {
        const k = (TRAIL - 1 - acc) / d;
        pts.push(px + (t.tx[i] - px) * k, pz + (t.tz[i] - pz) * k);
        acc = TRAIL - 1;
        break;
      }
      pts.push(t.tx[i], t.tz[i]);
      acc += d;
      px = t.tx[i];
      pz = t.tz[i];
    }
    const n = pts.length / 2;
    t.fx = pts[2 * n - 2];
    t.fz = pts[2 * n - 1];
    t.tx = [];
    t.tz = [];
    for (let i = n - 2; i >= 0; i--) t.tx.push(pts[2 * i]), t.tz.push(pts[2 * i + 1]);
    t.trailLen = acc;
    t.dir = -t.dir;
    t.s = acc;
    t.cont = undefined;
    stats.reversals++;
    t.reversed = (t.reversed || 0) + 1;
  }

  function move(t, dt) {
    const e = t.edge;
    const u = t.dir > 0 ? t.s : e.len - t.s;
    const q = pointAt(e, u, _p);
    const nx = q.x, nz = q.z;
    const h = Math.hypot(nx - t.fx, nz - t.fz);
    if (h > 1e-4) {
      t.hx = (nx - t.fx) / h;
      t.hz = (nz - t.fz) / h;
    } else {
      t.hx = q.hx * t.dir;
      t.hz = q.hz * t.dir;
    }
    // Remember the path, so the bodies can lie along it.
    const lx = t.tx.length ? t.tx[0] : t.fx, lz = t.tz.length ? t.tz[0] : t.fz;
    if (Math.hypot(nx - lx, nz - lz) >= 0.4) {
      t.tx.unshift(t.fx);
      t.tz.unshift(t.fz);
      t.trailLen += Math.hypot(t.fx - lx, t.fz - lz);
      while (t.tx.length > 2) {
        const i = t.tx.length - 1, seg = Math.hypot(t.tx[i] - t.tx[i - 1], t.tz[i] - t.tz[i - 1]);
        if (t.trailLen - seg < TRAIL) break;
        t.tx.pop();
        t.tz.pop();
        t.trailLen -= seg;
      }
    }
    t.fx = nx;
    t.fz = nz;
  }

  // ---------- riding ----------

  function ride() {
    const pl = game.player;
    if (riding) {
      const { unit, tram } = riding;
      if (pl.mode === 'ground' && pl.groundBox === unit.prism) {
        // Carried with the body: it moved by (cx - pcx, cz - pcz) and turned by dyaw about its middle.
        const ox = pl.pos.x - unit.pcx, oz = pl.pos.z - unit.pcz, c = Math.cos(unit.dyaw), s = Math.sin(unit.dyaw);
        pl.pos.x = unit.cx + ox * c + oz * s;
        pl.pos.z = unit.cz + oz * c - ox * s;
        const fx = pl.facing.x;
        pl.facing.x = fx * c + pl.facing.z * s;
        pl.facing.z = pl.facing.z * c - fx * s;
        pl.lastSafe.copy(pl.pos);
      } else {
        // She left the roof: a jump or a step off keeps the speed of the tram.
        if (pl.mode === 'air' || pl.mode === 'swing') {
          pl.vel.x += unit.vx;
          pl.vel.z += unit.vz;
        }
        riding = null;
      }
    } else if (pl.mode === 'ground' && pl.groundBox?.tramUnit) {
      riding = { unit: pl.groundBox.tramUnit, tram: pl.groundBox.tramUnit.g.userData.tram };
      stats.rides++;
      if (game.time - boardT > 45) game.voice?.say?.('tram');
      boardT = game.time;
    }
  }

  // ---------- the system ----------

  function init() {
    rng = game.rng || Math.random;
    cap = game.params.has('lowq') ? 2 : MAX;
  }

  function onCityChange() {
    for (const t of [...trams]) removeTram(t);
    sig = '';
    netT = 0;
    spawnT = 0;
  }

  function update(dt) {
    const pl = game.player, px = pl.pos.x, pz = pl.pos.z;
    if ((netT -= dt) <= 0) {
      netT = 1;
      refreshNet();
    }
    if (net.edges.length && trams.length < cap && (spawnT -= dt) <= 0) {
      spawnT = trams.length ? 1.5 : 0.1;
      trySpawn(px, pz, game.time < 2);
    }
    for (let i = trams.length - 1; i >= 0; i--) {
      const t = trams[i];
      if (Math.hypot(t.fx - px, t.fz - pz) > GONE && !(riding && riding.tram === t)) {
        removeTram(t);
        continue;
      }
      step(t, dt);
      move(t, dt);
      place(t, dt);
    }
    ride();
  }

  function dispose() {
    for (const t of [...trams]) removeTram(t);
    scene.removeFromParent();
  }

  return { name: 'trams', init, onCityChange, update, dispose, trams, stats, spawnOn, network: () => net, pointAt, stopsOf, ride: () => riding };
}
