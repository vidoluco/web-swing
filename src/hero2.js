import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { spiderEmblemTexture } from './textures.js';
import { damp, clamp } from './config.js';

// Skinned hero on the Mixamo X Bot rig. The suit is painted by a shader in bind-pose
// space, so red and blue panels, web lines, eyes and emblem stay glued to the body while
// the skeleton moves. Ground motion comes from the idle/walk/run clips; air poses are
// solved by aiming bones at target directions and blended on top.

const SUIT_GLSL = /* glsl */ `
uniform float uBlack;
uniform sampler2D uEmblem;
uniform sampler2D uEmblemBig;
varying vec3 vBind;
float gRough = 0.5;
float gSheen = 0.0;
float lineAA(float f, float w) {
  float d = min(f, 1.0 - f);
  float fw = fwidth(f) + 1e-5;
  return 1.0 - smoothstep(w - fw, w + fw, d);
}
vec3 suitColor(vec3 p, out float web, out float rough) {
  float x = p.x, y = p.y, z = p.z;
  float ax = abs(x);
  web = 0.0;
  rough = 0.55;
  // Panels in the T-pose: arms run along x at shoulder height.
  bool arm = ax > 0.2 && y > 1.28 && y < 1.6;
  bool head = !arm && y > 1.49;
  bool leg = y < 0.93;
  bool boot = y < 0.47;
  bool forearm = arm && ax > 0.46;
  bool chest = !arm && !leg && !head && (y > 1.17 || ax < 0.075);
  bool belt = !arm && y > 0.93 && y < 0.99;
  bool red = head || forearm || chest || boot || belt || (leg && ax < 0.045);
  vec3 redCol = vec3(0.58, 0.035, 0.05);
  vec3 blueCol = vec3(0.04, 0.12, 0.42);
  vec3 col = red ? redCol : blueCol;
  // Web lines over the red panels.
  if (red) {
    if (head) {
      vec2 q = vec2(x, y - 1.625);
      float ang = atan(q.y, q.x) / 6.2831853 * 20.0;
      float rad = length(q) / 0.028;
      web = max(lineAA(fract(ang), 0.05), lineAA(fract(rad + 0.15 * sin(ang * 3.14159)), 0.06));
    } else if (forearm) {
      float ang = atan(y - 1.43, z) / 6.2831853 * 10.0;
      web = max(lineAA(fract(ang), 0.05), lineAA(fract(ax / 0.045 + 0.2 * sin(fract(ang) * 3.14159)), 0.06));
    } else {
      float ang = atan(x, z) / 6.2831853 * 18.0;
      float sag = 0.22 * sin(fract(ang) * 3.14159);
      web = max(lineAA(fract(ang), 0.045), lineAA(fract(y / 0.05 + sag), 0.055));
    }
  }
  col = mix(col, vec3(0.015), web * 0.85);
  // Big lenses with black rims.
  if (head && z > 0.02) {
    for (int i = 0; i < 2; i++) {
      float s = i == 0 ? 1.0 : -1.0;
      vec2 c = vec2(0.043 * s, 1.652);
      vec2 d = vec2(x, y) - c;
      float a = -0.45 * s;
      d = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
      float e = (d.x * d.x) / (0.033 * 0.033) + (d.y * d.y) / (0.019 * 0.019);
      if (e < 1.5) col = vec3(0.01);
      if (e < 1.0) { col = vec3(0.92, 0.95, 0.97); rough = 0.15; web = 0.0; }
    }
  }
  return col;
}
`;

function suitMaterial(emblem, emblemBig) {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.55, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.6, 0.25, 0.25) });
  mat.userData.uniforms = { uBlack: { value: 0 }, uEmblem: { value: emblem }, uEmblemBig: { value: emblemBig } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SUIT_GLSL)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  float web, rough;
  vec3 c = suitColor(vBind, web, rough);
  vec3 p = vBind;
  if (uBlack > 0.5) {
    c = mix(vec3(0.012, 0.012, 0.016), vec3(0.06, 0.06, 0.07), web);
    rough = mix(0.22, 0.4, web);
    if (p.y > 1.49 && p.z > 0.02 && c.r < 0.5) {
      // keep the lenses from the classic pass
      float w2, r2; vec3 cl = suitColor(p, w2, r2);
      if (cl.r > 0.5) { c = cl; rough = 0.15; }
    }
    vec2 uv = vec2((p.x + 0.2) / 0.4, (p.y - 1.05) / 0.44);
    if (abs(p.x) < 0.2 && p.y > 1.05 && p.y < 1.49 && abs(p.z) > 0.03) {
      vec4 e = texture2D(uEmblemBig, vec2(p.z > 0.0 ? uv.x : 1.0 - uv.x, uv.y));
      c = mix(c, vec3(0.93), e.a);
      rough = mix(rough, 0.35, e.a);
    }
  } else if (p.z > 0.06 && abs(p.x) < 0.09 && p.y > 1.22 && p.y < 1.42) {
    vec4 e = texture2D(uEmblem, vec2((p.x + 0.09) / 0.18, (p.y - 1.22) / 0.2));
    c = mix(c, vec3(0.01), e.a);
  } else if (p.z < -0.05 && abs(p.x) < 0.13 && p.y > 1.12 && p.y < 1.42) {
    vec4 e = texture2D(uEmblem, vec2(1.0 - (p.x + 0.13) / 0.26, (p.y - 1.12) / 0.3));
    c = mix(c, vec3(0.6, 0.02, 0.03), e.a);
  }
  diffuseColor.rgb = c;
  gRough = rough;
}`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;');
  };
  mat.customProgramCacheKey = () => 'suit-v1';
  return mat;
}

// Emblem textures with alpha, drawn once.
function emblemTextures() {
  return [spiderEmblemTexture('#000'), spiderEmblemTexture('#fff', true)];
}

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

export class XbotHero {
  static async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new XbotHero(gltf);
  }

  constructor(gltf) {
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);
    const [emb, embBig] = emblemTextures();
    this.material = suitMaterial(emb, embBig);
    this.model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = this.material;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
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
    this.suit = 'classic';
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._pq = new THREE.Quaternion();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.crouch = 0;
  }

  setSuit(name) {
    this.suit = name;
    this.material.userData.uniforms.uBlack.value = name === 'symbiote' ? 1 : 0;
  }

  toggleSuit() {
    this.setSuit(this.suit === 'classic' ? 'symbiote' : 'classic');
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

    // Air poses on top.
    const pose = airPose(name, t, params.phase || 0);
    const targetW = pose ? 1 : 0;
    this.airW += (targetW - this.airW) * damp(pose ? rate : 6, dt);
    if (pose) this.pose = pose;
    const P = this.pose;
    this.root.updateMatrixWorld(true);
    const crouchWant = pose && pose.crouch ? pose.crouch : 0;
    this.crouch += (crouchWant - this.crouch) * damp(10, dt);
    if (P && this.airW > 0.01) {
      const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
      const w = this.airW;
      const order = ['spine', 'rArm', 'rFore', 'lArm', 'lFore', 'lThigh', 'lShin', 'rThigh', 'rShin'];
      for (const key of order) {
        if (!P[key]) continue;
        const d = this._d.copy(P[key]).applyQuaternion(rq);
        this.aim(this.bones[key], this.child[key], d, w);
        this.bones[key].updateMatrixWorld(true);
      }
    }
    // Crouch: drop the hips (bone units are centimetres under a 0.01 armature).
    this.bones.hips.position.y = this.hipsRest.y - this.crouch * 100 * this.airW;
  }
}
