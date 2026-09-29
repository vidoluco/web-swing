// Proof shot: swinging west along Bd. Unirii toward the Palace of Parliament.
import { startServer, launch, open } from './harness.mjs';
const srv = await startServer();
const browser = await launch();
const errors = [];
const page = await open(browser, 'shot=street', errors, 1920, 1080);
const Z = +(process.env.Z || 6);
const out = await page.evaluate(async (Z) => {
  const g = window.__game;
  const p = g.player;
  p.reset();
  p.pos.set(-250, 30, Z);
  p.vel.set(-28, 4, 0);
  p.mode = 'air';
  g.look(Math.PI / 2, -0.12);
  g.setInput({ moveY: 1, swing: true });
  const shots = [];
  for (const t of [0.9, 0.6, 0.7]) {
    g.advance(t);
    shots.push(g.state());
  }
  return shots;
}, Z);
await page.screenshot({ path: `shots/proof-boulevard-${Z}.png` });
console.log(JSON.stringify(out));
if (errors.length) console.log(errors.join('\n'));
await browser.close();
srv.kill();
