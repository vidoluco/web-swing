import * as THREE from 'three';
import { groundMaterials } from './ground.js';
import { Streets } from './streets.js';
import { Trees } from './trees.js';
import { Detail } from './detail.js';
import { Props } from './props.js';
import { uniforms } from './uniforms.js';

const DETAIL_ON = 200, DETAIL_OFF = 300, SHADOW_R = 260, TREE_FAR = 330; // metres from the camera to the chunk square // metres from the camera to the chunk square

// The visual layer of a city (task look-city). OsmCity owns the data and the collision prisms; this class owns
// what things look like: street surfaces, street furniture, vegetation and the detail on building walls. It is
// created by the OsmCity constructor when the photographic assets are available, and every hook in osmcity.js
// is marked "look-city:".
export class CityLook {
  constructor(city, assets) {
    this.city = city;
    this.assets = assets;
    this.streets = new Streets(city);
    this.trees_ = new Trees(city, assets);
    this.detail = new Detail(this);
    this.props = new Props(this);
    this.detailT = 0;
    this.uniforms = uniforms; // reachable for tests
    const m = groundMaterials(assets);
    Object.assign(city.mats, { road: m.road, sidewalk: m.sidewalk, path: m.path, plaza: m.plaza, grass: m.grass, railBed: m.railBed, rail: m.rail });
  }

  // The area meshes of OsmCity (grass, plaza) carry no street attributes: give the ground shaders zeros to read.
  padArea(geo) {
    const n = geo.attributes.position.count;
    if (!geo.attributes.uv || geo.attributes.uv.count !== n) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    geo.setAttribute('aRoad', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    geo.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return geo;
  }

  // Trees of a chunk: the mapped ones plus a row along the wide pavements of the big streets.
  trees(t, roads) {
    const extra = [];
    if (roads) {
      const taken = new Set();
      for (let i = 0; i < t.length; i += 2) taken.add(Math.floor(t[i] / 6) * 100003 + Math.floor(t[i + 1] / 6));
      for (const r of roads) {
        if (r.cls !== 'road' || !r.major || r.w < 9 || r.pts.length < 4) continue;
        const half = r.w / 2, seed = Math.round(r.pts[0] * 10) ^ Math.round(r.pts[1] * 10);
        let k = 0;
        this.props.walk(r.pts, 15, 6 + (seed & 7), (x, z, dx, dz, u) => {
          const side = k++ % 2 ? 1 : -1;
          const px = x - dz * side * (half + 3.0), pz = z + dx * side * (half + 3.0);
          const key = Math.floor(px / 6) * 100003 + Math.floor(pz / 6);
          if (taken.has(key) || (seed + k * 7) % 10 < 3 || !this.props.free(px, pz, 2.2)) return;
          taken.add(key);
          extra.push(px, pz);
        });
      }
    }
    return this.trees_.build(extra.length ? Array.from(t).concat(extra) : t);
  }

  decorate(rec, data, group) {
    this.props.decorate(rec, data, group);
  }

  update(dt, time, cam) {
    this.trees_.update(dt, time);
    this.props.update();
    this.detailT -= dt;
    if (this.detailT > 0 || !cam) return;
    this.detailT = 0.2;
    // Detail layer: build the nearest chunk that lacks it (one per call), drop the ones that are far.
    const C = this.city.index.chunk;
    let best = null, bd = DETAIL_ON;
    for (const rec of this.city.recs.values()) {
      if (rec.state !== 'loaded' || !rec.group) continue;
      const x0 = rec.info.cx * C, z0 = rec.info.cz * C;
      const d = Math.hypot(Math.max(x0 - cam.x, 0, cam.x - (x0 + C)), Math.max(z0 - cam.z, 0, cam.z - (z0 + C)));
      // Shadows of trees and buildings only matter close to the camera: the far cascades skip them.
      const shadow = d < SHADOW_R;
      const nearTrees = rec.treesNear ? d < TREE_FAR + 40 : d < TREE_FAR;
      if (rec.shadowOn !== shadow || rec.treesNear !== nearTrees) {
        rec.shadowOn = shadow;
        rec.treesNear = nearTrees;
        rec.group.traverse((o) => {
          if (!o.isInstancedMesh || o.material !== this.trees_.mat) return;
          const isNear = o.userData.lod === 'near';
          o.visible = isNear === nearTrees;
          o.castShadow = isNear && shadow;
        });
      }
      if (rec.detailGroup !== undefined && rec.detailGroup !== null) {
        if (d > DETAIL_OFF) this.dropDetail(rec);
      } else if (d < bd) (bd = d), (best = rec);
    }
    if (best) {
      const g = this.detail.build(best);
      best.detailGroup = g || false;
      if (g) {
        best.group.add(g);
        this.city.onChunkMesh?.(g);
      }
    }
  }

  // The chunk record is about to be reused: its meshes are gone.
  forget(rec) {
    rec.detailGroup = undefined;
    rec.shadowOn = undefined;
    rec.treesNear = undefined;
    rec.lookRoads = null;
  }

  dropDetail(rec) {
    const g = rec.detailGroup;
    rec.detailGroup = null;
    if (!g) return; // false: the chunk had no detail
    rec.group?.remove(g);
    g.traverse((o) => {
      if (!o.isInstancedMesh) return;
      o.dispose();
      if (o.userData.ownGeometry) o.geometry.dispose();
    });
  }

  buildLines(list) {
    return this.streets.build(list);
  }

  // Tram tracks are added to the chunk group here; returns null so OsmCity adds nothing itself.
  rails(list, group) {
    const r = this.streets.buildRails(list);
    if (!r) return null;
    if (r.bed) {
      const m = new THREE.Mesh(r.bed, this.city.mats.railBed);
      m.receiveShadow = true;
      group.add(m);
    }
    if (r.rails) {
      const m = new THREE.Mesh(r.rails, this.city.mats.rail);
      m.receiveShadow = true;
      group.add(m);
    }
    return null;
  }
}
