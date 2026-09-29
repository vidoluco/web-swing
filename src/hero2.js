import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SCARFS, bunicaMaterial, propsMaterial, buildProps, papucMesh } from './bunica.js';
import { damp, clamp } from './config.js';

// Bunica on the Mixamo X Bot rig. The dress, cardigan, tights, slippers and face are painted by a
// shader in bind-pose space (see bunica.js), so they stay glued to the body while the skeleton
// moves. Ground motion comes from the idle/walk/run clips; air poses are solved by aiming bones at
// target directions and blended on top.

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

// Target limb directions in hero space (+z forward, +y up, +x the hero's left).
function airPose(name, t, k) {
  const s = Math.sin(t * 8) * 0.08;
  switch (name) {
    case 'swing':
      return {
        spine: V(0, 1, 0.25 - k * 0.4),
        rArm: V(-0.12, 1, 0.12), rFore: V(-0.08, 1, 0.1),
        lArm: V(0.85, -0.25, -0.35), lFore: V(0.7, -0.5, 0.2),
        lThigh: V(0.12, -0.55 - k * 0.3, 0.8 - k * 0.6), lShin: V(0.05, -1, -0.35 + k * 0.2),
        rThigh: V(-0.12, -0.9, 0.35 - k * 0.3), rShin: V(-0.05, -1, -0.5),
      };
    case 'fall':
      return {
        spine: V(0, 1, -0.15),
        rArm: V(-0.75, -0.1 + s, -0.6), rFore: V(-0.6, -0.2, -0.75),
        lArm: V(0.75, -0.1 - s, -0.6), lFore: V(0.6, -0.2, -0.75),
        lThigh: V(0.15, -1, -0.15), lShin: V(0.12, -1, -0.35),
        rThigh: V(-0.15, -1, 0.1), rShin: V(-0.12, -1, -0.2),
      };
    case 'jump':
      return {
        spine: V(0, 1, 0.2),
        rArm: V(-0.85, 0.45, 0.2), rFore: V(-0.5, 0.8, 0.3),
        lArm: V(0.85, 0.45, 0.2), lFore: V(0.5, 0.8, 0.3),
        lThigh: V(0.15, -0.2, 1), lShin: V(0.05, -1, 0.05),
        rThigh: V(-0.15, -0.75, 0.55), rShin: V(-0.05, -1, -0.45),
      };
    case 'zip':
      return {
        spine: V(0, 1, 0.1),
        rArm: V(-0.15, 0.55, 1), rFore: V(-0.1, 0.5, 1),
        lArm: V(0.15, 0.55, 1), lFore: V(0.1, 0.5, 1),
        lThigh: V(0.12, -1, -0.2), lShin: V(0.08, -1, -0.6),
        rThigh: V(-0.12, -1, 0.1), rShin: V(-0.08, -1, -0.4),
      };
    case 'wall': {
      const c = Math.sin(k);
      return {
        spine: V(0, 1, 0.15),
        rArm: V(-0.55, 0.65 + c * 0.3, 0.45), rFore: V(-0.2, 0.9, 0.35),
        lArm: V(0.55, 0.65 - c * 0.3, 0.45), lFore: V(0.2, 0.9, 0.35),
        lThigh: V(0.65, -0.35 + c * 0.35, 0.55), lShin: V(0.25, -1, 0.1),
        rThigh: V(-0.65, -0.35 - c * 0.35, 0.55), rShin: V(-0.25, -1, 0.1),
      };
    }
    case 'perch':
    case 'land':
      return {
        spine: V(0, 0.75, 0.75),
        neckUp: true,
        rArm: V(-0.15, -0.85, 0.5), rFore: V(-0.05, -1, 0.15),
        lArm: V(0.35, -0.55, 0.75), lFore: V(0.1, -0.8, 0.6),
        lThigh: V(0.35, 0.15, 1), lShin: V(0.12, -1, -0.25),
        rThigh: V(-0.35, 0.15, 1), rShin: V(-0.12, -1, -0.25),
        crouch: 0.52,
      };
  }
  return null;
}

const HEIGHT = 0.93;
const HEAD = 1.25;
const _lq = new THREE.Quaternion();
const _lq2 = new THREE.Quaternion();
const _lq3 = new THREE.Quaternion();
const _lax = new THREE.Vector3();

export class XbotHero {
  static async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new XbotHero(gltf);
  }

  constructor(gltf) {
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.model.scale.setScalar(HEIGHT); // a grandmother is shorter than a mannequin
    this.root.add(this.model);
    this.scarfU = { uScarfA: { value: new THREE.Color() }, uScarfB: { value: new THREE.Color() } };
    this.material = bunicaMaterial(this.scarfU);
    this.propsMaterial = propsMaterial(this.scarfU);
    let body;
    this.model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = this.material;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        body = o;
      }
    });
    // The skirt, basma knot, glasses, bag and slipper fleece share the mannequin's skeleton.
    this.props = buildProps(body, this.propsMaterial);
    this.props.position.copy(body.position);
    this.props.quaternion.copy(body.quaternion);
    this.props.scale.copy(body.scale);
    body.parent.add(this.props);
    this.props.updateMatrixWorld(true);
    this.props.bind(body.skeleton, body.bindMatrix);
    const b = (n) => this.model.getObjectByName('mixamorig' + n);
    this.bones = {
      hips: b('Hips'), spine: b('Spine1'), neck: b('Neck'), head: b('Head'),
      rArm: b('RightArm'), rFore: b('RightForeArm'), rHand: b('RightHand'),
      lArm: b('LeftArm'), lFore: b('LeftForeArm'), lHand: b('LeftHand'),
      lThigh: b('LeftUpLeg'), lShin: b('LeftLeg'), lFoot: b('LeftFoot'),
      rThigh: b('RightUpLeg'), rShin: b('RightLeg'), rFoot: b('RightFoot'),
      spine2: b('Spine2'),
    };
    this.child = {
      spine: this.bones.neck, rArm: this.bones.rFore, rFore: this.bones.rHand, lArm: this.bones.lFore, lFore: this.bones.lHand,
      lThigh: this.bones.lShin, lShin: this.bones.lFoot, rThigh: this.bones.rShin, rShin: this.bones.rFoot,
    };
    this.bones.head.scale.setScalar(HEAD); // a big head for a small grandmother
    this.hipsRest = this.bones.hips.position.clone();
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n) => gltf.animations.find((a) => a.name === n);
    this.actions = {};
    for (const n of ['idle', 'walk', 'run']) {
      const a = this.mixer.clipAction(clip(n));
      a.play();
      a.setEffectiveWeight(n === 'idle' ? 1 : 0);
      this.actions[n] = a;
    }
    this.weights = { idle: 1, walk: 0, run: 0 };
    this.airW = 0;
    this.pose = null;
    this.over = null; // { w, spine?, rArm?, ... }: limb directions from the combat, blended over everything else
    this.setScarf(0);
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._pq = new THREE.Quaternion();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.crouch = 0;
  }

  // The colour of the basma: an index into SCARFS, or its id.
  setScarf(which) {
    const n = SCARFS.length;
    const i = typeof which === 'number' ? ((which % n) + n) % n : Math.max(0, SCARFS.findIndex((s) => s.id === which));
    const s = SCARFS[i];
    this.scarfIndex = i;
    this.suit = s.id;
    this.suitLabel = s.label;
    this.scarfU.uScarfA.value.set(s.a);
    this.scarfU.uScarfB.value.set(s.b);
  }

  setSuit(name) {
    this.setScarf(name);
  }

  toggleSuit() {
    this.setScarf(this.scarfIndex + 1);
  }

  handWorld(out) {
    return this.bones.rHand.getWorldPosition(out);
  }

  // Rotate `bone` (in world space) so that bone -> child points along `dirWorld`, blended by w.
  aim(bone, child, dirWorld, w) {
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(false, false);
    const a = this._a.setFromMatrixPosition(bone.matrixWorld);
    const cur = this._b.setFromMatrixPosition(child.matrixWorld).sub(a).normalize();
    const delta = this._q.setFromUnitVectors(cur, dirWorld);
    const boneWorld = bone.getWorldQuaternion(this._q2);
    const target = delta.multiply(boneWorld);
    const parentWorld = bone.parent.getWorldQuaternion(this._pq).invert();
    target.premultiply(parentWorld);
    bone.quaternion.slerp(target, w);
  }

  // Blend the limbs of `P` (hero space directions per key) into the skeleton with weight w.
  pose_(P, w) {
    const rq = this.root.getWorldQuaternion(_lq3);
    const order = ['spine', 'rArm', 'rFore', 'lArm', 'lFore', 'lThigh', 'lShin', 'rThigh', 'rShin'];
    for (const key of order) {
      if (!P[key]) continue;
      const d = this._d.copy(P[key]).applyQuaternion(rq);
      this.aim(this.bones[key], this.child[key], d, w);
      this.bones[key].updateMatrixWorld(true);
    }
  }

  // Pitch `bone` forward by `angle` about the hero's own left-right axis, in world space, so it does
  // not depend on the bone's local axes.
  lean(bone, angle) {
    _lax.set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(_lq));
    bone.updateWorldMatrix(true, false);
    const world = bone.getWorldQuaternion(_lq2).premultiply(_lq3.setFromAxisAngle(_lax, angle));
    bone.quaternion.copy(world).premultiply(bone.parent.getWorldQuaternion(_lq).invert());
    bone.updateMatrixWorld(true);
  }

  animate(name, dt, t, params = {}, rate = 10, speed = 0) {
    // Ground locomotion from clips.
    const ground = name === 'idle' || name === 'run';
    const runW = ground ? clamp((speed - 4) / 6, 0, 1) : 0;
    const walkW = ground ? clamp(speed / 3, 0, 1) * (1 - runW) : 0;
    const want = { idle: 1 - runW - walkW, walk: walkW, run: runW };
    const k = damp(8, dt);
    for (const n in this.actions) {
      this.weights[n] += (want[n] - this.weights[n]) * k;
      this.actions[n].setEffectiveWeight(this.weights[n]);
    }
    this.actions.run.timeScale = clamp(speed / 9, 0.6, 1.5);
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    // The stoop of age: lean forward standing or walking, head kept up, nothing in the air.
    const stoop = (this.weights.idle * 1 + this.weights.walk * 0.5) * (1 - this.airW);
    if (stoop > 0.01) {
      this.lean(this.bones.spine, 0.2 * stoop);
      this.lean(this.bones.spine2, 0.14 * stoop);
      this.lean(this.bones.neck, -0.16 * stoop);
      this.lean(this.bones.head, -0.08 * stoop);
    }

    // Air poses on top.
    const pose = airPose(name, t, params.phase || 0);
    const targetW = pose ? 1 : 0;
    this.airW += (targetW - this.airW) * damp(pose ? rate : 6, dt);
    if (pose) this.pose = pose;
    const P = this.pose;
    const crouchWant = pose && pose.crouch ? pose.crouch : 0;
    this.crouch += (crouchWant - this.crouch) * damp(10, dt);
    if (P && this.airW > 0.01) this.pose_(P, this.airW);
    if (this.over && this.over.w > 0.01) this.pose_(this.over, this.over.w);
    // Crouch: drop the hips (bone units are centimetres under a 0.01 armature).
    this.bones.hips.position.y = this.hipsRest.y - this.crouch * 100 * this.airW;
  }
}
