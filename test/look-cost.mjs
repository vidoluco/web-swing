// Cost of the city look at fixed viewpoints: draw calls and triangles (renderer.info), frame time of the real-time
// loop (rAF, so it includes the GPU, which is shared with other jobs: compare runs made together), and ms per
// tick from simulate() (CPU only). Run it from a build's folder to measure that build:
//   PORT=5227 node test/look-cost.mjs [view ...]
import { startServer, launch, open } from './harness.mjs';
import { VIEWS, place } from './look-shots.mjs';
import { GPU_FN } from './look-gpu.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['street', 'blocuri', 'oldtown', 'roof'];
const SECS = +(process.env.SECS || 4);
const srv = await startServer();
const browser = await launch();
const errors = [];
const results = {};
try {
  const page = await open(browser, 'city=bucharest&shot=perch', errors);
  for (const name of names) {
    await place(page, VIEWS[name]);
    const r = await page.evaluate(async ([secs, gpuSrc]) => {
      const g = window.__game;
      const gpuMs = await (0, eval)(gpuSrc)(g);
      const gl = g.renderer.getContext();
      g.advance(0.05);
      for (let i = 0; i < 4; i++) g.renderer.render(g.scene, g.camera); // warm up: shader compiles, uploads
      gl.finish();
      const info = g.renderer.info;
      g.renderer.render(g.scene, g.camera);
      const calls = info.render.calls, tris = info.render.triangles;
      const N = 30;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) g.renderer.render(g.scene, g.camera); // scene only, no post
      const cpu = (performance.now() - t0) / N;
      gl.finish();
      const total = (performance.now() - t0) / N;
      // real frames: the display loop draws with the full post chain; rAF spacing includes the GPU
      const ft = await new Promise((res) => {
        const a = [];
        let last = performance.now();
        const t0 = last;
        const f = (t) => {
          a.push(t - last);
          last = t;
          if (t - t0 < secs * 1000) requestAnimationFrame(f);
          else res(a);
        };
        requestAnimationFrame(f);
      });
      ft.shift();
      ft.sort((x, y) => x - y);
      const s0 = performance.now();
      g.simulate(2);
      const tick = (performance.now() - s0) / 120;
      return { calls, tris, gpuMs, cpuMs: +cpu.toFixed(2), sceneMs: +total.toFixed(2), tickMs: +tick.toFixed(2), frameP50: +ft[Math.floor(ft.length / 2)].toFixed(1), frameP95: +ft[Math.floor(ft.length * 0.95)].toFixed(1) };
    }, [SECS, GPU_FN]);
    results[name] = r;
    console.log(name, JSON.stringify(r));
  }
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
