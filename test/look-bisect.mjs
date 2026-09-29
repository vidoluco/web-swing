// Which part of the look costs the frame time? Hides one category at a time and measures rAF spacing.
//   PORT=5227 node test/look-bisect.mjs [view]
import { startServer, launch, open } from './harness.mjs';
import { VIEWS, place } from './look-shots.mjs';
import { GPU_FN } from './look-gpu.mjs';

const view = process.argv[2] || 'street';
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, 'city=bucharest&shot=perch', errors);
  await place(page, VIEWS[view]);
  const gpu = () => page.evaluate(`(${GPU_FN})(window.__game, 24)`);
  const measure = () =>
    page.evaluate(
      (secs) =>
        new Promise((res) => {
          const a = [];
          let last = performance.now();
          const t0 = last;
          const f = (t) => {
            a.push(t - last);
            last = t;
            if (t - t0 < secs * 1000) requestAnimationFrame(f);
            else {
              a.shift();
              a.sort((x, y) => x - y);
              res({ p50: +a[Math.floor(a.length / 2)].toFixed(1), p95: +a[Math.floor(a.length * 0.95)].toFixed(1) });
            }
          };
          requestAnimationFrame(f);
        }),
      2.5,
    );
  const setVis = (name, v) =>
    page.evaluate(
      ([name, v]) => {
        const g = window.__game;
        const L = g.city.look;
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          let cat = 'other';
          if (m === L.trees_?.mat) cat = 'trees';
          else if (m === g.city.mats.building) cat = 'buildings';
          else if (m === L.props?.mat || m === L.props?.roofMat || m === L.props?.haloMat || m === L.props?.poolMat || m === L.props?.zebraMat || m === L.props?.stopMat) cat = 'props';
          else if (m === L.detail?.mat) cat = 'detail';
          else if ([g.city.mats.road, g.city.mats.sidewalk, g.city.mats.path, g.city.mats.plaza, g.city.mats.grass].includes(m)) cat = 'ground';
          if (cat === name) o.visible = v;
        });
      },
      [name, v],
    );
  console.log('all', await gpu(), JSON.stringify(await measure()));
  for (const cat of ['trees', 'buildings', 'props', 'detail', 'ground']) {
    await setVis(cat, false);
    console.log('without', cat, await gpu(), JSON.stringify(await measure()));
    await setVis(cat, true);
  }
} finally {
  await browser.close();
  srv.kill();
}
