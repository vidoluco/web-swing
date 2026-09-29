// Meshes, instances and triangles by category in the loaded scene (not culled by the camera).
//   PORT=5227 node test/look-stats.mjs [view]
import { startServer, launch, open } from './harness.mjs';
import { VIEWS, place } from './look-shots.mjs';

const view = process.argv[2] || 'street';
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, 'city=bucharest&shot=perch', errors);
  await place(page, VIEWS[view]);
  const res = await page.evaluate(() => {
    const g = window.__game;
    const L = g.city.look;
    const out = {};
    g.camera.updateMatrixWorld();
    const M = g.camera.constructor;
    void M;
    g.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const m = o.material;
      let cat = 'other';
      if (m === L.trees_?.mat) cat = 'trees';
      else if (m === g.city.mats.building) cat = 'buildings';
      else if (m === L.props?.roofMat) cat = 'roofclutter';
      else if (m === L.props?.mat) cat = 'props';
      else if ([L.props?.haloMat, L.props?.poolMat, L.props?.zebraMat, L.props?.stopMat].includes(m)) cat = 'paint+glow';
      else if (m === L.detail?.mat) cat = 'detail';
      else if ([g.city.mats.road, g.city.mats.sidewalk, g.city.mats.path, g.city.mats.plaza, g.city.mats.grass].includes(m)) cat = 'ground';
      else if (m === g.city.mats.water) cat = 'water';
      const geo = o.geometry;
      const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      const c = (out[cat] ||= { meshes: 0, instances: 0, tris: 0, shadow: 0 });
      c.meshes++;
      c.instances += n;
      c.tris += tris * n;
      if (o.castShadow) c.shadow += tris * n;
    });
    for (const c of Object.values(out)) (c.tris = Math.round(c.tris / 1000) + 'k'), (c.shadow = Math.round(c.shadow / 1000) + 'k');
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
} finally {
  await browser.close();
  srv.kill();
}
