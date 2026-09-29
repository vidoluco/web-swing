import * as THREE from 'three';

// Bunica, the Romanian grandmother. She is the Mixamo X Bot painted in bind-pose space (colour
// panels, a floral dress, a knitted cardigan, thick tights, tartan papuci and a face all come from
// one shader), gently rounded by a vertex displacement, plus a second skinned mesh for the parts
// that need real volume: the skirt, the basma knot, the hair bun, big round glasses, the bag and
// the fleece of the slippers. Nothing is loaded: the geometry is built here.

export const SCARFS = [
  { id: 'rosso', label: 'Basma rosso', a: '#c4171f', b: '#f2d9a0' },
  { id: 'blu', label: 'Basma blu', a: '#1f4f9c', b: '#f4c7d0' },
  { id: 'verde', label: 'Basma verde', a: '#2f7a3f', b: '#f0a24a' },
  { id: 'viola', label: 'Basma viola', a: '#7a3a94', b: '#f4d4ea' },
  { id: 'giallo', label: 'Basma giallo', a: '#e0a91c', b: '#8a3a1c' },
  { id: 'nero', label: 'Basma nero', a: '#1c1b1f', b: '#d9384a' },
];

const glsl = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

export const PALETTE = {
  skin: '#efbb9b',
  rosy: '#e9868a',
  cardi: '#b98232',
  cardiDark: '#8f5f22',
  cream: '#f4e7bd',
  red: '#c1272d',
  blue: '#2b4c9b',
  sun: '#f2c230',
  leaf: '#4d8a3f',
  tights: '#8c6f5c',
  fleece: '#f6efe0',
  tartan: '#b3202a',
  tartanDark: '#5a1016',
  frame: '#2a160f',
  bag: '#6b3f24',
  bagDark: '#4a2915',
  gold: '#d9a441',
  hair: '#d8d8dc',
};

const COMMON = /* glsl */ `
uniform vec3 uScarfA;
uniform vec3 uScarfB;
varying vec3 vBind;
float gRough = 0.8;
const vec3 SKIN = ${glsl(PALETTE.skin)};
const vec3 ROSY = ${glsl(PALETTE.rosy)};
const vec3 CARDI = ${glsl(PALETTE.cardi)};
const vec3 CARDI_D = ${glsl(PALETTE.cardiDark)};
const vec3 CREAM = ${glsl(PALETTE.cream)};
const vec3 D_RED = ${glsl(PALETTE.red)};
const vec3 D_BLUE = ${glsl(PALETTE.blue)};
const vec3 SUN = ${glsl(PALETTE.sun)};
const vec3 LEAF = ${glsl(PALETTE.leaf)};
const vec3 TIGHTS = ${glsl(PALETTE.tights)};
const vec3 FLEECE = ${glsl(PALETTE.fleece)};
const vec3 TARTAN = ${glsl(PALETTE.tartan)};
const vec3 TARTAN_D = ${glsl(PALETTE.tartanDark)};
const vec3 HAIR = ${glsl(PALETTE.hair)};
const vec3 STRAP = ${glsl(PALETTE.bag)};

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Scattered five petal flowers with a leaf, on cells of one unit; fades to the mean colour when
// a cell gets smaller than a pixel or two so it does not shimmer.
vec3 flowers(vec2 g, vec3 base, vec3 petA, vec3 petB, vec3 heart, vec3 leaf) {
  float fw = max(fwidth(g.x), fwidth(g.y));
  vec2 id = floor(g), f = fract(g) - 0.5;
  float h = hash21(id);
  f += (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.28;
  float r = length(f);
  float a = atan(f.y, f.x) + h * 6.2832;
  float rad = 0.29 * (0.72 + 0.28 * cos(5.0 * a));
  float e = max(fw * 0.7, 0.02);
  float petal = 1.0 - smoothstep(rad - e, rad + e, r);
  float core = 1.0 - smoothstep(0.085 - e, 0.085 + e, r);
  vec2 q = f - vec2(0.30, -0.24);
  q = mat2(0.82, 0.57, -0.57, 0.82) * q;
  float lf = 1.0 - smoothstep(1.0 - e * 4.0, 1.0 + e * 4.0, length(q * vec2(5.0, 12.0)));
  vec3 c = base;
  c = mix(c, leaf, lf * step(0.3, hash21(id + 1.0)));
  c = mix(c, h > 0.5 ? petA : petB, petal);
  c = mix(c, heart, core);
  return mix(c, mix(base, petA, 0.3), smoothstep(0.32, 0.75, fw));
}

vec3 dressCloth(vec2 g) {
  return flowers(g, CREAM, D_RED, D_BLUE, SUN, LEAF);
}

vec3 scarfCloth(vec2 g) {
  vec3 pale = mix(uScarfB, vec3(1.0), 0.45);
  return flowers(g, uScarfA, uScarfB, pale, SUN, mix(uScarfA, LEAF, 0.4));
}

// Knit: fine vertical ribs, faded out when they get too dense.
vec3 knit(vec3 base, float u, float freq) {
  float fw = fwidth(u * freq);
  float rib = 0.5 + 0.5 * sin(u * freq * 6.2832);
  return base * (0.9 + 0.1 * mix(rib, 0.5, smoothstep(0.35, 0.8, fw)));
}

vec3 tartan(vec2 u) {
  vec2 f = fract(u);
  float a = smoothstep(0.0, 0.03, abs(f.x - 0.5) - 0.17);
  float b = smoothstep(0.0, 0.03, abs(f.y - 0.5) - 0.17);
  vec3 c = mix(TARTAN_D, TARTAN, a * b);
  float thin = (1.0 - smoothstep(0.0, 0.04, abs(f.x - 0.5) - 0.02)) + (1.0 - smoothstep(0.0, 0.04, abs(f.y - 0.5) - 0.02));
  return mix(c, FLEECE, clamp(thin, 0.0, 1.0) * 0.55);
}
`;

// Displacement in bind pose space, along directions that do not depend on the mesh normals, so the
// seams of the mannequin never open. Rounds her out and thickens the scarf, sleeves, tights and
// slippers.
const SHAPE_GLSL = /* glsl */ `
vec3 bunicaShape(vec3 p) {
  float x = p.x, y = p.y, z = p.z, ax = abs(x);
  vec3 d = vec3(0.0);
  float armZone = step(0.185, ax) * step(1.26, y) * step(y, 1.63);
  // Belly, hips and bust: radial from the body axis, more in front than behind.
  float torso = (1.0 - armZone) * step(0.78, y) * step(y, 1.5);
  float noArm = mix(1.0, 1.0 - smoothstep(0.11, 0.18, ax), step(1.2, y));
  float g = 0.03 * exp(-pow((y - 1.0) / 0.15, 2.0)) + 0.014 * exp(-pow((y - 1.29) / 0.1, 2.0));
  vec2 r = vec2(x, z - 0.012);
  d.xz += r / (length(r) + 1e-4) * g * torso * noArm * mix(0.65, 1.0, smoothstep(-0.06, 0.06, z));
  // Sleeves.
  float sleeve = armZone * smoothstep(0.17, 0.25, ax) * (1.0 - smoothstep(0.66, 0.72, ax));
  vec2 ra = vec2(y - 1.438, z + 0.05);
  d.yz += ra / (length(ra) + 1e-4) * 0.013 * sleeve;
  // Head: the basma is thicker than skin, with a folded edge round the face.
  float head = step(1.53, y) * (1.0 - armZone);
  vec3 hc = vec3(0.0, 1.655, 0.0);
  vec3 dir = p - hc;
  dir /= length(dir) + 1e-4;
  float e = pow(x / 0.058, 2.0) + pow((y - 1.652) / 0.086, 2.0);
  float face = step(0.03, z) * (1.0 - smoothstep(0.8, 1.1, e));
  d += dir * head * ((1.0 - face) * 0.007 + step(0.02, z) * smoothstep(0.85, 1.05, e) * (1.0 - smoothstep(1.05, 1.5, e)) * 0.007);
  // Scarf wound round the neck.
  float neck = step(1.4, y) * step(y, 1.53) * (1.0 - armZone) * (1.0 - smoothstep(0.08, 0.11, ax));
  vec2 rn = vec2(x, z + 0.02);
  d.xz += rn / (length(rn) + 1e-4) * neck * 0.012;
  // Thick tights, chunky slippers.
  float lx = sign(x) * 0.082;
  float legZone = step(y, 0.53) * step(0.12, y);
  vec2 rl = vec2(x - lx, z - 0.01);
  d.xz += rl / (length(rl) + 1e-4) * legZone * 0.009;
  float foot = 1.0 - smoothstep(0.09, 0.14, y);
  vec2 rf = vec2(x - lx, z - 0.04);
  d.xz += rf / (length(rf) + 1e-4) * foot * 0.017;
  d.y += foot * 0.012 * smoothstep(0.0, 0.1, z);
  return d;
}
`;

// The body: colour by region of the bind pose.
const BODY_GLSL = /* glsl */ `
vec3 bunicaPaint(vec3 p, out float rough) {
  float x = p.x, y = p.y, z = p.z, ax = abs(x);
  rough = 0.88;
  bool arm = ax > 0.185 && y > 1.26 && y < 1.63;
  bool head = !arm && y > 1.53;
  bool neck = !arm && y > 1.4 && y <= 1.53 && ax < 0.09;
  bool torso = !arm && !head && !neck && y >= 0.9;
  vec3 col = CARDI;
  if (arm) {
    if (ax > 0.705) {
      col = SKIN;
      rough = 0.6;
    } else {
      col = knit(CARDI, atan(y - 1.438, z + 0.05), 26.0);
      float cuff = smoothstep(0.585, 0.6, ax);
      col = mix(col, CARDI_D, cuff * (1.0 - step(0.7, ax)) * (0.65 + 0.35 * sin(z * 250.0)));
    }
  } else if (head) {
    float e = pow(x / 0.058, 2.0) + pow((y - 1.652) / 0.086, 2.0);
    vec2 g = vec2(atan(x, z) / 6.2832 * 15.0, y / 0.036);
    col = scarfCloth(g);
    rough = 0.9;
    if (z > 0.03 && e < 1.0) {
      rough = 0.55;
      col = SKIN;
      float ch = exp(-pow(length(vec2(ax - 0.037, y - 1.622)) / 0.02, 2.0));
      col = mix(col, ROSY, ch * 0.6);
      // Eyes behind the glasses, a warm brown.
      vec2 ep = vec2(ax - 0.032, y - 1.662);
      float eye = 1.0 - smoothstep(0.85, 1.05, length(ep / vec2(0.0115, 0.0078)));
      col = mix(col, vec3(0.96, 0.95, 0.92), eye);
      float iris = 1.0 - smoothstep(0.85, 1.05, length((ep - vec2(0.0, -0.0004)) / vec2(0.0058, 0.0058)));
      col = mix(col, vec3(0.06, 0.03, 0.02), iris);
      // Eyebrows and crow's feet.
      vec2 bp = vec2(ax - 0.034, y - 1.688 - (ax - 0.034) * 0.5);
      col = mix(col, vec3(0.45, 0.42, 0.42), 0.85 * (1.0 - smoothstep(0.7, 1.0, length(bp / vec2(0.0145, 0.0032)))));
      float cf = (1.0 - smoothstep(0.0, 0.0011, abs(fract((y - 1.66) * 190.0 + (ax - 0.064) * 90.0) - 0.5) * 0.02 - 0.0)) * smoothstep(0.052, 0.058, ax) * (1.0 - smoothstep(0.066, 0.07, ax));
      col = mix(col, SKIN * 0.72, cf * 0.5 * step(abs(y - 1.658), 0.012));
      // Smiling mouth.
      float my = 1.588 + pow(x / 0.02, 2.0) * 0.006;
      float mw = 1.0 - smoothstep(0.0009, 0.0022, abs(y - my));
      col = mix(col, vec3(0.62, 0.16, 0.2), mw * (1.0 - smoothstep(0.018, 0.024, ax)));
      // The dimples of a broad smile.
      col = mix(col, SKIN * 0.8, 0.5 * exp(-pow(length(vec2(ax - 0.026, y - 1.592)) / 0.0028, 2.0)));
    } else if (z > 0.03 && e < 1.5) {
      // The hem of the basma and grey hair peeking out above the forehead.
      float hemT = smoothstep(1.0, 1.06, e) * (1.0 - smoothstep(1.28, 1.34, e));
      col = mix(col, uScarfB, hemT * 0.9);
      float hair = smoothstep(1.0, 1.03, e) * (1.0 - smoothstep(1.1, 1.14, e)) * smoothstep(1.665, 1.69, y);
      col = mix(col, HAIR, hair);
    }
  } else if (neck) {
    col = scarfCloth(vec2(atan(x, z + 0.02) / 6.2832 * 10.0, y / 0.036));
    rough = 0.9;
  } else if (torso) {
    col = knit(CARDI, x, 190.0);
    // The dress in the V of the cardigan, with a white collar.
    float open = step(0.0, z) * step(1.25, y) * (1.0 - smoothstep(0.0, 0.006, ax - (y - 1.25) * 0.55));
    if (open > 0.0) {
      vec3 bib = dressCloth(vec2(x, y) / 0.035);
      float collar = 1.0 - smoothstep(0.0, 0.006, abs(ax - (y - 1.25) * 0.55) - 0.006);
      col = mix(col, mix(bib, vec3(0.96), collar), open);
    }
    // Placket, buttons, ribbed hem.
    float front = step(0.0, z) * step(y, 1.25) * step(0.93, y);
    col = mix(col, CARDI_D, front * (1.0 - smoothstep(0.0, 0.003, ax - 0.007)));
    for (int i = 0; i < 4; i++) {
      float by = 1.19 - float(i) * 0.075;
      float btn = 1.0 - smoothstep(0.0075, 0.0105, length(vec2(x, y - by)));
      col = mix(col, vec3(0.93, 0.87, 0.7), btn * front);
    }
    col = mix(col, CARDI_D, (1.0 - smoothstep(0.945, 0.96, y)) * (0.7 + 0.3 * sin(x * 260.0)));
    // The strap of the bag across the chest and back.
    vec2 sa = vec2(-0.10, 1.41), sb = vec2(0.24, 0.94);
    vec2 sp = vec2(x, y) - sa, sd = sb - sa;
    float st = clamp(dot(sp, sd) / dot(sd, sd), 0.0, 1.0);
    float sdist = length(sp - sd * st);
    col = mix(col, STRAP, (1.0 - smoothstep(0.011, 0.014, sdist)) * (1.0 - smoothstep(0.12, 0.17, ax)) * (1.0 - open));
  } else {
    // Legs: hidden by the skirt above the knee, thick tights below, tartan papuci.
    float side = sign(x);
    float pi = atan(x - side * 0.082, z - 0.01);
    col = knit(TIGHTS, pi, 9.0);
    rough = 0.95;
    if (y > 0.5) col = dressCloth(vec2(x + z, y) / 0.05);
    if (y < 0.105) {
      col = tartan(vec2(z * 14.0, (x - side * 0.082) * 22.0 + 0.5));
      rough = 0.85;
    }
    // The fleece rim of the papuci.
    col = mix(col, FLEECE, smoothstep(0.108, 0.118, y) * (1.0 - smoothstep(0.12, 0.128, y)));
  }
  return col;
}
`;

function baseVertex(extraAttr = '') {
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBind;\n${extraAttr}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
  };
}

export function bunicaMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    baseVertex()(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHAPE_GLSL}`)
      .replace('vBind = position;', 'vBind = position;\ntransformed += bunicaShape(position);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\n${BODY_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ float r; diffuseColor.rgb = bunicaPaint(vBind, r); gRough = r; }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
  };
  mat.customProgramCacheKey = () => 'bunica-body-v1';
  return mat;
}

// The parts with real volume: painted by kind (0 flat colour, 1 dress, 2 basma, 3 cardigan knit).
const PROPS_GLSL = /* glsl */ `
varying float vKind;
vec3 propPaint(vec3 p, vec3 base, out float rough) {
  rough = 0.85;
  if (vKind > 2.5) return knit(base, atan(p.x, p.z), 40.0);
  if (vKind > 1.5) return scarfCloth(vec2(p.x + p.z * 0.7, p.y) / 0.036);
  if (vKind > 0.5) return dressCloth(vec2(atan(p.x, p.z) / 6.2832 * 15.0, p.y / 0.05));
  return base;
}
`;

export function propsMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    baseVertex('attribute float aKind;\nvarying float vKind;')(shader);
    shader.vertexShader = shader.vertexShader.replace('vBind = position;', 'vBind = position;\nvKind = aKind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\n${PROPS_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n{ float r; diffuseColor.rgb = propPaint(vBind, vColor.rgb, r); gRough = r; }')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
  };
  mat.customProgramCacheKey = () => 'bunica-props-v1';
  return mat;
}

// ---------- geometry ----------

const M = (px, py, pz, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const col = (hex) => new THREE.Color(hex);

// Primitives merged in one geometry with a colour and a kind per vertex; skinned when a bone or a
// weights function is given.
export class Parts {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.kind = [];
    this.skinI = [];
    this.skinW = [];
    this.idx = [];
  }

  // weights: a bone index, or fn(x, y, z) -> [[bone, weight], ...] (up to four, in bind space).
  add(geo, m4, color, { kind = 0, weights = null } = {}) {
    const g = geo.clone().applyMatrix4(m4);
    const c = col(color);
    const p = g.attributes.position, n = g.attributes.normal;
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.kind.push(kind);
      if (weights !== null) {
        const w = typeof weights === 'function' ? weights(x, y, z) : [[weights, 1]];
        for (let k = 0; k < 4; k++) {
          this.skinI.push(w[k] ? w[k][0] : 0);
          this.skinW.push(w[k] ? w[k][1] : 0);
        }
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    if (this.skinI.length) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const sphere = (r = 1) => new THREE.SphereGeometry(r, 14, 10);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const torus = (R, r) => new THREE.TorusGeometry(R, r, 8, 24);
const cyl = (r0, r1, h) => new THREE.CylinderGeometry(r1, r0, h, 10, 1);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The skinned extras. `sm` is the mannequin's skinned mesh, whose skeleton they share.
export function buildProps(sm, material) {
  const bones = sm.skeleton.bones;
  const B = (n) => bones.findIndex((b) => b.name === 'mixamorig' + n);
  const hips = B('Hips'), spine2 = B('Spine2'), neck = B('Neck'), head = B('Head');
  const lLeg = B('LeftUpLeg'), rLeg = B('RightUpLeg'), lFoot = B('LeftFoot'), rFoot = B('RightFoot');
  const P = new Parts();

  // The skirt follows the thigh on its own side, more the lower it is, so the legs swing it.
  const skirtW = (x, y) => {
    const t = Math.min(1, Math.max(0, (0.98 - y) / 0.42)) * 0.8;
    const left = smooth(-0.1, 0.1, x);
    return [[lLeg, t * left], [rLeg, t * (1 - left)], [hips, 1 - t]];
  };
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 32);
  // Cardigan hem over the hips, then the dress flaring to below the knee.
  P.add(lathe([[0.19, 1.03], [0.235, 0.995], [0.262, 0.94], [0.268, 0.905], [0.252, 0.89]]), M(0, 0, 0.008), PALETTE.cardi, { kind: 3, weights: skirtW });
  P.add(lathe([[0.235, 0.9], [0.255, 0.84], [0.275, 0.72], [0.295, 0.6], [0.312, 0.49], [0.3, 0.478]]), M(0, 0, 0.008), PALETTE.cream, { kind: 1, weights: skirtW });

  // The basma: a wound collar, the knot under the chin with two tails, and the bun under it at the back.
  P.add(torus(0.056, 0.022), M(0, 1.505, -0.018, 1, 1, 1.2, Math.PI / 2), PALETTE.red, { kind: 2, weights: neck });
  P.add(sphere(0.03), M(0, 1.522, 0.108, 1.25, 0.95, 0.95), PALETTE.red, { kind: 2, weights: neck });
  P.add(sphere(0.02), M(0.036, 1.5, 0.098, 1.5, 1, 1, 0, 0, -0.5), PALETTE.red, { kind: 2, weights: neck });
  P.add(sphere(0.02), M(-0.036, 1.5, 0.098, 1.5, 1, 1, 0, 0, 0.5), PALETTE.red, { kind: 2, weights: neck });
  P.add(sphere(1), M(0.024, 1.445, 0.128, 0.022, 0.075, 0.006, -0.18, 0, -0.22), PALETTE.red, { kind: 2, weights: spine2 });
  P.add(sphere(1), M(-0.028, 1.44, 0.126, 0.022, 0.082, 0.006, -0.18, 0, 0.3), PALETTE.red, { kind: 2, weights: spine2 });
  // The bun, grey and a little net, peeking out from under the basma at the back.
  P.add(sphere(0.056), M(0, 1.605, -0.152, 1, 0.9, 0.95), PALETTE.hair, { weights: head });
  P.add(torus(0.05, 0.005), M(0, 1.605, -0.152, 1, 0.9, 1), PALETTE.gold, { weights: head });

  // Big round glasses with thick frames, and a nose.
  for (const s of [1, -1]) {
    P.add(torus(0.032, 0.0042), M(s * 0.034, 1.662, 0.126), PALETTE.frame, { weights: head });
    P.add(cyl(0.0035, 0.0035, 0.09), M(s * 0.082, 1.665, 0.06, 1, 1, 1, Math.PI / 2, 0, 0), PALETTE.frame, { weights: head });
  }
  P.add(cyl(0.0035, 0.0035, 0.018), M(0, 1.666, 0.128, 1, 1, 1, 0, 0, Math.PI / 2), PALETTE.frame, { weights: head });
  P.add(sphere(0.014), M(0, 1.63, 0.128, 1, 1.15, 1.1), PALETTE.skin, { weights: head });

  // A shoulder bag on the left hip.
  P.add(box(0.21, 0.16, 0.09), M(0.33, 0.8, -0.02), PALETTE.bag, { weights: hips });
  P.add(box(0.216, 0.07, 0.096), M(0.33, 0.865, -0.02), PALETTE.bagDark, { weights: hips });
  P.add(sphere(0.012), M(0.33, 0.84, 0.03), PALETTE.gold, { weights: hips });
  P.add(torus(0.06, 0.007), M(0.33, 0.9, -0.02, 1, 1, 1), PALETTE.bagDark, { weights: hips });

  // Fleece rims and pompoms on the papuci.
  for (const [s, f] of [[1, lFoot], [-1, rFoot]]) {
    P.add(torus(0.05, 0.016), M(s * 0.082, 0.112, -0.018, 1, 1, 1.05, Math.PI / 2), PALETTE.fleece, { weights: f });
    P.add(sphere(0.022), M(s * 0.082, 0.062, 0.156), PALETTE.fleece, { weights: f });
  }

  const geo = P.build();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The papuc, a plush tartan slipper, as its own small mesh (in her hand and in flight). About 26 cm
// long, sole down, toe towards +z.
export function papucMesh() {
  const P = new Parts();
  P.add(sphere(1), M(0, 0.018, 0.0, 0.055, 0.02, 0.135), '#f2ead7');
  P.add(sphere(1), M(0, 0.05, 0.04, 0.052, 0.04, 0.095), PALETTE.tartan);
  P.add(sphere(1), M(0, 0.055, -0.05, 0.05, 0.036, 0.06), PALETTE.tartanDark);
  P.add(torus(0.036, 0.012), M(0, 0.07, -0.055, 1, 1, 1.15, Math.PI / 2 - 0.35), PALETTE.fleece);
  P.add(sphere(0.014), M(0, 0.085, 0.1), PALETTE.fleece);
  const g = P.build();
  g.deleteAttribute('aKind');
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
