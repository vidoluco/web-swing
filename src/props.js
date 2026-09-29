import * as THREE from 'three';
import { h32, rnd01 } from './buildings.js';
import { pointInPrism2D, closestOnPrism, roadKey } from './osmcity.js';
import { uniforms } from './uniforms.js';
import { box, cyl, merge, propMaterial, partsOf, fillInstances } from './geom.js';

// Street furniture and roof clutter of a chunk: lamp posts, benches, bins, cabinets, bus shelters, kiosks and bar
// terraces, zebra crossings and stop lines, antennas, dishes, water tanks, chimneys and dormers. Everything is
// instanced (or merged into one mesh per chunk for the roof clutter), so a chunk costs a handful of draw calls.
// Lamps glow at night: a billboard halo and a light pool on the road, both driven by uNight.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const mat4 = (x, y, z, yaw, sx = 1, sy = sx, sz = sx) => _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(Y, yaw), _s.set(sx, sy, sz)).toArray();

function templates() {
  const T = {};
  const iron = 0x33363a, steel = 0x8d9296, glass = 0x5b7d8c;
  // modern street light: pole, curved arm and a flat lamp head; +z is towards the road
  const arm = new THREE.BoxGeometry(0.07, 0.07, 1.9).rotateX(-0.1).translate(0, 7.62, 0.85);
  T.lamp = merge([
    { g: cyl(0.2, 0.22, 0.35, 8), color: iron },
    { g: cyl(0.055, 0.1, 7.7, 8), color: iron },
    { g: arm, color: iron },
    { g: box(0.42, 0.11, 0.95, 0, 7.5, 1.75), color: 0x484c50 },
    { g: box(0.36, 0.02, 0.85, 0, 7.485, 1.75), color: 0xfff1cf },
  ]);
  T.bench = merge([
    ...[-0.16, 0, 0.16].map((z) => ({ g: box(1.75, 0.045, 0.13, 0, 0.44, z), color: 0x8a6440, tint: 1 })),
    ...[0.68, 0.86].map((y) => ({ g: new THREE.BoxGeometry(1.75, 0.13, 0.04).rotateX(-0.2).translate(0, y, -0.24), color: 0x8a6440, tint: 1 })),
    ...[-0.8, 0.8].map((x) => ({ g: box(0.06, 0.95, 0.55, x, 0, -0.02), color: iron })),
  ]);
  T.shelter = merge([
    { g: box(3.5, 0.09, 1.55, 0, 2.5, 0), color: 0xd4d6d8, tint: 1 },
    { g: box(3.4, 2.1, 0.03, 0, 0.35, -0.72), color: glass },
    { g: box(0.03, 2.1, 1.3, -1.68, 0.35, 0), color: glass },
    { g: box(0.03, 2.1, 1.3, 1.68, 0.35, 0), color: glass },
    ...[-1.7, 0, 1.7].map((x) => ({ g: box(0.07, 2.5, 0.07, x, 0, -0.72), color: steel })),
    { g: box(2.4, 0.06, 0.4, 0, 0.5, -0.5), color: 0x777b7e },
    { g: box(1.0, 1.4, 0.06, 1.2, 0.55, -0.68), color: 0xe9e9ea },
    { g: cyl(0.04, 0.04, 3.0, 6, 2.4, 0, 0.5), color: steel },
    { g: box(0.5, 0.5, 0.03, 2.4, 2.6, 0.5), color: 0x1f5fa8 },
  ]);
  T.kiosk = merge([
    { g: box(3.2, 2.5, 2.2, 0, 0, 0), color: 0xffffff, tint: 1 },
    { g: box(2.5, 1.0, 0.04, 0, 1.0, 1.1), color: 0x2f4b5c },
    { g: box(2.5, 0.06, 0.5, 0, 0.98, 1.3), color: 0xe9e2c8 },
    { g: box(3.5, 0.2, 2.6, 0, 2.5, 0), color: 0x555a5e },
    { g: box(2.6, 0.5, 0.06, 0, 2.55, 1.28), color: 0xffd23a },
    { g: box(3.0, 0.5, 0.05, 0, 0.0, 1.1), color: 0x3a3d40 },
  ]);
  T.table = null; // from the model
  // dish and antenna for roofs
  const dish = new THREE.SphereGeometry(0.45, 10, 5, 0, 6.283, 0, 1.05);
  dish.rotateX(Math.PI / 2 - 0.5);
  dish.translate(0, 0.9, 0.35);
  T.roofDish = merge([
    { g: dish, color: 0xd9d9d4 },
    { g: cyl(0.03, 0.03, 0.9, 5), color: 0x6c6c6c },
    { g: box(0.03, 0.03, 0.45, 0, 0.9, 0.2), color: 0x6c6c6c },
  ]);
  const ant = [{ g: cyl(0.018, 0.02, 4.2, 5), color: 0x7a7a7a }];
  for (let i = 0; i < 4; i++) ant.push({ g: box(1.15 - i * 0.18, 0.018, 0.018, 0, 2.2 + i * 0.5, 0), color: 0x9a9a9a });
  ant.push({ g: box(0.7, 0.018, 0.018, 0, 4.2, 0), color: 0x9a9a9a });
  T.antenna = merge(ant);
  T.tank = merge([
    { g: cyl(1.05, 1.05, 2.0, 12, 0, 1.0), color: 0x9aa39c },
    { g: cyl(1.1, 1.05, 0.12, 12, 0, 3.0), color: 0x7f8781 },
    ...[[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]].map(([x, z]) => ({ g: box(0.09, 1.1, 0.09, x, 0, z), color: 0x505558 })),
    { g: box(1.9, 0.09, 0.09, 0, 0.9, 0), color: 0x505558 },
  ]);
  T.chimney = merge([
    { g: box(0.7, 1.7, 0.7), color: 0x8a5040 },
    { g: box(0.9, 0.14, 0.9, 0, 1.7, 0), color: 0x9a9a96 },
    { g: box(0.5, 0.18, 0.5, 0, 1.84, 0), color: 0x1e1e20 },
  ]);
  // dormer window on a pitched roof, front is +z
  const tri = new THREE.Shape();
  tri.moveTo(-0.95, 0);
  tri.lineTo(0.95, 0);
  tri.lineTo(0, 0.85);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false }).translate(0, 1.3, 0.62);
  T.dormer = merge([
    { g: box(1.5, 1.3, 1.3, 0, 0, 0), color: 0xe9e2d0 },
    { g: box(0.85, 0.85, 0.05, 0, 0.3, 0.66), color: 0x2f3f52 },
    { g: box(1.0, 0.06, 0.12, 0, 0.26, 0.7), color: 0xf1ece0 },
    { g: new THREE.BoxGeometry(1.25, 0.06, 1.8).rotateZ(0.62).translate(-0.55, 1.68, 0.0), color: 0x9a4a32 },
    { g: new THREE.BoxGeometry(1.25, 0.06, 1.8).rotateZ(-0.62).translate(0.55, 1.68, 0.0), color: 0x9a4a32 },
    { g: gable, color: 0xe9e2d0 },
  ]);
  T.vent = merge([
    { g: box(0.9, 0.5, 0.9), color: 0xb8bab8 },
    { g: cyl(0.3, 0.3, 0.14, 10, 0, 0.5), color: 0x54585a },
  ]);
  return T;
}

// Radial glow textures drawn once.
function glowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,236,190,1)');
  gr.addColorStop(0.12, 'rgba(255,215,140,0.75)');
  gr.addColorStop(0.4, 'rgba(255,190,100,0.22)');
  gr.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class SignAtlas {
  static COLS = 4;
  static ROWS = 16;
  constructor() {
    const c = document.createElement('canvas');
    c.width = 512 * SignAtlas.COLS;
    c.height = 128 * SignAtlas.ROWS;
    this.canvas = c;
    this.g = c.getContext('2d');
    this.g.fillStyle = '#222';
    this.g.fillRect(0, 0, c.width, c.height);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.cells = new Map();
    this.next = 0;
  }
  // Cell index of a name, painting it on first use. The atlas is a ring: the oldest names are overwritten.
  cell(name) {
    let i = this.cells.get(name);
    if (i !== undefined) return i;
    i = this.next++ % (SignAtlas.COLS * SignAtlas.ROWS);
    for (const [k, v] of this.cells) if (v === i) this.cells.delete(k);
    this.cells.set(name, i);
    const h = h32([...name].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
    const pal = [['#7a1f1f', '#fff1d6'], ['#12324f', '#ffe08a'], ['#1d4d2b', '#f5f5e6'], ['#2b2b2e', '#ffcf4a'], ['#f3ead0', '#5b1a1a'], ['#5c2a63', '#ffffff']][h % 6];
    const x = (i % SignAtlas.COLS) * 512, y = Math.floor(i / SignAtlas.COLS) * 128;
    const g = this.g;
    g.fillStyle = pal[0];
    g.fillRect(x, y, 512, 128);
    g.strokeStyle = pal[1];
    g.lineWidth = 5;
    g.strokeRect(x + 6, y + 6, 500, 116);
    g.fillStyle = pal[1];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 64;
    g.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`;
    const text = name.length > 26 ? name.slice(0, 25) + '.' : name;
    while (g.measureText(text).width > 470 && size > 22) g.font = `800 ${(size -= 4)}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(text, x + 256, y + 68);
    this.tex.needsUpdate = true;
    return i;
  }
}

export class Props {
  constructor(look) {
    this.look = look;
    this.city = look.city;
    this.assets = look.assets;
    this.T = templates();
    this.mat = propMaterial();
    this.roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
    this.models = {};
    this.nightMats = [];
    // Night glow: billboards at the lamp heads and soft pools on the ground.
    const tex = glowTexture();
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { tGlow: { value: tex }, uNight: uniforms.uNight },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          vec4 mv = modelViewMatrix * c;
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D tGlow; uniform float uNight; varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tGlow, vUv).rgb * uNight * 1.1, 1.0); }`,
      fog: false,
    });
    this.haloGeo = new THREE.PlaneGeometry(1, 1);
    this.poolMat = new THREE.ShaderMaterial({
      uniforms: { tGlow: { value: tex }, uNight: uniforms.uNight },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -12,
      polygonOffsetUnits: -12,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tGlow; uniform float uNight; varying vec2 vUv;
        void main() { float d = clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0); float a = pow(1.0 - d, 2.6); gl_FragColor = vec4(vec3(1.0, 0.8, 0.5) * a * uNight * 0.2, 1.0); }`,
      fog: false,
    });
    this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // Zebra crossings and stop lines: paint that is discarded between the stripes.
    const paint = (stripes) => {
      const m = new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 });
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPUv; varying vec2 vPS;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPUv = uv; vPS = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vPUv; varying vec2 vPS;\nfloat ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
          .replace(
            '#include <alphatest_fragment>',
            `float wear = 0.55 + 0.45 * ph(floor(vPUv * vPS * 6.0));
${stripes ? 'float sx = vPUv.x * vPS.x; if (fract(sx / 0.9) > 0.55) discard;' : ''}
if (wear < 0.5) discard;
#include <alphatest_fragment>`
          );
      };
      m.customProgramCacheKey = () => 'paint' + stripes;
      return m;
    };
    this.zebraMat = paint(true);
    this.stopMat = paint(false);
    this.paintGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // Signs: names of bars and kiosks from OSM painted on a shared atlas, drawn unlit and glowing at night.
    this.signs = new SignAtlas();
    this.signGeo = new THREE.PlaneGeometry(1, 0.3);
    this.signMat = new THREE.ShaderMaterial({
      uniforms: { tSigns: { value: this.signs.tex }, uNight: uniforms.uNight },
      side: THREE.DoubleSide,
      vertexShader: `
        attribute float aCell; varying vec2 vUv;
        void main() {
          float cx = mod(aCell, ${SignAtlas.COLS}.0), cy = floor(aCell / ${SignAtlas.COLS}.0);
          vUv = vec2((cx + uv.x) / ${SignAtlas.COLS}.0, 1.0 - (cy + 1.0 - uv.y) / ${SignAtlas.ROWS}.0);
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D tSigns; uniform float uNight; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tSigns, vUv);
          vec3 lit = c.rgb * (0.85 + 1.2 * uNight);
          gl_FragColor = vec4(lit, 1.0);
          #include <colorspace_fragment>
        }`,
    });
  }

  model(name) {
    if (this.models[name] !== undefined) return this.models[name];
    const root = this.assets.models[name];
    if (!root) return (this.models[name] = null);
    const parts = partsOf(root);
    for (const p of parts) {
      if (/glass/i.test(p.material.name)) {
        p.material = p.material.clone();
        p.material.emissive = new THREE.Color(1.0, 0.82, 0.5);
        p.material.emissiveIntensity = 0;
        this.nightMats.push(p.material);
      }
    }
    return (this.models[name] = parts);
  }

  update() {
    const n = uniforms.uNight.value;
    for (const m of this.nightMats) m.emissiveIntensity = n * 2.2;
    const on = n > 0.03;
    this.haloMat.visible = this.poolMat.visible = on;
  }

  // A spot is free when no building footprint is within r.
  free(x, z, r) {
    const city = this.city;
    for (const b of city.nearby(x, z, r + 2, [])) {
      if (b.kind === 'prop') continue;
      if (x < b.minx - r || x > b.maxx + r || z < b.minz - r || z > b.maxz + r) continue;
      if (pointInPrism2D(x, z, b) || closestOnPrism(x, z, b, {}).d < r) return false;
    }
    return !city.isWater(x, z);
  }

  newLists() {
    return { lamp: [], oldLamp: [], bench: [], bin: [], boxA: [], boxB: [], shelter: [], kiosk: [], table: [], chalk: [], planter: [], plant: [], zebra: [], stop: [], halo: [], pool: [], sign: [] };
  }

  lineLen(pts) {
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return len;
  }

  inst(geo, mat, list) {
    return list.length ? fillInstances(new THREE.InstancedMesh(geo, mat, list.length), list) : null;
  }

  // Far layer: street lights with their night glow, and the paint at junctions. Added to the chunk group.
  decorate(rec, data, group) {
    const L = this.newLists();
    rec.lookRoads = data.r;
    for (const r of data.r) {
      const pts = r.pts;
      if (pts.length < 4 || r.cls !== 'road') continue;
      const len = this.lineLen(pts);
      if (len < 12) continue;
      this.road(L, r, pts, len, h32(Math.round(pts[0] * 10) ^ (Math.round(pts[1] * 10) << 9)), false);
    }
    this.junctions(L, rec);
    const parent = new THREE.Group();
    parent.userData.look = true;
    let m;
    if ((m = this.inst(this.T.lamp, this.mat, L.lamp))) parent.add(m);
    if ((m = this.inst(this.paintGeo, this.zebraMat, L.zebra))) parent.add(m);
    if ((m = this.inst(this.paintGeo, this.stopMat, L.stop))) parent.add(m);
    if ((m = this.inst(this.haloGeo, this.haloMat, L.halo))) parent.add(m);
    if ((m = this.inst(this.poolGeo, this.poolMat, L.pool))) parent.add(m);
    if (parent.children.length) group.add(parent);
  }

  // Near layer (see Detail): furniture, terraces, roof clutter. Returns meshes, no shadows.
  near(rec) {
    const L = this.newLists();
    for (const r of rec.lookRoads || []) {
      const pts = r.pts;
      if (pts.length < 4) continue;
      const len = this.lineLen(pts);
      if (len < 12) continue;
      const seed = h32(Math.round(pts[0] * 10) ^ (Math.round(pts[1] * 10) << 9));
      if (r.cls === 'road') this.road(L, r, pts, len, seed, true);
      else if (r.cls === 'foot' || r.cls === 'ped') this.pathProps(L, r, pts, len, seed);
    }
    this.pois(L, rec);
    const out = [];
    const put = (m) => {
      if (m) {
        m.castShadow = false;
        m.receiveShadow = true;
        out.push(m);
      }
    };
    put(this.inst(this.T.bench, this.mat, L.bench));
    put(this.inst(this.T.shelter, this.mat, L.shelter));
    put(this.inst(this.T.kiosk, this.mat, L.kiosk));
    put(this.inst(this.haloGeo, this.haloMat, L.halo));
    put(this.inst(this.poolGeo, this.poolMat, L.pool));
    const modelInst = (name, list) => {
      const parts = list.length ? this.model(name) : null;
      if (parts) for (const p of parts) put(fillInstances(new THREE.InstancedMesh(p.geometry, p.material, list.length), list));
    };
    modelInst('street_lamp_01', L.oldLamp);
    modelInst('metal_trash_can', L.bin);
    modelInst('utility_box_01', L.boxA);
    modelInst('utility_box_02', L.boxB);
    modelInst('outdoor_table_chair_set_01', L.table);
    modelInst('standing_chalkboard_01', L.chalk);
    modelInst('planter_box_01', L.planter);
    modelInst('potted_plant_02', L.plant);
    put(this.roofs(rec));
    if (L.sign.length) {
      const m = new THREE.InstancedMesh(this.signGeo, this.signMat, L.sign.length);
      const cells = new Float32Array(L.sign.length);
      L.sign.forEach(([mm, cell], k) => {
        m.instanceMatrix.array.set(mm, k * 16);
        cells[k] = cell;
      });
      m.geometry = this.signGeo.clone();
      m.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      m.userData.ownGeometry = true;
      out.push(m);
    }
    return out;
  }

  // Walk along a polyline: cb(x, z, dx, dz, u) every `step` metres from `first`.
  walk(pts, step, first, cb) {
    let acc = first, u = 0;
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-6) continue;
      const dx = (bx - ax) / l, dz = (bz - az) / l;
      while (acc <= u + l) {
        const t = acc - u;
        cb(ax + dx * t, az + dz * t, dx, dz, acc);
        acc += step;
      }
      u += l;
    }
  }

  road(L, r, pts, len, seed, near) {
    const city = this.city;
    const w = r.w;
    if (w < 5.5) return;
    const half = w / 2;
    const major = !!r.major;
    const oldTown = !major && w < 9 && Math.hypot(pts[0], pts[1]) < 900;
    const step = major ? 33 : 40;
    const clear = Math.min(w * 0.6 + 4, 10);
    let k = 0;
    this.walk(pts, step, clear + rnd01(seed, 1) * 6, (x, z, dx, dz, u) => {
      if (u > len - clear) return;
      const side = major ? (k++ % 2 ? -1 : 1) : (seed & 1 ? 1 : -1);
      const ox = -dz * side, oz = dx * side;
      const off = half + 0.85;
      const px = x + ox * off, pz = z + oz * off;
      if (!this.free(px, pz, 0.5)) return;
      const yaw = Math.atan2(-ox, -oz); // the arm points to the road
      const y = city.groundAt(px, pz);
      if (oldTown) {
        if (near) L.oldLamp.push([mat4(px, y, pz, yaw, 1, 1, 1)]);
        else {
          L.halo.push([mat4(px, y + 3.5, pz, 0, 1.8)]);
          L.pool.push([mat4(px, y + 0.06, pz, 0, 6.5)]);
        }
      } else if (!near) {
        const hs = major ? 1 : 0.72;
        L.lamp.push([mat4(px, y, pz, yaw, 1, hs, 1)]);
        const hx = px - ox * 1.75 * 1.0, hz = pz - oz * 1.75 * 1.0;
        L.halo.push([mat4(hx, y + 7.5 * hs, hz, 0, 2.6)]);
        L.pool.push([mat4(hx, y + 0.06, hz, 0, major ? 15 : 11)]);
      }
    });
    // bus shelters on the bigger streets, cabinets and bins on the pavement (near layer)
    if (!near) return;
    if (major && len > 70 && rnd01(seed, 2) < 0.5) {
      const u0 = len * (0.35 + 0.3 * rnd01(seed, 3));
      this.walk(pts, len, u0, (x, z, dx, dz) => {
        const side = rnd01(seed, 4) < 0.5 ? 1 : -1;
        const ox = -dz * side, oz = dx * side;
        const px = x + ox * (half + 2.0), pz = z + oz * (half + 2.0);
        if (!this.free(px, pz, 2)) return;
        L.shelter.push([mat4(px, city.groundAt(px, pz), pz, Math.atan2(ox, oz) + Math.PI, 1, 1, 1), [0xd8dadb, 0xc9d2d8, 0xdcd2c2][seed % 3]]);
      });
    }
    if (rnd01(seed, 5) < 0.3) {
      this.walk(pts, 90, len * rnd01(seed, 6), (x, z, dx, dz) => {
        const side = rnd01(seed, 7) < 0.5 ? 1 : -1;
        const off = half + (major ? 4.0 : 2.4);
        const px = x - dz * side * off, pz = z + dx * side * off;
        if (!this.free(px, pz, 1.2)) return;
        const list = rnd01(seed, 8) < 0.5 ? L.boxA : L.boxB;
        list.push([mat4(px, city.groundAt(px, pz), pz, Math.atan2(dz * side, -dx * side))]);
      });
    }
  }

  pathProps(L, r, pts, len, seed) {
    const city = this.city;
    const half = r.w / 2;
    const isPed = r.cls === 'ped';
    let k = 0;
    this.walk(pts, isPed ? 26 : 38, 6 + rnd01(seed, 1) * 8, (x, z, dx, dz, u) => {
      if (u > len - 4) return;
      const side = k++ % 2 ? 1 : -1;
      const ox = -dz * side, oz = dx * side;
      const px = x + ox * (half + 0.9), pz = z + oz * (half + 0.9);
      if (!this.free(px, pz, 1)) return;
      const y = city.groundAt(px, pz);
      const yaw = Math.atan2(-ox, -oz); // facing the path
      if (isPed || Math.hypot(x, z) < 1200) {
        const c = rnd01(seed, 20 + k);
        if (c < 0.45) L.bench.push([mat4(px, y, pz, yaw), [0x8a6440, 0x6f5236, 0x9a7650][k % 3]]);
        else if (c < 0.7) L.bin.push([mat4(px + ox * 0.5, y, pz + oz * 0.5, yaw, 0.85)]);
        else {
          L.oldLamp.push([mat4(px, y, pz, yaw, 1, 1, 1)]);
          L.halo.push([mat4(px, y + 3.5, pz, 0, 1.8)]);
          L.pool.push([mat4(px, y + 0.06, pz, 0, 6.5)]);
        }
      }
    });
  }

  // Kiosks, non-stops and bar terraces at the places OSM lists.
  pois(L, rec) {
    const city = this.city;
    for (const p of rec.pois || []) {
      const h = h32(Math.round(p.x * 5) ^ Math.round(p.z * 3));
      const yaw = Math.atan2(p.nx, p.nz);
      const tx = -p.nz, tz = p.nx; // along the wall
      if (p.kind === 1) {
        const kx = p.x + p.nx * 2.2, kz = p.z + p.nz * 2.2;
        if (!this.free(kx, kz, 2)) continue;
        const ky = city.groundAt(kx, kz);
        L.kiosk.push([mat4(kx, ky, kz, yaw), [0xffffff, 0xd94a4a, 0x2f7d4f, 0x3d6fb5, 0xf0c040, 0xd9d9d0][h % 6]]);
        L.sign.push([mat4(kx + p.nx * 1.31, ky + 2.78, kz + p.nz * 1.31, yaw, 1.7, 1, 1), this.signs.cell((p.name || 'NON-STOP').toUpperCase())]);
      } else {
        // a terrace: two table sets beside the door and a chalkboard
        for (let i = 0; i < 2; i++) {
          const s = i ? 1 : -1;
          const x = p.x + tx * 3.4 * s + p.nx * 0.9, z = p.z + tz * 3.4 * s + p.nz * 0.9;
          if (!this.free(x, z, 1.1)) continue;
          const y = city.groundAt(x, z);
          L.table.push([mat4(x, y, z, yaw + (h >> (i + 2) & 3) * 1.57)]);
          L.table.push([mat4(x, y, z, yaw + Math.PI + (h >> (i + 2) & 3) * 1.57)]);
        }
        // a blade sign on the wall, above the door
        if (p.name) {
          const wx = p.x - p.nx * 1.75, wz = p.z - p.nz * 1.75, wy = city.groundAt(wx, wz) + 3.1;
          L.sign.push([mat4(wx + p.nx * 0.9 + tx * 0.6, wy, wz + p.nz * 0.9 + tz * 0.6, yaw + Math.PI / 2, 1.4, 1.4, 1), this.signs.cell(p.name.toUpperCase())]);
        }
        const cx = p.x + tx * 1.8 + p.nx * 0.6, cz = p.z + tz * 1.8 + p.nz * 0.6;
        if (this.free(cx, cz, 0.6)) L.chalk.push([mat4(cx, city.groundAt(cx, cz), cz, yaw, 1)]);
      }
    }
  }

  // Zebra crossings and stop lines on the arms of junctions.
  junctions(L, rec) {
    const city = this.city;
    if (!rec.roads) return;
    const mine = new Set(rec.roads);
    const done = (this._done ||= new Set());
    for (const road of rec.roads) {
      if (road.w < 6.5) continue;
      const n = road.pts.length / 2;
      for (const i of [0, n - 1]) {
        const x = road.pts[i * 2], z = road.pts[i * 2 + 1];
        const key = i * 100000 + Math.round(x * 2) * 7919 + Math.round(z * 2);
        if (done.has(key)) continue;
        // node key as OsmCity indexes it
        const entries = city.roadNodes.get(roadKey(x, z)) || [];
        let arms = 0;
        for (const [rd, idx] of entries) arms += (idx > 0 ? 1 : 0) + (idx < rd.pts.length / 2 - 1 ? 1 : 0);
        if (arms < 3) continue;
        done.add(key);
        const j = i === 0 ? 1 : n - 2;
        let dx = road.pts[j * 2] - x, dz = road.pts[j * 2 + 1] - z;
        const l = Math.hypot(dx, dz);
        if (l < 14) continue;
        dx /= l; dz /= l;
        const w = road.w;
        const cd = Math.max(5.2, 3.2 + 3.0);
        const cx = x + dx * cd, cz = z + dz * cd;
        const yaw = Math.atan2(dx, dz); // plane length (z) runs along the arm
        const y = city.groundAt(cx, cz) + 0.045;
        L.zebra.push([mat4(cx, y, cz, yaw, w - 0.8, 1, 3.1)]);
        // stop line on the incoming half, before the crossing
        const inX = dz * 1, inZ = -dx * 1; // incoming lane side (traffic keeps right)
        const off = road.oneway ? 0 : w * 0.25;
        const sx = x + dx * (cd + 2.6) + inX * off, sz = z + dz * (cd + 2.6) + inZ * off;
        L.stop.push([mat4(sx, city.groundAt(sx, sz) + 0.045, sz, yaw, road.oneway ? w - 0.8 : w * 0.5 - 0.5, 1, 0.45)]);
      }
    }
    void mine;
  }

  // Antennas, dishes, tanks, chimneys, vents and dormers of one chunk, merged into one mesh.
  roofs(rec) {
    const d = rec.detail;
    if (!d) return null;
    const pos = [], nor = [], col = [];
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    const put = (tpl, x, y, z, yaw, s = 1, sy = s) => {
      _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(Y, yaw), _s.set(s, sy, s));
      nm.getNormalMatrix(_m);
      const P = tpl.attributes.position, N = tpl.attributes.normal, C = tpl.attributes.color;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(_m);
        n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        col.push(C.getX(i), C.getY(i), C.getZ(i));
      }
    };
    for (const f of d.flat) {
      const { prism, y, sd, kind } = f;
      if (!prism) continue;
      const w = prism.maxx - prism.minx, dd = prism.maxz - prism.minz;
      const r = (k) => rnd01(sd, 40 + k);
      const spot = (k) => {
        for (let t = 0; t < 8; t++) {
          const x = prism.minx + 1.5 + (w - 3) * rnd01(sd, 100 + k * 9 + t), z = prism.minz + 1.5 + (dd - 3) * rnd01(sd, 200 + k * 9 + t);
          if ([[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, c]) => pointInPrism2D(x + a * 1.2, z + c * 1.2, prism))) return [x, z];
        }
        return null;
      };
      if (w * dd < 120) continue;
      // antennas and dishes on residential roofs
      const nAnt = kind === 4 ? 2 + Math.floor(r(1) * 5) : r(1) < 0.4 ? 1 + Math.floor(r(2) * 2) : 0;
      for (let i = 0; i < nAnt; i++) {
        const p = spot(i);
        if (p) put(this.T.antenna, p[0], y, p[1], r(3 + i) * 6.28, 0.9 + r(9) * 0.4);
      }
      const nDish = kind === 4 ? Math.floor(r(4) * 4) : Math.floor(r(4) * 1.6);
      for (let i = 0; i < nDish; i++) {
        const p = spot(20 + i);
        if (p) put(this.T.roofDish, p[0], y, p[1], r(30 + i) * 6.28);
      }
      if (kind === 4 && w * dd > 400 && r(5) < 0.35) {
        const p = spot(50);
        if (p) put(this.T.tank, p[0], y, p[1], r(6) * 3.14);
      }
      if (r(7) < 0.5) {
        const p = spot(60);
        if (p) put(this.T.vent, p[0], y, p[1], r(8) * 3.14, 0.8 + r(9) * 0.6);
      }
    }
    for (const rf of d.roofs) {
      if (!rf) continue;
      const [rx1, rz1, rx2, rz2] = rf.ridge;
      const rl = Math.hypot(rx2 - rx1, rz2 - rz1);
      if (rl < 0.5) continue;
      const ux = (rx2 - rx1) / rl, uz = (rz2 - rz1) / rl;
      const px = -uz, pz = ux; // across the ridge
      const half = rf.wid / 2;
      const yAt = (lat) => rf.y - 0.12 + rf.rh * (1 - Math.abs(lat) / half);
      const r = (k) => rnd01(rf.seed, 300 + k);
      // chimney near one end of the ridge
      if (rf.len > 7 && r(1) < 0.7) {
        const t = 0.25 + r(2) * 0.5, lat = (r(3) - 0.5) * half * 0.5;
        put(this.T.chimney, rx1 + ux * rl * t + px * lat, yAt(lat) - 0.35, rz1 + uz * rl * t + pz * lat, Math.atan2(ux, uz), 1);
      }
      // dormers on both slopes of the bigger roofs
      if (rf.len > 11 && rf.wid > 7 && rf.rh > 2.4) {
        const cnt = Math.min(4, Math.floor(rf.len / 6));
        for (let side = -1; side <= 1; side += 2) {
          if (r(10 + side) < 0.35) continue;
          for (let k = 0; k < cnt; k++) {
            const t = (k + 0.5) / cnt;
            if (r(20 + k + side * 7) < 0.3) continue;
            const lat = side * half * 0.5;
            const x = rx1 + ux * rl * (0.15 + 0.7 * t) + px * lat, z = rz1 + uz * rl * (0.15 + 0.7 * t) + pz * lat;
            put(this.T.dormer, x, yAt(lat) - 0.5, z, Math.atan2(px * side, pz * side), 1);
          }
        }
      }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.roofMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}
void _e;
