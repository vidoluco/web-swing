import * as THREE from 'three';
import { PHYS, clamp, damp } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _near = [];

// Modes: ground, air, swing (pendulum on a web), wall (crawl), zip (pulled to a point).
export class Player {
  constructor(city) {
    this.city = city;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, -1);
    this.anchor = new THREE.Vector3();
    this.swingDir = new THREE.Vector3(0, 0, -1);
    this.quat = new THREE.Quaternion();
    this.wish = new THREE.Vector3();
    this.lastSafe = new THREE.Vector3();
    this.swingFrom = new THREE.Vector3();
    this.ban = { x: 0, z: 0, t: 0 };
    this.reset();
  }

  reset() {
    this.pos.copy(this.city.spawn);
    this.lastSafe.copy(this.city.spawn);
    this.vel.set(0, 0, 0);
    const yaw = this.city.spawnYaw || 0;
    this.facing.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.mode = 'ground';
    this.grounded = true;
    this.groundBox = this.city.spawnBox;
    this.side = 1;
    this.swingCooldown = 0;
    this.wallCooldown = 0;
    this.coyote = 0;
    this.idleTime = 2;
    this.landTimer = 0;
    this.runPhase = 0;
    this.wallPhase = 0;
    this.swingTime = 0;
    this.webT = 0;
    this.webFade = 0;
    this.wall = null;
    this.zip = null;
    this.events = [];
    this.quat.setFromAxisAngle(UP, 0);
  }

  get speed() {
    return this.vel.length();
  }

  update(dt, inp, view) {
    const fwd = _fwd.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    const right = _right.set(-fwd.z, 0, fwd.x);
    this.wish.set(0, 0, 0).addScaledVector(right, inp.moveX).addScaledVector(fwd, inp.moveY);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.camFwd = fwd;
    this.camRight = right;

    this.swingCooldown -= dt;
    this.ban.t -= dt;
    this.wallCooldown -= dt;
    this.coyote -= dt;
    this.landTimer -= dt;

    if (inp.zipPressed) this.tryZip(view);
    this.handleInput(inp);

    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(h, inp);

    this.updateOrientation(dt);
    if (this.mode === 'swing' || this.mode === 'zip') {
      this.webT = Math.min(1, this.webT + dt / 0.09);
      this.webFade = 1;
    } else {
      this.webFade = Math.max(0, this.webFade - dt / 0.15);
    }
    if (this.mode === 'ground' && this.wish.lengthSq() < 0.01) this.idleTime += dt;
    else this.idleTime = 0;
  }

  handleInput(inp) {
    switch (this.mode) {
      case 'ground':
        if (inp.jumpPressed) this.jump();
        else if (inp.swingPressed) {
          this.vel.y = 13;
          this.vel.addScaledVector(this.facing, 3);
          this.mode = 'air';
          this.pos.y += 0.05;
        }
        break;
      case 'air':
        if (inp.jumpPressed && this.coyote > 0) this.jump();
        if (inp.swing && this.swingCooldown <= 0) this.startSwing();
        break;
      case 'swing':
        if (inp.jumpPressed) this.release(true);
        else if (!inp.swing) this.release(false);
        break;
      case 'wall':
        if (inp.jumpPressed || inp.swingPressed) {
          const n = this.wall.n;
          this.vel.copy(n).multiplyScalar(12).addScaledVector(UP, 11).addScaledVector(this.camFwd, 4);
          this.facing.copy(n);
          this.mode = 'air';
          this.wallCooldown = 0.35;
          this.wall = null;
        }
        break;
      case 'zip':
        if (inp.jumpPressed) this.zip.launch = true;
        break;
    }
  }

  jump() {
    this.vel.y = PHYS.jumpSpeed;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 4) this.vel.addScaledVector(this.facing, 3);
    this.mode = 'air';
    this.coyote = 0;
    this.pos.y += 0.05;
    this.events.push('jump');
  }

  startSwing() {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // Travel direction: where you are steering, else where you are going.
    if (this.wish.lengthSq() > 0.01) this.swingDir.copy(this.wish).normalize();
    else if (hs > 3) this.swingDir.set(this.vel.x / hs, 0, this.vel.z / hs);
    else this.swingDir.copy(this.camFwd);
    this.side = -this.side;
    const ban = this.ban.t > 0 ? this.ban : null;
    const a = this.city.findAnchor(this.pos, this.swingDir, this.side, this.speed, ban) || this.city.findAnchor(this.pos, this.swingDir, -this.side, this.speed, ban);
    if (!a) {
      this.swingCooldown = 0.2;
      return;
    }
    this.anchor.copy(a);
    this.swingFrom.copy(this.pos);
    const d = this.pos.distanceTo(a);
    this.ropeLen = d * 0.9;
    this.mode = 'swing';
    this.swingTime = 0;
    this.webT = 0;
    // Initial yank toward the anchor and along the travel direction.
    _v.copy(a).sub(this.pos).normalize();
    this.vel.addScaledVector(_v, 5);
    if (hs < 20) this.vel.addScaledVector(this.swingDir, 6);
    this.events.push('web');
  }

  release(jumpBoost) {
    this.mode = 'air';
    const hs = Math.hypot(this.vel.x, this.vel.z) || 1;
    this.vel.y += jumpBoost ? 13 : 5;
    this.vel.x += (this.vel.x / hs) * (jumpBoost ? 6 : 3);
    this.vel.z += (this.vel.z / hs) * (jumpBoost ? 6 : 3);
    this.swingCooldown = jumpBoost ? 0.3 : 0.12;
    this.coyote = 0;
    if (jumpBoost) this.events.push('jump');
  }

  tryZip(view) {
    const hit = this.city.raycast(view.camPos, view.camDir, 170);
    if (!hit || hit.t < 3) return;
    const target = hit.point.clone().addScaledVector(hit.normal, hit.normal.y > 0.5 ? 0.02 : PHYS.radius + 0.05);
    if (target.distanceTo(this.pos) < 3) return;
    this.zip = { target, normal: hit.normal.clone(), box: hit.box, launch: false };
    this.anchor.copy(hit.point);
    this.mode = 'zip';
    this.webT = 0;
    this.wall = null;
    this.events.push('web');
  }

  step(h, inp) {
    const g = PHYS.gravity;
    const v = this.vel, p = this.pos;
    switch (this.mode) {
      case 'ground': {
        const target = _w.copy(this.wish).multiplyScalar(PHYS.runSpeed);
        const k = damp(this.wish.lengthSq() > 0.01 ? 10 : 14, h);
        v.x += (target.x - v.x) * k;
        v.z += (target.z - v.z) * k;
        v.y -= g * h;
        if (this.wish.lengthSq() > 0.01) this.facing.copy(this.wish).normalize();
        p.addScaledVector(v, h);
        this.collide();
        if (this.contact && this.wish.dot(this.contact.n) < -0.5 && this.contact.box.y1 - p.y > 2.5 && this.wallCooldown <= 0) {
          this.enterWall(this.contact);
        } else if (!this.grounded) {
          this.mode = 'air';
          this.coyote = 0.12;
        }
        break;
      }
      case 'air': {
        v.y -= g * h;
        v.x += this.wish.x * PHYS.airAccel * h;
        v.z += this.wish.z * PHYS.airAccel * h;
        v.multiplyScalar(1 - 0.04 * h);
        if (v.y < -80) v.y = -80;
        this.clampSpeed();
        p.addScaledVector(v, h);
        const vy = v.y;
        this.collide();
        const hs = Math.hypot(v.x, v.z);
        if (hs > 3) this.facing.set(v.x / hs, 0, v.z / hs);
        if (this.grounded) this.land(vy);
        else if (this.contact && this.wallCooldown <= 0 && this.contact.box.y1 - p.y > 2) this.enterWall(this.contact);
        break;
      }
      case 'swing': {
        this.swingTime += h;
        v.y -= g * h;
        const rel = _v.copy(p).sub(this.anchor);
        const d = rel.length();
        const rh = rel.clone().divideScalar(d || 1);
        // Pump: push along the tangent in the steering direction while below the anchor.
        const steer = _w.copy(this.wish.lengthSq() > 0.01 ? this.wish : this.swingDir);
        const tangent = steer.addScaledVector(rh, -steer.dot(rh));
        if (tangent.lengthSq() > 1e-4 && p.y < this.anchor.y) v.addScaledVector(tangent.normalize(), 17 * h);
        if (this.wish.lengthSq() > 0.01) this.swingDir.lerp(this.wish, damp(1.5, h)).setY(0).normalize();
        this.clampSpeed();
        p.addScaledVector(v, h);
        // Inelastic rope: project back onto the sphere and drop the outward velocity.
        rel.copy(p).sub(this.anchor);
        const dist = rel.length();
        if (dist > this.ropeLen) {
          rel.multiplyScalar(this.ropeLen / dist);
          p.copy(this.anchor).add(rel);
          rel.divideScalar(this.ropeLen);
          const vr = v.dot(rel);
          if (vr > 0) v.addScaledVector(rel, -vr);
        }
        this.ropeLen = Math.max(8, this.ropeLen - 2.5 * h);
        if (p.y < 1.2) {
          p.y = 1.2;
          if (v.y < 0) v.y = 0;
          this.ropeLen = Math.min(this.ropeLen, p.distanceTo(this.anchor));
        }
        this.collide();
        const hs = Math.hypot(v.x, v.z);
        if (hs > 2) this.facing.set(v.x / hs, 0, v.z / hs);
        if (this.contact && this.contact.box.y1 - p.y > 2) {
          this.enterWall(this.contact);
          break;
        }
        if (this.grounded) {
          this.land(v.y);
          break;
        }
        // Past the forward apex: let go and, if the button is still held, fire the next web.
        const ahead = (p.x - this.anchor.x) * this.swingDir.x + (p.z - this.anchor.z) * this.swingDir.z;
        if (this.swingTime > 0.45 && ahead > this.ropeLen * 0.5 && v.y > 0) this.release(false);
        if (this.swingTime > 3.5) this.release(false);
        // A swing that goes nowhere (circling under an anchor overhead) is let go, and that
        // anchor is avoided for a moment so the next web pulls somewhere new.
        else if (this.swingTime > 1.3 && Math.hypot(p.x - this.swingFrom.x, p.z - this.swingFrom.z) < 5) {
          this.ban.x = this.anchor.x;
          this.ban.z = this.anchor.z;
          this.ban.t = 2;
          this.release(false);
        }
        break;
      }
      case 'wall': {
        const W = this.wall;
        const n = W.n;
        const side = _w.crossVectors(UP, n); // horizontal, along the wall
        const s = Math.sign(side.dot(this.camRight)) || 1;
        const climb = inp.moveY * PHYS.climbSpeed * (inp.moveY > 0 ? 1.15 : 1);
        v.set(0, climb, 0).addScaledVector(side, inp.moveX * s * 6);
        p.addScaledVector(v, h);
        // Stay glued to the nearest face; walking past a corner moves onto the next face.
        const b = W.box;
        W.n.copy(this.city.wallGlue(p, b, PHYS.radius));
        this.wallPhase += (Math.abs(inp.moveY) + Math.abs(inp.moveX)) * h * 7;
        if (p.y >= b.y1 - 0.4) {
          // Vault over the parapet onto the roof.
          p.y = b.y1 + 0.05;
          p.addScaledVector(n, -1.2);
          v.copy(n).multiplyScalar(-4).addScaledVector(UP, 4);
          this.facing.copy(n).negate();
          this.mode = 'air';
          this.wall = null;
          this.wallCooldown = 0.3;
        } else if (p.y <= 0) {
          p.y = 0;
          this.mode = 'ground';
          this.wall = null;
          this.wallCooldown = 0.5;
        }
        break;
      }
      case 'zip': {
        const Z = this.zip;
        const to = _v.copy(Z.target).sub(p);
        const d = to.length();
        const sp = PHYS.zipSpeed;
        if (d <= sp * h + 0.3) {
          p.copy(Z.target);
          to.divideScalar(d || 1);
          if (Z.launch) {
            // Point launch: fling upward and onward.
            v.set(to.x, 0, to.z).normalize().multiplyScalar(18);
            v.y = 22;
            this.mode = 'air';
            this.events.push('jump');
          } else if (Z.normal.y > 0.5 || !Z.box) {
            v.set(to.x * 4, 2, to.z * 4);
            this.mode = 'air';
          } else {
            v.set(0, 0, 0);
            this.enterWall({ box: Z.box, n: Z.normal.clone() });
          }
          this.zip = null;
        } else {
          v.copy(to).multiplyScalar(sp / d);
          p.addScaledVector(v, h);
          const hs = Math.hypot(to.x, to.z);
          if (hs > 0.1) this.facing.set(to.x / hs, 0, to.z / hs);
        }
        break;
      }
    }
    this.checkWater();
  }

  enterWall(c) {
    this.mode = 'wall';
    this.wall = { box: c.box, n: c.n.clone() };
    this.vel.set(0, 0, 0);
    this.facing.copy(c.n).negate();
    this.events.push('wall');
  }

  land(vy) {
    this.mode = 'ground';
    if (vy < -22) {
      this.landTimer = 0.35;
      this.events.push('land');
    }
  }

  clampSpeed() {
    const s = this.vel.length();
    if (s > PHYS.maxSpeed) this.vel.multiplyScalar(PHYS.maxSpeed / s);
  }

  collide() {
    this.city.collide(this.pos, this.vel, PHYS.radius, PHYS.height, this.wish, this);
    if (this.grounded && !this.city.isWater(this.pos.x, this.pos.z)) this.lastSafe.copy(this.pos);
  }

  checkWater() {
    const p = this.pos;
    if (p.y < -0.8 && this.city.isWater(p.x, p.z)) {
      p.copy(this.lastSafe);
      this.vel.set(0, 0, 0);
      this.mode = 'ground';
      this.events.push('splash');
    }
  }

  updateOrientation(dt) {
    const f = _v, up = _w;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    up.copy(UP);
    f.copy(this.facing);
    if (this.mode === 'swing') {
      up.copy(this.anchor).sub(this.pos).normalize();
      f.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
      if (f.lengthSq() < 0.5) f.copy(this.swingDir);
      f.normalize();
    } else if (this.mode === 'wall') {
      f.copy(this.wall.n).negate();
    } else if (this.mode === 'air' && this.vel.y < -14 && hs > 1) {
      // Dive: pitch the body toward the fall.
      const pitch = clamp((-this.vel.y - 14) / 35, 0, 1) * 1.2;
      f.multiplyScalar(Math.cos(pitch)).addScaledVector(UP, -Math.sin(pitch));
      up.copy(UP).multiplyScalar(Math.cos(pitch)).addScaledVector(this.facing, Math.sin(pitch));
    } else if (this.mode === 'zip') {
      f.copy(this.zip ? this.zip.target : this.anchor).sub(this.pos).normalize();
      up.copy(UP).addScaledVector(f, -f.dot(UP)).normalize();
      if (up.lengthSq() < 0.1) up.set(0, 0, 1);
    }
    const x = new THREE.Vector3().crossVectors(up, f);
    if (x.lengthSq() < 1e-6) return;
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    _m.makeBasis(x, up, z);
    _q.setFromRotationMatrix(_m);
    this.quat.slerp(_q, damp(this.mode === 'swing' ? 9 : 12, dt));
  }

  poseName() {
    switch (this.mode) {
      case 'ground': {
        if (this.landTimer > 0) return 'land';
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (hs > 1.2) return 'run';
        return this.groundBox && this.idleTime > 0.8 ? 'perch' : 'idle';
      }
      case 'air':
        return this.vel.y > 3 ? 'jump' : 'fall';
      case 'swing':
        return 'swing';
      case 'wall':
        return 'wall';
      case 'zip':
        return 'zip';
    }
    return 'idle';
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
