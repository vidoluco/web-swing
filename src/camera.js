import * as THREE from 'three';
import { clamp, damp } from './config.js';

// Third-person orbit camera: mouse look, speed-based distance and FOV, auto-follow when the mouse is idle.
export class CameraRig {
  constructor(camera, city) {
    this.cam = camera;
    this.city = city;
    this.yaw = 0;
    this.pitch = -0.18;
    this.dist = 6;
    this.fov = camera.fov;
    this.target = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.shake = 0;
    this.idle = 0;
  }

  update(dt, player, mouse, autoFollow) {
    const [dx, dy] = mouse;
    const sens = 0.0022;
    if (dx || dy) this.idle = 0;
    else this.idle += dt;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.35, 0.95);

    const v = player.vel;
    const hs = Math.hypot(v.x, v.z);
    const speed = v.length();
    if ((autoFollow || this.idle > 1.2) && hs > 7 && player.mode !== 'wall') {
      const heading = Math.atan2(-v.x, -v.z);
      let d = heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * damp(autoFollow ? 2.2 : 1.2, dt);
      const wantPitch = clamp(-0.12 - Math.max(0, -v.y) * 0.006, -0.6, 0.2);
      if (autoFollow) this.pitch += (wantPitch - this.pitch) * damp(1.5, dt);
    }

    let want = 5.2 + clamp((speed - 10) * 0.07, 0, 4.5);
    if (player.mode === 'wall') want = 6.5;
    if (player.poseName() === 'perch') want = 6.5;
    if (player.mode === 'drive') want = 8.5 + clamp(speed * 0.06, 0, 4);
    this.dist += (want - this.dist) * damp(3, dt);

    this.target.copy(player.pos);
    this.target.y += player.mode === 'swing' ? 1.1 : player.mode === 'drive' ? 1.9 : 1.45;
    const cp = Math.cos(this.pitch);
    this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    // Pull in when a building sits between the player and the camera.
    const back = this.dir.clone().negate();
    // Three rays (centre and both shoulders) so the camera does not slip past a corner.
    let d = this.dist;
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(0.45);
    for (const k of [0, 1, -1]) {
      const o = this.target.clone().addScaledVector(side, k);
      const hit = this.city.raycast(o, back, this.dist + 0.6, true);
      if (hit) d = Math.min(d, Math.max(0.35, hit.t - 0.6));
    }
    const pos = this.cam.position.copy(this.target).addScaledVector(back, d);
    // A little offset to the right, over the shoulder.
    pos.x += Math.cos(this.yaw) * 0.6;
    pos.z += -Math.sin(this.yaw) * 0.6;
    if (pos.y < 0.5) pos.y = 0.5;

    this.shake = clamp((speed - 35) / 30, 0, 1);
    if (this.shake > 0) {
      const t = performance.now() * 0.03;
      pos.x += Math.sin(t * 1.3) * 0.04 * this.shake;
      pos.y += Math.sin(t * 1.7) * 0.04 * this.shake;
    }
    this.cam.lookAt(this.target.x + this.dir.x * 20, this.target.y + this.dir.y * 20, this.target.z + this.dir.z * 20);

    const wantFov = 68 + clamp((speed - 14) * 0.55, 0, 24);
    this.fov += (wantFov - this.fov) * damp(3, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
