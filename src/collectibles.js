import * as THREE from 'three';
import { pointInPrism2D, closestOnPrism } from './osmcity.js';
import { fadeTexture } from './beams.js';

// Things lying around the city to pick up: jars of zacusca and PET bottles. The places come from
// public/city/<id>/collect.json (tools/make-collectibles.mjs); this file holds what both kinds share:
// loading that file, a glow that shows from far, the pickup itself, and keeping a roof item off the
// props the city puts on top of the roof.

const cache = new Map();
// Only the cities with a collect.json (tools/make-collectibles.mjs); asking for the others would be a 404.
const CITIES_WITH_DATA = ['bucharest', 'brasov'];
export function loadCollect(cityId) {
  if (!CITIES_WITH_DATA.includes(cityId)) return Promise.resolve(null);
  if (!cache.has(cityId)) {
    cache.set(
      cityId,
      fetch(`city/${cityId}/collect.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(cityId);
}

// A soft column of light and a ring on the ground, in the colour of what lies there.
export function makeGlow(color, height = 14, radius = 0.55) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.scale.setScalar(radius * 1.5);
  ring.position.y = 0.06;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 16, 1, true).translate(0, height / 2, 0),
    new THREE.MeshBasicMaterial({ color, alphaMap: fadeTexture(), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.frustumCulled = false;
  g.add(ring, beam);
  return g;
}

const bandTexture = (lines, bg, fg, accent) => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = accent;
  g.fillRect(0, 0, 256, 14);
  g.fillRect(0, 114, 256, 14);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 54px system-ui, sans-serif';
  g.fillText(lines[0], 128, 50);
  g.font = '800 24px system-ui, sans-serif';
  g.fillText(lines[1], 128, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export { bandTexture };

// The pickup itself. spec: { items: [{id, x, y, z, on}], build(item) -> the model, hovering above the
// item's feet, glow(item) -> the colour of its light, height (of that light), taken: Set of ids,
// take(item) called once, radius, near (how far away it is drawn) }.
export class Pickups {
  constructor(game, spec) {
    this.game = game;
    this.city = game.city;
    this.spec = spec;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.taken = spec.taken;
    this.items = spec.items.map((it) => ({ ...it, obj: null, settled: false }));
    this.time = 0;
    this.scanT = 0;
    this.chunk = game.city.index?.chunk ?? 400;
  }

  get left() {
    return this.items.filter((it) => !this.taken.has(it.id));
  }

  find(id) {
    return this.items.find((it) => it.id === id);
  }

  // Marks an item as taken (once) and runs the spec's take().
  take(it) {
    if (this.taken.has(it.id)) return false;
    this.taken.add(it.id);
    if (it.obj) it.obj.visible = false;
    this.spec.take(it);
    return true;
  }

  // Off any roof prop: the props are boxes on top of a roof and a bottle inside one cannot be reached.
  settle(it) {
    it.settled = true;
    if (it.on !== 'roof') return;
    const props = this.city.nearby(it.x, it.z, 3, []).filter((b) => b.kind === 'prop' && Math.abs(b.y0 - it.y) < 0.4);
    const blocked = (x, z) => props.some((b) => x > b.minx - 0.7 && x < b.maxx + 0.7 && z > b.minz - 0.7 && z < b.maxz + 0.7);
    if (!blocked(it.x, it.z)) return;
    const roof = this.city.nearby(it.x, it.z, 3, []).find((b) => b.kind !== 'prop' && Math.abs(b.y1 - it.y) < 0.3 && pointInPrism2D(it.x, it.z, b));
    const cp = {};
    for (let r = 1.5; r <= 9; r += 1.5) {
      for (let a = 0; a < 16; a++) {
        const x = it.x + Math.cos((a / 16) * Math.PI * 2) * r, z = it.z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (roof && (!pointInPrism2D(x, z, roof) || closestOnPrism(x, z, roof, cp).d < 1.2)) continue;
        if (blocked(x, z)) continue;
        it.x = x;
        it.z = z;
        if (it.obj) it.obj.position.set(x, it.y, z);
        return;
      }
    }
  }

  update(dt) {
    const { player } = this.game;
    this.time += dt;
    const near = this.spec.near ?? 350;
    const driving = this.game.driving?.();
    if ((this.scanT -= dt) <= 0) {
      this.scanT = 0.4;
      for (const it of this.items) {
        if (this.taken.has(it.id)) continue;
        const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
        const show = d < near;
        if (show && !it.obj) {
          it.obj = new THREE.Group();
          it.obj.add(this.spec.build(it), makeGlow(this.spec.glow(it), this.spec.height));
          it.obj.position.set(it.x, it.y, it.z);
          this.group.add(it.obj);
        }
        if (it.obj) it.obj.visible = show;
        if (show && !it.settled && d < 150 && this.city.recs.get(`${Math.floor(it.x / this.chunk)}_${Math.floor(it.z / this.chunk)}`)?.state === 'loaded') this.settle(it);
      }
    }
    const r = this.spec.radius ?? 2.2;
    for (const it of this.items) {
      if (this.taken.has(it.id)) continue;
      const m = it.obj?.visible ? it.obj.children[0] : null;
      if (m) {
        m.rotation.y = this.time * 1.6 + it.x;
        m.position.y = 0.9 + Math.sin(this.time * 2.2 + it.z) * 0.12;
      }
      if (driving) continue;
      const dx = it.x - player.pos.x, dz = it.z - player.pos.z;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      const dy = it.y + 1 - (player.pos.y + 0.9);
      if (dx * dx + dz * dz < r * r && Math.abs(dy) < 2.4) this.take(it);
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
  }
}
