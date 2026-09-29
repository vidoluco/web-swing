// The six look viewpoints (street, blocuri, Old Town, swing, rooftop, Brasov) as screenshots plus renderer cost.
// Usage: PORT=5227 node test/look-shots.mjs <tag> [view ...]   -> shots/look/<tag>-<view>.png
// Brasov has no terrain in this branch (the terrain agent owns it), so the Brasov view builds a throw-away
// height mesh from dem.bin inside the page, only for the screenshot.
import { mkdirSync } from 'node:fs';
import { startServer, launch, open } from './harness.mjs';

export const VIEWS = {
  // name: city, player position, direction to look at (x, z), camera pitch and distance
  street: { city: 'bucharest', pos: [-236, 0, -318], at: [-236, -420], pitch: 0.12, dist: 6 },
  blocuri: { city: 'bucharest', pos: [-6040, 0, 722], at: [-6032, 762], pitch: 0.12, dist: 6 },
  oldtown: { city: 'bucharest', pos: [-300, 0, -520], at: [-330, -560], pitch: 0.1, dist: 6 },
  swing: { city: 'bucharest', swing: true },
  roof: { city: 'bucharest', roof: true },
  brasov: { city: 'brasov', pos: [30.9, null, 60.1], at: [327, 943], pitch: 0.05, dist: 6 },
  tampa: { city: 'brasov', pos: [420, null, 520], at: [30, 60], pitch: -0.12, dist: 9 },
};

// A rough terrain mesh for Brasov, injected only for screenshots.
const TERRAIN = async () => {
  const g = window.__game;
  const idx = await fetch('city/brasov/index.json').then((r) => r.json());
  const d = idx.dem;
  const data = new Float32Array(await fetch('city/brasov/' + d.file).then((r) => r.arrayBuffer()));
  const at = (x, z) => {
    const u = Math.min(Math.max((x - d.x0) / d.step, 0), d.w - 1), v = Math.min(Math.max((z - d.z0) / d.step, 0), d.h - 1);
    const i = Math.min(Math.floor(u), d.w - 2), j = Math.min(Math.floor(v), d.h - 2), fu = u - i, fv = v - j;
    const a = data[j * d.w + i], b = data[j * d.w + i + 1], c = data[(j + 1) * d.w + i], e = data[(j + 1) * d.w + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + e * fu) * fv;
  };
  g.city.groundAt = at;
  const gm = g.city.groundMesh;
  gm.visible = false;
  const x0 = -1500, x1 = 2400, z0 = -900, z1 = 2200, S = 15;
  const nx = Math.round((x1 - x0) / S), nz = Math.round((z1 - z0) / S);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), idxs = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * S, z = z0 + j * S, o = (j * (nx + 1) + i) * 3;
    pos[o] = x; pos[o + 1] = at(x, z) - 0.15; pos[o + 2] = z;
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
    idxs.push(a, c, b, b, c, e);
  }
  const geo = new gm.geometry.constructor();
  geo.setAttribute('position', new gm.geometry.attributes.position.constructor(pos, 3));
  geo.setIndex(idxs);
  geo.computeVertexNormals();
  g.city.look?.padArea(geo);
  const mesh = new gm.constructor(geo, g.city.mats.grass);
  mesh.receiveShadow = true;
  g.scene.add(mesh);
  // chunks built before the terrain existed were draped on 0: rebuild them
  for (const rec of g.city.recs.values()) if (rec.state === 'loaded') g.city.unloadChunk(rec);
  await g.city.streamAround(0, 0, 1500);
  return true;
};

// Puts the player and camera at a view and lets the chunks stream in. Works on any build of the game.
export async function place(page, v) {
  await page.evaluate(async (v) => {
    const g = window.__game;
    const yawTo = (px, pz, ax, az) => Math.atan2(-(ax - px), -(az - pz));
    if (v.pos) {
      const [px, , pz] = v.pos;
      g.city.focus = { x: px, z: pz };
      await g.city.streamAround(px, pz, 900);
      g.city.focus = null;
      const y = v.pos[1] ?? g.city.groundAt(px, pz);
      g.player.reset();
      g.player.pos.set(px, y, pz);
      g.player.groundBox = null;
      g.player.mode = 'ground';
      g.player.facing.set(v.at[0] - px, 0, v.at[1] - pz).normalize();
      g.rig.yaw = yawTo(px, pz, v.at[0], v.at[1]);
      g.rig.pitch = v.pitch;
      g.rig.dist = v.dist;
      g.player.idleTime = 2;
    } else if (v.roof) {
      g.shot('perch');
      g.rig.pitch = -0.25;
    } else if (v.swing) {
      g.shot('perch');
      g.setInput({ moveY: 1, jumpPressed: true });
    }
  }, v);
  if (v.swing) {
    await page.evaluate(() => window.__game.advance(0.4));
    await page.evaluate(() => window.__game.setInput({ moveY: 1, swing: true, swingPressed: true }));
    await page.evaluate(() => window.__game.advance(0.1));
    await page.evaluate(() => window.__game.setInput({ moveY: 1, swing: true }));
    await page.evaluate(() => window.__game.advance(2.2));
  } else await page.evaluate(() => window.__game.advance(1.2));
}

export async function shoot(browser, errors, tag, names) {
  mkdirSync('shots/look', { recursive: true });
  const out = [];
  let page = null, cur = null;
  for (const name of names) {
    const v = VIEWS[name];
    if (!v) throw new Error('unknown view ' + name);
    if (cur !== v.city) {
      await page?.close();
      page = await open(browser, `city=${v.city}&shot=perch${process.env.Q ? '&' + process.env.Q : ''}`, errors);
      cur = v.city;
      if (v.city === 'brasov') await page.evaluate(TERRAIN);
    }
    await place(page, v);
    await page.screenshot({ path: `shots/look/${tag}-${name}.png` });
    const info = await page.evaluate(() => {
      const g = window.__game;
      g.renderer.render(g.scene, g.camera);
      const i = g.renderer.info;
      return { calls: i.render.calls, tris: i.render.triangles };
    });
    out.push({ name, ...info });
    console.log(name, JSON.stringify(info));
  }
  await page?.close();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tag = process.argv[2] || 'x';
  const names = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(VIEWS);
  const srv = await startServer();
  const browser = await launch();
  const errors = [];
  try {
    await shoot(browser, errors, tag, names);
  } finally {
    await browser.close();
    srv.kill();
  }
  if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
}
