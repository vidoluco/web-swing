import * as THREE from 'three';

// The cheap visual and audio feedback of the fights: star and dust particles, the '!' over a
// telegraphed strike, the lock-on ring, and the sounds, all synthesised with the existing Sfx.

function stampTexture(draw, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const starTexture = () =>
  stampTexture((g, s) => {
    g.translate(s / 2, s / 2);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.18 : s * 0.46;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });

const puffTexture = () =>
  stampTexture((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,0.9)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });

// A fixed pool of points that fly and fade, one draw call per emitter.
class Emitter {
  constructor(scene, map, size, blending, max) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max);
    this.tint = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
  }

  emit(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.tint.set([r, g, b], i * 3);
    this.life[i] = this.span[i] = life;
    this.n = Math.min(this.max, this.n + 1);
  }

  update(dt, gravity) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.col.fill(0, i * 3, i * 3 + 3);
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.span[i]);
      for (let a = 0; a < 3; a++) {
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.tint[i * 3 + a] * k;
      }
      this.vel[i * 3 + 1] -= gravity * dt;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    return alive;
  }
}

export class Fx {
  constructor(scene, sfx) {
    this.scene = scene;
    this.sfx = sfx;
    this.stars = new Emitter(scene, starTexture(), 0.34, THREE.AdditiveBlending, 48);
    this.dust = new Emitter(scene, puffTexture(), 0.9, THREE.AdditiveBlending, 40);

    // The '!' above an enemy that is about to strike.
    const bang = stampTexture((g, s) => {
      g.fillStyle = '#ffd400';
      g.strokeStyle = '#3a1a00';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(s / 2, 4);
      g.lineTo(s - 6, s - 8);
      g.lineTo(6, s - 8);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#c1121f';
      g.fillRect(s / 2 - 4.5, 22, 9, 22);
      g.beginPath();
      g.arc(s / 2, 52, 5.5, 0, 7);
      g.fill();
    }, 96);
    this.bangs = Array.from({ length: 6 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bang, depthTest: false, transparent: true }));
      s.visible = false;
      s.renderOrder = 999;
      scene.add(s);
      return s;
    });

    // Lock-on: a ring on the ground and a chevron above the head.
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32).rotateX(-Math.PI / 2), this.ringMat);
    this.chevron = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4).rotateX(Math.PI), this.ringMat);
    this.ring.visible = this.chevron.visible = false;
    this.ring.renderOrder = this.chevron.renderOrder = 998;
    scene.add(this.ring, this.chevron);
  }

  // Stars fly out of a hit; `big` for the last hit of a combo.
  hit(x, y, z, big) {
    const n = big ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random(), s = 2.2 + Math.random() * 2.6;
      this.stars.emit(x, y, z, Math.cos(a) * s, 1.5 + Math.random() * 2.5, Math.sin(a) * s, 0.45 + Math.random() * 0.25, 1, 0.85, 0.2);
    }
  }

  puff(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = 0.6 + Math.random() * 1.1;
      this.dust.emit(x, y, z, Math.cos(a) * s, 0.4 + Math.random() * 0.6, Math.sin(a) * s, 0.5 + Math.random() * 0.3, 0.55, 0.5, 0.42);
    }
  }

  flame(x, y, z) {
    this.stars.emit(x + (Math.random() - 0.5) * 0.2, y, z + (Math.random() - 0.5) * 0.2, 0, 0.6, 0, 0.3, 1, 0.45, 0.08);
  }

  // Stars circling a fainted head.
  dizzy(x, y, z, t) {
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + (i / 3) * 6.283;
      this.stars.emit(x + Math.cos(a) * 0.35, y + Math.sin(t * 9 + i) * 0.05, z + Math.sin(a) * 0.35, 0, 0, 0, 0.12, 1, 0.9, 0.3);
    }
  }

  update(dt) {
    this.stars.update(dt, 9);
    this.dust.update(dt, -0.5);
  }

  // Marker slot i above `head` (a Vector3) or hidden when head is null.
  bang(i, head, t) {
    const s = this.bangs[i];
    if (!head) {
      s.visible = false;
      return;
    }
    const k = 0.75 + 0.15 * Math.sin(t * 30);
    s.visible = true;
    s.position.set(head.x, head.y + 0.55, head.z);
    s.scale.set(k, k, k);
  }

  lock(target, time) {
    if (!target) {
      this.ring.visible = this.chevron.visible = false;
      return;
    }
    this.ring.visible = this.chevron.visible = true;
    this.ring.position.set(target.pos.x, target.pos.y + 0.05, target.pos.z);
    this.ring.scale.setScalar(0.9 + 0.08 * Math.sin(time * 6));
    this.chevron.position.set(target.pos.x, target.pos.y + target.height + 0.45 + 0.08 * Math.sin(time * 6), target.pos.z);
    this.chevron.rotation.y = time * 2.5;
  }

  dispose() {
    for (const e of [this.stars, this.dust]) {
      this.scene.remove(e.points);
      e.geo.dispose();
    }
    for (const s of this.bangs) this.scene.remove(s);
    this.scene.remove(this.ring, this.chevron);
  }

  // Synthesised effects through the existing Sfx (silent until the audio context exists).
  sound(name) {
    const s = this.sfx;
    if (!s?.ctx) return;
    switch (name) {
      case 'whack':
        s.burst(0.12, 1100, 200, 'lowpass', 0.6);
        s.tone(0.1, 240, 90, 0.5);
        break;
      case 'swoosh':
        s.burst(0.13, 2600, 700, 'bandpass', 0.22, 2);
        break;
      case 'thrown':
        s.burst(0.24, 3200, 900, 'bandpass', 0.2, 3);
        s.tone(0.2, 720, 320, 0.08);
        break;
      case 'catch':
        s.tone(0.09, 520, 260, 0.2);
        break;
      case 'hurt':
        s.tone(0.2, 320, 110, 0.5);
        s.burst(0.16, 800, 150, 'lowpass', 0.4);
        break;
      case 'dodge':
        s.burst(0.22, 1400, 5200, 'bandpass', 0.2, 1.5);
        break;
      case 'tie':
        s.burst(0.14, 1900, 800, 'bandpass', 0.2, 2);
        setTimeout(() => s.tone(0.1, 420, 300, 0.15), 120);
        break;
      case 'nope':
        s.tone(0.14, 190, 140, 0.25);
        break;
      case 'down':
        s.tone(0.28, 160, 50, 0.4);
        break;
      case 'faint':
        s.tone(0.9, 420, 60, 0.4);
        break;
      case 'bang':
        s.tone(0.1, 880, 880, 0.12);
        break;
    }
  }
}
