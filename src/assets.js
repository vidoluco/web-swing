import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Free photographic and modelled assets (credits in assets/CREDITS.md). Everything is optional: a file that
// fails to load leaves a flat neutral layer or a null model, so the game still starts without it.
//
// PBR sets are packed into two texture arrays per group, so a shader can pick a material by index:
//   albedo array: rgb = colour (sRGB), a = roughness
//   normal array: rg = tangent space normal (OpenGL, xy), b = 255, a = 255
// Mean sRGB value (0-255) the albedo of a layer is scaled to, so the vertex colour decides the tone. Others keep their own.
const NORMALISE = { plaster_a: 196, plaster_b: 196, plaster_c: 196, panel_a: 190, panel_b: 176 };
export const WALL = ['plaster_a', 'plaster_b', 'plaster_c', 'brick_a', 'brick_b', 'panel_a', 'panel_b', 'roof_a', 'roof_b', 'roof_c'];
export const GROUND = ['asphalt_a', 'asphalt_b', 'paving_a', 'paving_b', 'paving_c', 'paving_d', 'grass_a', 'grass_b', 'dirt_a', 'gravel_a', 'bark_a'];
export const MODELS = ['street_lamp_01', 'street_lamp_02', 'metal_trash_can', 'utility_box_01', 'utility_box_02', 'outdoor_table_chair_set_01', 'standing_chalkboard_01', 'planter_box_01', 'wooden_picnic_table', 'plastic_monobloc_chair_01', 'potted_plant_01', 'potted_plant_02', 'rollershutter_window_01'];

// Parked cars reuse the Kenney car kit that the traffic already loads (length in metres).
export const CARS = [['sedan', 4.6], ['sedan-sports', 4.5], ['suv', 4.7], ['suv-luxury', 4.9], ['van', 5.2]];
const SIZE = 1024;

async function decode(url, canvas, ctx) {
  const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(url))));
  const bmp = await createImageBitmap(blob);
  canvas.width = canvas.height = SIZE;
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  bmp.close?.();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

async function packGroup(base, names) {
  const n = names.length, layer = SIZE * SIZE * 4;
  const alb = new Uint8Array(layer * n), nor = new Uint8Array(layer * n);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const missing = [];
  // One layer at a time: the three images of a set share the canvas.
  for (let i = 0; i < n; i++) {
    const A = alb.subarray(i * layer, (i + 1) * layer), N = nor.subarray(i * layer, (i + 1) * layer);
    try {
      const c = await decode(`${base}/${names[i]}_c.jpg`, canvas, ctx);
      A.set(c);
      if (NORMALISE[names[i]]) {
        let sum = 0;
        for (let p = 0; p < SIZE * SIZE; p += 7) sum += (c[p * 4] + c[p * 4 + 1] + c[p * 4 + 2]) / 3;
        const k = NORMALISE[names[i]] / (sum / Math.ceil((SIZE * SIZE) / 7));
        for (let p = 0; p < SIZE * SIZE; p++) for (let q = 0; q < 3; q++) A[p * 4 + q] = Math.min(255, A[p * 4 + q] * k);
      }
      const r = await decode(`${base}/${names[i]}_r.jpg`, canvas, ctx);
      for (let p = 0; p < SIZE * SIZE; p++) A[p * 4 + 3] = r[p * 4];
      const nn = await decode(`${base}/${names[i]}_n.jpg`, canvas, ctx);
      for (let p = 0; p < SIZE * SIZE; p++) {
        N[p * 4] = nn[p * 4];
        N[p * 4 + 1] = nn[p * 4 + 1];
        N[p * 4 + 2] = 255;
        N[p * 4 + 3] = 255;
      }
    } catch {
      missing.push(names[i]);
      for (let p = 0; p < SIZE * SIZE; p++) {
        A[p * 4] = A[p * 4 + 1] = A[p * 4 + 2] = 150;
        A[p * 4 + 3] = 210;
        N[p * 4] = N[p * 4 + 1] = 128;
        N[p * 4 + 2] = N[p * 4 + 3] = 255;
      }
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, SIZE, SIZE, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), normal: mk(nor, false), names, missing };
}

// Flat grey layers, used if a whole group could not be built.
function dummyGroup(names) {
  const n = names.length, a = new Uint8Array(4 * 4 * 4 * n), nn = new Uint8Array(4 * 4 * 4 * n);
  for (let i = 0; i < a.length; i += 4) a.set([150, 150, 150, 210], i), nn.set([128, 128, 255, 255], i);
  const mk = (d, srgb) => {
    const t = new THREE.DataArrayTexture(d, 4, 4, n);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = t.magFilter = THREE.NearestFilter;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(a, true), normal: mk(nn, false), names, missing: names.slice() };
}

async function loadModel(loader, base, name) {
  try {
    const g = await loader.loadAsync(`${base}/${name}.glb`);
    g.scene.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    return g.scene;
  } catch {
    return null;
  }
}

async function loadCar(loader, base, [name, len]) {
  try {
    const g = await loader.loadAsync(`${base}/${name}.glb`);
    const root = g.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const k = len / size.z;
    root.scale.setScalar(k);
    root.position.set((-(box.min.x + box.max.x) / 2) * k, -box.min.y * k, (-(box.min.z + box.max.z) / 2) * k);
    const holder = new THREE.Group();
    holder.add(root);
    holder.updateMatrixWorld(true);
    holder.userData.dims = { len, wid: size.x * k, h: size.y * k };
    return holder;
  } catch {
    return null;
  }
}

async function loadLeaf(url) {
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(url))));
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

// base is the folder holding textures/pbr and models/props. Never throws.
export async function loadAssets(base = '') {
  const b = base ? base + '/' : '';
  const t0 = performance.now();
  const loader = new GLTFLoader();
  const [wall, ground, leaf, bark, cars, ...models] = await Promise.all([
    packGroup(`${b}textures/pbr`, WALL).catch(() => dummyGroup(WALL)),
    packGroup(`${b}textures/pbr`, GROUND).catch(() => dummyGroup(GROUND)),
    loadLeaf(`${b}textures/pbr/leaf.png`),
    loadLeaf(`${b}textures/pbr/bark_a_c.jpg`),
    Promise.all(CARS.map((c) => loadCar(loader, `${b}models/cars`, c))),
    ...MODELS.map((m) => loadModel(loader, `${b}models/props`, m)),
  ]);
  const assets = { wall, ground, leaf, bark, cars: cars.filter(Boolean), models: Object.fromEntries(MODELS.map((m, i) => [m, models[i]])), ms: Math.round(performance.now() - t0) };
  const missing = [...(wall?.missing || []), ...(ground?.missing || []), ...MODELS.filter((m) => !assets.models[m])];
  if (missing.length) console.warn('assets: missing', missing.join(', '));
  return assets;
}

export const layerOf = (list, name) => Math.max(0, list.indexOf(name));
