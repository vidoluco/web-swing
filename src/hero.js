import * as THREE from 'three';
import { webPatternTexture, spiderEmblemTexture } from './textures.js';
import { damp } from './config.js';

// A primitive-built hero with procedural poses. The root sits at the feet and faces +z.
const JOINTS = ['pelvis', 'spine', 'neck', 'lShoulder', 'lElbow', 'rShoulder', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee'];

export class Hero {
  constructor() {
    this.root = new THREE.Group();
    this.suit = 'classic';
    this.mats = {
      red: new THREE.MeshStandardMaterial({ map: webPatternTexture(), roughness: 0.55 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x1f47c0, roughness: 0.6 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.28, metalness: 0.2 }),
      eye: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.3, emissive: 0x333333 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.5 }),
    };
    this.emblemSmall = new THREE.MeshBasicMaterial({ map: spiderEmblemTexture('#0a0a0a'), transparent: true, depthWrite: false });
    this.emblemBig = new THREE.MeshBasicMaterial({ map: spiderEmblemTexture('#f2f2f2', true), transparent: true, depthWrite: false });
    this.parts = []; // [mesh, role]
    this.j = {};
    this.build();
    this.cur = {};
    for (const k of JOINTS) this.cur[k] = new THREE.Quaternion();
    this.pelvisY = 0.95;
    this.setSuit('classic');
  }

  part(geo, role, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, this.mats.red);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    this.parts.push([m, role]);
    return m;
  }

  joint(name, parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    this.j[name] = g;
    return g;
  }

  build() {
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 12);
    const pelvis = this.joint('pelvis', this.root, 0, 0.95, 0);
    this.part(new THREE.SphereGeometry(0.17, 14, 10).scale(1.05, 0.75, 0.8), 'secondary', pelvis, 0, -0.02, 0);
    const spine = this.joint('spine', pelvis, 0, 0.06, 0);
    this.part(cap(0.14, 0.16).scale(0.92, 1, 0.75), 'primary', spine, 0, 0.14, 0); // waist
    this.part(cap(0.19, 0.13).scale(1.28, 1.05, 0.82), 'primary', spine, 0, 0.36, 0.0); // chest
    const emb = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), this.emblemSmall);
    emb.position.set(0, 0.38, 0.158);
    spine.add(emb);
    this.emblem = emb;
    const embBack = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.emblemSmall);
    embBack.position.set(0, 0.36, -0.158);
    embBack.rotation.y = Math.PI;
    spine.add(embBack);
    this.emblemBack = embBack;
    const neck = this.joint('neck', spine, 0, 0.52, 0);
    this.part(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 10), 'primary', neck, 0, 0.03, 0);
    const head = this.part(new THREE.SphereGeometry(0.115, 18, 14).scale(0.92, 1.12, 1.0), 'primary', neck, 0, 0.16, 0.01);
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 8).scale(1.25, 0.85, 0.35), this.mats.rim);
      rim.position.set(s * 0.045, 0.02, 0.098);
      rim.rotation.set(0, s * 0.35, s * -0.55);
      head.add(rim);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8).scale(1.2, 0.8, 0.35), this.mats.eye);
      eye.position.set(s * 0.045, 0.02, 0.103);
      eye.rotation.set(0, s * 0.35, s * -0.55);
      head.add(eye);
    }
    for (const side of ['l', 'r']) {
      const s = side === 'l' ? 1 : -1;
      const sh = this.joint(side + 'Shoulder', spine, s * 0.235, 0.44, 0);
      this.part(new THREE.SphereGeometry(0.088, 12, 10), 'primary', sh, 0, 0, 0);
      this.part(cap(0.06, 0.2), 'secondary', sh, 0, -0.15, 0);
      const el = this.joint(side + 'Elbow', sh, 0, -0.3, 0);
      this.part(cap(0.052, 0.19), 'primary', el, 0, -0.13, 0);
      this.part(new THREE.SphereGeometry(0.055, 10, 8).scale(0.9, 1.1, 0.7), 'primary', el, 0, -0.3, 0.01);
      const hip = this.joint(side + 'Hip', pelvis, s * 0.1, -0.05, 0);
      this.part(cap(0.085, 0.28), 'secondary', hip, 0, -0.22, 0);
      const kn = this.joint(side + 'Knee', hip, 0, -0.44, 0);
      this.part(cap(0.062, 0.3), 'primary', kn, 0, -0.2, 0);
      this.part(new THREE.BoxGeometry(0.1, 0.07, 0.22), 'primary', kn, 0, -0.42, 0.05);
    }
    this.hand = this.j.rElbow; // web shooter
  }

  setSuit(name) {
    this.suit = name;
    const black = name === 'symbiote';
    for (const [m, role] of this.parts) {
      m.material = black ? this.mats.black : role === 'primary' ? this.mats.red : this.mats.blue;
    }
    const em = black ? this.emblemBig : this.emblemSmall;
    this.emblem.material = this.emblemBack.material = em;
    this.emblem.scale.setScalar(black ? 1.6 : 1);
    this.emblemBack.scale.setScalar(black ? 1.7 : 1);
  }

  toggleSuit() {
    this.setSuit(this.suit === 'classic' ? 'symbiote' : 'classic');
  }

  handWorld(out) {
    return this.j.rElbow.localToWorld(out.set(0, -0.3, 0));
  }

  // Joint targets in radians (x, y, z) for each pose.
  static pose(name, t, p = {}) {
    const P = {};
    const set = (k, x = 0, y = 0, z = 0) => (P[k] = [x, y, z]);
    for (const k of JOINTS) set(k);
    let pelvisDrop = 0;
    switch (name) {
      case 'idle': {
        const b = Math.sin(t * 2) * 0.03;
        set('spine', 0.05 + b);
        set('lShoulder', 0.05, 0, 0.12);
        set('rShoulder', 0.05, 0, -0.12);
        set('lElbow', -0.25);
        set('rElbow', -0.25);
        set('lHip', -0.05, 0, 0.04);
        set('rHip', -0.05, 0, -0.04);
        set('lKnee', 0.1);
        set('rKnee', 0.1);
        break;
      }
      case 'run': {
        const ph = p.phase || 0, s = Math.sin(ph), c = Math.cos(ph);
        set('pelvis', 0, s * 0.12, 0);
        set('spine', -0.32, -s * 0.2, 0);
        set('neck', 0.25);
        set('lShoulder', s * 1.1, 0, 0.15);
        set('rShoulder', -s * 1.1, 0, -0.15);
        set('lElbow', -1.3);
        set('rElbow', -1.3);
        set('lHip', -s * 1.05 - 0.25);
        set('rHip', s * 1.05 - 0.25);
        set('lKnee', 0.35 + Math.max(0, -c) * 1.5);
        set('rKnee', 0.35 + Math.max(0, c) * 1.5);
        pelvisDrop = 0.08 - Math.abs(c) * 0.06;
        break;
      }
      case 'jump': {
        set('spine', -0.2);
        set('lShoulder', -0.6, 0, 0.9);
        set('rShoulder', -0.6, 0, -0.9);
        set('lElbow', -1.0);
        set('rElbow', -1.0);
        set('lHip', -1.1, 0, 0.2);
        set('rHip', -0.4, 0, -0.1);
        set('lKnee', 1.8);
        set('rKnee', 1.0);
        break;
      }
      case 'fall': {
        const w = Math.sin(t * 9) * 0.1;
        set('spine', 0.25);
        set('neck', -0.4);
        set('lShoulder', 0.9 + w, 0, 0.5);
        set('rShoulder', 0.9 - w, 0, -0.5);
        set('lElbow', -0.2);
        set('rElbow', -0.2);
        set('lHip', 0.2, 0, 0.12);
        set('rHip', 0.1, 0, -0.12);
        set('lKnee', 0.3);
        set('rKnee', 0.5);
        break;
      }
      case 'swing': {
        // Right arm holds the web; the body hangs from it and the legs trail.
        const k = p.phase || 0;
        set('spine', 0.1 - k * 0.2);
        set('neck', -0.2);
        set('rShoulder', -3.0, 0, 0.15);
        set('rElbow', -0.15);
        set('lShoulder', 0.5, 0, 0.7);
        set('lElbow', -0.9);
        set('lHip', -0.9 + k * 0.6, 0, 0.1);
        set('rHip', -0.2 + k * 0.3, 0, -0.08);
        set('lKnee', 1.4 - k * 0.6);
        set('rKnee', 0.5);
        break;
      }
      case 'zip': {
        set('spine', -0.1);
        set('lShoulder', -2.6, 0, -0.15);
        set('rShoulder', -2.6, 0, 0.15);
        set('lHip', 0.2);
        set('rHip', 0.1);
        set('lKnee', 0.9);
        set('rKnee', 0.6);
        break;
      }
      case 'perch': {
        const b = Math.sin(t * 1.5) * 0.03;
        set('spine', -0.75 + b);
        set('neck', 0.55);
        set('lShoulder', -0.35, 0, 0.35);
        set('rShoulder', -0.9, 0, -0.25);
        set('lElbow', -0.2);
        set('rElbow', -0.4);
        set('lHip', -1.75, 0, 0.35);
        set('rHip', -1.55, 0, -0.35);
        set('lKnee', 2.35);
        set('rKnee', 2.25);
        pelvisDrop = 0.5;
        break;
      }
      case 'land': {
        set('spine', -0.6);
        set('lShoulder', -0.2, 0, 0.6);
        set('rShoulder', -1.0, 0, -0.4);
        set('lHip', -1.5, 0, 0.3);
        set('rHip', -1.2, 0, -0.3);
        set('lKnee', 2.1);
        set('rKnee', 1.8);
        pelvisDrop = 0.45;
        break;
      }
      case 'wall': {
        // Crawling: limbs spread, alternating reach.
        const ph = p.phase || 0, s = Math.sin(ph);
        set('spine', -0.15);
        set('neck', -0.5);
        set('lShoulder', -2.2 - s * 0.5, 0, 0.5);
        set('rShoulder', -2.2 + s * 0.5, 0, -0.5);
        set('lElbow', -1.1);
        set('rElbow', -1.1);
        set('lHip', -1.1 + s * 0.4, 0, 0.55);
        set('rHip', -1.1 - s * 0.4, 0, -0.55);
        set('lKnee', 1.7);
        set('rKnee', 1.7);
        pelvisDrop = 0.1;
        break;
      }
    }
    return { P, pelvisDrop };
  }

  animate(name, dt, t, params, rate = 14) {
    const { P, pelvisDrop } = Hero.pose(name, t, params);
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const k = damp(rate, dt);
    for (const name of JOINTS) {
      const [x, y, z] = P[name];
      q.setFromEuler(e.set(x, y, z));
      this.cur[name].slerp(q, k);
      this.j[name].quaternion.copy(this.cur[name]);
    }
    this.pelvisY += (0.95 - pelvisDrop - this.pelvisY) * k;
    this.j.pelvis.position.y = this.pelvisY;
  }
}
