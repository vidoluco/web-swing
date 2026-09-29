// Real-time frame rate while the demo autopilot swings across the city (rAF, not advance()).
import { startServer, launch, open } from './harness.mjs';

const q = process.argv[2] || 'city=bucharest&demo';
const secs = +(process.argv[3] || 30);
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, q, errors);
  const samples = [];
  await page.evaluate(() => {
    window.__ft = [];
    let last = performance.now();
    const f = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  for (let t = 0; t < secs; t += 5) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await page.evaluate(() => {
      const ft = window.__ft.splice(0);
      ft.sort((a, b) => a - b);
      return { ...window.__game.state(), frames: ft.length, p50: ft[Math.floor(ft.length / 2)], p95: ft[Math.floor(ft.length * 0.95)], max: ft[ft.length - 1] };
    });
    samples.push(st);
    console.log(`t=${t + 5}s fps=${(st.frames / 5).toFixed(0)} p50=${st.p50?.toFixed(1)}ms p95=${st.p95?.toFixed(1)}ms max=${st.max?.toFixed(0)}ms loaded=${st.loaded} prisms=${st.prisms} pos=${st.pos} mode=${st.mode}`);
  }
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
