// The city look: every building style renders without shader errors, instanced props exist, the night uniform
// lights the windows, Brasov walls reach the slope, and the draw calls stay under a ceiling set from measurements.
// Usage: PORT=5227 node test/look.mjs   (exit code 1 on any failure)
import { startServer, launch, open } from './harness.mjs';
import { VIEWS, TERRAIN, place } from './look-shots.mjs';

const KINDS = ['glass', 'brick', 'monument', 'ribbon', 'panel', 'belle', 'interwar', 'house', 'baroque'];
// Measured on this branch (street 728, roof 723, blocuri 333, old town 385 calls) with a margin of a third.
const CALLS_CEILING = 1000;

const srv = await startServer();
const browser = await launch();
const errors = [];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};

// Counts the bright warm pixels of a PNG (lit windows), decoded in the page.
const brightWarm = (page, png) =>
  page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 130 && d[i] > d[i + 2] + 40) n++;
    return n;
  }, png.toString('base64'));

try {
  // ---------- Bucharest: the styles ----------
  const page = await open(browser, 'shot=perch', errors);
  const found = await page.evaluate(async () => {
    const g = window.__game;
    const spots = {};
    for (const [cx, cz] of [[0, 0], [-1200, -100], [-1400, -2800], [-6000, 700], [3900, -1100]]) {
      await g.city.streamAround(cx, cz, 800);
      for (const rec of g.city.recs.values()) {
        const w = rec.detail?.walls;
        if (!w) continue;
        for (let i = 0; i < w.length; i += 14) {
          const k = w[i + 6];
          if (spots[k] || w[i + 10] < 14 || w[i + 11] < 1 || w[i + 5] - w[i + 4] < 8) continue;
          const mx = (w[i] + w[i + 2]) / 2, mz = (w[i + 1] + w[i + 3]) / 2;
          spots[k] = { x: mx + w[i + 12] * 14, z: mz + w[i + 13] * 14, ax: mx, az: mz, y: g.city.groundAt(mx, mz) };
        }
      }
    }
    return spots;
  });
  // ribbon (OSM style 3) is rare in the Bucharest data: it may be missing, the seven others may not
  const missing = KINDS.slice(0, 8).filter((_, k) => !found[k] && k !== 3);
  check('every Bucharest building style but the rare ribbon has a wall in the data', missing.length === 0, { missing });

  const drawn = [];
  for (const k of Object.keys(found).map(Number)) {
    const s = found[k];
    const r = await page.evaluate(async (s) => {
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
      g.advance(1);
      g.renderer.render(g.scene, g.camera);
      const mesh = [];
      g.scene.traverse((o) => o.isMesh && o.visible && o.material === g.city.mats.building && mesh.push(o));
      const bad = g.renderer.info.programs.filter((p) => p.diagnostics && p.diagnostics.runnable === false).length;
      return { meshes: mesh.length, badPrograms: bad };
    }, s);
    drawn.push({ style: KINDS[k], ...r });
  }
  check('each style renders with the facade material and no failed shader program', drawn.length >= 7 && drawn.every((d) => d.meshes > 0 && d.badPrograms === 0), drawn);
  // ---------- instanced props ----------
  await place(page, VIEWS.street);
  const inst = await page.evaluate(() => {
    const g = window.__game;
    const L = g.city.look;
    const out = { trees: 0, props: 0, cars: 0, other: 0 };
    g.scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.visible) return;
      if (o.material === L.trees_.mat) out.trees += o.count;
      else if (o.material === L.props.mat || o.material === L.props.roofMat) out.props += o.count;
      else out.other += o.count;
    });
    return out;
  });
  check('trees and street furniture are instanced in the loaded chunks', inst.trees > 50 && inst.props > 20, inst);

  await page.close();

  // ---------- draw calls ----------
  const cp = await open(browser, 'shot=perch', errors);
  const calls = {};
  for (const name of ['street', 'roof', 'blocuri', 'oldtown']) {
    await place(cp, VIEWS[name]);
    calls[name] = await cp.evaluate(() => {
      const g = window.__game;
      g.renderer.render(g.scene, g.camera);
      g.renderer.info.reset?.();
      g.renderer.render(g.scene, g.camera);
      return g.renderer.info.render.calls;
    });
  }
  check(`draw calls stay under ${CALLS_CEILING} at four viewpoints`, Object.values(calls).every((c) => c > 100 && c < CALLS_CEILING), calls);
  await cp.close();

  // ---------- night ----------
  // A dark stand-in for the evening so that only uNight differs between the two frames.
  const night = await open(browser, 'shot=perch&sun=0.02&env=0.05&nopost', errors);
  await place(night, VIEWS.blocuri);
  const frame = async (v) => {
    await night.evaluate((v) => {
      const g = window.__game;
      g.city.look.uniforms.uNight.value = v;
      g.scene.traverse((o) => o.material?.uniforms?.turbidity && (o.visible = false));
      g.scene.background = null;
      g.scene.fog.color.set(0x05070c);
      g.advance(0.2);
    }, v);
    return brightWarm(night, await night.screenshot());
  };
  const day = await frame(0);
  const dark = await frame(1);
  check('night uniform lights the windows: many bright warm pixels at 1, few at 0', dark > 400 && dark > day * 4, { uNight0: day, uNight1: dark });
  await night.close();

  // ---------- Brasov: walls reach the slope ----------
  const bra = await open(browser, 'city=brasov&shot=perch', errors);
  await bra.evaluate(TERRAIN);
  await place(bra, VIEWS.brasov);
  const gaps = await bra.evaluate(() => {
    const g = window.__game;
    let walls = 0, samples = 0, gap = 0, worst = 0, sloped = 0, controlGap = 0;
    const kinds = new Set();
    g.scene.traverse((o) => {
      if (!o.isMesh || o.material !== g.city.mats.building) return;
      const P = o.geometry.attributes.position, I = o.geometry.attributes.aInfo, S = o.geometry.attributes.aSurf, G = o.geometry.attributes.aGeo;
      for (let i = 0; i + 1 < P.count; i++) {
        // a wall bottom vertex sits well below the floor level of its edge (info.z) and pairs with the next one
        if (S.getX(i) !== 0 || P.getY(i) > I.getZ(i) - 0.5) continue;
        const j = i + 1;
        if (S.getX(j) !== 0 || P.getY(j) > I.getZ(j) - 0.5 || G.getZ(i) !== G.getZ(j)) continue;
        kinds.add(I.getX(i));
        walls++;
        let lo = Infinity, hi = -Infinity;
        for (let s = 0; s <= 8; s++) {
          const f = s / 8;
          const x = P.getX(i) + (P.getX(j) - P.getX(i)) * f, z = P.getZ(i) + (P.getZ(j) - P.getZ(i)) * f;
          const y = P.getY(i) + (P.getY(j) - P.getY(i)) * f, gy = g.city.groundAt(x, z);
          lo = Math.min(lo, gy);
          hi = Math.max(hi, gy);
          samples++;
          if (y - gy > 0.05) (gap++, (worst = Math.max(worst, y - gy)));
          if (y - (gy - 2) > 0.05) controlGap++; // the same walls against a ground 2 m lower must show gaps
        }
        if (hi - lo > 0.5) sloped++;
      }
    });
    return { walls, samples, gap, worst: +worst.toFixed(2), sloped, controlGap, kinds: [...kinds] };
  });
  check('Brasov walls reach the slope: no wall bottom floats above the ground, on walls that do stand on a slope', gaps.walls > 200 && gaps.sloped > 5 && gaps.gap === 0, gaps);
  check('the gap check can fail: against a ground 2 m lower it reports gaps', gaps.controlGap > 0, { controlGap: gaps.controlGap });
  check('Brasov has baroque and house styles', gaps.kinds.includes(8) && gaps.kinds.includes(7), { kinds: gaps.kinds });
  await bra.close();
} finally {
  await browser.close();
  srv.kill();
}
check('no page errors, no console errors or shader warnings', errors.length === 0, [...new Set(errors)].slice(0, 5));
process.exit(results.every((x) => x.ok) ? 0 : 1);
