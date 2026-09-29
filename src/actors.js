import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pointInPrism2D, closestOnPrism } from './osmcity.js';
import { clamp, mulberry32 } from './config.js';

// People, cops, stray dogs and bears for the city: behaviour primitives only (steer to a point,
// stay out of buildings and water, a small state machine), no gameplay. Up to about 120 at once.
//
// Humans are the Mixamo X Bot (public/models/Xbot.glb) rebuilt for crowds: a 22 bone skeleton,
// body and accessories merged in one skinned mesh with three levels of detail, clothes painted by a
// shader in bind-pose space (so a few shared materials give hundreds of outfits). Dogs and bears are
// primitives skinned to a tiny skeleton and animated by hand. Nodes never update on their own: the
// matrices are written here, and only for the actors that are near enough to be worth it.

const FULL = 60; // full rate inside this many metres of the player
const SLOW = 120; // 15 Hz up to here
const HIDE = 160; // frozen and out of the scene beyond
const CULL = 420; // removed beyond, unless persistent
const LOD_AT = [14, 60];
const CLUSTER = [0, 0.03, 0.075]; // vertex clustering cell of each human level of detail, metres
const SHADOW_AT = 55;
const DOWN_HOLD = 3.2;
const DOWN_FADE = 1.3;
const TAU = Math.PI * 2;

// Speeds are metres per second. `runAt`: above it the state is 'run'. `turn`: radians per second.
const KINDS = {
  thug: { rig: 'human', hp: 60, radius: 0.36, walk: 1.5, run: 5.4, runAt: 2.6, turn: 9, height: [1.0, 1.07] },
  cop: { rig: 'human', hp: 100, radius: 0.36, walk: 1.5, run: 5.2, runAt: 2.6, turn: 9, height: [1.0, 1.06] },
  civilian: { rig: 'human', hp: 30, radius: 0.32, walk: 1.35, run: 4.6, runAt: 2.6, turn: 9, height: [0.9, 1.05] },
  dog: { rig: 'quad', hp: 25, radius: 0.3, walk: 1.3, run: 6.8, runAt: 3.0, turn: 10 },
  bear: { rig: 'quad', hp: 220, radius: 0.75, walk: 1.5, run: 6.2, runAt: 3.2, turn: 5 },
};

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'].map((n) => 'mixamorig' + n);
const B = Object.fromEntries(BONES.map((n, i) => [n.slice(9).replace(/^./, (c) => c.toLowerCase()), i]));

const WALK_CLIP_SPEED = 1.5; // ground speed the walk clip matches at time scale 1, measured from the feet
const RUN_CLIP_SPEED = 3.5;

const lin = (hex) => new THREE.Color(hex).toArray();
const pick = (rng, a) => a[(rng() * a.length) | 0];
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

// ---------- geometry building ----------

const mat4 = (px, py, pz, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const _nm = new THREE.Matrix3();
const _pv = new THREE.Vector3();

// Collects primitives rigidly bound to one bone each, with a part code the shader reads:
// 1 fixed vertex colour, 2 shirt, 3 accent, 4 pants, 5 hair, 6 shoe, 7 dark shirt.
class Mesher {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.si = [];
    this.sw = [];
    this.part = [];
    this.col = [];
    this.idx = [];
  }

  add(geo, m4, bone, part = 1, color = [1, 1, 1], flip = false) {
    const base = this.pos.length / 3;
    const p = geo.attributes.position, n = geo.attributes.normal;
    _nm.getNormalMatrix(m4);
    for (let i = 0; i < p.count; i++) {
      _pv.fromBufferAttribute(p, i).applyMatrix4(m4);
      this.pos.push(_pv.x, _pv.y, _pv.z);
      _pv.fromBufferAttribute(n, i).applyNormalMatrix(_nm).normalize();
      if (flip) _pv.negate();
      this.nor.push(_pv.x, _pv.y, _pv.z);
      this.si.push(bone, 0, 0, 0);
      this.sw.push(1, 0, 0, 0);
      this.part.push(part);
      this.col.push(color[0], color[1], color[2]);
    }
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      if (flip) this.idx.push(base + ix[i], base + ix[i + 2], base + ix[i + 1]);
      else this.idx.push(base + ix[i], base + ix[i + 1], base + ix[i + 2]);
    }
  }

  // A surface seen from both sides: the outer faces and an inner copy.
  shell(geo, m4, bone, part, color) {
    this.add(geo, m4, bone, part, color);
    this.add(geo, m4, bone, part, color, true);
  }

  // A tapered rod between two points: `rFrom` at the first, `rTo` at the second.
  limb(from, to, rFrom, rTo, bone, part, color, sides = 8) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const d = b.clone().sub(a), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5).clone(), q, new THREE.Vector3(1, 1, 1));
    this.add(new THREE.CylinderGeometry(rTo, rFrom, len, sides, 1, false), m, bone, part, color);
  }

  raw() {
    return {
      pos: Float32Array.from(this.pos),
      nor: Float32Array.from(this.nor),
      si: Uint16Array.from(this.si),
      sw: Float32Array.from(this.sw),
      part: Float32Array.from(this.part),
      col: Float32Array.from(this.col),
      idx: Uint32Array.from(this.idx),
    };
  }
}

// One skinned geometry from a body (part 0, painted by zone) and optional accessories.
function assemble(body, extra) {
  const nb = body ? body.pos.length / 3 : 0, na = extra ? extra.pos.length / 3 : 0, n = nb + na;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), part = new Float32Array(n), col = new Float32Array(n * 3);
  if (body) {
    pos.set(body.pos);
    nor.set(body.nor);
    si.set(body.si);
    sw.set(body.sw);
  }
  if (extra) {
    pos.set(extra.pos, nb * 3);
    nor.set(extra.nor, nb * 3);
    si.set(extra.si, nb * 4);
    sw.set(extra.sw, nb * 4);
    part.set(extra.part, nb);
    col.set(extra.col, nb * 3);
  }
  const bi = body ? body.idx.length : 0, ei = extra ? extra.idx.length : 0;
  const idx = n > 65535 ? new Uint32Array(bi + ei) : new Uint16Array(bi + ei);
  if (body) idx.set(body.idx);
  for (let i = 0; i < ei; i++) idx[bi + i] = extra.idx[i] + nb;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// The X Bot body as flat arrays on the compact skeleton: finger, eye and tip bones fold into the
// nearest bone we keep, and the two meshes (surface and joints) become one.
function bodyArrays(gltf) {
  const skinned = [];
  gltf.scene.traverse((o) => o.isSkinnedMesh && skinned.push(o));
  const old = skinned[0].skeleton.bones;
  const keep = new Map(BONES.map((n, i) => [n, i]));
  const map = old.map((b) => {
    let o = b;
    while (o && !keep.has(o.name)) o = o.parent;
    return o ? keep.get(o.name) : 0;
  });
  const pos = [], nor = [], si = [], sw = [], idx = [];
  let base = 0;
  const acc = { id: [0, 0, 0, 0, 0, 0, 0, 0], w: [0, 0, 0, 0, 0, 0, 0, 0] };
  for (const m of skinned) {
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      let k = 0;
      for (let j = 0; j < 4; j++) {
        const w = SW.getComponent(i, j);
        if (w <= 0) continue;
        const id = map[SI.getComponent(i, j)];
        let s = 0;
        while (s < k && acc.id[s] !== id) s++;
        if (s === k) (acc.id[k] = id), (acc.w[k++] = 0);
        acc.w[s] += w;
      }
      for (let j = 0; j < 4; j++) {
        si.push(j < k ? acc.id[j] : 0);
        sw.push(j < k ? acc.w[j] : 0);
      }
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(base + ix[i]);
    base += P.count;
  }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), si: Uint16Array.from(si), sw: Float32Array.from(sw), idx: Uint32Array.from(idx), boneMap: map, old };
}

// Vertex clustering: everything inside one grid cell becomes one vertex (positions and normals
// averaged, skin weights summed and cut to the four strongest). Crude, and fine from 20 m away.
function cluster(src, cell) {
  const n = src.pos.length / 3;
  const ids = new Map();
  const of = new Int32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const key = (Math.floor(src.pos[i * 3] / cell) + 512) * 1048576 + (Math.floor(src.pos[i * 3 + 1] / cell) + 512) * 1024 + Math.floor(src.pos[i * 3 + 2] / cell) + 512;
    let c = ids.get(key);
    if (c === undefined) ids.set(key, (c = m++));
    of[i] = c;
  }
  const pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), cnt = new Uint32Array(m);
  const sk = Array.from({ length: m }, () => new Map());
  for (let i = 0; i < n; i++) {
    const c = of[i];
    cnt[c]++;
    for (let k = 0; k < 3; k++) {
      pos[c * 3 + k] += src.pos[i * 3 + k];
      nor[c * 3 + k] += src.nor[i * 3 + k];
    }
    for (let j = 0; j < 4; j++) if (src.sw[i * 4 + j] > 0) sk[c].set(src.si[i * 4 + j], (sk[c].get(src.si[i * 4 + j]) || 0) + src.sw[i * 4 + j]);
  }
  const si = new Uint16Array(m * 4), sw = new Float32Array(m * 4);
  for (let c = 0; c < m; c++) {
    for (let k = 0; k < 3; k++) pos[c * 3 + k] /= cnt[c];
    const l = Math.hypot(nor[c * 3], nor[c * 3 + 1], nor[c * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) nor[c * 3 + k] /= l;
    const top = [...sk[c]].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([id, w], j) => {
      si[c * 4 + j] = id;
      sw[c * 4 + j] = w / tot;
    });
  }
  const idx = [];
  for (let i = 0; i < src.idx.length; i += 3) {
    const a = of[src.idx[i]], b = of[src.idx[i + 1]], c = of[src.idx[i + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return { pos, nor, si, sw, idx: Uint32Array.from(idx) };
}

// ---------- human accessories ----------

const unit = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20, 1, false),
  tube: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
};
const sph = (ps, pl, ts, tl) => new THREE.SphereGeometry(1, 16, 10, ps, pl, ts, tl);

function humanVariant(name) {
  const m = new Mesher();
  const NAVY = lin(0x0f1a3a), SILVER = lin(0xc8cdd2), HIVIS = lin(0xc6d81c), BLACK = lin(0x0b0b0d), GOLD = lin(0xd9b13a);
  // Hood or head scarf: a cap over the crown plus a back and side piece with the face left open.
  const wrapHead = (part, rx, ry, rz, open, y) => {
    const t = mat4(0, y, -0.005, rx, ry, rz);
    m.shell(sph(0, TAU, 0, 1.1), t, B.head, part);
    m.shell(sph(Math.PI / 2 + open, TAU - 2 * open, 1.1, 1.3), t, B.head, part);
  };
  const cap = (part, col, y = 1.705) => {
    m.shell(sph(0, TAU, 0, Math.PI / 2), mat4(0, y, 0.003, 0.106, 0.105, 0.128), B.head, part, col);
    m.add(unit.sphere, mat4(0, y + 0.002, 0.135, 0.078, 0.008, 0.072, 0.22), B.head, 6);
  };
  switch (name) {
    case 'hood':
      wrapHead(2, 0.113, 0.175, 0.146, 1.0, 1.665);
      m.add(new THREE.TorusGeometry(0.1, 0.034, 8, 20), mat4(0, 1.49, -0.02, 1, 1.15, 1, Math.PI / 2), B.neck, 2);
      m.add(unit.box, mat4(0, 1.1, 0.135, 0.22, 0.09, 0.05), B.spine, 7);
      break;
    case 'beanie':
      m.shell(sph(0, TAU, 0, Math.PI / 2 + 0.15), mat4(0, 1.7, 0.0, 0.104, 0.12, 0.127), B.head, 3);
      m.add(new THREE.TorusGeometry(0.106, 0.014, 6, 24), mat4(0, 1.69, 0.0, 1, 1.2, 1, Math.PI / 2), B.head, 7);
      break;
    case 'cap':
      cap(3);
      break;
    case 'scarf':
      wrapHead(3, 0.108, 0.16, 0.14, 0.9, 1.68);
      m.add(unit.sphere, mat4(0, 1.53, 0.07, 0.03), B.head, 3);
      break;
    case 'bag': {
      // Hangs from the right hand: beyond the fingertips in the T-pose is below the hand in a walk.
      m.add(unit.box, mat4(-1.0, 1.4, -0.05, 0.27, 0.13, 0.22), B.rightHand, 3);
      m.add(unit.box, mat4(-0.82, 1.4, -0.05, 0.1, 0.014, 0.012), B.rightHand, 6);
      m.add(unit.box, mat4(-0.995, 1.4, -0.05, 0.14, 0.14, 0.015), B.rightHand, 7);
      break;
    }
    case 'pack':
      m.add(unit.box, mat4(0, 1.3, -0.205, 0.27, 0.34, 0.13), B.spine2, 3);
      m.add(unit.box, mat4(0, 1.43, -0.215, 0.2, 0.08, 0.12), B.spine2, 7);
      break;
    case 'cop': {
      // The cap is navy with a flat top, a black visor and a badge.
      cap(1, NAVY, 1.715);
      m.add(unit.cyl, mat4(0, 1.752, 0.005, 0.108, 0.045, 0.13), B.head, 1, NAVY);
      m.add(unit.sphere, mat4(0, 1.735, 0.138, 0.012), B.head, 1, GOLD);
      // Reflective vest, belt, holster and radio.
      m.shell(unit.tube, mat4(0, 1.24, 0.01, 0.18, 0.36, 0.145), B.spine1, 1, HIVIS);
      for (const y of [1.13, 1.3]) m.add(unit.tube, mat4(0, y, 0.01, 0.185, 0.035, 0.15), B.spine1, 1, SILVER);
      for (const x of [-0.07, 0.07]) {
        m.add(unit.box, mat4(x, 1.24, 0.148, 0.03, 0.3, 0.01), B.spine1, 1, SILVER);
        m.add(unit.box, mat4(x, 1.24, -0.127, 0.03, 0.3, 0.01), B.spine1, 1, SILVER);
      }
      m.add(unit.cyl, mat4(0, 0.99, 0.01, 0.178, 0.05, 0.145), B.hips, 1, BLACK);
      m.add(unit.box, mat4(-0.19, 0.92, 0.0, 0.05, 0.13, 0.08), B.hips, 1, BLACK);
      m.add(unit.box, mat4(0.11, 1.34, 0.157, 0.045, 0.08, 0.03), B.spine2, 1, BLACK);
      break;
    }
  }
  return m.raw();
}

// ---------- materials ----------

const FADE_GLSL = /* glsl */ `
if (uFade < 0.999) {
  float d = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (d > uFade) discard;
}`;

function patchFade(shader, u) {
  shader.uniforms.uFade = u;
  shader.fragmentShader = 'uniform float uFade;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FADE_GLSL);
}

// Zones are read from the bind pose (T-pose, metres, +x is the character's left).
const PAINT_GLSL = /* glsl */ `
uniform vec3 uShirt;
uniform vec3 uPants;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform vec3 uAccent;
uniform vec3 uShoe;
uniform vec4 uCloth; // sleeve end |x|, hem height, stripes, hair length
varying vec3 vBind;
varying float vPart;
float gRough = 0.85;
vec3 paintActor(vec3 fixedCol) {
  vec3 p = vBind;
  float ax = abs(p.x), y = p.y, z = p.z;
  if (vPart > 0.5) {
    gRough = 0.75;
    if (vPart < 1.5) return fixedCol;
    if (vPart < 2.5) return uShirt;
    if (vPart < 3.5) return uAccent;
    if (vPart < 4.5) return uPants;
    if (vPart < 5.5) return uHair;
    if (vPart < 6.5) return uShoe;
    return uShirt * 0.62;
  }
  vec3 c;
  float stripe = 1.0 - uCloth.z * 0.42 * step(0.5, fract(y * 15.0));
  if (ax > 0.19 && y > 1.27) {
    if (ax < uCloth.x) c = uShirt * stripe;
    else { c = uSkin; gRough = 0.6; }
    if (ax > uCloth.x - 0.03 && ax < uCloth.x) c = uShirt * 0.8;
  } else if (y > 1.505) {
    c = uSkin;
    gRough = 0.6;
    bool hair = y > 1.73 || (z < -0.035 && y > 1.60 - 0.1 * uCloth.w) || (ax > 0.07 && y > 1.69 && z < 0.03);
    if (hair) { c = uHair; gRough = 0.8; }
    if (z > 0.05) {
      vec2 e = vec2((ax - 0.031) / 0.0105, (y - 1.661) / 0.0075);
      if (dot(e, e) < 1.0) c = vec3(0.02);
      if (abs(y - 1.688) < 0.0035 && ax > 0.016 && ax < 0.05) c = uHair;
      if (abs(y - 1.6) < 0.003 && ax < 0.02) c = uSkin * 0.55;
    }
  } else if (y > 0.985) {
    c = uShirt * stripe;
  } else if (y > 0.955) {
    c = uPants * 0.45;
  } else if (y < 0.095) {
    c = uShoe;
  } else if (y < uCloth.y) {
    c = uSkin;
    gRough = 0.6;
  } else {
    c = uPants;
  }
  return c * 0.8;
}`;

function humanMaterial(onMaterial) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true });
  const u = {
    uShirt: { value: new THREE.Color() }, uPants: { value: new THREE.Color() }, uSkin: { value: new THREE.Color() }, uHair: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() }, uShoe: { value: new THREE.Color() }, uCloth: { value: new THREE.Vector4() }, uFade: { value: 1 },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying vec3 vBind;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;\nvPart = aPart;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PAINT_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = paintActor(vColor.rgb);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
    patchFade(shader, u.uFade);
  };
  mat.customProgramCacheKey = () => 'actors-human-v1';
  onMaterial?.(mat);
  return mat;
}

function paintHuman(mat, p) {
  const u = mat.userData.u;
  u.uShirt.value.set(p.shirt);
  u.uPants.value.set(p.pants);
  u.uSkin.value.set(p.skin);
  u.uHair.value.set(p.hair);
  u.uAccent.value.set(p.accent);
  u.uShoe.value.set(p.shoe);
  u.uCloth.value.set(p.sleeve, p.hem, p.stripe, p.hairBack);
  mat.userData.params = p;
}

const SKIN = [0xe8b696, 0xdba88a, 0xd39a78, 0xc08560, 0xa86f4b, 0x8a5636, 0x6b4029];
const HAIR = [0x17120f, 0x2b1d14, 0x3b2a1e, 0x6b4a2e, 0xa57d43, 0xc9a560, 0x8a8a8a, 0xd4d4d4, 0x6e2a16];
const SHIRTS = [0xd9534f, 0x2f6fb3, 0xefe2a8, 0x4a9d5b, 0xe8b23a, 0xb04a9a, 0xf2f2f2, 0x5b5f66, 0xe07b39, 0x2d3e63, 0x7fb7c9, 0xc9a7d8, 0x8a2f2f, 0x1f8a70, 0x9aa64b];
const PANTS = [0x2b3a55, 0x3f5f8a, 0x1c1c1f, 0x6b5a47, 0xb9a98c, 0x555a60, 0x7a2f3a, 0xdcd4c0, 0x3d4a3a];
const SKIRTS = [0x7a2f3a, 0x2d3e63, 0x1c1c1f, 0x8a6a3a, 0x5b3a6a, 0x3f6f5f];
const ACCENTS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0x16a085, 0xecf0f1, 0x34495e];
const SHOES = [0x111114, 0x2a2118, 0xe8e8e8, 0x4a3a2a, 0x2c3e50];
const THUG_TOP = [0x2b2d33, 0x353a44, 0x3a4256, 0x2f4436, 0x4a3535, 0x3d3d3d];
const THUG_PANTS = [0x1f2126, 0x33363d, 0x444852, 0x2f3a55];

function humanParams(kind, rng) {
  const skin = pick(rng, SKIN);
  if (kind === 'thug') return { shirt: pick(rng, THUG_TOP), pants: pick(rng, THUG_PANTS), skin, hair: pick(rng, HAIR), accent: pick(rng, [0x101010, 0x1c1c22, 0x5c1a1a, 0x1a2a4a]), shoe: rng() < 0.5 ? 0xe4e4e4 : 0x111114, sleeve: 0.7, hem: 0.09, stripe: 0, hairBack: rng() };
  if (kind === 'cop') return { shirt: 0x1e2f5c, pants: 0x131c3a, skin, hair: pick(rng, HAIR.slice(0, 5)), accent: 0x0d1733, shoe: 0x0b0b0d, sleeve: rng() < 0.25 ? 0.33 : 0.7, hem: 0.09, stripe: 0, hairBack: 0.2 };
  const skirt = rng() < 0.22, shorts = !skirt && rng() < 0.08;
  return { shirt: pick(rng, SHIRTS), pants: skirt ? pick(rng, SKIRTS) : pick(rng, PANTS), skin, hair: pick(rng, HAIR), accent: pick(rng, ACCENTS), shoe: pick(rng, SHOES), sleeve: rng() < 0.35 ? 0.33 : 0.7, hem: skirt ? 0.5 : shorts ? 0.55 : 0.09, stripe: rng() < 0.12 ? 1 : 0, hairBack: rng() };
}

const VARIANTS = {
  thug: [['hood', 3], ['beanie', 1]],
  cop: [['cop', 1]],
  civilian: [['plain', 10], ['cap', 2], ['beanie', 1], ['scarf', 2], ['bag', 3], ['pack', 2]],
};
const POOL = { thug: 10, cop: 4, civilian: 40 }; // outfits per kind, shared by the actors of that kind

// ---------- dogs and bears ----------

const FUR = {
  dog: [0xb08850, 0x6b4a2b, 0x3a3532, 0x8a8a84, 0xb5a687, 0x94572a],
  bear: [0x7a5535, 0x6b4a2e, 0x8a6240, 0x5a3f28],
};

// Proportions in metres, x sideways, y up, z forward, standing on y = 0. Ellipsoids are
// [x, y, z, rx, ry, rz]. `scaleTo` rescales the whole animal so its highest point is that tall.
const QUAD = {
  dog: {
    body: [[0, 0.5, 0, 0.13, 0.155, 0.32], [0, 0.505, 0.19, 0.14, 0.17, 0.17], [0, 0.49, -0.2, 0.125, 0.15, 0.16]],
    neck: [[0, 0.57, 0.31], [0, 0.67, 0.42], 0.06, 0.055],
    head: [0, 0.685, 0.47, 0.072, 0.078, 0.095],
    snout: [0, 0.655, 0.585, 0.042, 0.038, 0.07],
    nose: [0, 0.667, 0.655, 0.02],
    eye: [0.04, 0.705, 0.53, 0.011],
    ear: { x: 0.05, y: 0.75, z: 0.43, h: 0.09, r: 0.036, tilt: 0.45 },
    fore: { x: 0.085, y: 0.43, z: 0.2, up: 0.21, r: [0.058, 0.04, 0.03], paw: [0.036, 0.024, 0.055] },
    hind: { x: 0.085, y: 0.44, z: -0.23, up: 0.22, r: [0.066, 0.042, 0.03], paw: [0.036, 0.024, 0.055] },
    tail: { from: [0, 0.58, -0.3], mid: [0, 0.68, -0.44], to: [0, 0.8, -0.44], r: [0.026, 0.02, 0.012] },
    stride: 0.95, walkSwing: 0.45, runSwing: 0.85, knee: 0.9, bob: 0.02, wag: 7,
  },
  bear: {
    scaleTo: 1.4,
    body: [[0, 0.9, 0, 0.36, 0.38, 0.8], [0, 0.86, 0.46, 0.35, 0.38, 0.38], [0, 0.85, -0.5, 0.33, 0.35, 0.36], [0, 1.05, 0.42, 0.3, 0.3, 0.34]],
    neck: [[0, 0.95, 0.6], [0, 0.98, 0.88], 0.21, 0.19],
    head: [0, 0.98, 1.0, 0.19, 0.18, 0.22],
    snout: [0, 0.92, 1.2, 0.09, 0.08, 0.13],
    nose: [0, 0.94, 1.325, 0.035],
    eye: [0.09, 1.02, 1.12, 0.018],
    ear: { x: 0.13, y: 1.13, z: 0.94, h: 0.05, r: 0.05, tilt: 0, round: true },
    fore: { x: 0.2, y: 0.72, z: 0.5, up: 0.38, r: [0.12, 0.095, 0.075], paw: [0.085, 0.045, 0.14] },
    hind: { x: 0.2, y: 0.72, z: -0.5, up: 0.38, r: [0.13, 0.1, 0.075], paw: [0.085, 0.045, 0.14] },
    tail: { from: [0, 0.92, -0.82], mid: [0, 0.92, -0.9], to: [0, 0.9, -0.95], r: [0.06, 0.05, 0.04] },
    stride: 1.7, walkSwing: 0.4, runSwing: 0.65, knee: 0.7, bob: 0.03, wag: 2,
  },
};
const Q = { body: 0, head: 1, tail1: 2, tail2: 3, flU: 4, flL: 5, frU: 6, frL: 7, hlU: 8, hlL: 9, hrU: 10, hrL: 11 };

function quadModel(name) {
  const S = QUAD[name];
  const m = new Mesher();
  const white = [1, 1, 1], dark = [0.08, 0.08, 0.08], ear = [0.62, 0.62, 0.62], paw = [0.82, 0.82, 0.82], muzzle = [0.9, 0.86, 0.8];
  const k = S.scaleTo ? S.scaleTo / Math.max(...S.body.map((e) => e[1] + e[4])) : 1;
  const ell = (e, bone, col) => m.add(unit.sphere, mat4(e[0], e[1], e[2], e[3], e[4], e[5]), bone, 1, col);
  S.body.forEach((e) => ell(e, Q.body, white));
  m.limb(S.neck[0], S.neck[1], S.neck[2], S.neck[3], Q.body, 1, white, 10);
  ell(S.head, Q.head, white);
  ell(S.snout, Q.head, muzzle);
  ell([S.nose[0], S.nose[1], S.nose[2], S.nose[3], S.nose[3], S.nose[3]], Q.head, dark);
  for (const sx of [-1, 1]) {
    ell([S.eye[0] * sx, S.eye[1], S.eye[2], S.eye[3], S.eye[3], S.eye[3]], Q.head, dark);
    const e = S.ear;
    if (e.round) ell([e.x * sx, e.y, e.z, e.r, e.r, e.r * 0.6], Q.head, ear);
    else m.add(new THREE.ConeGeometry(e.r, e.h, 8), mat4(e.x * sx, e.y, e.z, 1, 1, 1, e.tilt * -0.4, 0, -e.tilt * sx), Q.head, 1, ear);
  }
  // Legs: an upper and a lower rod per leg, hinged at the hip and the knee.
  const legs = [['fl', S.fore, 1, Q.flU, Q.flL], ['fr', S.fore, -1, Q.frU, Q.frL], ['hl', S.hind, 1, Q.hlU, Q.hlL], ['hr', S.hind, -1, Q.hrU, Q.hrL]];
  const bones = [{ name: 'body', parent: -1, at: [0, S.fore.y, 0] }, { name: 'head', parent: 0, at: [S.neck[1][0], S.neck[1][1], S.neck[1][2]] }, { name: 'tail1', parent: 0, at: S.tail.from }, { name: 'tail2', parent: 2, at: S.tail.mid }];
  for (const [n, L, sx, up, low] of legs) {
    const hip = [L.x * sx, L.y, L.z], knee = [L.x * sx, L.y - L.up, L.z];
    m.limb(hip, knee, L.r[0], L.r[1], up, 1, white);
    m.limb(knee, [knee[0], 0.02, knee[2]], L.r[1], L.r[2], low, 1, white);
    ell([knee[0], 0.02, knee[2] + L.paw[2] * 0.4, L.paw[0], L.paw[1], L.paw[2]], low, paw);
    bones.push({ name: n + 'U', parent: 0, at: hip }, { name: n + 'L', parent: bones.length, at: knee });
  }
  // Tail in two rods.
  m.limb(S.tail.from, S.tail.mid, S.tail.r[0], S.tail.r[1], Q.tail1, 1, white);
  m.limb(S.tail.mid, S.tail.to, S.tail.r[1], S.tail.r[2], Q.tail2, 1, white);
  const raw = m.raw();
  for (let i = 0; i < raw.pos.length; i++) raw.pos[i] *= k;
  for (const b of bones) b.at = b.at.map((v) => v * k);
  const g = assemble(null, raw);
  g.computeBoundingBox();
  const h = g.boundingBox.max.y;
  const inverses = bones.map((b) => new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]));
  return { S, geometry: g, bones, inverses, height: h, sphere: new THREE.Sphere(new THREE.Vector3(0, h * 0.5, 0), Math.max(h, g.boundingBox.max.z - g.boundingBox.min.z) * 0.8), k };
}

function quadMaterial(onMaterial) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true });
  const u = { uFade: { value: 1 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => patchFade(shader, u.uFade);
  mat.customProgramCacheKey = () => 'actors-quad-v1';
  onMaterial?.(mat);
  return mat;
}

// ---------- walkable ways ----------

// Footways and pedestrian streets from the road data, plus a pavement strip beside every street,
// read from the city's minimap cells (they keep every road of every loaded chunk).
class Paths {
  constructor(city) {
    this.city = city;
    this.cells = new Map();
    this.cand = [];
  }

  entry(key) {
    const c = this.city.mmCells.get(key);
    let e = this.cells.get(key);
    const n = c ? c.r.length : 0;
    const last = n ? c.r[n - 1] : null;
    if (e && e.n === n && e.last === last) return e;
    const segs = [];
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < n; i++) {
      const r = c.r[i], p = r.pts;
      if (r.cls === 'river' || p.length < 4) continue;
      const kind = r.cls === 'road' ? 0 : 1;
      const side = r.cls === 'road' ? r.w / 2 + (r.major ? 2 : 1.3) : 0;
      for (let j = 0; j + 3 < p.length; j += 2) {
        const len = Math.hypot(p[j + 2] - p[j], p[j + 3] - p[j + 1]);
        if (len < 0.5) continue;
        segs.push(p[j], p[j + 1], p[j + 2], p[j + 3], kind, side, r.w, len);
        minx = Math.min(minx, p[j], p[j + 2]);
        maxx = Math.max(maxx, p[j], p[j + 2]);
        minz = Math.min(minz, p[j + 1], p[j + 3]);
        maxz = Math.max(maxz, p[j + 1], p[j + 3]);
      }
    }
    e = { n, last, segs, minx, maxx, minz, maxz };
    this.cells.set(key, e);
    return e;
  }

  // Is (x, z) on the carriageway of some street?
  onRoad(x, z) {
    for (let cx = Math.floor(x / 200) - 2; cx <= Math.floor(x / 200) + 2; cx++) {
      for (let cz = Math.floor(z / 200) - 2; cz <= Math.floor(z / 200) + 2; cz++) {
        const s = this.entry(cx * 1000 + cz).segs;
        for (let i = 0; i < s.length; i += 8) {
          if (s[i + 4]) continue;
          const h = s[i + 6] / 2 - 0.3;
          if ((x < s[i] - h && x < s[i + 2] - h) || (x > s[i] + h && x > s[i + 2] + h) || (z < s[i + 1] - h && z < s[i + 3] - h) || (z > s[i + 1] + h && z > s[i + 3] + h)) continue;
          const dx = s[i + 2] - s[i], dz = s[i + 3] - s[i + 1];
          const t = clamp(((x - s[i]) * dx + (z - s[i + 1]) * dz) / (dx * dx + dz * dz), 0, 1);
          if (Math.hypot(x - s[i] - dx * t, z - s[i + 1] - dz * t) < h) return true;
        }
      }
    }
    return false;
  }

  // A random spot within r of (x, z) on a footway or beside a street that `ok` accepts, or null.
  sample(x, z, r, rng, ok, out) {
    const cand = this.cand;
    cand.length = 0;
    let total = 0;
    const R = r + 460;
    for (let cx = Math.floor((x - R) / 200); cx <= Math.floor((x + R) / 200); cx++) {
      for (let cz = Math.floor((z - R) / 200); cz <= Math.floor((z + R) / 200); cz++) {
        const e = this.entry(cx * 1000 + cz);
        if (!e.segs.length || e.minx > x + r || e.maxx < x - r || e.minz > z + r || e.maxz < z - r) continue;
        const s = e.segs;
        for (let i = 0; i < s.length; i += 8) {
          // Interval of the segment inside the circle.
          const dx = s[i + 2] - s[i], dz = s[i + 3] - s[i + 1], fx = s[i] - x, fz = s[i + 1] - z;
          const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
          const disc = b * b - 4 * a * c;
          if (disc <= 0) continue;
          const sq = Math.sqrt(disc);
          const t0 = Math.max(0, (-b - sq) / (2 * a)), t1 = Math.min(1, (-b + sq) / (2 * a));
          if (t1 <= t0) continue;
          const w = (t1 - t0) * s[i + 7] * (s[i + 4] ? 3 : 1);
          total += w;
          cand.push(s, i, t0, t1, total);
        }
      }
    }
    for (let attempt = 0; attempt < 12 && cand.length; attempt++) {
      const pickW = rng() * total;
      let k = 0;
      while (k < cand.length - 5 && cand[k + 4] < pickW) k += 5;
      const s = cand[k], i = cand[k + 1];
      const t = cand[k + 2] + rng() * (cand[k + 3] - cand[k + 2]);
      const dx = s[i + 2] - s[i], dz = s[i + 3] - s[i + 1], len = s[i + 7];
      const nx = -dz / len, nz = dx / len;
      let off;
      if (s[i + 4]) off = (rng() - 0.5) * Math.min(s[i + 6], 4) * 0.6;
      else off = (rng() < 0.5 ? 1 : -1) * (s[i + 5] + (rng() - 0.5) * 0.6);
      const px = s[i] + dx * t + nx * off, pz = s[i + 1] + dz * t + nz * off;
      if (Math.hypot(px - x, pz - z) > r || !ok(px, pz)) continue;
      out.x = px;
      out.z = pz;
      return out;
    }
    return null;
  }
}

// ---------- the actors ----------

const _cp = {};
const _near = [];
const _yAxis = new THREE.Vector3(0, 1, 0);

class Actor {
  constructor(mgr, id, kind, K) {
    this.mgr = mgr;
    this.id = id;
    this.kind = kind;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = K.hp;
    this.maxHp = K.hp;
    this.state = 'idle';
    this.stunT = 0;
    this.tied = false;
    this.mesh = null;
    this.radius = K.radius;
    this.height = 1.8;
    this.speed = 0;
    this.removed = false;
    this.persist = false;
    this.hasGoal = false;
    this.goal = { x: 0, z: 0, speed: 0 };
    this.obst = [];
    this.ox = 1e9;
    this.oz = 1e9;
    this.ot = 0;
    this.side = 1;
    this.follow = 0;
    this.goalT = 0;
    this.goalMax = 0;
    this.stuck = 0;
    this.path = null; // waypoints [x, z, ...] round obstacles, from the planner
    this.pathI = 0;
    this.needPlan = false;
    this.checkLine = false;
    this.plans = 0;
    this.planT = -9;
    this.best = Infinity;
    this.bestT = 0;
    this.acc = 0;
    this.lod = -1;
    this.attached = false;
    this.downT = 0;
    this.fall = 0;
    this.fallDir = 1;
    this.flinch = 0;
    this.phase = 0;
    this.rope = null;
    this.lie = 0;
  }

  // Lowers hp; at zero the actor falls. Returns false if it was already down or gone.
  hit(dmg, by) {
    return this.mgr.hit(this, dmg, by);
  }

  // Dazed for t seconds: stops and ignores walkTo. Returns false if it cannot be stunned.
  stun(t = 2) {
    return this.mgr.stun(this, t);
  }

  // Ties it up where it stands (any live state; the combat rules decide when this is allowed).
  tie() {
    return this.mgr.tie(this);
  }

  remove() {
    this.mgr.remove(this);
  }
}

export class Actors {
  static async load(url, scene, city, opts) {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Actors(scene, city, gltf, opts);
  }

  constructor(scene, city, gltf, opts = {}) {
    this.scene = scene;
    this.city = city;
    this.events = opts.events || null; // {emit(name, payload)}; falls back to window.__game.events
    this.onMaterial = opts.onMaterial || null; // called for every material created (shadow setup)
    this.rng = opts.rng || mulberry32(opts.seed ?? 20260929);
    this.list = [];
    this.max = opts.max ?? 120;
    this.nextId = 1;
    this.time = 0;
    this.center = null;
    this.paths = new Paths(city);
    this.pools = { human: [], dog: [], bear: [] };
    this.outfits = { thug: [], cop: [], civilian: [] };
    this.ghosts = { human: [], quad: [] };
    this.varGeo = new Map();
    this.quad = {};
    this.stat = { spawned: 0, culled: 0, rigs: 0 };
    this.crowd = new Map(); // 2.5 m cells of the actors that can be walked into, rebuilt every update
    this._spot = { x: 0, z: 0 };
    this.planBudget = 1;
    this.lineBudget = 6;

    // Human assets: compact skeleton, merged body in three levels of detail, trimmed clips.
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const arm = root.getObjectByName('Armature');
    this.tpl = {
      arm: { p: arm.position.clone(), q: arm.quaternion.clone(), s: arm.scale.clone() },
      bones: [],
      inverses: [],
    };
    const body = bodyArrays(gltf);
    const oldBones = body.old;
    const inv = root.getObjectByProperty('isSkinnedMesh', true).skeleton.boneInverses;
    BONES.forEach((n) => {
      const b = root.getObjectByName(n);
      let p = b.parent;
      while (p && !BONES.includes(p.name)) p = p.parent;
      this.tpl.bones.push({ name: n, parent: p ? BONES.indexOf(p.name) : -1, p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
      this.tpl.inverses.push(inv[oldBones.indexOf(b)].clone());
    });
    this.bodyLod = CLUSTER.map((c) => (c ? cluster(body, c) : body));
    this.clips = {};
    const keepTrack = new Set(BONES);
    const trim = (name) => {
      const c = gltf.animations.find((a) => a.name === name);
      const tracks = c.tracks.filter((t) => {
        const [bone, prop] = t.name.split('.');
        return keepTrack.has(bone) && (prop === 'quaternion' || (prop === 'position' && bone === 'mixamorigHips'));
      });
      return new THREE.AnimationClip(name, c.duration, tracks);
    };
    this.clips = { idle: trim('idle'), walk: trim('walk'), run: trim('run'), pose: trim('sad_pose') };
    this.ropeGeo = new THREE.TorusGeometry(1, 0.05, 6, 24);
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0xece5d2, roughness: 0.9 });
    this.onMaterial?.(this.ropeMat);
  }

  // ---------- public API ----------

  // Add an actor of kind 'thug', 'cop', 'civilian', 'dog' or 'bear' at {x, z}. Options: yaw, hp,
  // persist (never culled or evicted), exact (skip the search for a free spot), scale (height
  // factor), variant (thug: 'hood' | 'beanie'; civilian: 'plain' | 'cap' | 'beanie' | 'scarf' |
  // 'bag' | 'pack'), fur (dog and bear colour). Returns null when the cap is reached with nobody
  // far enough to make room for, or when there is no free spot within 12 m.
  spawn(kind, at, opts = {}) {
    const K = KINDS[kind];
    if (!K) throw new Error(`unknown actor kind "${kind}"`);
    if (this.list.length >= this.max && !this._makeRoom(at)) return null;
    let x = at.x, z = at.z;
    if (!opts.exact) {
      const p = this._freeSpot(x, z, K.radius);
      if (!p) return null;
      (x = p.x), (z = p.z);
    }
    const a = new Actor(this, this.nextId++, kind, K);
    a.K = K;
    a.persist = !!opts.persist;
    if (opts.hp) a.hp = a.maxHp = opts.hp;
    a.pos.set(x, this.groundAt(x, z), z);
    a.yaw = opts.yaw ?? this.rng() * TAU;
    a.speedWalk = K.walk;
    a.speedRun = K.run;
    if (K.rig === 'human') this._dressHuman(a, opts);
    else this._dressQuad(a, opts);
    a.mesh = a.rig.group;
    a.acc = this.rng() / 15;
    this.list.push(a);
    this.stat.spawned++;
    const d = this.center ? Math.hypot(x - this.center.x, z - this.center.z) : 0;
    if (d < HIDE) this._attach(a);
    this._lod(a, d);
    this._animate(a, 0.0001);
    this._pose(a);
    return a;
  }

  // Actors within r of pos (a point or anything with x, y, z), nearest first, optionally filtered.
  near(pos, r, filter) {
    const out = [];
    const y = pos.y ?? 0;
    for (const a of this.list) {
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z, dy = a.pos.y + a.height * 0.5 - y;
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (d <= r && (!filter || filter(a))) out.push([d, a]);
    }
    return out.sort((p, q) => p[0] - q[0]).map((e) => e[1]);
  }

  // Head for (x, z) at `speed` m/s, around buildings and water. Returns false if the actor cannot
  // walk now (down, tied, stunned). The state turns 'walk' or 'run' by speed and 'idle' on arrival.
  walkTo(a, x, z, speed) {
    if (a.removed || a.state === 'down' || a.tied || a.stunT > 0) return false;
    const g = a.goal;
    const moved = !a.hasGoal || Math.hypot(x - g.x, z - g.z) > 2;
    g.x = x;
    g.z = z;
    g.speed = speed ?? a.speedWalk;
    a.hasGoal = true;
    if (moved) {
      // Give up after a fair time: four times the straight walk, plus ten seconds.
      a.goalT = 0;
      a.goalMax = 10 + (4 * Math.hypot(x - a.pos.x, z - a.pos.z)) / Math.max(g.speed, 0.5);
      a.stuck = 0;
      a.path = null;
      a.plans = 0;
      a.best = Infinity;
      // Whether the straight line runs through a building or water is looked at on the next step
      // (a few per update), and if so it is planned round.
      a.needPlan = false;
      a.checkLine = this.time - a.planT > 1.5;
    }
    return true;
  }

  // A spot within r of pos on a footway, a pedestrian street or the pavement beside a street.
  randomWalkPoint(pos, r = 40) {
    const spot = this.paths.sample(pos.x, pos.z, r, this.rng, (px, pz) => !this.blocked(px, pz, 0.4) && !this.paths.onRoad(px, pz), {});
    if (spot) return spot;
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * TAU, d = Math.sqrt(this.rng()) * r;
      const x = pos.x + Math.sin(a) * d, z = pos.z + Math.cos(a) * d;
      if (!this.blocked(x, z, 0.4)) return { x, z };
    }
    return { x: pos.x, z: pos.z };
  }

  // Water for a walker: a lake or, where the city draws rivers as ribbons, a river that no bridge crosses. // terrain:
  wet(x, z) {
    return this.city.isWater(x, z) || !!this.city.isRiver?.(x, z);
  }

  // True if a body of radius r at (x, z) would be in water or overlap a building footprint.
  blocked(x, z, r = 0.35) {
    if (this.wet(x, z)) return true;
    const gy = this.groundAt(x, z);
    for (const b of this.city.nearby(x, z, r + 1, _near)) {
      if (!this._solid(b, gy)) continue;
      if (x < b.minx - r || x > b.maxx + r || z < b.minz - r || z > b.maxz + r) continue;
      if (pointInPrism2D(x, z, b) || closestOnPrism(x, z, b, _cp).d < r) return true;
    }
    return false;
  }

  groundAt(x, z) {
    return this.city.groundAt?.(x, z) ?? 0;
  }

  // Does this prism stand in the way of a walker whose feet are at height `gy`? Roof props, floating
  // parts and anything lower than a step do not.
  _solid(b, gy) {
    return b.kind !== 'prop' && b.y0 < gy + 2.5 && b.y1 > gy + 0.9;
  }

  update(dt, player) {
    this.time += dt;
    this.planBudget = 1; // one path plan and a few line checks per update keep a crowd from stalling a frame
    this.lineBudget = 6;
    const px = player.pos.x, pz = player.pos.z;
    if (!this.center) this.center = new THREE.Vector3();
    this.center.set(px, 0, pz);
    this.crowd.clear();
    for (const a of this.list) {
      if (a.state === 'down' || (a.pos.x - px) ** 2 + (a.pos.z - pz) ** 2 > SLOW * SLOW) continue;
      const k = Math.floor(a.pos.x / 2.5) * 100003 + Math.floor(a.pos.z / 2.5);
      const l = this.crowd.get(k);
      if (l) l.push(a);
      else this.crowd.set(k, [a]);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      const dx = a.pos.x - px, dz = a.pos.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > CULL * CULL && !a.persist) {
        this.stat.culled++;
        this.remove(a);
        continue;
      }
      if (d2 > HIDE * HIDE) {
        if (a.attached) this._detach(a);
        continue;
      }
      if (!a.attached) this._attach(a);
      const every = d2 < FULL * FULL ? 0 : d2 < SLOW * SLOW ? 1 / 15 : 1 / 7.5;
      a.acc += dt;
      if (a.acc < every) continue;
      const h = Math.min(a.acc, 0.25);
      a.acc = 0;
      const dist = Math.sqrt(d2);
      this._lod(a, dist);
      this._think(a, h);
      if (a.removed) continue;
      this._animate(a, h);
      this._pose(a);
    }
  }

  remove(a) {
    if (a.removed) return;
    a.removed = true;
    this._detach(a);
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    if (a.rope) {
      a.rope.parent.remove(a.rope);
      a.rope = null;
    }
    if (a.ghost) this._freeGhost(a);
    this._release(a);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.remove(this.list[i]);
  }

  // Another city (the map choice): everyone goes, the road index starts again on the new data.
  setCity(city) {
    this.clear();
    this.city = city;
    this.paths = new Paths(city);
    this.center = null;
  }

  stats() {
    const s = { total: this.list.length, attached: 0, lod: [0, 0, 0], triangles: 0, byState: {}, spawned: this.stat.spawned, culled: this.stat.culled };
    for (const a of this.list) {
      s.byState[a.state] = (s.byState[a.state] || 0) + 1;
      if (!a.attached) continue;
      s.attached++;
      if (a.lod >= 0) s.lod[a.lod]++;
      s.triangles += a.rig.body.geometry.index.count / 3;
    }
    return s;
  }

  dispose() {
    this.clear();
    for (const g of this.varGeo.values()) g.forEach((x) => x.dispose());
  }

  // ---------- state changes ----------

  bus(name, payload) {
    (this.events || window.__game?.events)?.emit?.(name, payload);
  }

  hit(a, dmg, by) {
    if (a.removed || a.state === 'down') return false;
    a.hp = Math.max(0, a.hp - dmg);
    a.flinch = 1;
    this.bus('hit', { target: a, dmg, by: by ?? null });
    if (a.hp <= 0) {
      a.state = 'down';
      a.hasGoal = false;
      a.stunT = 0;
      a.downT = 0;
      a.fallDir = this.rng() < 0.7 ? 1 : -1;
      this.bus('actor:down', { actor: a });
    }
    return true;
  }

  stun(a, t) {
    if (a.removed || a.state === 'down' || a.tied) return false;
    a.stunT = Math.max(a.stunT, t);
    a.state = 'stunned';
    a.hasGoal = false;
    return true;
  }

  tie(a) {
    if (a.removed || a.state === 'down' || a.tied) return false;
    a.tied = true;
    a.state = 'tied';
    a.hasGoal = false;
    a.stunT = 0;
    if (!a.rope) {
      // Clothesline wound round the body: rings of a unit torus, sized to the rig.
      const rope = new THREE.Group();
      const ring = (x, y, z, rx, ry, tube) => {
        const m = new THREE.Mesh(this.ropeGeo, this.ropeMat);
        m.scale.set(rx, ry, tube);
        m.position.set(x, y, z);
        m.castShadow = true;
        rope.add(m);
        return m;
      };
      if (a.K.rig === 'human') {
        for (const y of [1.1, 1.24, 1.38]) ring(0, y, 0.01, 0.19, 0.155, 0.17).rotation.x = Math.PI / 2;
      } else {
        // Round the barrel, hung on the body bone so it goes down with the animal when it lies.
        const q = a.rig.model, b = q.S.body[0];
        ring(0, b[1] * q.k - q.S.fore.y * q.k, (b[2] + b[5] * 0.25) * q.k, b[3] * q.k * 1.1, b[4] * q.k * 1.1, b[3] * q.k * 0.5);
      }
      (a.K.rig === 'human' ? a.rig.tilt : a.rig.bones[Q.body]).add(rope);
      a.rope = rope;
    }
    this.bus('actor:tied', { actor: a });
    return true;
  }

  // ---------- population ----------

  // Free a slot: drop the farthest non-persistent actor that is out of sight and farther than the
  // newcomer. Returns false if nobody qualifies.
  _makeRoom(at) {
    const c = this.center || at;
    const dNew = Math.hypot(at.x - c.x, at.z - c.z);
    let worst = null, wd = HIDE;
    for (const a of this.list) {
      const d = Math.hypot(a.pos.x - c.x, a.pos.z - c.z);
      if (!a.persist && d > wd && d > dNew) (wd = d), (worst = a);
    }
    if (!worst) return false;
    this.remove(worst);
    return true;
  }

  _freeSpot(x, z, r) {
    const s = this._spot;
    s.x = x;
    s.z = z;
    if (!this.blocked(x, z, r)) return s;
    for (const d of [1.5, 3, 5, 8, 12]) {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * TAU + d;
        s.x = x + Math.sin(ang) * d;
        s.z = z + Math.cos(ang) * d;
        if (!this.blocked(s.x, s.z, r)) return s;
      }
    }
    return null;
  }

  _attach(a) {
    if (a.attached) return;
    this.scene.add(a.rig.group);
    a.attached = true;
    a.rig.group.visible = true;
    a.lod = -1;
    this._pose(a);
  }

  _detach(a) {
    if (!a.attached) return;
    this.scene.remove(a.rig.group);
    a.attached = false;
  }

  _release(a) {
    const r = a.rig;
    a.rig = null;
    r.body.castShadow = false;
    (r.kind === 'human' ? this.pools.human : this.pools[r.kind]).push(r);
  }

  _humanRig() {
    this.stat.rigs++;
    const t = this.tpl;
    const armature = new THREE.Object3D();
    armature.position.copy(t.arm.p);
    armature.quaternion.copy(t.arm.q);
    armature.scale.copy(t.arm.s);
    armature.updateMatrix();
    const bones = t.bones.map((d) => {
      const b = new THREE.Bone();
      b.name = d.name;
      b.position.copy(d.p);
      b.quaternion.copy(d.q);
      b.scale.copy(d.s);
      return b;
    });
    t.bones.forEach((d, i) => (d.parent < 0 ? armature : bones[d.parent]).add(bones[i]));
    const tilt = new THREE.Group();
    tilt.add(armature);
    const group = new THREE.Group();
    group.add(tilt);
    const skeleton = new THREE.Skeleton(bones, t.inverses);
    const body = new THREE.SkinnedMesh(this._humanGeos('plain')[0], new THREE.MeshBasicMaterial());
    armature.add(body);
    body.bind(skeleton, new THREE.Matrix4());
    body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 90, 0), 135);
    body.receiveShadow = true;
    body.castShadow = false;
    const mixer = new THREE.AnimationMixer(tilt);
    const actions = {};
    for (const n of ['idle', 'walk', 'run', 'pose']) {
      actions[n] = mixer.clipAction(this.clips[n]);
      actions[n].play();
    }
    for (const o of [group, tilt, armature, body, ...bones]) {
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
    }
    return { kind: 'human', group, tilt, armature, body, bones, mixer, actions, w: { idle: 1, walk: 0, run: 0, pose: 0 }, on: 'idle' };
  }

  _quadRig(kind) {
    this.stat.rigs++;
    let q = this.quad[kind];
    if (!q) q = this.quad[kind] = quadModel(kind);
    const bones = q.bones.map((d) => {
      const b = new THREE.Bone();
      b.name = d.name;
      const p = d.parent >= 0 ? q.bones[d.parent].at : [0, 0, 0];
      b.position.set(d.at[0] - p[0], d.at[1] - p[1], d.at[2] - p[2]);
      return b;
    });
    q.bones.forEach((d, i) => d.parent >= 0 && bones[d.parent].add(bones[i]));
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    tilt.add(bones[0]);
    const body = new THREE.SkinnedMesh(q.geometry, new THREE.MeshBasicMaterial());
    tilt.add(body);
    body.bind(new THREE.Skeleton(bones, q.inverses), new THREE.Matrix4());
    body.boundingSphere = q.sphere;
    body.receiveShadow = true;
    for (const o of [group, tilt, body, ...bones]) {
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
    }
    return { kind, group, tilt, body, bones, model: q };
  }

  _humanGeos(variant) {
    let g = this.varGeo.get(variant);
    if (!g) {
      const extra = variant === 'plain' ? null : humanVariant(variant);
      g = this.bodyLod.map((b) => assemble(b, extra));
      this.varGeo.set(variant, g);
    }
    return g;
  }

  _outfit(kind) {
    const pool = this.outfits[kind];
    if (pool.length >= POOL[kind]) return pool[(this.rng() * pool.length) | 0];
    const mat = humanMaterial(this.onMaterial);
    paintHuman(mat, humanParams(kind, this.rng));
    pool.push(mat);
    return mat;
  }

  _dressHuman(a, opts) {
    const K = a.K;
    const rig = this.pools.human.pop() || this._humanRig();
    a.rig = rig;
    const rng = this.rng;
    let variant = opts.variant;
    if (!variant) {
      const v = VARIANTS[a.kind], tot = v.reduce((s, e) => s + e[1], 0);
      let r = rng() * tot;
      variant = v.find((e) => (r -= e[1]) < 0)[0];
    }
    a.variant = variant;
    a.geos = this._humanGeos(variant);
    a.mat = this._outfit(a.kind);
    rig.body.material = a.mat;
    rig.body.geometry = a.geos[0];
    const h = opts.scale ?? K.height[0] + rng() * (K.height[1] - K.height[0]);
    const w = h * (a.kind === 'thug' ? 0.98 + rng() * 0.14 : 0.94 + rng() * 0.1);
    rig.group.scale.set(w, h, w);
    a.height = 1.8 * h;
    a.radius = K.radius * w;
    this._resetRig(a);
  }

  _dressQuad(a, opts) {
    const K = a.K;
    const rig = this.pools[a.kind].pop() || this._quadRig(a.kind);
    a.rig = rig;
    const pool = (this.outfits[a.kind] = this.outfits[a.kind] || []);
    const fur = opts.fur ?? pick(this.rng, FUR[a.kind]);
    let mat = pool.find((m) => m.color.getHex() === new THREE.Color(fur).getHex());
    if (!mat) {
      mat = quadMaterial(this.onMaterial);
      mat.color.set(fur);
      pool.push(mat);
    }
    a.mat = mat;
    a.geos = [rig.model.geometry];
    rig.body.material = mat;
    const h = opts.scale ?? 0.95 + this.rng() * 0.1;
    rig.group.scale.setScalar(h);
    a.height = rig.model.height * h;
    a.radius = K.radius * h;
    a.speedWalk = K.walk * h;
    a.speedRun = K.run * h;
    this._resetRig(a);
  }

  _resetRig(a) {
    const r = a.rig;
    r.tilt.rotation.set(0, 0, 0);
    r.tilt.position.set(0, 0, 0);
    r.tilt.quaternion.identity();
    if (r.kind === 'human') {
      for (const n in r.w) r.w[n] = n === 'idle' ? 1 : 0;
      r.on = 'idle';
      for (const n in r.actions) {
        const act = r.actions[n];
        act.enabled = n === 'idle';
        act.time = n === 'idle' ? this.rng() * act.getClip().duration : 0;
        act.setEffectiveWeight(n === 'idle' ? 1 : 0);
      }
    } else for (const b of r.bones) b.quaternion.identity();
    a.lod = -1;
    a.mesh = r.group;
  }

  // ---------- per-step logic ----------

  _lod(a, dist) {
    const r = a.rig;
    if (a.geos.length > 1) {
      const t0 = LOD_AT[0] + (a.lod === 0 ? 2 : -2), t1 = LOD_AT[1] + (a.lod === 2 ? -2 : 2);
      const l = dist < t0 ? 0 : dist < t1 ? 1 : 2;
      if (l !== a.lod) {
        a.lod = l;
        r.body.geometry = a.geos[l];
      }
    } else a.lod = 0;
    const shadow = dist < SHADOW_AT && a.state !== 'down';
    if (r.body.castShadow !== shadow) r.body.castShadow = shadow;
  }

  _think(a, dt) {
    const K = a.K;
    if (a.flinch > 0) a.flinch = Math.max(0, a.flinch - dt * 4);
    if (a.state === 'down') {
      a.downT += dt;
      a.fall = Math.min(1, a.fall + dt / 0.55);
      this._coast(a, dt, 6);
      if (a.downT > DOWN_HOLD + DOWN_FADE) this.remove(a);
      return;
    }
    if (a.tied) {
      a.state = 'tied';
      this._coast(a, dt, 14);
      a.lie = Math.min(1, a.lie + dt * 2);
      return;
    }
    if (a.stunT > 0) {
      a.stunT -= dt;
      a.state = 'stunned';
      this._coast(a, dt, 10);
      if (a.stunT <= 0) (a.stunT = 0), (a.state = 'idle');
      return;
    }
    a.lie = Math.max(0, a.lie - dt * 3);
    if (!a.hasGoal) {
      a.state = 'idle';
      this._coast(a, dt, 9);
      return;
    }
    const g = a.goal;
    const gd = Math.hypot(g.x - a.pos.x, g.z - a.pos.z);
    if (gd < Math.max(0.5, a.radius * 1.3)) {
      this._stopGoal(a);
      this._coast(a, dt, 9);
      return;
    }
    this._refreshObstacles(a);
    if (a.checkLine && this.lineBudget > 0) {
      this.lineBudget--;
      a.checkLine = false;
      a.needPlan = this._lineBlocked(a, g.x, g.z);
    }
    if (a.needPlan && this.planBudget > 0) {
      this.planBudget--;
      this._plan(a);
    }
    // The point being steered to: the next waypoint of a plan, else the goal itself.
    let tx = g.x, tz = g.z;
    if (a.path) {
      const w = a.path;
      while (a.path && Math.hypot(w[a.pathI] - a.pos.x, w[a.pathI + 1] - a.pos.z) < 1) {
        a.best = Infinity;
        if (a.pathI + 2 < w.length) a.pathI += 2;
        else a.path = null;
      }
      if (a.path) (tx = w[a.pathI]), (tz = w[a.pathI + 1]);
    }
    const dx = tx - a.pos.x, dz = tz - a.pos.z, dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const heading = this._heading(a, want, g.speed, dt);
    const diff = wrap(heading - a.yaw);
    const turn = K.turn * dt;
    a.yaw = wrap(a.yaw + clamp(diff, -turn, turn));
    const align = Math.max(0, Math.cos(diff));
    const target = g.speed * (0.2 + 0.8 * align) * clamp(gd / 1.5, 0.35, 1);
    const acc = 8 * dt;
    a.speed += clamp(target - a.speed, -acc, acc);
    a.state = g.speed > K.runAt ? 'run' : 'walk';
    const moved = this._move(a, dt);
    a.goalT += dt;
    // No nearer to the point for three seconds, or pushing against something: plan round it, and
    // give up after three plans.
    if (dist < a.best - 0.5) (a.best = dist), (a.bestT = a.goalT);
    if (a.speed > 0.4 && moved < a.speed * dt * 0.3) a.stuck += dt;
    else a.stuck = Math.max(0, a.stuck - dt);
    if (!a.needPlan && (a.stuck > 1.5 || a.goalT - a.bestT > 3)) {
      if (a.plans >= 3) this._stopGoal(a);
      else {
        a.needPlan = true;
        a.stuck = 0;
        a.bestT = a.goalT;
      }
    }
    if (a.goalT > a.goalMax) this._stopGoal(a);
  }

  _stopGoal(a) {
    a.hasGoal = false;
    a.needPlan = a.checkLine = false;
    a.path = null;
    a.stuck = 0;
    a.state = 'idle';
  }

  // Is the straight line from the actor to (x, z) blocked by a building or water?
  _lineBlocked(a, x, z) {
    const dx = x - a.pos.x, dz = z - a.pos.z, d = Math.hypot(dx, dz) || 1;
    for (let k = 1; k * 1.2 < d + 1.2 && k < 80; k++) {
      const t = Math.min(1, (k * 1.2) / d);
      if (this.blocked(a.pos.x + dx * t, a.pos.z + dz * t, a.radius)) return true;
    }
    return false;
  }

  // A path round buildings and water: A* over a 1 m grid laid over the 96 m square around the way to
  // the goal (160 m on a retry; a goal beyond two thirds of that is planned towards), then pulled
  // straight between waypoints. A goal that cannot be reached gets the nearest point that can.
  _plan(a) {
    // The second and third tries look at a wider square, for a goal only a long way round can reach.
    const N = a.plans >= 1 ? 160 : 96, g = a.goal;
    a.needPlan = false;
    a.planT = this.time;
    a.plans++;
    a.path = null;
    let tx = g.x, tz = g.z;
    const D = Math.hypot(tx - a.pos.x, tz - a.pos.z);
    const far = N * 0.67;
    if (D > far) {
      tx = a.pos.x + ((tx - a.pos.x) * far) / D;
      tz = a.pos.z + ((tz - a.pos.z) * far) / D;
    }
    const cx = (a.pos.x + tx) / 2, cz = (a.pos.z + tz) / 2;
    const x0 = Math.round(cx) - N / 2, z0 = Math.round(cz) - N / 2;
    const grids = this._grids || (this._grids = {});
    const G = grids[N] || (grids[N] = { dil: new Uint8Array(N * N), cost: new Float32Array(N * N), from: new Int32Array(N * N) });
    const dil = G.dil;
    dil.fill(0);
    // A cell is closed when its centre is inside a footprint or in water, or nearer a wall than the
    // body plus a hand's breadth.
    // The retries also squeeze through narrower gaps than the first try would.
    const tight = a.plans > 1;
    const m = a.radius + (tight ? 0.15 : 0.45), m2 = m * m;
    const walls = [];
    for (const b of this.city.nearby(cx, cz, N * 0.75, _near)) {
      if (!this._solid(b, this.groundAt((b.minx + b.maxx) / 2, (b.minz + b.maxz) / 2)) || b.maxx < x0 - m || b.minx > x0 + N + m || b.maxz < z0 - m || b.minz > z0 + N + m) continue;
      walls.push(b);
      const i0 = Math.max(0, Math.floor(b.minx - x0)), i1 = Math.min(N - 1, Math.floor(b.maxx - x0));
      const j0 = Math.max(0, Math.floor(b.minz - z0)), j1 = Math.min(N - 1, Math.floor(b.maxz - z0));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInPrism2D(x0 + i + 0.5, z0 + j + 0.5, b)) dil[j * N + i] = 1;
      for (const ring of [b.outer, ...b.holes]) {
        for (let e = 0, n = ring.length; e < n; e += 2) {
          const ax = ring[e], az = ring[e + 1], bx = ring[(e + 2) % n], bz = ring[(e + 3) % n];
          const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4);
          for (let k = 0; k <= steps; k++) {
            const px = ax + ((bx - ax) * k) / steps, pz = az + ((bz - az) * k) / steps;
            for (let j = Math.max(0, Math.floor(pz - m - z0 - 0.5)); j <= Math.min(N - 1, Math.floor(pz + m - z0 + 0.5)); j++) {
              for (let i = Math.max(0, Math.floor(px - m - x0 - 0.5)); i <= Math.min(N - 1, Math.floor(px + m - x0 + 0.5)); i++) {
                if ((x0 + i + 0.5 - px) ** 2 + (z0 + j + 0.5 - pz) ** 2 <= m2) dil[j * N + i] = 1;
              }
            }
          }
        }
      }
    }
    // Water closes its cell and, on the first try, the cells touching it.
    const wet = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (this.wet(x0 + i + 0.5, z0 + j + 0.5)) wet.push(j * N + i);
    for (const n of wet) {
      dil[n] = 1;
      if (tight) continue;
      const ni = n % N, nj = (n / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) dil[clamp(nj + dj, 0, N - 1) * N + clamp(ni + di, 0, N - 1)] = 1;
    }
    const cell = (x, z) => clamp(Math.floor(z - z0), 0, N - 1) * N + clamp(Math.floor(x - x0), 0, N - 1);
    // The actor may already be close to a wall: open the cells round it so it can step out.
    const start = cell(a.pos.x, a.pos.z);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) dil[clamp(((start / N) | 0) + dj, 0, N - 1) * N + clamp((start % N) + di, 0, N - 1)] = 0;
    let goal = cell(tx, tz);
    if (dil[goal]) {
      // Nearest free cell to the goal.
      let best = -1, bd = 1e9;
      const gi = goal % N, gj = (goal / N) | 0;
      for (let dj = -8; dj <= 8; dj++) {
        for (let di = -8; di <= 8; di++) {
          const i = gi + di, j = gj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N || dil[j * N + i] || di * di + dj * dj >= bd) continue;
          (bd = di * di + dj * dj), (best = j * N + i);
        }
      }
      if (best < 0) return void (a.planWhy = 'goal');
      goal = best;
    }
    const gI = goal % N, gJ = (goal / N) | 0;
    const cost = G.cost, from = G.from;
    cost.fill(Infinity);
    const heap = [];
    const push = (f, n) => {
      heap.push([f, n]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top[1];
    };
    const octile = (i, j) => {
      const dx = Math.abs(i - gI), dz = Math.abs(j - gJ);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    cost[start] = 0;
    from[start] = -1;
    push(octile(start % N, (start / N) | 0), start);
    let found = false, closest = start, closestH = octile(start % N, (start / N) | 0);
    while (heap.length) {
      const n = pop();
      if (n === goal) {
        found = true;
        break;
      }
      const h = octile(n % N, (n / N) | 0);
      if (h < closestH) (closestH = h), (closest = n);
      const ni = n % N, nj = (n / N) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ni + di, j = nj + dj;
          if (i < 0 || j < 0 || i >= N || j >= N || dil[j * N + i]) continue;
          if (di && dj && (dil[nj * N + i] || dil[j * N + ni])) continue;
          // A small extra cost beside a wall keeps the route off it where there is room.
          const near = dil[j * N + Math.max(0, i - 1)] || dil[j * N + Math.min(N - 1, i + 1)] || dil[Math.max(0, j - 1) * N + i] || dil[Math.min(N - 1, j + 1) * N + i];
          const c = cost[n] + (di && dj ? Math.SQRT2 : 1) + (near ? 0.8 : 0);
          if (c < cost[j * N + i]) {
            cost[j * N + i] = c;
            from[j * N + i] = n;
            push(c + octile(i, j), j * N + i);
          }
        }
      }
    }
    // A goal that cannot be reached (a courtyard, a gap too narrow) gets the nearest point that can.
    if (!found) {
      if (closest === start) return void (a.planWhy = 'route');
      goal = closest;
      a.planWhy = 'partial';
    } else a.planWhy = 'ok';
    const cells = [];
    for (let n = goal; n >= 0; n = from[n]) cells.push(n);
    cells.reverse();
    const los = (n0, n1) => {
      const i0 = (n0 % N) + 0.5, j0 = ((n0 / N) | 0) + 0.5, i1 = (n1 % N) + 0.5, j1 = ((n1 / N) | 0) + 0.5;
      const steps = Math.ceil(Math.hypot(i1 - i0, j1 - j0) * 2);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        if (dil[Math.floor(j0 + (j1 - j0) * t) * N + Math.floor(i0 + (i1 - i0) * t)]) return false;
      }
      return true;
    };
    // The grid says a line is open; this checks it against the real outlines before trusting it.
    const rr = a.radius + (tight ? 0.12 : 0.3);
    const freeAt = (x, z) => {
      if (this.wet(x, z) || this.wet(x + rr, z) || this.wet(x - rr, z) || this.wet(x, z + rr) || this.wet(x, z - rr)) return false;
      for (const b of walls) {
        if (x < b.minx - rr || x > b.maxx + rr || z < b.minz - rr || z > b.maxz + rr) continue;
        if (pointInPrism2D(x, z, b) || closestOnPrism(x, z, b, _cp).d < rr) return false;
      }
      return true;
    };
    const exact = (n0, n1) => {
      const xa = x0 + (n0 % N) + 0.5, za = z0 + ((n0 / N) | 0) + 0.5, xb = x0 + (n1 % N) + 0.5, zb = z0 + ((n1 / N) | 0) + 0.5;
      const steps = Math.ceil(Math.hypot(xb - xa, zb - za) / 0.5);
      for (let k = 1; k < steps; k++) if (!freeAt(xa + ((xb - xa) * k) / steps, za + ((zb - za) * k) / steps)) return false;
      return true;
    };
    const way = [];
    let at = 0;
    while (at < cells.length - 1) {
      let far = at + 1;
      for (let k = Math.min(cells.length - 1, at + 40); k > at + 1; k--) {
        if (los(cells[at], cells[k]) && exact(cells[at], cells[k])) {
          far = k;
          break;
        }
      }
      at = far;
      const n = cells[at];
      way.push(x0 + (n % N) + 0.5, z0 + ((n / N) | 0) + 0.5);
    }
    // The last waypoint is the goal itself when it was reachable as given.
    if (found && tx === g.x && tz === g.z && way.length) (way[way.length - 2] = g.x), (way[way.length - 1] = g.z);
    a.path = way.length ? way : null;
    a.pathI = 0;
    a.best = Infinity;
  }

  // Slow to a stop while still sliding forward.
  _coast(a, dt, k) {
    if (a.speed > 0.01) {
      a.speed = Math.max(0, a.speed - k * dt);
      this._move(a, dt);
    } else a.speed = 0;
    a.vel.set(Math.sin(a.yaw) * a.speed, 0, Math.cos(a.yaw) * a.speed);
  }

  // Advance along the facing, pushed out of footprints, never into water. Returns the distance moved.
  _move(a, dt) {
    const ox = a.pos.x, oz = a.pos.z;
    let x = ox + Math.sin(a.yaw) * a.speed * dt, z = oz + Math.cos(a.yaw) * a.speed * dt;
    const r = a.radius;
    // Keep a body's width from the neighbours: each of a pair gives way half of the overlap.
    const ci = Math.floor(x / 2.5), cj = Math.floor(z / 2.5);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const near = this.crowd.get(i * 100003 + j);
        if (!near) continue;
        for (const o of near) {
          const dx = x - o.pos.x, dz = z - o.pos.z, d2 = dx * dx + dz * dz, m = (r + o.radius) * 0.8;
          if (o === a || d2 >= m * m || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), push = (m - d) * 0.5;
          x += (dx / d) * push;
          z += (dz / d) * push;
        }
      }
    }
    this._refreshObstacles(a);
    for (const b of a.obst) {
      if (x < b.minx - r || x > b.maxx + r || z < b.minz - r || z > b.maxz + r) continue;
      const inside = pointInPrism2D(x, z, b);
      closestOnPrism(x, z, b, _cp);
      if (!inside && _cp.d >= r) continue;
      x = _cp.x + _cp.nx * (r + 0.005);
      z = _cp.z + _cp.nz * (r + 0.005);
    }
    if (this.wet(x, z)) {
      x = ox;
      z = oz;
      a.speed = 0;
    }
    a.pos.set(x, this.groundAt(x, z), z);
    a.vel.set(Math.sin(a.yaw) * a.speed, 0, Math.cos(a.yaw) * a.speed);
    return Math.hypot(x - ox, z - oz);
  }

  _refreshObstacles(a) {
    const dx = a.pos.x - a.ox, dz = a.pos.z - a.oz;
    if (dx * dx + dz * dz < 16 && this.time - a.ot < 1.5 && a.ot !== 0) return;
    a.ox = a.pos.x;
    a.oz = a.pos.z;
    a.ot = this.time || 1e-6;
    a.obst.length = 0;
    for (const b of this.city.nearby(a.pos.x, a.pos.z, 14, _near)) if (this._solid(b, a.pos.y)) a.obst.push(b);
  }

  _blockedAt(a, x, z, r) {
    if (this.wet(x, z)) return true;
    for (const b of a.obst) {
      if (x < b.minx - r || x > b.maxx + r || z < b.minz - r || z > b.maxz + r) continue;
      if (pointInPrism2D(x, z, b) || closestOnPrism(x, z, b, _cp).d < r) return true;
    }
    return false;
  }

  // The heading closest to `want` whose path a metre or two ahead is clear. When something is in
  // the way it picks the side that gets round it sooner and keeps to that side while the way
  // ahead stays blocked, so it follows a wall to its end instead of dithering in front of it.
  _heading(a, want, speed, dt) {
    const look = clamp(speed * 0.7, 0.9, 2.4), r = a.radius;
    const clear = (h) => {
      const s = Math.sin(h), c = Math.cos(h);
      return !this._blockedAt(a, a.pos.x + s * r * 1.1, a.pos.z + c * r * 1.1, r) && !this._blockedAt(a, a.pos.x + s * look * 0.5, a.pos.z + c * look * 0.5, r) && !this._blockedAt(a, a.pos.x + s * look, a.pos.z + c * look, r);
    };
    if (clear(want)) {
      a.follow = Math.max(0, a.follow - dt);
      return want;
    }
    if (a.follow <= 0) {
      let best = a.side, bo = 9;
      for (const side of [a.side, -a.side]) {
        for (let o = 0.3; o < 2.8; o += 0.3) {
          if (!clear(want + side * o)) continue;
          if (o < bo - 0.05) (bo = o), (best = side);
          break;
        }
      }
      a.side = best;
    }
    a.follow = 1.5;
    for (let o = 0.3; o < 2.8; o += 0.3) if (clear(want + a.side * o)) return want + a.side * o;
    for (let o = 0.3; o < 2.8; o += 0.3) {
      if (clear(want - a.side * o)) {
        a.side = -a.side;
        return want + a.side * o;
      }
    }
    return want + a.side * 2.9;
  }

  // ---------- animation ----------

  _animate(a, dt) {
    const r = a.rig;
    if (r.kind === 'human') this._animHuman(a, r, dt);
    else this._animQuad(a, r, dt);
  }

  _animHuman(a, r, dt) {
    const K = a.K, tilt = r.tilt;
    let want = 'idle';
    if (a.state === 'stunned' || a.state === 'tied') want = 'pose';
    else if (a.state === 'walk' || a.state === 'run') want = a.speed < 0.2 ? 'idle' : a.speed < K.runAt ? 'walk' : 'run';
    if (a.state !== 'down') {
      const k = Math.min(1, dt * 9);
      let sum = 0;
      for (const n in r.w) sum += r.w[n] += ((n === want ? 1 : 0) - r.w[n]) * k;
      for (const n in r.actions) {
        const act = r.actions[n], w = r.w[n] / sum;
        const on = w > 0.01;
        if (on && !act.enabled) {
          const ref = r.actions[r.on];
          if (ref && (n === 'walk' || n === 'run') && (r.on === 'walk' || r.on === 'run')) act.time = (ref.time / ref.getClip().duration) * act.getClip().duration;
        }
        act.enabled = on;
        act.setEffectiveWeight(w);
      }
      r.on = want;
      r.actions.walk.timeScale = clamp(a.speed / WALK_CLIP_SPEED, 0.55, 1.9);
      r.actions.run.timeScale = clamp(a.speed / RUN_CLIP_SPEED, 0.75, 1.7);
      r.mixer.update(dt);
    }
    // Body attitude: flinch, sway when dazed, slump when tied, and the fall.
    let rx = -a.flinch * 0.16, rz = 0, y = 0;
    if (a.state === 'stunned') {
      rz = Math.sin(this.time * 7 + a.id) * 0.09;
      rx += 0.1;
    } else if (a.tied) rx += 0.22 * a.lie;
    if (a.fall > 0) {
      const f = 1 - (1 - a.fall) * (1 - a.fall);
      rx = -a.fallDir * (Math.PI / 2) * f;
      rz = 0.12 * f;
      y = 0.17 * f;
    }
    tilt.rotation.set(rx, 0, rz);
    tilt.position.y = y;
    this._fade(a);
  }

  _animQuad(a, r, dt) {
    const S = r.model.S, bones = r.bones;
    const sp = a.speed, moving = clamp(sp / 0.25, 0, 1);
    const run = clamp((sp - a.speedWalk) / Math.max(1, a.speedRun - a.speedWalk), 0, 1);
    if (a.state !== 'down') a.phase += (sp * dt * TAU) / (S.stride * r.model.k);
    const ph = a.phase, t = this.time + a.id;
    const swing = (S.walkSwing + (S.runSwing - S.walkSwing) * run) * moving;
    const lie = a.lie, fall = a.fall;
    const legs = [[Q.flU, Q.flL, 0], [Q.frU, Q.frL, Math.PI], [Q.hlU, Q.hlL, Math.PI], [Q.hrU, Q.hrL, 0]];
    for (const [u, l, off] of legs) {
      const s = ph + off;
      bones[u].rotation.x = -Math.sin(s) * swing + lie * 1.15 * (u < Q.hlU ? 1 : -1) + fall * 0.35;
      bones[l].rotation.x = Math.max(0, -Math.cos(s)) * S.knee * moving + lie * 1.9;
    }
    const body = bones[Q.body];
    const base = r.model.S.fore.y * r.model.k;
    body.position.y = base + (1 - Math.cos(ph * 2)) * 0.5 * S.bob * moving * r.model.k - lie * base * 0.5;
    body.rotation.z = Math.sin(ph) * 0.03 * moving;
    body.rotation.x = -run * 0.05 + Math.sin(ph * 2) * 0.012 * moving;
    const stun = a.state === 'stunned' ? 1 : 0;
    bones[Q.head].rotation.x = Math.sin(ph * 2) * 0.05 * moving + Math.sin(t * 0.8) * 0.05 * (1 - moving) + stun * (0.35 + Math.sin(this.time * 6) * 0.12) + lie * 0.4;
    bones[Q.head].rotation.y = Math.sin(t * 0.5) * 0.25 * (1 - moving) * (1 - stun);
    const wag = S.wag * (1 + run);
    bones[Q.tail1].rotation.y = Math.sin(t * wag) * 0.5 * (stun || lie ? 0.2 : 1);
    bones[Q.tail1].rotation.x = -0.15 * moving + lie * 0.6;
    bones[Q.tail2].rotation.y = Math.sin(t * wag - 0.8) * 0.4 * (stun || lie ? 0.2 : 1);
    let rz = stun * Math.sin(this.time * 7 + a.id) * 0.1, rx = -a.flinch * 0.08, y = 0;
    if (fall > 0) {
      const f = 1 - (1 - fall) * (1 - fall);
      rz = a.fallDir * (Math.PI / 2) * f;
      y = r.model.S.body[0][3] * r.model.k * 0.95 * f;
    }
    r.tilt.rotation.set(rx, 0, rz);
    r.tilt.position.y = y;
    this._fade(a);
  }

  // A dithered fade of the fallen; each fading actor borrows a private material from a small pool.
  _fade(a) {
    if (a.state !== 'down' || a.downT < DOWN_HOLD) return;
    if (!a.ghost) {
      const kind = a.rig.kind === 'human' ? 'human' : 'quad';
      const g = this.ghosts[kind].pop() || (kind === 'human' ? humanMaterial(this.onMaterial) : quadMaterial(this.onMaterial));
      if (kind === 'human') paintHuman(g, a.mat.userData.params);
      else g.color.copy(a.mat.color);
      a.ghost = g;
      a.rig.body.material = g;
    }
    a.ghost.userData.u.uFade.value = clamp(1 - (a.downT - DOWN_HOLD) / DOWN_FADE, 0, 1);
  }

  _freeGhost(a) {
    a.ghost.userData.u.uFade.value = 1;
    this.ghosts[a.rig.kind === 'human' ? 'human' : 'quad'].push(a.ghost);
    a.ghost = null;
  }

  // Write the node matrices by hand: nothing in an actor updates itself in the scene traversal.
  _pose(a) {
    const r = a.rig, g = r.group;
    g.position.copy(a.pos);
    g.quaternion.setFromAxisAngle(_yAxis, a.yaw);
    g.matrix.compose(g.position, g.quaternion, g.scale);
    g.matrixWorld.copy(g.matrix);
    const t = r.tilt;
    t.matrix.compose(t.position, t.quaternion, t.scale);
    t.matrixWorld.multiplyMatrices(g.matrixWorld, t.matrix);
    if (r.armature) r.armature.matrixWorld.multiplyMatrices(t.matrixWorld, r.armature.matrix);
    const bs = r.bones;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      b.matrix.compose(b.position, b.quaternion, b.scale);
      b.matrixWorld.multiplyMatrices(b.parent.matrixWorld, b.matrix);
    }
    r.body.matrixWorld.multiplyMatrices(r.body.parent.matrixWorld, r.body.matrix);
    r.body.bindMatrixInverse.copy(r.body.matrixWorld).invert();
  }
}
