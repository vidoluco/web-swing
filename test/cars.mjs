// Screens and checks for traffic, car theft and driving. Usage: node test/cars.mjs
import { startServer, launch, open } from './harness.mjs';

const srv = await startServer();
const browser = await launch();
const errors = [];
const shot = async (page, name) => {
  await page.screenshot({ path: `shots/${name}.png` });
  console.log(name, JSON.stringify(await page.evaluate(() => window.__game.state())));
};
try {
  const page = await open(browser, 'shot=street', errors);
  await page.evaluate(() => window.__game.advance(4));
  // Stand on the pavement next to a moving car, looking at it.
  const info = await page.evaluate(() => {
    const g = window.__game;
    const cars = g.traffic.cars.filter((c) => c.mode === 'traffic').sort((a, b) => Math.hypot(a.x + 300, a.z - 12) - Math.hypot(b.x + 300, b.z - 12));
    const c = cars[0];
    const lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw);
    g.player.pos.set(c.x - lx * 7 - Math.sin(c.yaw) * 6, 0, c.z - lz * 7 - Math.cos(c.yaw) * 6);
    g.player.groundBox = null;
    g.look(Math.atan2(-(c.x - g.player.pos.x), -(c.z - g.player.pos.z)) + Math.PI, -0.12);
    return { type: c.type, speed: c.speed, x: c.x, z: c.z };
  });
  console.log('car', JSON.stringify(info));
  await page.evaluate(() => window.__game.advance(0.1));
  await shot(page, 'car-traffic');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const c = g.traffic.nearest(g.player.pos, 40);
    g.player.pos.set(c.x + Math.cos(c.yaw) * 2, 0, c.z - Math.sin(c.yaw) * 2);
    g.setInput({ carPressed: true });
    g.simulate(1 / 30, 1 / 30);
    g.setInput({ moveY: 1 });
    const s = g.simulate(4, 1 / 30);
    return { ...s, said: g.voice.lastLine };
  });
  console.log('drive', JSON.stringify(r));
  await page.evaluate(() => window.__game.look(window.__game.rig.yaw, -0.15));
  await page.evaluate(() => window.__game.advance(0.5));
  await shot(page, 'car-drive');
} finally {
  await browser.close();
  srv.kill();
}
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
