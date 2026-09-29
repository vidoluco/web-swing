// Scratch: finds a street next to prefab blocks around a point. node test/probe-blocks.mjs x z
import { startServer, launch, open } from './harness.mjs';
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, 'shot=perch', errors);
  const [x, z] = [+process.argv[2], +process.argv[3]];
  const res = await page.evaluate(async ([x, z]) => {
    const g = window.__game;
    await g.city.streamAround(x, z, 700);
    const out = [];
    for (const p of g.city.prisms) {
      if (p.style !== 4 || p.y1 - p.y0 < 20) continue;
      const cx = (p.minx + p.maxx) / 2, cz = (p.minz + p.maxz) / 2;
      if (Math.hypot(cx - x, cz - z) > 400) continue;
      // nearest road vertex
      let best = null;
      for (const r of g.city.recs.values()) for (const rd of r.roads || []) for (let i = 0; i < rd.pts.length; i += 2) {
        const d = Math.hypot(rd.pts[i] - cx, rd.pts[i + 1] - cz);
        if (rd.w >= 7 && (!best || d < best.d)) best = { d, x: rd.pts[i], z: rd.pts[i + 1], w: rd.w };
      }
      if (best && best.d < 60) out.push({ cx: Math.round(cx), cz: Math.round(cz), h: Math.round(p.y1 - p.y0), len: Math.round(p.maxx - p.minx), road: best });
      if (out.length > 6) break;
    }
    return out;
  }, [x, z]);
  console.log(JSON.stringify(res));
} finally {
  await browser.close();
  srv.kill();
}
