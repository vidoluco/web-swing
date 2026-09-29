import * as THREE from 'three';
import { clamp } from './config.js';
import { osmBuildingMaterial, surfaceMaterial, markingMaterial, waterMaterial, treeMaterials } from './materials2.js';
import { Terrain } from './terrain.js'; // terrain:
import { HillSign } from './hillsign.js'; // terrain:

// Bucharest rebuilt from OpenStreetMap chunks (see tools/osm-build.mjs).
// Buildings are prisms: a footprint polygon (with holes) between y0 and y1. Everything the
// player touches (collisions, web anchors, zip rays, camera) runs against those prisms.

const CELL = 32;
const PARAPET = 0.8;
const LIFT = 0.03; // terrain: streets lie this far above the ground, the mesh under them can be a few cm off
const FOUNDATION = 0.35; // terrain: how far the walls of a building on a slope reach below its base
const _v = new THREE.Vector3();

function ringArea(xs) {
  let a = 0;
  const n = xs.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (xs[j * 2] - xs[i * 2]) * (xs[j * 2 + 1] + xs[i * 2 + 1]);
  return a / 2;
}

function pointInRing(x, z, r) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// The polyline with points added so no piece is longer than 6 m.
function densify(pts) {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
    const k = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
    for (let j = 1; j < k; j++) out.push(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k);
    out.push(bx, bz);
  }
  return out;
}

export const roadKey = (x, z) => (Math.round(x * 2) + 100000) * 400000 + Math.round(z * 2) + 100000;

export function pointInPrism2D(x, z, b) {
  if (x < b.minx || x > b.maxx || z < b.minz || z > b.maxz) return false;
  if (!pointInRing(x, z, b.outer)) return false;
  for (const h of b.holes) if (pointInRing(x, z, h)) return false;
  return true;
}

// Closest point on the prism boundary (2D) plus the outward normal of that edge.
export function closestOnPrism(x, z, b, out) {
  let best = Infinity;
  const rings = [b.outer, ...b.holes];
  for (let ri = 0; ri < rings.length; ri++) {
    const r = rings[ri];
    const s = b.signs[ri];
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[j * 2], az = r[j * 2 + 1], bx = r[i * 2], bz = r[i * 2 + 1];
      const ex = bx - ax, ez = bz - az;
      const L2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1);
      const px = ax + ex * t, pz = az + ez * t;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) {
        best = d;
        const L = Math.sqrt(L2);
        out.x = px;
        out.z = pz;
        out.nx = (s * ez) / L;
        out.nz = (-s * ex) / L;
        out.t = t;
      }
    }
  }
  out.d = Math.sqrt(best);
  return out;
}

export class OsmCity {
  // base is the city folder, public/city/<id>; spawnFacing is the point the start roof looks at.
  // options: { sign } a row of big letters on a hillside (cities.js), { spawn } { x, z, r } where to look for the start roof
  static async load(base, scene, envMap, textures, onProgress, spawnFacing, options = {}) {
    const index = await fetch(`${base}/index.json`).then((r) => r.json());
    const city = new OsmCity(scene, envMap, textures, index, base);
    // terrain: the grid comes first, the buildings, roads and trees are laid on it as they are built
    if (index.dem) city.terrain = new Terrain(index.dem, await fetch(`${base}/${index.dem.file}`).then((r) => r.arrayBuffer()));
    const lod = await fetch(`${base}/lod.bin`).then((r) => (r.ok ? r.arrayBuffer() : null));
    if (lod) city.buildLOD(new Float32Array(lod));
    if (index.map) {
      const tex = await new THREE.TextureLoader().loadAsync(`${base}/${index.map.file}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.anisotropy = 8;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      const u = city.mats.ground.userData.city;
      u.tCity.value = tex;
      u.uCityBox.value.set(index.map.x0, index.map.z0, index.map.x1, index.map.z1);
      u.uHasCity.value = 1;
    }
    if (city.terrain) city.attachTerrain(textures); // terrain:
    if (options.sign && city.terrain) city.sign = new HillSign(city, options.sign); // terrain:
    if (options.treeTint !== undefined) city.mats.crown.color.set(options.treeTint); // terrain: darker crowns
    // The first ring around the origin is loaded up front so the start tower exists.
    await city.streamAround(0, 0, 1100, onProgress);
    city.finish(spawnFacing, options.spawn);
    return city;
  }

  async fetchChunk(rec) {
    rec.state = 'loading';
    try {
      rec.data = await fetch(`${this.base}/${rec.info.k}.json`).then((r) => r.json());
      rec.state = 'fetched';
    } catch {
      rec.state = 'idle';
    }
  }

  async streamAround(x, z, R, onProgress) {
    const want = this.chunksWithin(x, z, R).filter((r) => r.state === 'idle');
    let done = 0;
    const queue = want.slice();
    const worker = async () => {
      while (queue.length) {
        const rec = queue.shift();
        await this.fetchChunk(rec);
        if (rec.state === 'fetched') this.buildChunk(rec);
        onProgress?.(++done / want.length);
      }
    };
    await Promise.all(Array.from({ length: 10 }, worker));
  }

  chunksWithin(x, z, R) {
    const C = this.index.chunk;
    const out = [];
    for (const rec of this.recs.values()) {
      const d = Math.hypot((rec.info.cx + 0.5) * C - x, (rec.info.cz + 0.5) * C - z);
      if (d < R) out.push(rec);
      rec.dist = d;
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  constructor(scene, envMap, textures, index, base) {
    this.base = base;
    this.cityId = base.split('/').pop();
    this.origin = index.origin; // { lat, lon } of the local (0, 0)
    this.recs = new Map(index.chunks.map((c) => [c.k, { info: c, state: 'idle', prisms: [], waters: [], mm: [], group: null }]));
    this.mmCells = new Map();
    this.roadNodes = new Map();
    this.streamT = 0;
    this.building = [];
    this.scene = scene;
    this.envMap = envMap;
    this.index = index;
    this.terrain = null; // terrain: set by load() for a city with a dem
    this.clearings = null; // terrain: [(x, z) => bool] places where no trees are planted
    this.extraGreens = null; // terrain: [kind, outer, holes] painted on the ground next to the ones of the chunks
    this.prisms = [];
    this.grid = new Map();
    this.waterGrid = new Map();
    this.waters = [];
    this.stamp = 0;
    this.mats = {
      building: osmBuildingMaterial(envMap, textures),
      ground: surfaceMaterial('ground', textures),
      sidewalk: surfaceMaterial('sidewalk', textures),
      road: surfaceMaterial('road', textures),
      grass: surfaceMaterial('grass', textures),
      plaza: surfaceMaterial('plaza', textures),
      marking: markingMaterial(),
      trail: new THREE.MeshStandardMaterial({ color: 0x6a5c48, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), // terrain: paths in the woods
      rail: new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.4, metalness: 0.8, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }),
      water: waterMaterial(envMap, textures),
      ...treeMaterials(),
    };
    this.bounds = { minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity };
    // Ground: one big plane under everything.
    const g = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), this.mats.ground);
    g.receiveShadow = true;
    scene.add(g);
    this.groundMesh = g;
  }

  // terrain: the ground of a city with relief. The flat plane goes, the far mesh and the tiles around
  // the start take its place; the land-use map of the ground paints it.
  attachTerrain(textures) {
    const m = this.index.map, T = this.terrain;
    const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 120, 255]), 1, 1);
    fallback.needsUpdate = true;
    T.makeMaterial({
      map: m ? this.mats.ground.userData.city.tCity.value : fallback,
      box: m ? [m.x0, m.z0, m.x1, m.z1] : [-1e5, -1e5, 1e5, 1e5],
      pavers: textures.pavers,
      concrete: textures.concrete,
    });
    this.scene.remove(this.groundMesh);
    this.groundMesh.geometry.dispose();
    T.attach(this.scene, 0, 0, 1100, (mesh) => this.onChunkMesh?.(mesh));
  }

  // ---------- chunk building ----------

  buildChunk(rec) {
    const info = rec.info, data = rec.data;
    rec.data = null;
    this._rec = rec;
    const group = new THREE.Group();
    group.userData.cx = (info.cx + 0.5) * this.index.chunk;
    group.userData.cz = (info.cz + 0.5) * this.index.chunk;
    const bgeo = this.buildBuildings(data.b);
    if (bgeo) {
      const m = new THREE.Mesh(bgeo, this.mats.building);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    const pm = this.propMesh(this._props || []);
    if (pm) group.add(pm);
    this.indexRoads(rec, data.r);
    this.placePois(rec, data.p || []);
    const lines = this.buildLines(data.r, data.g);
    for (const [key, geo] of Object.entries(lines)) {
      if (!geo) continue;
      const m = new THREE.Mesh(geo, key === 'river' ? this.mats.water : this.mats[key]);
      m.receiveShadow = true;
      group.add(m);
    }
    const rails = this.buildRails(data.rl);
    if (rails) group.add(new THREE.Mesh(rails, this.mats.rail));
    this.terrain?.setMask(info.cx, info.cz, this.extraGreens ? data.g.concat(this.extraGreens) : data.g); // terrain: woods, meadows and plazas are painted on the ground
    const areas = this.buildAreas(data.w, data.g);
    for (const [key, geo] of Object.entries(areas)) {
      if (!geo) continue;
      const m = new THREE.Mesh(geo, key === 'water' ? this.mats.water : this.mats[key]);
      m.receiveShadow = true;
      group.add(m);
    }
    if (data.t.length) group.add(...this.buildTrees(data.t));
    this.scene.add(group);
    this.onChunkMesh?.(group);
    rec.group = group;
    rec.state = 'loaded';
    this.setLODVisible(info, false);
    this._rec = null;
  }

  // Bars and kiosks sit inside their buildings in OSM: move each one out to the pavement in front.
  placePois(rec, list) {
    rec.pois = [];
    for (const [x, z, kind, name] of list) {
      const poi = { x, z, nx: 0, nz: 0, kind, name };
      this.settlePoi(poi);
      if (this.isWater(poi.x, poi.z)) continue;
      rec.pois.push(poi);
      this.mmPut(poi.x, poi.z, 'p', poi);
    }
  }

  // Push a place out of any building footprint it stands in; nx, nz then point away from that
  // building. Called again when the place is shown, since a neighbour chunk may load later.
  settlePoi(poi) {
    const cp = {};
    for (let pass = 0; pass < 3; pass++) {
      const b = this.nearby(poi.x, poi.z, 1, []).find((q) => q.kind !== 'prop' && q.y0 < this.lowGround(q) + 1 && pointInPrism2D(poi.x, poi.z, q));
      if (!b) return;
      closestOnPrism(poi.x, poi.z, b, cp);
      const dx = cp.x - poi.x, dz = cp.z - poi.z, d = Math.hypot(dx, dz) || 1;
      poi.nx = dx / d;
      poi.nz = dz / d;
      poi.x = cp.x + poi.nx * 1.8;
      poi.z = cp.z + poi.nz * 1.8;
    }
  }

  // Drivable roads of a chunk, with every vertex indexed so traffic can turn where roads meet.
  indexRoads(rec, roads) {
    rec.roads = [];
    rec.roadKeys = [];
    for (const r of roads) {
      if (r.cls !== 'road' || r.w < 5.5 || r.pts.length < 4) continue;
      const road = { pts: Float32Array.from(r.pts), w: r.w, oneway: !!r.oneway, major: !!r.major, len: 0 };
      const n = road.pts.length / 2;
      for (let i = 0; i < n; i++) {
        if (i) road.len += Math.hypot(road.pts[2 * i] - road.pts[2 * i - 2], road.pts[2 * i + 1] - road.pts[2 * i - 1]);
        const k = roadKey(road.pts[2 * i], road.pts[2 * i + 1]);
        let a = this.roadNodes.get(k);
        if (!a) this.roadNodes.set(k, (a = []));
        a.push([road, i]);
        rec.roadKeys.push(k);
      }
      rec.roads.push(road);
    }
  }

  unloadChunk(rec) {
    if (rec.roads) {
      const gone = new Set(rec.roads);
      for (const k of rec.roadKeys) {
        const a = this.roadNodes.get(k);
        if (!a) continue;
        const f = a.filter((e) => !gone.has(e[0]));
        if (f.length) this.roadNodes.set(k, f);
        else this.roadNodes.delete(k);
      }
      rec.roads = rec.roadKeys = null;
    }
    const g = rec.group;
    if (g) {
      this.scene.remove(g);
      g.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        else if (o.isMesh && !o.userData.sharedGeo) o.geometry.dispose();
      });
    }
    const gone = new Set(rec.prisms);
    for (const p of rec.prisms) {
      for (let gx = Math.floor(p.minx / CELL); gx <= Math.floor(p.maxx / CELL); gx++) {
        for (let gz = Math.floor(p.minz / CELL); gz <= Math.floor(p.maxz / CELL); gz++) {
          const k = gx * 100003 + gz;
          const a = this.grid.get(k);
          if (!a) continue;
          const f = a.filter((q) => !gone.has(q));
          if (f.length) this.grid.set(k, f);
          else this.grid.delete(k);
        }
      }
    }
    this.prisms = this.prisms.filter((q) => !gone.has(q));
    const wgone = new Set(rec.waters);
    for (const [k, a] of this.waterGrid) {
      const f = a.filter((w) => !wgone.has(w));
      if (f.length !== a.length) f.length ? this.waterGrid.set(k, f) : this.waterGrid.delete(k);
    }
    for (const [k, type, item] of rec.mm) {
      const c = this.mmCells.get(k);
      if (c) c[type] = c[type].filter((x) => x !== item);
    }
    this.terrain?.clearMask(rec.info.cx, rec.info.cz); // terrain:
    rec.prisms = [];
    rec.waters = [];
    rec.mm = [];
    rec.group = null;
    rec.state = 'idle';
    this.setLODVisible(rec.info, true);
  }

  mmPut(x, z, type, item) {
    const k = Math.floor(x / 200) * 1000 + Math.floor(z / 200);
    let c = this.mmCells.get(k);
    if (!c) this.mmCells.set(k, (c = { b: [], r: [], g: [], w: [], p: [] }));
    c[type].push(item);
    this._rec?.mm.push([k, type, item]);
  }

  buildLOD(f) {
    const n = f.length / 11;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUp = normal.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vUp > 0.5 ? vec3(0.16) : diffuseColor.rgb * 0.72;');
    };
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color(), Yax = new THREE.Vector3(0, 1, 0);
    this.lodMatrices = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      q.setFromAxisAngle(Yax, -f[o + 4]);
      // terrain: a box far away stands 4 m deeper, so it never floats over the coarse ground mesh
      const sink = this.terrain ? 4 : 0;
      m4.compose(p.set(f[o], f[o + 5] - sink, f[o + 1]), q, sc.set(Math.max(1, f[o + 2] * 2), Math.max(1, f[o + 6] - f[o + 5]) + sink, Math.max(1, f[o + 3] * 2)));
      mesh.setMatrixAt(i, m4);
      m4.toArray(this.lodMatrices, i * 16);
      mesh.setColorAt(i, c.setRGB(f[o + 7], f[o + 8], f[o + 9], THREE.SRGBColorSpace));
    }
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    this.lod = mesh;
    this.scene.add(mesh);
  }

  setLODVisible(info, visible) {
    if (!this.lod || !info.lod) return;
    const [start, count] = info.lod;
    const arr = this.lod.instanceMatrix.array;
    for (let i = start; i < start + count; i++) {
      if (visible) arr.set(this.lodMatrices.subarray(i * 16, i * 16 + 16), i * 16);
      else arr.fill(0, i * 16, i * 16 + 16);
    }
    this.lod.instanceMatrix.addUpdateRange(start * 16, count * 16);
    this.lod.instanceMatrix.needsUpdate = true;
  }

  buildBuildings(list) {
    if (!list.length) return null;
    const pos = [], nor = [], col = [], u = [], base = [], top = [], sty = [], seed = [], roof = [], tan = [];
    const props = [];
    const color = new THREE.Color();
    const pushV = (x, y, z, nx, ny, nz, uu, b, t, s, sd, rf, tx, tz) => {
      pos.push(x, y, z);
      nor.push(nx, ny, nz);
      col.push(color.r, color.g, color.b);
      u.push(uu);
      base.push(b);
      top.push(t);
      sty.push(s);
      seed.push(sd);
      roof.push(rf);
      tan.push(tx, tz);
    };
    for (const [s, hex, y0, y1, rf, sd, outerArr, holesArr, name] of list) {
      if (y1 - y0 < 0.5) continue;
      color.set(hex);
      const outer = Float32Array.from(outerArr);
      const holes = holesArr.map((h) => Float32Array.from(h));
      const rings = [outer, ...holes];
      // Outer rings wind one way, holes the other; the sign makes every wall normal point outward.
      const signs = rings.map((r, i) => (i === 0 ? Math.sign(ringArea(r)) || 1 : -(Math.sign(ringArea(r)) || 1)));
      const prism = { outer, holes, signs, y0, y1, minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity, kind: 'building', name, style: s, pitched: !!rf && !holes.length && outer.length === 8 }; // terrain: pitched: a hipped roof stands over y1
      for (let i = 0; i < outer.length; i += 2) {
        prism.minx = Math.min(prism.minx, outer[i]);
        prism.maxx = Math.max(prism.maxx, outer[i]);
        prism.minz = Math.min(prism.minz, outer[i + 1]);
        prism.maxz = Math.max(prism.maxz, outer[i + 1]);
      }
      this.addPrism(prism);
      const b = this.bounds;
      b.minx = Math.min(b.minx, prism.minx); b.maxx = Math.max(b.maxx, prism.maxx);
      b.minz = Math.min(b.minz, prism.minz); b.maxz = Math.max(b.maxz, prism.maxz);
      this.mmPut((prism.minx + prism.maxx) / 2, (prism.minz + prism.maxz) / 2, 'b', outer);
      const parapet = !rf && y1 - y0 > 9 && y0 < this.lowGround(prism) + 0.5;
      const yb = this.terrain ? y0 - FOUNDATION : y0; // terrain: the walls go a little into the hillside
      if (parapet) this.roofProps(prism, props);
      // Walls.
      for (let ri = 0; ri < rings.length; ri++) {
        const r = rings[ri];
        const sg = signs[ri];
        const n = r.length / 2;
        let uacc = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
          const ex = bx - ax, ez = bz - az;
          const L = Math.hypot(ex, ez);
          if (L < 0.05) continue;
          const nx = (sg * ez) / L, nz = (-sg * ex) / L;
          const tx = ex / L, tz = ez / L;
          const u0 = uacc, u1 = uacc + L;
          uacc = u1;
          const yt = parapet ? y1 + PARAPET : y1;
          // Two triangles, wound counter-clockwise when seen from outside.
          const quad = [[ax, yb, az, u0], [bx, yb, bz, u1], [bx, yt, bz, u1], [ax, yb, az, u0], [bx, yt, bz, u1], [ax, yt, az, u0]];
          // Check winding against the normal and flip if needed.
          const c1x = bx - ax, c1y = 0, c1z = bz - az, c2x = 0, c2y = y1 - y0, c2z = 0;
          const cx = c1y * c2z - c1z * c2y, cz = c1x * c2y - c1y * c2x;
          const flip = cx * nx + cz * nz < 0;
          const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
          for (const k of order) {
            const q = quad[k];
            pushV(q[0], q[1], q[2], nx, 0, nz, q[3], y0, y1, s, sd, 0, tx, tz);
          }
          if (parapet) {
            // Inner face and cap of the parapet.
            const ix0 = ax - nx * 0.3, iz0 = az - nz * 0.3, ix1 = bx - nx * 0.3, iz1 = bz - nz * 0.3;
            const inner = [[ix1, y1, iz1], [ix0, y1, iz0], [ix0, yt, iz0], [ix1, y1, iz1], [ix0, yt, iz0], [ix1, yt, iz1]];
            for (const k of order) pushV(inner[k][0], inner[k][1], inner[k][2], -nx, 0, -nz, 0, y0, y1, s, sd, 0, -tx, -tz);
            const cap = [[ax, yt, az], [ix0, yt, iz0], [ix1, yt, iz1], [ax, yt, az], [ix1, yt, iz1], [bx, yt, bz]];
            const cy = (cap[2][0] - cap[0][0]) * (cap[1][2] - cap[0][2]) - (cap[1][0] - cap[0][0]) * (cap[2][2] - cap[0][2]);
            const co = cy > 0 ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
            for (const k of co) pushV(cap[k][0], cap[k][1], cap[k][2], 0, 1, 0, 0, y0, y1, s, sd, 0, 1, 0);
          }
        }
      }
      // Roof: a hipped roof for simple four-sided houses, flat otherwise.
      if (rf && holes.length === 0 && outer.length === 8) this.hippedRoof(outer, y1, pushV, s, sd, y0);
      else {
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
        for (const [a, bb, c] of tris) {
          const A = all[a], B = all[bb], C = all[c];
          // Face up: cross((B-A),(C-A)).y must be positive with x,z mapping.
          const cy = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
          const tri = cy > 0 ? [A, B, C] : [A, C, B];
          for (const P of tri) pushV(P.x, y1, P.y, 0, 1, 0, 0, y0, y1, s, sd, 0, 1, 0);
        }
      }
    }
    this._props = props;
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
    g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 1));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(sty, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('aRoof', new THREE.Float32BufferAttribute(roof, 1));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 2));
    g.computeBoundingSphere();
    return g;
  }

  // Lift housings and AC units on flat roofs: collidable boxes, not web anchors.
  roofProps(b, props) {
    const w = b.maxx - b.minx, d = b.maxz - b.minz;
    if (w * d < 150) return;
    const seed = Math.abs(Math.sin(b.minx * 12.9898 + b.minz * 78.233)) * 43758.5453;
    let k = seed;
    const r = () => ((k = (k * 16807 + 11) % 2147483647) / 2147483647);
    const n = 1 + Math.floor(r() * (w * d > 800 ? 5 : 3));
    for (let i = 0; i < n; i++) {
      const big = i === 0 && b.y1 > 18;
      const sx = big ? 4 + r() * 3 : 1.2 + r() * 2.2, sz = big ? 3 + r() * 3 : 1.2 + r() * 2, sy = big ? 2.8 + r() * 1.2 : 0.9 + r() * 1;
      for (let tries = 0; tries < 8; tries++) {
        const x = b.minx + sx / 2 + 1 + r() * Math.max(0.1, w - sx - 2), z = b.minz + sz / 2 + 1 + r() * Math.max(0.1, d - sz - 2);
        if (![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([a, c]) => pointInPrism2D(x + (a * sx) / 2 + a, z + (c * sz) / 2 + c, b))) continue;
        props.push([x, b.y1, z, sx, sy, sz, big ? 1 : 0]);
        this.addPrism({ outer: Float32Array.from([x - sx / 2, z - sz / 2, x + sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, x - sx / 2, z + sz / 2]), holes: [], signs: [1], y0: b.y1, y1: b.y1 + sy, minx: x - sx / 2, maxx: x + sx / 2, minz: z - sz / 2, maxz: z + sz / 2, kind: 'prop' });
        break;
      }
    }
  }

  propMesh(props) {
    if (!props.length) return null;
    if (!this.propGeo) {
      this.propGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      this.propMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.2 });
    }
    const m = new THREE.InstancedMesh(this.propGeo, this.propMat, props.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    props.forEach(([x, y, z, sx, sy, sz, big], i) => {
      m.setMatrixAt(i, m4.compose(p.set(x, y, z), q, s.set(sx, sy, sz)));
      m.setColorAt(i, big ? c.setRGB(0.55, 0.53, 0.5) : c.setRGB(0.62 + (i % 3) * 0.05, 0.63 + (i % 3) * 0.05, 0.64 + (i % 3) * 0.05));
    });
    m.castShadow = m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }

  hippedRoof(r, y1, pushV, s, sd, y0) {
    // Order the four corners, find the long axis, and put a ridge along it.
    const P = [0, 1, 2, 3].map((i) => new THREE.Vector2(r[i * 2], r[i * 2 + 1]));
    const e0 = P[1].clone().sub(P[0]), e1 = P[2].clone().sub(P[1]);
    const longFirst = e0.length() >= e1.length();
    const [A, B, C, D] = longFirst ? P : [P[1], P[2], P[3], P[0]];
    const width = Math.min(A.distanceTo(D), B.distanceTo(C));
    const h = Math.min(width * 0.4, 5);
    const mAD = A.clone().add(D).multiplyScalar(0.5), mBC = B.clone().add(C).multiplyScalar(0.5);
    const dir = mBC.clone().sub(mAD).normalize();
    const R1 = mAD.clone().addScaledVector(dir, width / 2), R2 = mBC.clone().addScaledVector(dir, -width / 2);
    const top = y1 + h;
    const face = (pts) => {
      // pts: array of [x, y, z]; fan triangulation, normal from the first triangle, facing up.
      const a = new THREE.Vector3(...pts[0]), b = new THREE.Vector3(...pts[1]), c = new THREE.Vector3(...pts[2]);
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      if (n.y < 0) {
        pts = pts.slice().reverse();
        n.negate();
      }
      for (let i = 1; i < pts.length - 1; i++) {
        for (const p of [pts[0], pts[i], pts[i + 1]]) pushV(p[0], p[1], p[2], n.x, n.y, n.z, 0, y0, top, s, sd, 1, 1, 0);
      }
    };
    face([[A.x, y1, A.y], [B.x, y1, B.y], [R2.x, top, R2.y], [R1.x, top, R1.y]]);
    face([[C.x, y1, C.y], [D.x, y1, D.y], [R1.x, top, R1.y], [R2.x, top, R2.y]]);
    face([[D.x, y1, D.y], [A.x, y1, A.y], [R1.x, top, R1.y]]);
    face([[B.x, y1, B.y], [C.x, y1, C.y], [R2.x, top, R2.y]]);
  }

  addPrism(p) {
    this.prisms.push(p);
    this._rec?.prisms.push(p);
    for (let gx = Math.floor(p.minx / CELL); gx <= Math.floor(p.maxx / CELL); gx++) {
      for (let gz = Math.floor(p.minz / CELL); gz <= Math.floor(p.maxz / CELL); gz++) {
        const k = gx * 100003 + gz;
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(p);
      }
    }
  }

  // Road ribbons (with a wider sidewalk ribbon underneath), footways, rivers, centre-line dashes.
  buildLines(list, greens = []) {
    const out = { sidewalk: [], trail: [], road: [], plaza: [], river: [], marking: [] };
    // terrain: a footway through a wood is a dirt trail, not pavement
    const woods = this.terrain ? greens.filter((g) => g[0] === 'wood').map((g) => g[1]) : [];
    const inWood = (pts) => {
      const x = pts[pts.length >> 2 << 1], z = pts[(pts.length >> 2 << 1) + 1];
      return woods.some((o) => pointInRing(x, z, o));
    };
    for (const r of list) {
      const pts = r.pts;
      if (pts.length < 4) continue;
      if (r.cls === 'river') this.ribbon(out.river, pts, r.w, 0, 0, true);
      else if (r.cls === 'foot') this.ribbon(woods.length && inWood(pts) ? out.trail : out.sidewalk, pts, r.w, 0);
      else if (r.cls === 'ped') this.ribbon(out.plaza, pts, r.w, 0);
      else {
        this.ribbon(out.sidewalk, pts, r.w + (r.major ? 7 : 4.5), 0);
        this.ribbon(out.road, pts, r.w, 0);
        if (r.major) {
          if (r.oneway) {
            this.ribbon(out.marking, pts, 0.14, 0, r.w * 0.18);
            this.ribbon(out.marking, pts, 0.14, 0, -r.w * 0.18);
          } else this.ribbon(out.marking, pts, 0.14, 0);
        }
      }
      this.mmPut(r.pts[0], r.pts[1], 'r', r);
    }
    const res = {};
    for (const k in out) res[k] = out[k].length ? this.ribbonGeometry(out[k]) : null;
    return res;
  }

  // A strip along a street. On a city with relief every vertex sits on the ground (a river stays level
  // across its width), and the street gets a vertex at least every 6 m so it follows the hills.
  ribbon(acc, pts, w, y, offset = 0, level = false) {
    const T = this.terrain;
    if (T) pts = densify(pts);
    const n = pts.length / 2;
    const L = [], R = [], U = [];
    let u = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
      const nx = pts[Math.min(n - 1, i + 1) * 2], nz = pts[Math.min(n - 1, i + 1) * 2 + 1];
      let dx = nx - px, dz = nz - pz;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      // Miter: widen at corners, capped so sharp turns do not spike.
      let miter = 1;
      if (i > 0 && i < n - 1) {
        const ax = x - px, az = z - pz, al = Math.hypot(ax, az) || 1;
        const bx = nx - x, bz = nz - z, bl = Math.hypot(bx, bz) || 1;
        const cos = (ax * bx + az * bz) / (al * bl);
        miter = Math.min(2, 1 / Math.sqrt(Math.max(0.2, (1 + cos) / 2)));
      }
      const ox = -dz, oz = dx;
      const hw = (w / 2) * miter;
      if (i > 0) u += Math.hypot(x - pts[(i - 1) * 2], z - pts[(i - 1) * 2 + 1]);
      const lx = x + ox * (hw + offset), lz = z + oz * (hw + offset), rx = x - ox * (hw - offset), rz = z - oz * (hw - offset);
      const c = T && level ? T.height(x, z) + LIFT : 0;
      L.push([lx, lz, y + (T ? (level ? c : T.height(lx, lz) + LIFT) : 0)]);
      R.push([rx, rz, y + (T ? (level ? c : T.height(rx, rz) + LIFT) : 0)]);
      U.push(u);
    }
    acc.push({ L, R, U });
  }

  ribbonGeometry(ribbons) {
    const pos = [], uv = [];
    for (const { L, R, U } of ribbons) {
      for (let i = 0; i < L.length - 1; i++) {
        const a = L[i], b = R[i], c = L[i + 1], d = R[i + 1];
        // Wind so the face points up (+y).
        const tri = (p, q, r, up, uq, ur) => {
          const cy = (r[0] - p[0]) * (q[1] - p[1]) - (q[0] - p[0]) * (r[1] - p[1]);
          const T = cy > 0 ? [[p, up], [q, uq], [r, ur]] : [[p, up], [r, ur], [q, uq]];
          for (const [P, UU] of T) {
            pos.push(P[0], P[2], P[1]);
            uv.push(UU[0], UU[1]);
          }
        };
        tri(a, b, c, [U[i], 0], [U[i], 1], [U[i + 1], 0]);
        tri(b, d, c, [U[i], 1], [U[i + 1], 1], [U[i + 1], 0]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const nor = new Float32Array(pos.length);
    if (this.terrain) {
      const n = _v;
      for (let i = 0; i < pos.length; i += 3) {
        this.terrain.smooth(pos[i], pos[i + 2], n);
        nor[i] = n.x;
        nor[i + 1] = n.y;
        nor[i + 2] = n.z;
      }
    } else for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    return g;
  }

  buildRails(list) {
    if (!list || !list.length) return null;
    const acc = [];
    for (const r of list) {
      if (r.pts.length < 4) continue;
      for (const o of [-0.72, 0.72]) this.ribbon(acc, r.pts, 0.12, 0.02, o);
    }
    return acc.length ? this.ribbonGeometry(acc) : null;
  }

  buildAreas(waters, greens) {
    const out = { water: [], grass: [], plaza: [], sidewalk: [] };
    const tri = (acc, outer, holes, y = 0) => {
      const contour = [];
      for (let i = 0; i < outer.length; i += 2) contour.push(new THREE.Vector2(outer[i], outer[i + 1]));
      const hv = holes.map((h) => {
        const a = [];
        for (let i = 0; i < h.length; i += 2) a.push(new THREE.Vector2(h[i], h[i + 1]));
        return a;
      });
      let t;
      try {
        t = THREE.ShapeUtils.triangulateShape(contour, hv);
      } catch {
        return;
      }
      const all = contour.concat(...hv);
      for (const [a, b, c] of t) {
        const A = all[a], B = all[b], C = all[c];
        const cy = (C.x - A.x) * (B.y - A.y) - (B.x - A.x) * (C.y - A.y);
        for (const P of cy > 0 ? [A, B, C] : [A, C, B]) acc.push(P.x, y, P.y);
      }
    };
    for (const [outer, holes] of waters) {
      // terrain: a lake is level; its surface is the middle height of its shore
      let level = 0;
      if (this.terrain) {
        const hs = [];
        for (let i = 0; i < outer.length; i += 2) hs.push(this.terrain.height(outer[i], outer[i + 1]));
        level = hs.sort((a, b) => a - b)[hs.length >> 1];
      }
      tri(out.water, outer, holes, level);
      const w = { outer: Float32Array.from(outer), holes: holes.map((h) => Float32Array.from(h)), level, minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity };
      for (let i = 0; i < outer.length; i += 2) {
        w.minx = Math.min(w.minx, outer[i]); w.maxx = Math.max(w.maxx, outer[i]);
        w.minz = Math.min(w.minz, outer[i + 1]); w.maxz = Math.max(w.maxz, outer[i + 1]);
      }
      this.waters.push(w);
      this._rec?.waters.push(w);
      this.mmPut(outer[0], outer[1], 'w', w.outer);
      for (let gx = Math.floor(w.minx / 64); gx <= Math.floor(w.maxx / 64); gx++) {
        for (let gz = Math.floor(w.minz / 64); gz <= Math.floor(w.maxz / 64); gz++) {
          const k = gx * 100003 + gz;
          (this.waterGrid.get(k) || this.waterGrid.set(k, []).get(k)).push(w);
        }
      }
    }
    for (const [kind, outer, holes] of greens) {
      const target = kind === 'plaza' ? out.plaza : kind === 'sand' ? out.sidewalk : out.grass;
      if (!this.terrain) tri(target, outer, holes); // terrain: with relief they are painted on the ground instead (Terrain.setMask)
      if (kind !== 'plaza') this.mmPut(outer[0], outer[1], 'g', Float32Array.from(outer));
    }
    const res = {};
    for (const k in out) {
      if (!out[k].length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(out[k], 3));
      const nor = new Float32Array(out[k].length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.computeBoundingSphere();
      res[k] = g;
    }
    return res;
  }

  buildTrees(t) {
    const n = t.length / 2;
    const T = this.terrain;
    const trunk = new THREE.InstancedMesh(this.mats.trunkGeo, this.mats.trunk, n);
    const crown = new THREE.InstancedMesh(this.mats.crownGeo, this.mats.crown, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = t[i * 2], z = t[i * 2 + 1];
      if (this.clearings && this.cleared(x, z)) continue; // terrain: trees keep off the BRASOV sign
      // terrain: the trunk starts a little under the ground so it stands on a slope
      const gy = T ? T.height(x, z) : 0, sink = T ? 0.4 : 0;
      const h = 6 + ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1 * 8;
      const r = 2 + (h - 6) * 0.3;
      trunk.setMatrixAt(k, m4.compose(p.set(x, gy - sink, z), q.identity(), s.set(1, h * 0.55 + sink, 1)));
      q.setFromAxisAngle(Y, (x * 0.37 + z * 0.11) % 6.28);
      crown.setMatrixAt(k, m4.compose(p.set(x, gy + h * 0.66, z), q, s.set(r * 2.1, r * 1.9, r * 2.1)));
      const c = ((Math.sin(x * 3.1 + z * 7.7) * 9999) % 1 + 1) % 1;
      crown.setColorAt(k, col.setHSL(0.02 * c - (c > 0.88 ? 0.07 : 0), 0.15 + 0.2 * c, 0.75 + 0.2 * c));
      k++;
    }
    trunk.count = crown.count = k;
    trunk.castShadow = crown.castShadow = true;
    crown.receiveShadow = true;
    trunk.computeBoundingSphere();
    crown.computeBoundingSphere();
    return [trunk, crown];
  }

  finish(facing, spawn) {
    // Spawn: the tallest block within 900 m of the origin (or of `spawn`), on its edge facing the point of interest.
    const [fx, fz] = facing || [];
    const sx = spawn?.x ?? 0, sz = spawn?.z ?? 0;
    // A city may have no tall block close by: look further out, then stand on the ground.
    const r = this.roofNear(sx, sz, spawn?.r ?? 900, fx, fz) || this.roofNear(sx, sz, 3000, fx, fz) || { box: null, pos: new THREE.Vector3(sx, this.groundAt(sx, sz), sz), yaw: 0 };
    this.spawnBox = r.box;
    this.spawn = r.pos;
    this.spawnYaw = r.yaw;
  }

  // A roof to stand on near (x, z): tall, reasonably small, on the ground; the edge closest to
  // the point of interest (fx, fz), facing it.
  roofNear(x, z, R, fx = x, fz = z) {
    let best = null, bestScore = -Infinity;
    for (const p of this.prisms) {
      const cx = (p.minx + p.maxx) / 2, cz = (p.minz + p.maxz) / 2;
      const d = Math.hypot(cx - x, cz - z);
      const low = this.lowGround(p); // terrain: the ground the building stands on, not y = 0
      if (p.kind === 'prop' || d > R || p.y0 > low + 0.5 || p.y1 - low < 12 || (this.terrain && p.pitched)) continue;
      if ((p.maxx - p.minx) * (p.maxz - p.minz) > 3000) continue;
      const score = p.y1 - low - d * 0.03;
      if (score > bestScore) (bestScore = score), (best = p);
    }
    if (!best) return null;
    const c = closestOnPrism(fx, fz, best, {});
    const cx = (best.minx + best.maxx) / 2, cz = (best.minz + best.maxz) / 2;
    // Step from the edge towards the middle until we are on the roof, clear of the parapet.
    let px = c.x, pz = c.z;
    const L = Math.hypot(cx - px, cz - pz) || 1;
    for (let k = 0; k < 60 && !(pointInPrism2D(px, pz, best) && closestOnPrism(px, pz, best, {}).d > 0.9); k++) {
      px += ((cx - px) / L) * 0.4;
      pz += ((cz - pz) / L) * 0.4;
    }
    let dx = fx - px, dz = fz - pz;
    if (Math.hypot(dx, dz) < 20) (dx = px - cx), (dz = pz - cz);
    return { box: best, pos: new THREE.Vector3(px, best.y1, pz), yaw: Math.atan2(-dx, -dz) };
  }

  update(dt, time, camPos) {
    const at = this.focus || camPos;
    this.mats.ground.userData.city?.uCamXZ.value.set(at.x, at.z);
    this.terrain?.tick(dt, at.x, at.z); // terrain:
    this.mats.water.userData.time && (this.mats.water.userData.time.value = time);
    // Build at most one fetched chunk per frame to keep frames smooth.
    const ready = this.building.findIndex((r) => r.state === 'fetched');
    if (ready >= 0) this.buildChunk(this.building.splice(ready, 1)[0]);
    this.building = this.building.filter((r) => r.state === 'loading' || r.state === 'fetched');
    this.streamT -= dt;
    if (this.streamT > 0) return;
    this.streamT = 0.4;
    const LOAD = 1900, UNLOAD = 2500;
    const near = this.chunksWithin(at.x, at.z, LOAD);
    let inflight = this.building.filter((r) => r.state === 'loading').length;
    for (const rec of near) {
      if (inflight >= 4) break;
      if (rec.state !== 'idle') continue;
      this.building.push(rec);
      this.fetchChunk(rec);
      inflight++;
    }
    for (const rec of this.recs.values()) if (rec.state === 'loaded' && rec.dist > UNLOAD) this.unloadChunk(rec);
  }

  // ---------- queries ----------

  nearby(x, z, rad, out = []) {
    out.length = 0;
    const st = ++this.stamp;
    for (let gx = Math.floor((x - rad) / CELL); gx <= Math.floor((x + rad) / CELL); gx++) {
      for (let gz = Math.floor((z - rad) / CELL); gz <= Math.floor((z + rad) / CELL); gz++) {
        const a = this.grid.get(gx * 100003 + gz);
        if (!a) continue;
        for (const p of a) {
          if (p._s === st) continue;
          p._s = st;
          out.push(p);
        }
      }
    }
    return out;
  }

  // Terrain height in metres relative to the origin: the bilinear sample of the dem, 0 on a flat city.
  groundAt(x, z) {
    return this.terrain ? this.terrain.height(x, z) : 0;
  }

  // Unit normal of the ground, straight up on a flat city.
  groundNormalAt(x, z, out = new THREE.Vector3()) {
    return this.terrain ? this.terrain.normal(x, z, out) : out.set(0, 1, 0);
  }

  // Rise over run of the ground under (x, z): 0.62 is a 32 degree slope.
  slopeAt(x, z) {
    return this.terrain ? this.terrain.slope(x, z) : 0;
  }

  // A solid that is not part of the streamed chunks (the BRASOV letters): it collides and takes webs like a building.
  addSolid(outer, y0, y1, name) {
    const o = Float32Array.from(outer);
    const p = { outer: o, holes: [], signs: [Math.sign(ringArea(o)) || 1], y0, y1, minx: Infinity, maxx: -Infinity, minz: Infinity, maxz: -Infinity, kind: 'building', name, style: 3 };
    for (let i = 0; i < o.length; i += 2) {
      p.minx = Math.min(p.minx, o[i]);
      p.maxx = Math.max(p.maxx, o[i]);
      p.minz = Math.min(p.minz, o[i + 1]);
      p.maxz = Math.max(p.maxz, o[i + 1]);
    }
    this.addPrism(p);
    return p;
  }

  cleared(x, z) {
    return this.clearings.some((f) => f(x, z));
  }

  // Lowest ground under a building, 0 on a flat city. A part held up above it (min_height) has y0 above this.
  lowGround(p) {
    if (!this.terrain) return 0;
    if (p._lg === undefined) {
      const o = p.outer;
      let m = this.terrain.height((p.minx + p.maxx) / 2, (p.minz + p.maxz) / 2);
      for (let i = 0; i < o.length; i += 2) m = Math.min(m, this.terrain.height(o[i], o[i + 1]));
      p._lg = m;
    }
    return p._lg;
  }

  isWater(x, z) {
    const a = this.waterGrid.get(Math.floor(x / 64) * 100003 + Math.floor(z / 64));
    if (!a) return false;
    for (const w of a) {
      if (!(x > w.minx && x < w.maxx && z > w.minz && z < w.maxz && pointInRing(x, z, w.outer) && !w.holes.some((h) => pointInRing(x, z, h)))) continue;
      // terrain: where the ground stands above the surface of the lake it is bank, not water
      if (this.terrain && this.terrain.height(x, z) > w.level + 0.6) continue;
      return true;
    }
    return false;
  }

  // Player cylinder against prisms. Sets grounded/contact on `st`.
  collide(p, v, r, H, wish, st) {
    const wasOnGround = st.grounded && !st.groundBox;
    st.grounded = false;
    st.contact = null;
    st.groundBox = st.groundBox || null;
    // terrain: the ground is the dem; a runner keeps her feet on it going downhill instead of leaving it for a frame
    const gy = this.groundAt(p.x, p.z);
    const snap = this.terrain && wasOnGround && st.mode === 'ground' && v.y <= 0.5 ? 0.35 : 0;
    if (p.y <= gy + snap && !this.isWater(p.x, p.z)) {
      p.y = gy;
      if (v.y < 0) v.y = 0;
      st.grounded = true;
      st.groundBox = null;
    }
    const cp = {};
    for (const b of this.nearby(p.x, p.z, r + 1, _near)) {
      if (p.y >= b.y1 || p.y + H <= b.y0) continue;
      if (p.x < b.minx - r || p.x > b.maxx + r || p.z < b.minz - r || p.z > b.maxz + r) continue;
      const inside = pointInPrism2D(p.x, p.z, b);
      closestOnPrism(p.x, p.z, b, cp);
      if (!inside && cp.d >= r) continue;
      const up = b.y1 - p.y;
      const pen = inside ? cp.d + r : r - cp.d;
      if ((up < 0.9 && v.y <= 0.5) || up < pen) {
        if (!inside && cp.d > r * 0.6) {
          // Clipping the edge of a roof: nudge sideways instead of popping up.
        }
        p.y = b.y1;
        if (v.y < 0) v.y = 0;
        st.grounded = true;
        st.groundBox = b;
        continue;
      }
      const nx = cp.nx, nz = cp.nz;
      p.x = cp.x + nx * (r + 0.001);
      p.z = cp.z + nz * (r + 0.001);
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        v.x -= nx * vn;
        v.z -= nz * vn;
      }
      const n = new THREE.Vector3(nx, 0, nz);
      if (b.kind !== 'prop' && (!st.contact || n.dot(wish) < st.contact.n.dot(wish))) st.contact = { box: b, n };
    }
  }

  // Keep a crawling player glued to the nearest face; returns the face normal.
  wallGlue(p, b, r) {
    const cp = closestOnPrism(p.x, p.z, b, {});
    p.x = cp.x + cp.nx * r;
    p.z = cp.z + cp.nz * r;
    return _v.set(cp.nx, 0, cp.nz);
  }

  raycast(o, d, maxDist, skipProps = false, skipGround = false) {
    const cand = [];
    const step = CELL * 0.5;
    const st = ++this.stamp;
    for (let t = 0; t <= maxDist + step; t += step) {
      const px = o.x + d.x * t, pz = o.z + d.z * t;
      const gx = Math.floor(px / CELL), gz = Math.floor(pz / CELL);
      for (let ax = gx - 1; ax <= gx + 1; ax++) {
        for (let az = gz - 1; az <= gz + 1; az++) {
          const a = this.grid.get(ax * 100003 + az);
          if (!a) continue;
          for (const p of a) {
            if (p._s === st) continue;
            p._s = st;
            cand.push(p);
          }
        }
      }
    }
    let best = null;
    for (const b of cand) {
      if (skipProps && b.kind === 'prop') continue;
      // Roof plane.
      if (Math.abs(d.y) > 1e-6) {
        const t = (b.y1 - o.y) / d.y;
        if (t > 0 && t <= maxDist && (!best || t < best.t)) {
          const x = o.x + d.x * t, z = o.z + d.z * t;
          if (pointInPrism2D(x, z, b)) best = { t, normal: new THREE.Vector3(0, 1, 0), box: b };
        }
      }
      // Walls.
      const rings = [b.outer, ...b.holes];
      for (let ri = 0; ri < rings.length; ri++) {
        const rr = rings[ri];
        const sg = b.signs[ri];
        const n = rr.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const ax = rr[j * 2], az = rr[j * 2 + 1], bx = rr[i * 2], bz = rr[i * 2 + 1];
          const ex = bx - ax, ez = bz - az;
          const den = d.x * ez - d.z * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((ax - o.x) * ez - (az - o.z) * ex) / den;
          const s = ((ax - o.x) * d.z - (az - o.z) * d.x) / den;
          if (t <= 0 || t > maxDist || s < 0 || s > 1) continue;
          const y = o.y + d.y * t;
          if (y < b.y0 || y > b.y1) continue;
          if (best && t >= best.t) continue;
          const L = Math.hypot(ex, ez);
          const nrm = new THREE.Vector3((sg * ez) / L, 0, (-sg * ex) / L);
          if (nrm.x * d.x + nrm.z * d.z > 0) continue; // back face
          best = { t, normal: nrm, box: b };
        }
      }
    }
    if (this.terrain) {
      // terrain: the ground is a surface, not a plane. The camera boom skips it: on a slope the camera rises over it (CameraRig).
      const t = skipGround ? -1 : this.terrain.rayHit(o, d, best ? best.t : maxDist);
      if (t > 0) best = { t, normal: this.terrain.normal(o.x + d.x * t, o.z + d.z * t, new THREE.Vector3()), box: null };
    } else if (d.y < -1e-4) {
      const t = -o.y / d.y;
      if (t > 0 && t <= maxDist && (!best || t < best.t)) best = { t, normal: new THREE.Vector3(0, 1, 0), box: null };
    }
    if (best) best.point = new THREE.Vector3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t);
    return best;
  }

  findAnchor(p, fwd, side, speed, ban = null) {
    const reach = 22 + Math.min(speed, 55) * 0.35;
    const rightX = -fwd.z, rightZ = fwd.x;
    const D = new THREE.Vector3(p.x + fwd.x * reach + rightX * side * 11, p.y + 22, p.z + fwd.z * reach + rightZ * side * 11);
    let best = null, bestScore = Infinity;
    const cp = {};
    for (const b of this.nearby(p.x, p.z, 95, _near2)) {
      if (b.kind === 'prop' || b.y1 < p.y + 6) continue;
      closestOnPrism(D.x, D.z, b, cp);
      const cx = pointInPrism2D(D.x, D.z, b) ? D.x : cp.x, cz = pointInPrism2D(D.x, D.z, b) ? D.z : cp.z;
      const cy = clamp(D.y, b.y0 + 1, b.y1 - 0.5);
      const vx = cx - p.x, vy = cy - p.y, vz = cz - p.z;
      const dist = Math.hypot(vx, vy, vz);
      if (dist < 10 || dist > 90 || vy < 5) continue;
      if (vx * fwd.x + vz * fwd.z < -1) continue;
      if (ban && Math.hypot(cx - ban.x, cz - ban.z) < 12) continue;
      const score = Math.hypot(cx - D.x, cy - D.y, cz - D.z) + dist * 0.12;
      if (score < bestScore) {
        bestScore = score;
        best = new THREE.Vector3(cx, cy, cz);
      }
    }
    if (!best && p.y - this.groundAt(p.x, p.z) < 45) best = D;
    return best;
  }
}

const _near = [];
const _near2 = [];
