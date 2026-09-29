import * as THREE from 'three';

// Small helpers to compose instanced prop templates out of boxes and cylinders.

export function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

export function cyl(rTop, rBot, h, sides = 8, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, sides);
  g.translate(x, y + h / 2, z);
  return g;
}

// Merge pieces { g, color, tint } into one indexed-free geometry with vertex colours and a tint mask
// (1: takes the instance colour, 0: stays as painted).
export function merge(pieces) {
  let n = 0;
  for (const p of pieces) n += p.g.index ? p.g.index.count : p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), tint = new Float32Array(n);
  let o = 0;
  for (const { g, color, tint: tt = 0 } of pieces) {
    const c = new THREE.Color(color);
    const P = g.attributes.position, N = g.attributes.normal;
    const cnt = g.index ? g.index.count : P.count;
    for (let i = 0; i < cnt; i++) {
      const k = g.index ? g.index.getX(i) : i;
      pos.set([P.getX(k), P.getY(k), P.getZ(k)], o * 3);
      nor.set([N.getX(k), N.getY(k), N.getZ(k)], o * 3);
      col.set([c.r, c.g, c.b], o * 3);
      tint[o] = tt;
      o++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  g.computeBoundingSphere();
  return g;
}

// One standard material for painted props: vertex colours, and the instance colour applied where aTint is 1.
export function propMaterial(extra = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, ...extra });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);'));
  };
  m.customProgramCacheKey = () => 'prop-tint';
  return m;
}

// Meshes of a loaded model with their node transforms baked in: [{ geometry, material }].
export function partsOf(root) {
  const parts = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    parts.push({ geometry: g, material: o.material });
  });
  return parts;
}

// Fill an InstancedMesh from a list of [matrixArray16, colourHex].
export function fillInstances(mesh, list) {
  const c = new THREE.Color();
  for (let k = 0; k < list.length; k++) {
    mesh.instanceMatrix.array.set(list[k][0], k * 16);
    if (list[k][1] !== undefined) mesh.setColorAt(k, c.setHex(list[k][1]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
