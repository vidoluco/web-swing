import * as THREE from 'three';

// The web is a clothesline: a thin cord from her hand to the anchor, with wooden clothespins and
// pieces of laundry (socks, a shirt, a bra, bloomers, a towel) hanging from it at fixed spots
// measured from the anchor, so they stay put in the world while she swings and flutter in the wind.

const KINDS = 5;
const CELL_W = 128;
const CELL_H = 160;
const SPACING = 5.5; // metres between two pieces
const FIRST = 2.5; // the first hangs this far from the anchor
const MAX = 12;
const INK = '#3a2a1c';

// The laundry, drawn once: one cell per kind, hanging from the top middle.
function laundryAtlas() {
  const c = document.createElement('canvas');
  c.width = CELL_W * KINDS;
  c.height = CELL_H;
  const g = c.getContext('2d');
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  const shape = (k, fill, fn) => {
    g.save();
    g.translate(k * CELL_W, 0);
    g.beginPath();
    fn(g);
    g.fillStyle = fill;
    g.fill();
    g.stroke();
    g.restore();
  };
  const inCell = (k, fn) => {
    g.save();
    g.translate(k * CELL_W, 0);
    fn(g);
    g.restore();
  };
  // 0 sock, striped
  shape(0, '#f3efe6', (p) => {
    p.moveTo(44, 6);
    p.lineTo(84, 6);
    p.lineTo(84, 100);
    p.quadraticCurveTo(116, 100, 116, 128);
    p.quadraticCurveTo(116, 146, 94, 146);
    p.lineTo(44, 146);
    p.closePath();
  });
  inCell(0, (p) => {
    p.fillStyle = '#c1272d';
    for (let y = 22; y < 90; y += 26) p.fillRect(46, y, 37, 11);
    p.fillStyle = '#c1272d';
    p.fillRect(46, 6, 37, 8);
  });
  // 1 T-shirt
  shape(1, '#6fa8d6', (p) => {
    p.moveTo(40, 8);
    p.lineTo(56, 8);
    p.quadraticCurveTo(64, 24, 72, 8);
    p.lineTo(88, 8);
    p.lineTo(120, 34);
    p.lineTo(104, 58);
    p.lineTo(92, 48);
    p.lineTo(92, 136);
    p.lineTo(36, 136);
    p.lineTo(36, 48);
    p.lineTo(24, 58);
    p.lineTo(8, 34);
    p.closePath();
  });
  inCell(1, (p) => {
    p.fillStyle = '#f4c7d0';
    p.beginPath();
    p.arc(64, 84, 16, 0, 6.3);
    p.fill();
    p.fillStyle = '#c1272d';
    p.beginPath();
    p.moveTo(64, 96);
    p.bezierCurveTo(46, 82, 52, 68, 64, 76);
    p.bezierCurveTo(76, 68, 82, 82, 64, 96);
    p.fill();
  });
  // 2 bra, beige and generous
  shape(2, '#efd9c3', (p) => {
    p.moveTo(14, 26);
    p.quadraticCurveTo(14, 96, 60, 92);
    p.quadraticCurveTo(64, 72, 64, 66);
    p.quadraticCurveTo(64, 72, 68, 92);
    p.quadraticCurveTo(114, 96, 114, 26);
    p.quadraticCurveTo(64, 46, 14, 26);
  });
  inCell(2, (p) => {
    p.strokeStyle = INK;
    p.lineWidth = 3;
    p.beginPath();
    p.moveTo(22, 30);
    p.lineTo(40, 6);
    p.moveTo(106, 30);
    p.lineTo(88, 6);
    p.stroke();
    p.strokeStyle = '#ffffff';
    p.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      p.beginPath();
      p.arc(38, 48, 8 + i * 5, 0.4, 2.7);
      p.stroke();
      p.beginPath();
      p.arc(90, 48, 8 + i * 5, 0.4, 2.7);
      p.stroke();
    }
  });
  // 3 bloomers, cream with dots
  shape(3, '#f6e6c8', (p) => {
    p.moveTo(14, 8);
    p.lineTo(114, 8);
    p.lineTo(120, 90);
    p.quadraticCurveTo(104, 112, 78, 100);
    p.lineTo(64, 84);
    p.lineTo(50, 100);
    p.quadraticCurveTo(24, 112, 8, 90);
    p.closePath();
  });
  inCell(3, (p) => {
    p.fillStyle = '#e88ba0';
    for (const [x, y] of [[30, 30], [64, 26], [98, 30], [46, 56], [82, 56], [28, 82], [100, 82], [64, 50]]) {
      p.beginPath();
      p.arc(x, y, 6, 0, 6.3);
      p.fill();
    }
    p.fillStyle = '#c1272d';
    p.fillRect(15, 9, 98, 8);
  });
  // 4 towel
  shape(4, '#ffffff', (p) => {
    p.rect(20, 6, 88, 128);
  });
  inCell(4, (p) => {
    p.fillStyle = '#2b4c9b';
    for (let y = 20; y < 130; y += 30) p.fillRect(21, y, 86, 12);
    p.fillStyle = '#e8d6a0';
    for (let x = 24; x < 106; x += 6) p.fillRect(x, 134, 3, 12);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Clothesline {
  constructor(scene) {
    this.cordMat = new THREE.MeshBasicMaterial({ color: 0xf6efe0, transparent: true });
    this.cord = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), this.cordMat);
    this.cord.frustumCulled = false;
    this.cord.visible = false;
    scene.add(this.cord);

    const map = laundryAtlas();
    this.mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
    // One quad per kind, textured with its cell and hung from its top middle edge.
    this.geos = Array.from({ length: KINDS }, (_, k) => {
      const g = new THREE.PlaneGeometry(0.8, 1).translate(0, -0.5, 0);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / KINDS);
      return g;
    });
    this.items = Array.from({ length: MAX }, (_, i) => {
      const m = new THREE.Mesh(this.geos[i % KINDS], this.mat);
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    // Two wooden clothespins per piece, one instanced mesh.
    this.pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.09, 0.03), new THREE.MeshLambertMaterial({ color: 0xc9a06a }), MAX * 2);
    this.pins.frustumCulled = false;
    this.pins.count = 0;
    scene.add(this.pins);
    this.shown = 0; // pieces in view, for tests
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._pp = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._Y = new THREE.Vector3(0, 1, 0);
  }

  // hand -> anchor, `grow` (0..1) how far the cord has been shot, `fade` its opacity.
  update(time, hand, anchor, grow, fade, camPos) {
    const d = this._d.copy(anchor).sub(hand);
    const len = d.length();
    d.divideScalar(len || 1);
    const reach = len * grow;
    this.cord.visible = true;
    this.cord.position.copy(hand);
    this.cord.quaternion.setFromUnitVectors(this._Y, d);
    const thick = 0.02 + Math.min(len, 120) * 0.0003;
    this.cord.scale.set(thick, reach, thick);
    this.cordMat.opacity = fade;

    let n = 0;
    for (let i = 0; i < MAX; i++) {
      const dist = FIRST + i * SPACING; // from the anchor
      const it = this.items[i];
      if (dist > reach - 1 || fade < 0.5) {
        it.visible = false;
        continue;
      }
      const p = this._p.copy(anchor).addScaledVector(d, -dist);
      const far = camPos ? camPos.distanceTo(p) : 20;
      const s = Math.min(2.6, 0.7 + far * 0.024); // a bit bigger with distance so it stays readable
      const ph = i * 1.7;
      // Faces the camera, swinging in the wind.
      const face = camPos ? Math.atan2(camPos.x - p.x, camPos.z - p.z) : 0;
      const yaw = face + Math.sin(time * 2.4 + ph) * 0.5 + Math.sin(time * 5.1 + ph * 2) * 0.16;
      const hx = Math.cos(yaw), hz = -Math.sin(yaw); // the piece's own left-right axis
      it.visible = true;
      it.position.copy(p);
      it.position.y -= 0.03 * s;
      it.rotation.set(0, yaw, Math.sin(time * 3.1 + ph) * 0.07);
      it.scale.setScalar(s);
      for (const side of [-1, 1]) {
        this._m.compose(this._pp.set(p.x + hx * 0.27 * s * side, p.y, p.z + hz * 0.27 * s * side), this._q.setFromAxisAngle(this._Y, yaw), this._s.setScalar(s));
        this.pins.setMatrixAt(n++, this._m);
      }
    }
    this.pins.count = n;
    this.pins.instanceMatrix.needsUpdate = true;
    this.shown = n / 2;
  }

  hide() {
    if (!this.cord.visible) return;
    this.cord.visible = false;
    for (const it of this.items) it.visible = false;
    this.pins.count = 0;
    this.shown = 0;
  }
}
