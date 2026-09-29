// Records a ~32 s showcase to shots/showcase.mp4: swinging, stealing a car on Bd. Unirii,
// drinks at the Big Ben Pub, a drunk walk and a swing out. Fixed 30 fps timestep.
import { startServer, launch, open } from './harness.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const srv = await startServer();
const browser = await launch();
const errors = [];
let n = 0;
rmSync('shots/frames', { recursive: true, force: true });
mkdirSync('shots/frames', { recursive: true });
try {
  const page = await open(browser, 'demo', errors);
  // Each frame runs `step(g, i)` in the page, advances 1/30 s and saves a picture.
  const frames = async (count, step, arg) => {
    for (let i = 0; i < count; i++) {
      await page.evaluate(([src, i, arg]) => {
        const g = window.__game;
        new Function('g', 'i', 'arg', src)(g, i, arg);
        g.advance(1 / 30);
      }, [step, i, arg]);
      await page.screenshot({ path: `shots/frames/f${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90 });
    }
  };
  const quiet = (secs) => page.evaluate((s) => window.__game.simulate(s, 1 / 30), secs);

  // 1. Autopilot swinging from the start tower.
  await frames(300, '');

  // 2. Down on Bd. Unirii next to a car in traffic, steal it and drive off.
  await page.evaluate(() => {
    const g = window.__game;
    g.stopPilot();
    g.setInput(null);
    g.player.reset();
    g.player.pos.set(-300, 0, 12);
    g.player.groundBox = null;
  });
  await quiet(6);
  await page.evaluate(() => {
    const g = window.__game;
    // A car, not a truck, with at least 150 m of open road ahead.
    const clear = (c) => !g.city.raycast({ x: c.x, y: 1, z: c.z, clone() { return this; } }.x !== undefined ? new g.player.pos.constructor(c.x, 1, c.z) : null, new g.player.pos.constructor(Math.sin(c.yaw), 0, Math.cos(c.yaw)), 150);
    const cars = g.traffic.cars.filter((c) => c.mode === 'traffic' && /sedan|taxi|police|suv/.test(c.type) && clear(c));
    cars.sort((a, b) => Math.hypot(a.x + 300, a.z - 12) - Math.hypot(b.x + 300, b.z - 12));
    const c = cars[0] || g.traffic.cars[0];
    c.speed = 0;
    c.cruise = 0;
    const lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw), fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    g.player.pos.set(c.x + lx * 2.2 - fx * 1.5, 0, c.z + lz * 2.2 - fz * 1.5);
    g.player.groundBox = null;
    g.look(Math.atan2(-fx, -fz) + 0.9, -0.12);
    window.__car = c;
  });
  await frames(20, '');
  await frames(1, "g.setInput({ carPressed: true });");
  await frames(210, "g.setInput({ moveY: 1 });");
  await frames(20, "g.setInput(i === 0 ? { carPressed: true } : {});");

  // 3. The Big Ben Pub: tuica, then beer, then a drunk walk and a swing out.
  await page.evaluate(() => {
    const g = window.__game;
    g.setInput(null);
    let best = null;
    for (const rec of g.city.recs.values()) for (const p of rec.pois || []) if (/Big Ben/.test(p.name)) best = p;
    if (!best) for (const rec of g.city.recs.values()) for (const p of rec.pois || []) if (p.kind === 0 && !best) best = p;
    g.city.settlePoi(best);
    g.player.reset();
    g.player.pos.set(best.x + best.nx * 7, 0, best.z + best.nz * 7);
    g.player.groundBox = null;
    g.drinks.scanT = 0;
    window.__bar = best;
  });
  await quiet(0.2);
  const walkTo = `
    const it = g.drinks.list.find((x) => x.obj.visible && x.poi === window.__bar && x.kind === arg);
    if (!it) { g.setInput({}); return; }
    const dx = it.x - g.player.pos.x, dz = it.z - g.player.pos.z;
    g.look(Math.atan2(-dx, -dz), -0.18);
    g.setInput(Math.hypot(dx, dz) > 0.6 ? { moveY: 0.55 } : {});`;
  await frames(75, walkTo, 'tuica');
  await frames(20, "g.setInput({});");
  await frames(75, walkTo, 'beer');
  await frames(20, "g.setInput({});");
  await frames(110, "if (i === 0) g.look(g.rig.yaw + Math.PI, -0.1); g.setInput({ moveY: 1 });");
  await frames(12, "g.setInput({ moveY: 1, jumpPressed: i === 0, jump: true });");
  await frames(110, "g.setInput({ moveY: 1, swing: true });");
  console.log('state', JSON.stringify(await page.evaluate(() => window.__game.state())), 'said', await page.evaluate(() => window.__game.voice.lastLine));
} finally {
  await browser.close();
  srv.kill();
}
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', 'shots/frames/f%04d.jpg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', 'shots/showcase.mp4']);
rmSync('shots/frames', { recursive: true, force: true });
console.log(`shots/showcase.mp4, ${n} frames`);
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
