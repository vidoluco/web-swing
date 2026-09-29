import * as THREE from 'three';

// Terrain of a city with relief (the "dem" entry of index.json, see docs/city-data-format.md).
// The height function is the bilinear sample of the grid, clamped at the edges, exactly as
// tools/dem-lib.mjs does it. On top of it: a heightfield mesh in tiles around the player that
// follows the chunk streaming ring, one coarse mesh for the whole grid as the far ground, and
// a land-use mask per loaded chunk so woods, meadows and paved squares are painted on the ground
// instead of being laid over it as flat polygons.

const CH = 400; // chunk size of the city data
const TILE = 32; // grid cells per tile side (480 m at a 15 m grid)
const FAR = 4; // the far mesh keeps one vertex in four
const SKIRT = 10; // tiles hang a wall this deep at their border, so different resolutions leave no crack
const OUT = 60000; // the far mesh runs this far past the grid, at the height of its edge
const NEAR_N = 2; // sub-cells per grid cell close to the player (7.5 m)
const NEAR_R = 650, NEAR_KEEP = 800; // tile distance for the fine mesh
const RING_R = 2400, RING_KEEP = 2700; // tile distance for the full-resolution mesh
const MASK = 192, LAYERS = 128; // land-use mask: pixels per chunk side, chunks held at once

const lin = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

// Node coordinates (in grid cells) from a to b, `n` per cell, the last one exactly b.
function axis(a, b, per, stride = 1) {
  const out = [];
  const d = stride / per;
  for (let k = a; k < b - 1e-9; k += d) out.push(k);
  out.push(b);
  return out;
}

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
`;

export class Terrain {
  // meta is index.dem, buffer the content of dem.bin.
  constructor(meta, buffer) {
    this.meta = meta;
    this.data = new Float32Array(buffer);
    this.base = meta.base || 0;
    this.tiles = new Map();
    this.nTx = Math.ceil((meta.w - 1) / TILE);
    this.nTz = Math.ceil((meta.h - 1) / TILE);
    this.scene = null;
    this.mesh = null;
    this.scan = 0;
    this._hill = null;
  }

  // ---------- sampling (the contract) ----------

  height(x, z) {
    const m = this.meta, w = m.w;
    let u = (x - m.x0) / m.step, v = (z - m.z0) / m.step;
    u = u < 0 ? 0 : u > w - 1 ? w - 1 : u;
    v = v < 0 ? 0 : v > m.h - 1 ? m.h - 1 : v;
    const i = Math.min(u | 0, w - 2), j = Math.min(v | 0, m.h - 2);
    const fu = u - i, fv = v - j, k = j * w + i, d = this.data;
    return d[k] * (1 - fu) * (1 - fv) + d[k + 1] * fu * (1 - fv) + d[k + w] * (1 - fu) * fv + d[k + w + 1] * fu * fv;
  }

  // Slope of the bilinear cell under (x, z): fills out with (rise per metre east, rise per metre south).
  gradient(x, z, out) {
    const m = this.meta, w = m.w;
    const ru = (x - m.x0) / m.step, rv = (z - m.z0) / m.step;
    const u = ru < 0 ? 0 : ru > w - 1 ? w - 1 : ru, v = rv < 0 ? 0 : rv > m.h - 1 ? m.h - 1 : rv;
    const i = Math.min(u | 0, w - 2), j = Math.min(v | 0, m.h - 2);
    const fu = u - i, fv = v - j, k = j * w + i, d = this.data;
    out.x = ru < 0 || ru > w - 1 ? 0 : ((d[k + 1] - d[k]) * (1 - fv) + (d[k + w + 1] - d[k + w]) * fv) / m.step;
    out.z = rv < 0 || rv > m.h - 1 ? 0 : ((d[k + w] - d[k]) * (1 - fu) + (d[k + w + 1] - d[k + 1]) * fu) / m.step;
    return out;
  }

  // Unit normal of the ground.
  normal(x, z, out) {
    this.gradient(x, z, _g);
    const l = Math.hypot(_g.x, 1, _g.z);
    return out.set(-_g.x / l, 1 / l, -_g.z / l);
  }

  // Rise over run of the ground (0.62 is a 32 degree slope).
  slope(x, z) {
    this.gradient(x, z, _g);
    return Math.hypot(_g.x, _g.z);
  }

  // First point where a ray meets the ground within tmax, or -1. The ray must start above it.
  rayHit(o, d, tmax) {
    if (o.y < this.height(o.x, o.z)) return -1;
    let t0 = 0;
    for (let t = 4; ; t += 4) {
      if (t > tmax) t = tmax;
      if (o.y + d.y * t < this.height(o.x + d.x * t, o.z + d.z * t)) {
        let a = t0, b = t;
        for (let k = 0; k < 10; k++) {
          const c = (a + b) / 2;
          if (o.y + d.y * c < this.height(o.x + d.x * c, o.z + d.z * c)) b = c;
          else a = c;
        }
        return b;
      }
      t0 = t;
      if (t >= tmax) return -1;
    }
  }

  // Smooth normal for shading, from heights one grid cell around the point, so tiles of different
  // resolution agree on the vertices they share.
  smooth(x, z, out) {
    const s = this.meta.step;
    const hx = (this.height(x + s, z) - this.height(x - s, z)) / (2 * s), hz = (this.height(x, z + s) - this.height(x, z - s)) / (2 * s);
    const l = Math.hypot(hx, 1, hz);
    return out.set(-hx / l, 1 / l, -hz / l);
  }

  // ---------- minimap ----------

  // Hillshade of the whole grid on a canvas, 30 m per pixel: white where the ground faces the
  // light from the north west, black where it faces away, transparent on flat ground.
  hillshade() {
    if (this._hill) return this._hill;
    const m = this.meta, W = Math.ceil(m.w / 2), H = Math.ceil(m.h / 2);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const lx = -0.55, ly = 0.62, lz = -0.55;
    const flat = ly / Math.hypot(lx, ly, lz);
    const n = new THREE.Vector3();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        this.smooth(m.x0 + i * 2 * m.step, m.z0 + j * 2 * m.step, n);
        const shade = (n.x * lx + n.y * ly + n.z * lz) / Math.hypot(lx, ly, lz) - flat;
        const k = (j * W + i) * 4, a = shade > 0 ? Math.min(0.26, shade * 1.1) : Math.min(0.5, -shade * 1.7);
        img.data[k] = img.data[k + 1] = img.data[k + 2] = shade > 0 ? 255 : 0;
        img.data[k + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return (this._hill = c);
  }

  // ---------- material ----------

  // surface: { map (the land-use map texture), box [x0, z0, x1, z1] of that map, pavers, concrete }.
  makeMaterial(surface) {
    const m = this.meta;
    const cx0 = Math.floor(m.x0 / CH), cz0 = Math.floor(m.z0 / CH);
    const nx = Math.floor((m.x0 + (m.w - 1) * m.step) / CH) - cx0 + 1, nz = Math.floor((m.z0 + (m.h - 1) * m.step) / CH) - cz0 + 1;
    this.idx = { cx0, cz0, nx, nz, tex: null, data: new Uint8Array(nx * nz * 4) };
    this.idx.tex = new THREE.DataTexture(this.idx.data, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.idx.tex.minFilter = this.idx.tex.magFilter = THREE.NearestFilter;
    this.idx.tex.needsUpdate = true;
    this.maskData = new Uint8Array(MASK * MASK * 4 * LAYERS);
    const arr = (this.maskTex = new THREE.DataArrayTexture(this.maskData, MASK, MASK, LAYERS));
    arr.format = THREE.RGBAFormat;
    arr.type = THREE.UnsignedByteType;
    arr.minFilter = arr.magFilter = THREE.LinearFilter;
    arr.generateMipmaps = false;
    arr.needsUpdate = true;
    this.free = Array.from({ length: LAYERS - 1 }, (_, i) => LAYERS - 1 - i); // layer 0 stays empty
    this.layers = new Map();
    this.uniforms = {
      tCity: { value: surface.map },
      uCityBox: { value: new THREE.Vector4(...surface.box) },
      tPavers: { value: surface.pavers },
      tConcrete: { value: surface.concrete },
      tMaskIdx: { value: this.idx.tex },
      tMask: { value: arr },
      uIdx: { value: new THREE.Vector4(cx0, cz0, nx, nz) },
      uCamXZ: { value: new THREE.Vector2() },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vTN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = objectNormal;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D tCity; uniform vec4 uCityBox; uniform sampler2D tPavers; uniform sampler2D tConcrete;
uniform sampler2D tMaskIdx; uniform sampler2DArray tMask; uniform vec4 uIdx; uniform vec2 uCamXZ;
varying vec3 vWPos; varying vec3 vTN;
vec3 gNW = vec3(0.0, 1.0, 0.0);
${NOISE}`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 p = vWPos.xz;
  vec3 Ng = normalize(vTN);
  float f = smoothstep(1400.0, 2100.0, distance(p, uCamXZ));
  vec2 cuv = clamp((p - uCityBox.xy) / (uCityBox.zw - uCityBox.xy), 0.0, 1.0);
  vec3 cm = texture2D(tCity, cuv).rgb;
  // Land use: from the map everywhere, from the polygons of the loaded chunks where there are some.
  float wood = 1.0 - smoothstep(0.02, 0.08, distance(cm, ${lin('#3c5a28')}));
  float grass = 1.0 - smoothstep(0.02, 0.08, distance(cm, ${lin('#5f8a3e')}));
  float paved = 0.0;
  ivec2 ci = ivec2(floor(p / ${CH}.0)) - ivec2(uIdx.xy);
  float lay = 0.0;
  if (ci.x >= 0 && ci.y >= 0 && ci.x < int(uIdx.z) && ci.y < int(uIdx.w)) lay = floor(texelFetch(tMaskIdx, ci, 0).r * 255.0 + 0.5);
  if (lay > 0.5) {
    vec3 m = texture(tMask, vec3((p - floor(p / ${CH}.0) * ${CH}.0) / ${CH}.0, lay - 1.0)).rgb;
    m = smoothstep(0.34, 0.66, m + (vnoise(p * 0.7) - 0.5) * 0.3);
    wood = m.r;
    grass = m.g;
    paved = m.b;
  }
  float sum = wood + grass + paved;
  if (sum > 1.0) { wood /= sum; grass /= sum; paved /= sum; sum = 1.0; }
  float other = 1.0 - sum;
  float n1 = vnoise(p * 0.05), n2 = vnoise(p * 0.31), n3 = vnoise(p * 1.7);
  vec3 forest = mix(vec3(0.028, 0.045, 0.018), vec3(0.06, 0.07, 0.03), n2) * (0.65 + 0.7 * n3);
  forest = mix(forest, vec3(0.085, 0.06, 0.035), smoothstep(0.55, 0.8, n1) * 0.6);
  vec3 meadow = mix(vec3(0.12, 0.23, 0.06), vec3(0.24, 0.34, 0.1), n1) * (0.8 + 0.3 * n3);
  meadow = mix(meadow, vec3(0.3, 0.27, 0.14), smoothstep(0.62, 0.8, vnoise(p * 0.03 + 7.0)) * 0.5);
  vec3 pave = texture2D(tPavers, p / 2.8).rgb * vec3(0.86, 0.8, 0.72) * (0.85 + 0.25 * n1);
  // Everything else: worn turf between concrete on built-up land, the map colour on fields.
  float chroma = max(cm.r, max(cm.g, cm.b)) - min(cm.r, min(cm.g, cm.b));
  float grey = 1.0 - smoothstep(0.015, 0.05, chroma);
  float gp = smoothstep(0.42, 0.62, vnoise(p * 0.011) * 0.75 + vnoise(p * 0.043) * 0.35);
  vec3 turf = mix(vec3(0.13, 0.2, 0.07), vec3(0.24, 0.28, 0.1), vnoise(p * 0.21)) * (0.75 + 0.35 * vnoise(p * 2.3));
  vec3 conc = texture2D(tConcrete, p / 5.0).rgb * vec3(0.62, 0.61, 0.58) * (0.85 + 0.25 * n1);
  conc *= mix(1.0, 0.45 + texture2D(tConcrete, p / 1.3 + 0.37).r, 0.7 * (1.0 - smoothstep(20.0, 90.0, distance(p, uCamXZ))));
  vec3 oth = mix(cm * (0.85 + 0.3 * n3), mix(conc, turf, gp), grey);
  // Steep land the map leaves blank is scree and rough grass, not pavement.
  float sl0 = 1.0 - Ng.y;
  oth = mix(oth, mix(meadow * 0.75, vec3(0.13, 0.12, 0.1), smoothstep(0.1, 0.2, sl0 + (n2 - 0.5) * 0.06)), smoothstep(0.03, 0.09, sl0));
  vec3 near = wood * forest + grass * meadow + paved * pave + other * oth;
  // Close up, fine grain so the ground is not a smooth blur.
  float dist = distance(p, uCamXZ);
  float hf = 1.0 - smoothstep(25.0, 110.0, dist);
  near *= mix(1.0, (0.84 + 0.32 * vnoise(p * 9.0)) * (0.9 + 0.2 * vnoise(p * 33.0)), hf);
  // Seen from afar the map colour carries the ground, with a blotchy canopy over the woods.
  float canopy = vnoise(p * 0.09) * 0.5 + vnoise(p * 0.35) * 0.35 + vnoise(p * 1.4) * 0.15;
  vec3 far = cm * mix(1.0, 0.65 + 0.75 * canopy, wood) * (0.92 + 0.16 * n1);
  vec3 col = mix(near, far, f);
  // Bare rock where the ground is steep.
  float rock = smoothstep(0.22, 0.34, 1.0 - Ng.y + (n2 - 0.5) * 0.08) * (1.0 - 0.5 * wood);
  vec3 rockC = mix(vec3(0.1, 0.09, 0.075), vec3(0.2, 0.18, 0.15), vnoise(vec2((p.x + p.y) * 0.09, vWPos.y * 0.5))) * (0.7 + 0.5 * n3);
  col = mix(col, rockC, rock * (1.0 - paved));
  float bump = mix(0.3, 0.8, rock) * (1.0 - f);
  vec2 q = p * 1.3, r = p * 6.0;
  float bx = (vnoise(q + vec2(0.35, 0.0)) - vnoise(q - vec2(0.35, 0.0))) * bump + (vnoise(r + vec2(0.3, 0.0)) - vnoise(r - vec2(0.3, 0.0))) * 0.5 * hf;
  float bz = (vnoise(q + vec2(0.0, 0.35)) - vnoise(q - vec2(0.0, 0.35))) * bump + (vnoise(r + vec2(0.0, 0.3)) - vnoise(r - vec2(0.0, 0.3))) * 0.5 * hf;
  gNW = normalize(vec3(Ng.x - bx, Ng.y, Ng.z - bz));
  diffuseColor.rgb = col;
}`
        )
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);');
    };
    mat.customProgramCacheKey = () => 'terrain';
    return (this.material = mat);
  }

  // ---------- land-use masks ----------

  // Paints the green and paved polygons of a chunk into a layer of the mask: red wood, green
  // grass, pitches and cemeteries, blue plazas and sand.
  setMask(cx, cz, greens) {
    const k = this.maskIndex(cx, cz);
    if (k < 0) return;
    this.clearMask(cx, cz);
    let layer = 0;
    if (greens.length && this.free.length) {
      layer = this.free.pop();
      const g = this.maskCtx();
      g.clearRect(0, 0, MASK, MASK);
      const s = MASK / CH, ox = cx * CH, oz = cz * CH;
      for (const [kind, outer, holes] of greens) {
        g.fillStyle = kind === 'wood' ? '#f00' : kind === 'plaza' || kind === 'sand' ? '#00f' : '#0f0';
        g.beginPath();
        for (const ring of [outer, ...holes]) {
          for (let i = 0; i < ring.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, (ring[i] - ox) * s, (ring[i + 1] - oz) * s);
          g.closePath();
        }
        g.fill('evenodd');
      }
      const px = g.getImageData(0, 0, MASK, MASK).data, out = this.maskData, o = layer * MASK * MASK * 4;
      for (let i = 0; i < MASK * MASK; i++) {
        const a = px[i * 4 + 3] / 255;
        out[o + i * 4] = px[i * 4] * a;
        out[o + i * 4 + 1] = px[i * 4 + 1] * a;
        out[o + i * 4 + 2] = px[i * 4 + 2] * a;
        out[o + i * 4 + 3] = 255;
      }
      this.maskTex.addLayerUpdate(layer);
      this.maskTex.needsUpdate = true;
      this.layers.set(k, layer);
    }
    // 0 means the chunk is not loaded (the map alone paints it); layer 0 is the empty one.
    this.idx.data[k * 4] = layer + 1;
    this.idx.tex.needsUpdate = true;
  }

  clearMask(cx, cz) {
    const k = this.maskIndex(cx, cz);
    if (k < 0) return;
    const layer = this.layers.get(k);
    if (layer !== undefined) {
      this.free.push(layer);
      this.layers.delete(k);
    }
    this.idx.data[k * 4] = 0;
    this.idx.tex.needsUpdate = true;
  }

  maskIndex(cx, cz) {
    const i = cx - this.idx.cx0, j = cz - this.idx.cz0;
    return i < 0 || j < 0 || i >= this.idx.nx || j >= this.idx.nz ? -1 : j * this.idx.nx + i;
  }

  maskCtx() {
    if (!this._mc) {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(MASK, MASK) : Object.assign(document.createElement('canvas'), { width: MASK, height: MASK });
      this._mc = c.getContext('2d', { willReadFrequently: true });
    }
    return this._mc;
  }

  // ---------- meshes ----------

  // Adds the far mesh to the scene and builds the tiles around (x, z) at once.
  attach(scene, x, z, radius, onMesh) {
    this.scene = scene;
    this.onMesh = onMesh;
    this.buildFar();
    this.update(x, z, Infinity, radius);
  }

  buildFar() {
    const m = this.meta, s = m.step, w = m.w, h = m.h;
    const fx = axis(0, w - 1, 1, FAR), fz = axis(0, h - 1, 1, FAR);
    const nfx = fx.length, nfz = fz.length, EX = nfx + 2, EZ = nfz + 2;
    const pos = new Float32Array(EX * EZ * 3), nor = new Float32Array(EX * EZ * 3);
    const n = new THREE.Vector3();
    for (let b = 0; b < EZ; b++) {
      const jb = fz[Math.min(Math.max(b - 1, 0), nfz - 1)];
      for (let a = 0; a < EX; a++) {
        const ia = fx[Math.min(Math.max(a - 1, 0), nfx - 1)];
        const x = m.x0 + ia * s, z = m.z0 + jb * s, v = (b * EX + a) * 3;
        pos[v] = a === 0 ? -OUT : a === EX - 1 ? OUT : x;
        pos[v + 1] = this.data[jb * w + ia];
        pos[v + 2] = b === 0 ? -OUT : b === EZ - 1 ? OUT : z;
        this.smooth(x, z, n);
        nor[v] = n.x;
        nor[v + 1] = n.y;
        nor[v + 2] = n.z;
      }
    }
    // Index blocks: the frame beyond the grid always shows, the block of a tile is left out while that tile is loaded.
    const quad = (out, a, b) => {
      const v00 = b * EX + a, v10 = v00 + 1, v01 = v00 + EX, v11 = v01 + 1;
      const d = pos[v00 * 3 + 1] - pos[v10 * 3 + 1] - pos[v01 * 3 + 1] + pos[v11 * 3 + 1];
      if (d > 0) out.push(v00, v01, v10, v10, v01, v11);
      else out.push(v00, v01, v11, v00, v11, v10);
    };
    const frame = [];
    for (let b = 0; b < EZ - 1; b++) for (let a = 0; a < EX - 1; a++) if (a === 0 || b === 0 || a === EX - 2 || b === EZ - 2) quad(frame, a, b);
    this.farFrame = Uint32Array.from(frame);
    this.farBlocks = new Map();
    let total = frame.length;
    for (let tj = 0; tj < this.nTz; tj++) {
      for (let ti = 0; ti < this.nTx; ti++) {
        const blk = [];
        for (let b = 1 + tj * (TILE / FAR); b < Math.min(1 + (tj + 1) * (TILE / FAR), EZ - 2); b++)
          for (let a = 1 + ti * (TILE / FAR); a < Math.min(1 + (ti + 1) * (TILE / FAR), EX - 2); a++) quad(blk, a, b);
        this.farBlocks.set(ti + ',' + tj, Uint32Array.from(blk));
        total += blk.length;
      }
    }
    this.farIndex = new Uint32Array(total);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(this.farIndex, 1).setUsage(THREE.DynamicDrawUsage));
    const mesh = (this.mesh = new THREE.Mesh(g, this.material));
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.onMesh?.(mesh);
    this.farDirty = true;
    this.refreshFar();
  }

  refreshFar() {
    if (!this.farDirty) return;
    this.farDirty = false;
    let n = 0;
    this.farIndex.set(this.farFrame, n);
    n += this.farFrame.length;
    for (const [key, blk] of this.farBlocks) {
      if (this.tiles.has(key)) continue;
      this.farIndex.set(blk, n);
      n += blk.length;
    }
    const g = this.mesh.geometry;
    g.index.needsUpdate = true;
    g.setDrawRange(0, n);
  }

  // A tile: the heightfield of TILE x TILE cells, `per` vertices per cell, with a skirt around it.
  buildTile(ti, tj, per) {
    const m = this.meta, s = m.step;
    const i0 = ti * TILE, i1 = Math.min(i0 + TILE, m.w - 1), j0 = tj * TILE, j1 = Math.min(j0 + TILE, m.h - 1);
    const X = axis(i0, i1, per), Z = axis(j0, j1, per);
    const nx = X.length, nz = Z.length, grid = nx * nz, ring = 2 * (nx + nz) - 4;
    const pos = new Float32Array((grid + ring) * 3), nor = new Float32Array((grid + ring) * 3);
    const n = new THREE.Vector3();
    for (let b = 0; b < nz; b++) {
      for (let a = 0; a < nx; a++) {
        const x = m.x0 + X[a] * s, z = m.z0 + Z[b] * s, v = (b * nx + a) * 3;
        pos[v] = x;
        pos[v + 1] = this.height(x, z);
        pos[v + 2] = z;
        this.smooth(x, z, n);
        nor[v] = n.x;
        nor[v + 1] = n.y;
        nor[v + 2] = n.z;
      }
    }
    // Border vertices in order around the tile, each with a copy hanging SKIRT below.
    const border = [];
    for (let a = 0; a < nx; a++) border.push(a);
    for (let b = 1; b < nz; b++) border.push(b * nx + nx - 1);
    for (let a = nx - 2; a >= 0; a--) border.push((nz - 1) * nx + a);
    for (let b = nz - 2; b >= 1; b--) border.push(b * nx);
    for (let k = 0; k < ring; k++) {
      const src = border[k] * 3, dst = (grid + k) * 3;
      pos[dst] = pos[src];
      pos[dst + 1] = pos[src + 1] - SKIRT;
      pos[dst + 2] = pos[src + 2];
      nor[dst] = nor[src];
      nor[dst + 1] = nor[src + 1];
      nor[dst + 2] = nor[src + 2];
    }
    const idx = new Uint16Array((nx - 1) * (nz - 1) * 6 + ring * 12);
    let o = 0;
    for (let b = 0; b < nz - 1; b++) {
      for (let a = 0; a < nx - 1; a++) {
        const v00 = b * nx + a, v10 = v00 + 1, v01 = v00 + nx, v11 = v01 + 1;
        // The diagonal that keeps the mesh under the bilinear ground, so a road laid on the ground is never buried.
        const d = pos[v00 * 3 + 1] - pos[v10 * 3 + 1] - pos[v01 * 3 + 1] + pos[v11 * 3 + 1];
        const t = d > 0 ? [v00, v01, v10, v10, v01, v11] : [v00, v01, v11, v00, v11, v10];
        for (const v of t) idx[o++] = v;
      }
    }
    for (let k = 0; k < ring; k++) {
      const g0 = border[k], g1 = border[(k + 1) % ring], s0 = grid + k, s1 = grid + ((k + 1) % ring);
      for (const v of [g0, g1, s1, g0, s1, s0, g0, s1, g1, g0, s0, s1]) idx[o++] = v;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  // Every frame: moves the fade of the ground towards the map, and every quarter second looks for tiles to change.
  tick(dt, x, z) {
    this.uniforms.uCamXZ.value.set(x, z);
    if ((this.scan -= dt) > 0) return;
    this.scan = 0.25;
    this.update(x, z);
  }

  // Keeps the tiles around (x, z): fine ones close by, full-resolution ones out to the ring, and
  // takes the far mesh out under each. Builds at most `budget` per call, the nearest first.
  update(x, z, budget = 2, radius = RING_R) {
    this.uniforms.uCamXZ.value.set(x, z);
    const m = this.meta, span = TILE * m.step;
    const want = [];
    const t0 = (v, o) => Math.floor((v - o) / span);
    for (let tj = Math.max(0, t0(z - radius, m.z0)); tj <= Math.min(this.nTz - 1, t0(z + radius, m.z0)); tj++) {
      for (let ti = Math.max(0, t0(x - radius, m.x0)); ti <= Math.min(this.nTx - 1, t0(x + radius, m.x0)); ti++) {
        const ax = m.x0 + ti * span, az = m.z0 + tj * span;
        const d = Math.hypot(Math.max(ax - x, 0, x - (ax + span)), Math.max(az - z, 0, z - (az + span)));
        const key = ti + ',' + tj, have = this.tiles.get(key);
        const lod = have ? (have.per === NEAR_N ? (d < NEAR_KEEP ? NEAR_N : 1) : d < NEAR_R ? NEAR_N : 1) : d < NEAR_R ? NEAR_N : 1;
        if (d > (have ? RING_KEEP : radius)) continue;
        if (!have || have.per !== lod) want.push({ ti, tj, key, per: lod, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const t of want.slice(0, budget)) {
      const old = this.tiles.get(t.key);
      const mesh = new THREE.Mesh(this.buildTile(t.ti, t.tj, t.per), this.material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.onMesh?.(mesh);
      if (old) this.dropTile(old);
      else this.farDirty = true;
      this.tiles.set(t.key, { mesh, per: t.per });
    }
    for (const [key, t] of this.tiles) {
      const [ti, tj] = key.split(',').map(Number);
      const ax = m.x0 + ti * span, az = m.z0 + tj * span;
      if (Math.hypot(Math.max(ax - x, 0, x - (ax + span)), Math.max(az - z, 0, z - (az + span))) > RING_KEEP) {
        this.dropTile(t);
        this.tiles.delete(key);
        this.farDirty = true;
      }
    }
    this.refreshFar();
  }

  dropTile(t) {
    this.scene.remove(t.mesh);
    t.mesh.geometry.dispose();
  }
}

const _g = { x: 0, z: 0 };
