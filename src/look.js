import * as THREE from 'three';
import { groundMaterials } from './ground.js';
import { Streets } from './streets.js';
import { Trees } from './trees.js';

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
    const m = groundMaterials(assets);
    Object.assign(city.mats, { road: m.road, sidewalk: m.sidewalk, path: m.path, plaza: m.plaza, grass: m.grass, railBed: m.railBed, rail: m.rail });
  }

  trees(t) {
    return this.trees_.build(t);
  }

  update(dt, time) {
    this.trees_.update(dt, time);
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
