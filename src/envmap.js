import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { makeSkyMaterial, setSkyUniforms } from './skydome.js';

// Image based light for the whole day. The sky is baked into a few environment maps at fixed sun elevations
// (the sun disc left out: the directional light is the sun), some of them mixed with a real Poly Haven sky.
// Between two maps we blend the two PMREM textures pixel by pixel on a tiny target, so the light changes
// smoothly with the hour without ever baking again.

export const KEY_ELEV = [-20, -6, 0, 8, 25, 60];
// Which sky photo backs each key: midday, sunset, dusk, night. Poly Haven, CC0.
const HDRI = {
  noon: { file: 'hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr', keys: [25, 60], mix: 0.5 },
  sunset: { file: 'hdri/belfast_sunset_puresky_1k.hdr', keys: [0, 8], mix: 0.55 },
  dusk: { file: 'hdri/qwantani_dusk_2_puresky_1k.hdr', keys: [-6], mix: 0.5 },
  night: { file: 'hdri/qwantani_moonrise_puresky_1k.hdr', keys: [-20], mix: 0.35 },
};

const BLEND_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tA, tB;
uniform float t;
void main() { gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), t); }`;

// Reads a parsed .hdr (half floats, top row first) and finds where the sun is and how bright the sky is.
export function analyseHdri(tex) {
  const { width: w, height: h, data } = tex.image;
  const F = THREE.DataUtils.fromHalfFloat;
  const stepX = Math.max(1, Math.floor(w / 256)), stepY = Math.max(1, Math.floor(h / 128));
  let best = 0, bx = 0, by = 0;
  const pts = [];
  for (let j = 0; j < h; j += stepY) {
    const v = 1 - (j + 0.5) / h; // row 0 is the top of the picture, v = 1
    for (let i = 0; i < w; i += stepX) {
      const k = (j * w + i) * 4;
      const l = 0.2126 * F(data[k]) + 0.7152 * F(data[k + 1]) + 0.0722 * F(data[k + 2]);
      const u = (i + 0.5) / w;
      pts.push(u, v, l);
      if (v > 0.5 && l > best) (best = l), (bx = u), (by = v);
    }
  }
  // Direction of the brightest spot in the shader's convention: u from atan(z, x), v from asin(y).
  const sunAz = (bx - 0.5) * 2 * Math.PI;
  const sunEl = (by - 0.5) * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(sunEl) * Math.cos(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.sin(sunAz));
  // Average brightness of the sky away from the sun.
  let sum = 0, n = 0;
  for (let p = 0; p < pts.length; p += 3) {
    const az = (pts[p] - 0.5) * 2 * Math.PI, el = (pts[p + 1] - 0.5) * Math.PI;
    if (el < 0.05) continue;
    const dvec = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    if (dvec.dot(sunDir) > 0.86) continue;
    sum += pts[p + 2];
    n++;
  }
  return { az: sunAz, elev: sunEl / (Math.PI / 180), avg: n ? sum / n : 1, peak: best };
}

export class EnvMaps {
  constructor(renderer, baseUrl = '') {
    this.renderer = renderer;
    this.baseUrl = baseUrl;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene = new THREE.Scene();
    this.material = makeSkyMaterial(true);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.dome.scale.setScalar(50);
    this.scene.add(this.dome);
    this.targets = [];
    this.hdris = {};
    this.out = null;
    this.texture = null;
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { tA: { value: null }, tB: { value: null }, t: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: BLEND_FRAG,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.quad.frustumCulled = false;
    this.blendScene = new THREE.Scene();
    this.blendScene.add(this.quad);
    this.blendCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lastElev = null;
  }

  // Sun reference direction for every bake: due south. The real azimuth comes back as environmentRotation.
  static refSun(elev) {
    const e = (elev * Math.PI) / 180;
    return { x: 0, y: Math.sin(e), z: Math.cos(e), elev };
  }

  async loadHdris() {
    const loader = new HDRLoader();
    await Promise.all(
      Object.entries(HDRI).map(async ([name, spec]) => {
        try {
          const tex = await loader.loadAsync(this.baseUrl + spec.file);
          tex.minFilter = tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = false;
          tex.wrapS = THREE.RepeatWrapping;
          tex.needsUpdate = true;
          this.hdris[name] = { tex, info: analyseHdri(tex), spec };
        } catch (e) {
          console.warn('HDRI not loaded', spec.file, e);
        }
      })
    );
  }

  // Bakes every key elevation. atmFor(elev) gives the palette for that sun height.
  bake(atmFor, moonFor, size = 256) {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    const u = this.material.uniforms;
    for (const elev of KEY_ELEV) {
      const atm = atmFor(elev);
      const sun = EnvMaps.refSun(elev);
      const night = elev < -4 ? 1 : 0;
      setSkyUniforms(this.material, atm, sun, moonFor(elev), night, 0, 0);
      u.uBelow.value.copy(atm.hg).multiplyScalar(0.6 + 0.4 * Math.min(1, atm.sunK + 0.2));
      const entry = Object.values(this.hdris).find((h) => h.spec.keys.includes(elev));
      if (entry) {
        const info = entry.info;
        u.uHdri.value = entry.tex;
        u.uHdriMix.value = entry.spec.mix;
        // Turn the photo so its sun sits due south like ours, and scale it to the brightness of the procedural sky.
        u.uHdriRot.value = info.az - Math.PI / 2;
        const target = 0.2126 * atm.zen.r * 0.5 + 0.2126 * atm.hor.r * 0.5 + 0.7152 * (atm.zen.g + atm.hor.g) * 0.5 + 0.0722 * (atm.zen.b + atm.hor.b) * 0.5;
        u.uHdriScale.value = target / Math.max(info.avg, 1e-3);
        u.uHdriMax.value = Math.max(target * 3.5, 0.02);
      } else u.uHdriMix.value = 0;
      this.targets.push(this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size }));
    }
    if (!this.out) {
      const t0 = this.targets[0];
      this.out = new THREE.WebGLRenderTarget(t0.width, t0.height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
      });
      this.out.texture.mapping = THREE.CubeUVReflectionMapping;
      this.out.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.texture = this.out.texture;
    }
    this.lastElev = null;
  }

  // Blends the two bakes around a sun elevation into the texture the scene uses.
  blend(elev) {
    if (!this.targets.length) return;
    if (this.lastElev !== null && Math.abs(elev - this.lastElev) < 0.02) return;
    this.lastElev = elev;
    let i = 0;
    while (i < KEY_ELEV.length - 2 && elev > KEY_ELEV[i + 1]) i++;
    const t = Math.max(0, Math.min(1, (elev - KEY_ELEV[i]) / (KEY_ELEV[i + 1] - KEY_ELEV[i])));
    const m = this.quad.material.uniforms;
    m.tA.value = this.targets[i].texture;
    m.tB.value = this.targets[i + 1].texture;
    m.t.value = t;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.out);
    r.render(this.blendScene, this.blendCam);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.out?.dispose();
    this.pmrem.dispose();
    this.material.dispose();
    this.dome.geometry.dispose();
    for (const h of Object.values(this.hdris)) h.tex.dispose();
  }
}
