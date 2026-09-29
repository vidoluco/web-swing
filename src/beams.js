import * as THREE from 'three';

// Tall glowing columns with a pulsing ring on the ground: the checkpoints of missions and races and
// the start markers. A column is also the trigger: passing through it at any height up to HEIGHT
// counts, so a checkpoint can be taken on foot or at the top of a swing.
export const HEIGHT = 90;
const REACH = 45; // metres above the base at which passing through the column still counts

let fadeTex = null;
export function fadeTexture() {
  if (!fadeTex) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#000');
    gr.addColorStop(1, '#fff');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    fadeTex = new THREE.CanvasTexture(c);
  }
  return fadeTex;
}

export class Beams {
  constructor(scene, city) {
    this.city = city;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = new Map();
    this.t = 0;
  }

  // spec: { x, z, y? (else the ground), color, r = hit radius, alpha = 1 (dim the checkpoints not yet next) }
  set(id, spec) {
    let it = this.items.get(id);
    if (!it) {
      const obj = new THREE.Group();
      const beamMat = new THREE.MeshBasicMaterial({ alphaMap: fadeTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ringMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, HEIGHT, 20, 1, true).translate(0, HEIGHT / 2, 0), beamMat);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40).rotateX(-Math.PI / 2), ringMat);
      ring.position.y = 0.15;
      beam.frustumCulled = false;
      obj.add(beam, ring);
      this.group.add(obj);
      it = { obj, beam, ring, beamMat, ringMat };
      this.items.set(id, it);
    }
    const y = spec.y ?? this.city.groundAt?.(spec.x, spec.z) ?? 0;
    Object.assign(it, { x: spec.x, z: spec.z, y, r: spec.r ?? 6, alpha: spec.alpha ?? 1 });
    it.obj.position.set(spec.x, y, spec.z);
    it.beam.scale.set(it.r * 0.5, 1, it.r * 0.5);
    it.ring.scale.setScalar(it.r);
    it.beamMat.color.set(spec.color);
    it.ringMat.color.set(spec.color);
    return it;
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.group.remove(it.obj);
    it.beam.geometry.dispose();
    it.ring.geometry.dispose();
    it.beamMat.dispose();
    it.ringMat.dispose();
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  // Is pos inside the column of this beam?
  inside(id, pos) {
    const it = this.items.get(id);
    return !!it && Math.hypot(pos.x - it.x, pos.z - it.z) < it.r && pos.y > it.y - 3 && pos.y < it.y + REACH;
  }

  update(dt) {
    this.t += dt;
    for (const it of this.items.values()) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3 + it.x * 0.13);
      it.beamMat.opacity = it.alpha * (0.32 + 0.1 * pulse);
      it.ringMat.opacity = it.alpha * (0.55 + 0.4 * pulse);
      it.ring.scale.setScalar(it.r * (1 + 0.06 * pulse));
    }
  }
}
