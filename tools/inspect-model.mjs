import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const buf = readFileSync('public/models/Xbot.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
new GLTFLoader().parse(ab, '', (g) => {
  const root = g.scene;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.geometry.computeBoundingBox();
      console.log('skinned', o.name, o.material.name, 'bbox', o.geometry.boundingBox.min.toArray().map(v=>v.toFixed(3)), o.geometry.boundingBox.max.toArray().map(v=>v.toFixed(3)));
      console.log(' world scale', new THREE.Vector3().setFromMatrixScale(o.matrixWorld).toArray(), 'bindMatrix scale', new THREE.Vector3().setFromMatrixScale(o.bindMatrix).toArray());
      console.log(' parent chain', (() => { let p = o, s = []; while (p) { s.push(`${p.name}[s=${p.scale.x.toFixed(3)} r=${p.rotation.x.toFixed(2)}]`); p = p.parent; } return s.join(' <- '); })());
    }
  });
  const hips = root.getObjectByName('mixamorigHips');
  console.log('hips world', hips && new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld).toArray());
  const head = root.getObjectByName('mixamorigHead');
  console.log('head world', head && new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).toArray());
  const lh = root.getObjectByName('mixamorigLeftHand');
  console.log('lefthand world', lh && new THREE.Vector3().setFromMatrixPosition(lh.matrixWorld).toArray());
  console.log('anims', g.animations.map((a) => `${a.name}:${a.duration.toFixed(2)}s/${a.tracks.length}`).join(' '));
  const box = new THREE.Box3().setFromObject(root);
  console.log('world box', box.min.toArray(), box.max.toArray());
}, (e) => console.error('ERR', e));
