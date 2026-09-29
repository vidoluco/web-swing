// One screenshot per building kind (0 glass ... 8 baroque): stands 14 m in front of a long wall of that kind.
// Usage: PORT=5227 node test/look-kinds.mjs <tag> [city] [kinds...]
import { mkdirSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';
const NAMES = ['glass', 'brick', 'monument', 'ribbon', 'panel', 'belle', 'interwar', 'house', 'baroque'];
const tag = process.argv[2] || 'k';
const city = process.argv[3] || 'bucharest';
const kinds = process.argv.slice(4).length ? process.argv.slice(4).map(Number) : NAMES.map((_, i) => i);
mkdirSync('shots/look', { recursive: true });
const srv = await startServer();
const browser = await launch();
const errors = [];
try {
  const page = await open(browser, `city=${city}&shot=perch`, errors);
  for (const k of kinds) {
    const spot = await page.evaluate(async (kind) => {
      const g = window.__game;
      const centres = { bucharest: [[0, 0], [-1200, -100], [-1400, -2800], [-6000, 700], [3900, -1100]], brasov: [[0, 0], [300, 300]] }[g.cityId];
      for (const [cx, cz] of centres) {
        await g.city.streamAround(cx, cz, 800);
        for (const rec of g.city.recs.values()) {
          const w = rec.detail?.walls;
          if (!w) continue;
          for (let i = 0; i < w.length; i += 14) {
            if (w[i + 6] !== kind || w[i + 10] < 14 || w[i + 11] < 1 || w[i + 5] - w[i + 4] < 8) continue;
            const mx = (w[i] + w[i + 2]) / 2, mz = (w[i + 1] + w[i + 3]) / 2;
            return { x: mx + w[i + 12] * 14, z: mz + w[i + 13] * 14, ax: mx, az: mz, y: g.city.groundAt(mx, mz), L: w[i + 10], h: w[i + 5] - w[i + 4] };
          }
        }
      }
      return null;
    }, k);
    if (!spot) {
      console.log(NAMES[k], 'no wall found');
      continue;
    }
    await page.evaluate(async (s) => {
      const g = window.__game;
      g.city.focus = { x: s.x, z: s.z };
      await g.city.streamAround(s.x, s.z, 600);
      g.city.focus = null;
      g.player.reset();
      g.player.pos.set(s.x, s.y, s.z);
      g.player.groundBox = null;
      g.player.mode = 'ground';
      g.player.facing.set(s.ax - s.x, 0, s.az - s.z).normalize();
      g.rig.yaw = Math.atan2(-(s.ax - s.x), -(s.az - s.z));
      g.rig.pitch = 0.22;
      g.rig.dist = 5;
      g.player.idleTime = 2;
    }, spot);
    await page.evaluate(() => window.__game.advance(1));
    await page.screenshot({ path: `shots/look/${tag}-kind-${NAMES[k]}.png` });
    console.log(NAMES[k], JSON.stringify(spot));
  }
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
