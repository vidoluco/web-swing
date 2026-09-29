import * as THREE from 'three';
import { h32 } from './buildings.js';

// Trees and shrubs. Foliage is made of leaf-clump cards (a photographic leaf, scattered densely on a canvas atlas
// in green, gold and red-orange) arranged in a crown, with normals bent radially so the crown shades like a volume.
// Three shared geometries (broadleaf, conifer, shrub) are instanced per chunk; non-uniform instance scales turn the
// broadleaf into a lime, a spreading plane tree, a poplar or a small maple. The vertex shader drops cards with
// distance and enlarges the rest, so far trees cost a fraction of near ones.

const CELL = 256;
const COLS = 4;
const ROWS = 5; // 0 green, 1 gold, 2 red-orange, 3 conifer, 4 bark

let seedv = 1;
const rand = () => ((seedv = (seedv * 16807) % 2147483647) / 2147483647);

function makeAtlas(leaf, bark) {
  const c = document.createElement('canvas');
  c.width = CELL * COLS;
  c.height = CELL * ROWS;
  const g = c.getContext('2d');
  const tint = (col, dark) => {
    const t = document.createElement('canvas');
    t.width = leaf ? leaf.width : 16;
    t.height = leaf ? leaf.height : 28;
    const x = t.getContext('2d');
    if (leaf) x.drawImage(leaf, 0, 0);
    else {
      x.fillStyle = '#4f8a2a';
      x.beginPath();
      x.ellipse(t.width / 2, t.height / 2, t.width / 2, t.height / 2, 0, 0, 7);
      x.fill();
    }
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = col;
    x.fillRect(0, 0, t.width, t.height);
    x.fillStyle = `rgba(0,0,0,${dark})`;
    x.fillRect(0, 0, t.width, t.height);
    return t;
  };
  // Palettes: overlay colour with alpha, from the leaf's own green.
  const pal = [
    ['rgba(30,85,25,0.5)', 'rgba(60,110,25,0.45)'], // green
    ['rgba(215,170,30,0.62)', 'rgba(200,125,25,0.6)'], // gold
    ['rgba(236,140,40,0.76)', 'rgba(218,98,34,0.72)'], // red-orange
  ];
  for (let row = 0; row < 3; row++) {
    const sprites = [];
    for (let k = 0; k < 6; k++) sprites.push(tint(pal[row][k % 2], (row === 0 ? 0.5 : 0.36) - k * 0.075));
    for (let cx = 0; cx < COLS; cx++) {
      const ox = cx * CELL, oy = row * CELL;
      g.save();
      g.beginPath();
      g.rect(ox, oy, CELL, CELL);
      g.clip();
      // A clump: leaves in an irregular blob. Dark inside, light on the rim and at the top.
      const n = 1100;
      const items = [];
      for (let i = 0; i < n; i++) {
        const a = rand() * 6.283, r = Math.sqrt(rand()) * (112 + 14 * Math.sin(a * 3 + cx));
        const x = CELL / 2 + Math.cos(a) * r, y = CELL / 2 + Math.sin(a) * r * 0.92;
        // sparser towards the rim and in patches, so the clump has an airy silhouette
        const clump = 0.5 + 0.5 * Math.sin(x * 0.075 + cx * 2.1 + row) * Math.sin(y * 0.083 + cx);
        if (rand() > Math.exp(-Math.pow(r / 100, 3)) * (0.35 + 0.8 * clump)) continue;
        const light = Math.min(1, Math.max(0, 0.3 + (r / 120) * 0.45 + (0.5 - y / CELL) * 0.35 + rand() * 0.3));
        items.push([x, y, light, rand() * 6.283, 0.8 + rand() * 0.5]);
      }
      items.sort((p, q) => p[2] - q[2]);
      for (const [x, y, light, rot, s] of items) {
        const sp = sprites[Math.min(5, Math.floor(light * 6))];
        const w = 12 * s, h = 12 * s * (sp.height / sp.width);
        g.save();
        g.translate(ox + x, oy + y);
        g.rotate(rot);
        g.drawImage(sp, -w / 2, -h / 2, w, h);
        g.restore();
      }
      g.restore();
    }
  }
  // Conifer sprays: a twig with needles on both sides, dark green.
  for (let cx = 0; cx < COLS; cx++) {
    const ox = cx * CELL, oy = 3 * CELL;
    g.save();
    g.beginPath();
    g.rect(ox, oy, CELL, CELL);
    g.clip();
    g.lineCap = 'round';
    const twigs = 5 + cx;
    for (let t = 0; t < twigs; t++) {
      const a0 = -1.57 + (t - twigs / 2) * 0.42 + (rand() - 0.5) * 0.2;
      const len = 105 + rand() * 25;
      const bx = ox + CELL / 2, by = oy + CELL - 20;
      for (let s = 0; s < 46; s++) {
        const f = s / 46;
        const px = bx + Math.cos(a0) * len * f, py = by + Math.sin(a0) * len * f;
        for (const side of [-1, 1]) {
          const na = a0 + side * (1.05 - f * 0.35) + (rand() - 0.5) * 0.3;
          const nl = 24 * (1 - f * 0.55) * (0.8 + rand() * 0.4);
          const l = 18 + Math.floor(rand() * 26);
          g.strokeStyle = `hsl(${118 + rand() * 12}, ${32 + rand() * 12}%, ${l}%)`;
          g.lineWidth = 3.2;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
          g.stroke();
        }
      }
      g.strokeStyle = '#3a2a1c';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(a0) * len, by + Math.sin(a0) * len);
      g.stroke();
    }
    g.restore();
  }
  // Bark tile: the photographic bark, lightened a little so trunks do not turn black in the shade
  g.fillStyle = '#7d6a58';
  g.fillRect(0, 4 * CELL, CELL, CELL);
  if (bark) {
    g.drawImage(bark, 0, 4 * CELL, CELL, CELL);
    // desaturate towards a grey-brown and lift it, so trunks do not read as red or black
    const im = g.getImageData(0, 4 * CELL, CELL, CELL);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const gr = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      d[i] = Math.min(255, (gr * 0.75 + d[i] * 0.25) * 1.5 + 30);
      d[i + 1] = Math.min(255, (gr * 0.75 + d[i + 1] * 0.25) * 1.2 + 16);
      d[i + 2] = Math.min(255, (gr * 0.75 + d[i + 2] * 0.25) * 0.85 + 6);
    }
    g.putImageData(im, 0, 4 * CELL);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex: t, canvas: c };
}

// ---- geometry ----
class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.card = [];
    this.center = [];
    this.part = [];
    this.idx = [];
    this.n = 0;
  }
  // A quad card centred at c, spanned by the unit vectors ax, ay, with half sizes.
  card_(c, ax, ay, hw, hh, normal, cell, ao, cardId) {
    const base = this.n;
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of cs) {
      this.pos.push(c.x + ax.x * hw * sx + ay.x * hh * sy, c.y + ax.y * hw * sx + ay.y * hh * sy, c.z + ax.z * hw * sx + ay.z * hh * sy);
      this.nor.push(normal.x, normal.y, normal.z);
      this.uv.push((cell.col + (sx + 1) / 2) / COLS, 1 - (cell.row + 1 - (sy + 1) / 2) / ROWS);
      this.col.push(ao, ao, ao);
      this.card.push(cardId);
      this.center.push(c.x, c.y, c.z);
      this.part.push(0);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.n += 4;
  }
  // Tapered tube along a curve of points with radii; bark uv covers the atlas bark tile.
  tube(points, radii, sides = 6, v0 = 0, v1 = 1) {
    const base = this.n;
    const rings = points.length;
    for (let i = 0; i < rings; i++) {
      const p = points[i];
      const a = points[Math.max(0, i - 1)], b = points[Math.min(rings - 1, i + 1)];
      const d = new THREE.Vector3().subVectors(b, a).normalize();
      const s = Math.abs(d.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(d, s).normalize();
      const w = new THREE.Vector3().crossVectors(d, u).normalize();
      for (let k = 0; k <= sides; k++) {
        const ang = (k / sides) * 6.283;
        const nx = Math.cos(ang) * u.x + Math.sin(ang) * w.x, ny = Math.cos(ang) * u.y + Math.sin(ang) * w.y, nz = Math.cos(ang) * u.z + Math.sin(ang) * w.z;
        this.pos.push(p.x + nx * radii[i], p.y + ny * radii[i], p.z + nz * radii[i]);
        this.nor.push(nx, ny, nz);
        const v = v0 + (v1 - v0) * (i / (rings - 1));
        this.uv.push((k / sides) * (1 / COLS), 1 - (4 + 1 - v) / ROWS);
        this.col.push(1, 1, 1);
        this.card.push(0);
        this.center.push(p.x, p.y, p.z);
        this.part.push(1);
        this.n++;
      }
    }
    for (let i = 0; i < rings - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = base + i * (sides + 1) + k, b = a + 1, c = a + sides + 1, d = c + 1;
        this.idx.push(a, b, c, b, d, c);
      }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.card, 1));
    g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.center, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function broadleaf(near) {
  seedv = 41;
  const B = new GeoBuilder();
  const H = 11, trunkH = 4.6, R = new THREE.Vector3(4.3, 4.4, 4.3), C = new THREE.Vector3(0, trunkH + 2.5, 0);
  // trunk with a slight lean and five limbs into the crown
  const tp = [], tr = [];
  const rings = near ? 5 : 2;
  for (let i = 0; i <= rings; i++) {
    tp.push(new THREE.Vector3(Math.sin((i / rings) * 2.5) * 0.12, (i / rings) * trunkH, 0));
    tr.push(0.3 - (i / rings) * 0.2);
  }
  B.tube(tp, tr, near ? 7 : 5, 0, 1);
  for (let k = 0; k < (near ? 5 : 0); k++) {
    const a = (k / 5) * 6.283 + rand();
    const from = tp[Math.min(rings, 3 + (k % 3))].clone();
    const to = new THREE.Vector3(Math.cos(a) * R.x * 0.55, C.y + R.y * (0.1 + rand() * 0.4), Math.sin(a) * R.z * 0.55);
    const pts = [from, from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.3, 0)), to];
    B.tube(pts, [0.09, 0.06, 0.025], 5, 0.2, 0.6);
  }
  const N = near ? 56 : 14;
  for (let i = 0; i < N; i++) {
    // points in the ellipsoid, pushed towards the surface
    let d = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const r = 0.45 + 0.55 * Math.pow(rand(), 0.55);
    const p = new THREE.Vector3(C.x + d.x * R.x * r, C.y + d.y * R.y * r, C.z + d.z * R.z * r);
    const nrm = new THREE.Vector3(d.x / R.x, d.y / R.y, d.z / R.z).normalize();
    // card plane: mostly facing outward, some tilted freely
    const face = rand() < 0.7 ? nrm.clone().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.7)).normalize() : new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const ax = new THREE.Vector3().crossVectors(face, new THREE.Vector3(0, 1, 0));
    if (ax.lengthSq() < 0.01) ax.set(1, 0, 0);
    ax.normalize();
    const ay = new THREE.Vector3().crossVectors(face, ax).normalize();
    const sz = (1.55 + rand() * 0.6) * (near ? 1 : 2.05);
    const ao = 0.5 + 0.5 * Math.pow(r, 1.3) + 0.12 * Math.max(0, d.y);
    B.card_(p, ax, ay, sz, sz, nrm.clone().lerp(new THREE.Vector3(0, 1, 0), 0.15).normalize(), { col: i % COLS, row: 0 }, Math.min(1.1, ao), (i * 0.61803) % 1);
  }
  void H;
  return B.geometry();
}

function conifer(near) {
  seedv = 77;
  const B = new GeoBuilder();
  const H = 12;
  B.tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 3, 0), new THREE.Vector3(0, H, 0)], [0.22, 0.14, 0.02], 7, 0, 1);
  const tiers = near ? 9 : 5;
  let id = 0;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = 2.0 + f * (H - 2.6);
    const rad = 3.0 * (1 - f) + 0.35;
    const per = Math.max(3, Math.round((10 - f * 5) * (near ? 1 : 0.6)));
    for (let k = 0; k < per; k++) {
      const a = ((k + (t % 2) * 0.5) / per) * 6.283 + rand() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a), -0.45 - 0.2 * rand(), Math.sin(a)).normalize();
      const c = new THREE.Vector3(Math.cos(a) * rad * 0.62, y - 0.3 * rad * 0.4, Math.sin(a) * rad * 0.62);
      const ax = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const ay = dir.clone().negate().setY(Math.abs(dir.y) * 0.4 + 0.35).normalize();
      const ay2 = new THREE.Vector3().crossVectors(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), ax).normalize().add(new THREE.Vector3(Math.cos(a) * 0.4, 0.5, Math.sin(a) * 0.4)).normalize();
      const nrm = new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize();
      const sz = (0.9 + rad * 0.32) * (near ? 1 : 1.5);
      B.card_(c.clone().add(new THREE.Vector3(Math.cos(a) * rad * 0.15, 0, Math.sin(a) * rad * 0.15)), ax, ay2, sz * 1.1, sz, nrm, { col: (t + k) % COLS, row: 3 }, 0.55 + 0.45 * (0.5 + 0.5 * f), (id++ * 0.61803) % 1);
      void ay;
    }
  }
  return B.geometry();
}

function shrub(near) {
  seedv = 5;
  const B = new GeoBuilder();
  const C = new THREE.Vector3(0, 0.75, 0);
  const R = new THREE.Vector3(1.0, 0.75, 1.0);
  const N = near ? 14 : 6;
  for (let i = 0; i < N; i++) {
    const d = new THREE.Vector3(rand() - 0.5, rand() * 0.9 - 0.3, rand() - 0.5).normalize();
    const r = 0.5 + 0.5 * rand();
    const p = new THREE.Vector3(C.x + d.x * R.x * r, C.y + d.y * R.y * r, C.z + d.z * R.z * r);
    const nrm = d.clone();
    const face = nrm.clone().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.8)).normalize();
    const ax = new THREE.Vector3().crossVectors(face, new THREE.Vector3(0, 1, 0));
    if (ax.lengthSq() < 0.01) ax.set(1, 0, 0);
    ax.normalize();
    const ay = new THREE.Vector3().crossVectors(face, ax).normalize();
    const sz = (0.55 + rand() * 0.3) * (near ? 1 : 1.5);
    B.card_(p, ax, ay, sz, sz, nrm, { col: i % COLS, row: 0 }, 0.6 + 0.4 * r, (i * 0.61803) % 1);
  }
  return B.geometry();
}

export class Trees {
  constructor(city, assets) {
    this.city = city;
    const atlas = makeAtlas(assets.leaf, assets.bark);
    this.atlas = atlas;
    this.time = { value: 0 };
    this.geos = { broad: broadleaf(true), conifer: conifer(true), shrub: shrub(true) };
    this.farGeos = { broad: broadleaf(false), conifer: conifer(false), shrub: shrub(false) };
    const mat = new THREE.MeshStandardMaterial({ map: atlas.tex, vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45 });
    const time = this.time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aCard; attribute vec3 aCenter; attribute float aPart;
uniform float uTime;
varying float vPart;`
        )
        .replace(
          '#include <color_vertex>',
          THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= instanceColor.rgb;', `vColor.rgb *= instanceColor.r; if (aPart < 0.5) vMapUv.y -= floor(instanceColor.g * 2.0 + 0.5) / ${ROWS}.0;`) + '\nvPart = aPart;'
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 wp = (modelMatrix * ip).xyz;
  float d = distance(wp, cameraPosition);
  float keep = 1.0 - 0.8 * smoothstep(70.0, 520.0, d);
  if (aPart < 0.5) {
    if (aCard > keep || d > 2600.0) { transformed = aCenter; }
    else transformed = aCenter + (transformed - aCenter) * inversesqrt(keep);
    // sway grows with height and phase depends on the tree
    float ph = uTime * 1.6 + wp.x * 0.11 + wp.z * 0.13;
    transformed.xz += vec2(sin(ph), cos(ph * 0.9)) * 0.045 * clamp(transformed.y / 8.0, 0.0, 1.5) * (1.0 + aCard);
  }
}`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPart;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '').replace('tbn[0] *= faceDirection;', '').replace('tbn[1] *= faceDirection;', ''))
        .replace('#include <alphatest_fragment>', 'if (vPart > 0.5) diffuseColor.a = 1.0;\n#include <alphatest_fragment>')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
#if NUM_DIR_LIGHTS > 0
  if (vPart < 0.5) {
    // leaves glow when the sun is behind them
    float bt = pow(clamp(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.0, 1.0), 2.5);
    totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * bt * 0.5;
  }
#endif`
        );
    };
    mat.customProgramCacheKey = () => 'trees-v1';
    this.mat = mat;
  }

  // t: flat [x, z, ...]. Returns InstancedMeshes for one chunk.
  build(t) {
    const city = this.city;
    const n = t.length / 2;
    const lists = { broad: [], conifer: [], shrub: [] };
    for (let i = 0; i < n; i++) {
      const x = t[i * 2], z = t[i * 2 + 1];
      const hh = h32(Math.round(x * 4) * 73856093 ^ Math.round(z * 4) * 19349663);
      const r1 = (hh & 1023) / 1023, r2 = ((hh >> 10) & 1023) / 1023, r3 = ((hh >> 20) & 1023) / 1023;
      let kind = 'broad';
      const conif = city.brasov ? 0.34 : 0.07;
      if (r1 < conif) kind = 'conifer';
      else if (r1 > 0.93 && !city.brasov) kind = 'shrub';
      lists[kind].push([x, z, r1, r2, r3, hh]);
    }
    const out = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    for (const kind of ['broad', 'conifer', 'shrub']) {
      const L = lists[kind];
      if (!L.length) continue;
      const mesh = new THREE.InstancedMesh(this.geos[kind], this.mat, L.length);
      const pal = new Float32Array(L.length);
      const bright = new Float32Array(L.length);
      const ic = new Float32Array(L.length * 3); // raw data, not a colour: no colour management
      for (let i = 0; i < L.length; i++) {
        const [x, z, r1, r2, r3, hh] = L[i];
        q.setFromAxisAngle(Y, r2 * 6.283);
        let sx = 1, sy = 1;
        if (kind === 'broad') {
          // species by shape: lime, spreading plane, poplar, small maple
          const sp = (hh >> 5) & 3;
          if (sp === 0) (sx = 0.85 + r3 * 0.35), (sy = sx);
          else if (sp === 1) (sx = 1.25 + r3 * 0.4), (sy = 0.95 + r2 * 0.25);
          else if (sp === 2) (sx = 0.5 + r3 * 0.15), (sy = 1.35 + r2 * 0.4);
          else (sx = 0.6 + r3 * 0.2), (sy = 0.6 + r3 * 0.2);
          // colour: mostly green with gold and red in late September
          const c = ((hh >> 12) & 255) / 255;
          pal[i] = sp === 3 ? (c < 0.4 ? 2 : c < 0.7 ? 1 : 0) : sp === 2 ? (c < 0.5 ? 1 : 0) : c < 0.62 ? 0 : c < 0.9 ? 1 : 2;
          bright[i] = 0.9 + r1 * 0.3;
        } else if (kind === 'conifer') {
          sx = 0.75 + r3 * 0.5; sy = 0.8 + r2 * 0.5;
          pal[i] = 0;
          bright[i] = 0.8 + r1 * 0.35;
        } else {
          sx = 0.8 + r3 * 0.8; sy = 0.7 + r2 * 0.7;
          pal[i] = (hh >> 9) & 1;
          bright[i] = 0.8 + r1 * 0.3;
        }
        m4.compose(p.set(x, city.groundAt ? city.groundAt(x, z) : 0, z), q, s.set(sx, sy, sx));
        mesh.setMatrixAt(i, m4);
        // instance colour carries data: r = brightness, g = palette row / 2
        ic[i * 3] = bright[i];
        ic[i * 3 + 1] = pal[i] / 2;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(ic, 3);
      mesh.castShadow = false; // switched on for the chunks near the camera (CityLook.update)
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.userData.lod = 'near';
      // the far version shares the instance buffers and is shown instead beyond ~400 m
      const far = new THREE.InstancedMesh(this.farGeos[kind], this.mat, L.length);
      far.instanceMatrix = mesh.instanceMatrix;
      far.instanceColor = mesh.instanceColor;
      far.count = mesh.count;
      far.receiveShadow = true;
      far.boundingSphere = mesh.boundingSphere;
      far.userData.lod = 'far';
      far.visible = false;
      out.push(mesh, far);
    }
    return out;
  }

  update(dt, time) {
    this.time.value = time;
  }
}
